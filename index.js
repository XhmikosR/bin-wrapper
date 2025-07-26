import {promises as fs} from 'node:fs';
import path from 'node:path';
import binCheck from '@xhmikosr/bin-check';
import binVersionCheck from 'bin-version-check';
import downloader from '@xhmikosr/downloader';
import osFilterObject from '@xhmikosr/os-filter-obj';
import semver from 'semver';

/**
 * @typedef {Object} BinWrapperOptions
 * @property {number} [strip=1] - Number of leading paths to strip from the archive.
 * @property {boolean} [skipCheck=false] - Skip binary checks.
 */

/**
 * @typedef {Object} SourceFile
 * @property {string} url - The URL of the file.
 * @property {string} [os] - The operating system the file is for.
 * @property {string} [arch] - The architecture the file is for.
 */

/**
 * Initialize a new `BinWrapper`
 *
 * @param {BinWrapperOptions} [options={}] - Options for the BinWrapper instance.
 * @api public
 */
export default class BinWrapper {
	#options;
	#src;
	#dest;
	#use;
	#version;

	/**
	 * @param {BinWrapperOptions} [options={}]
	 */
	constructor(options = {}) {
		this.#options = options;

		if (this.#options.strip <= 0) {
			this.#options.strip = 0;
		// eslint-disable-next-line logical-assignment-operators
		} else if (!this.#options.strip) {
			this.#options.strip = 1;
		}
	}

	/**
	 * Get or set files to download
	 *
	 * @param {string} [src] - The source URL of the file.
	 * @param {string} [os] - The operating system the file is for.
	 * @param {string} [arch] - The architecture the file is for.
	 * @returns {SourceFile[]|this} - Returns the source files if no arguments are provided, otherwise returns `this`.
	 * @api public
	 */
	src(src, os, arch) {
		if (arguments.length === 0) {
			return this.#src;
		}

		try {
			const url = new URL(src);
			const allowedProtocols = ['http:', 'https:'];
			if (!allowedProtocols.includes(url.protocol)) {
				throw new Error(`Invalid protocol: ${url.protocol}`);
			}
		} catch {
			throw new Error(`Invalid URL: ${src}`);
		}

		this.#src ||= [];
		this.#src.push({url: src, os, arch});

		return this;
	}

	/**
	 * Get or set the destination
	 *
	 * @param {string} [dest] - The destination path.
	 * @returns {string|this} - Returns the destination if no arguments are provided, otherwise returns `this`.
	 * @api public
	 */
	dest(dest) {
		if (arguments.length === 0) {
			return this.#dest;
		}

		this.#dest = path.resolve(dest);
		return this;
	}

	/**
	 * Get or set the binary
	 *
	 * @param {string} [bin] - The binary name.
	 * @returns {string|this} - Returns the binary name if no arguments are provided, otherwise returns `this`.
	 * @api public
	 */
	use(bin) {
		if (arguments.length === 0) {
			return this.#use;
		}

		this.#use = bin;
		return this;
	}

	/**
	 * Get or set a semver range to test the binary against
	 *
	 * @param {string} [range] - The semver range.
	 * @returns {string|this} - Returns the semver range if no arguments are provided, otherwise returns `this`.
	 * @api public
	 */
	version(range) {
		if (arguments.length === 0) {
			return this.#version;
		}

		if (!semver.validRange(range)) {
			throw new Error(`Invalid version range: "${range}"`);
		}

		this.#version = range;
		return this;
	}

	/**
	 * Get path to the binary
	 *
	 * @returns {string} - The full path to the binary.
	 * @api public
	 */
	path() {
		const resolvedDest = path.resolve(this.dest());
		const resolvedBinary = path.resolve(resolvedDest, this.use());

		if (!resolvedBinary.startsWith(resolvedDest)) {
			throw new Error('Invalid binary path: Directory traversal detected');
		}

		return resolvedBinary;
	}

	/**
	 * Run
	 *
	 * @param {string[]} [cmd=['--version']] - The command to run.
	 * @returns {Promise<void>} - Resolves when the command completes.
	 * @api public
	 */
	async run(cmd = ['--version']) {
		await this.#findExisting();

		if (this.#options.skipCheck) {
			return;
		}

		await this.#runCheck(cmd);
	}

	/**
	 * Run binary check
	 *
	 * @param {string[]} cmd - The command to run.
	 * @returns {Promise<void>} - Resolves when the check completes.
	 */
	async #runCheck(cmd) {
		if (!Array.isArray(cmd)) {
			throw new TypeError('Invalid command: argument must be an array');
		}

		const works = await binCheck(this.path(), cmd);
		if (!works) {
			throw new Error(
				`The "${this.path()}" binary doesn't seem to work correctly`,
			);
		}

		if (this.version()) {
			await binVersionCheck(this.path(), this.version());
		}
	}

	/**
	 * Find existing files
	 *
	 * @returns {Promise<void>} - Resolves when the files are found or downloaded.
	 */
	async #findExisting() {
		try {
			await fs.access(this.path());
		} catch (error) {
			if (error?.code === 'ENOENT') {
				await this.#download();
			} else {
				throw new Error(`An error occurred while checking for the binary:\n${error.message}`);
			}
		}
	}

	/**
	 * Download files
	 *
	 * @returns {Promise<void>} - Resolves when the files are downloaded and set up.
	 */
	async #download() {
		const files = osFilterObject(this.src() || []);

		if (files.length === 0) {
			throw new Error('No binary found matching your system. It\'s probably not supported.');
		}

		const urls = files.map(file => file.url);

		const results = await Promise.all(
			urls.map(url =>
				downloader(url, this.dest(), {
					extract: true,
					decompress: {
						strip: this.#options.strip,
					},
				}),
			),
		);

		const resultFiles = results.flatMap((item, index) => {
			if (Array.isArray(item)) {
				return item.map(file => file.path);
			}

			const parsedUrl = new URL(files[index].url);
			const parsedPath = path.parse(parsedUrl.pathname);

			return parsedPath.base;
		});

		await Promise.all(
			resultFiles.map(file => {
				const resolvedFile = path.join(this.dest(), file);
				if (!resolvedFile.startsWith(path.resolve(this.dest()))) {
					throw new Error('Invalid file path: Directory traversal detected');
				}

				return fs.chmod(resolvedFile, 0o755);
			}),
		);
	}
}
