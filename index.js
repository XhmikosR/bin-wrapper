import {promises as fs} from 'node:fs';
import path from 'node:path';
import binCheck from '@xhmikosr/bin-check';
import binaryVersionCheck from 'binary-version-check';
import downloader from '@xhmikosr/downloader';
import osFilterObject from '@xhmikosr/os-filter-obj';
import semver from 'semver';

/**
 * @typedef {Object} BinWrapperOptions
 * @property {number} [strip=1] - Number of leading paths to strip from the archive.
 * @property {boolean} [skipCheck=false] - Skip binary checks.
 * @property {string[]} [allowedProtocols=['http:','https:']] - URL protocols accepted by `src()`.
 */

/**
 * @typedef {Object} SourceFile
 * @property {string} url - The URL of the file.
 * @property {string} [os] - The operating system the file is for.
 * @property {string} [arch] - The architecture the file is for.
 */

export default class BinWrapper {
	#options;
	#src;
	#dest;
	#use;
	#version;

	/**
	 * @param {BinWrapperOptions} [options]
	 */
	constructor(options = {}) {
		const {strip = 1, skipCheck = false, allowedProtocols = ['http:', 'https:']} = options;

		if (!Number.isInteger(strip) || strip < 0) {
			throw new TypeError('options.strip must be a non-negative integer');
		}

		if (typeof skipCheck !== 'boolean') {
			throw new TypeError('options.skipCheck must be a boolean');
		}

		if (!Array.isArray(allowedProtocols) || allowedProtocols.length === 0 || !allowedProtocols.every(p => typeof p === 'string' && p.length > 1 && p.endsWith(':'))) {
			throw new TypeError('options.allowedProtocols must be a non-empty array of protocol strings ending with ":" (e.g. "https:")');
		}

		this.#options = {strip, skipCheck, allowedProtocols};
	}

	/**
	 * Get or set files to download
	 *
	 * @param {string} [src] - The source URL of the file.
	 * @param {string} [os] - The operating system the file is for.
	 * @param {string} [arch] - The architecture the file is for.
	 * @returns {SourceFile[]|undefined|this} - Returns the source files if no arguments are provided, otherwise returns `this`.
	 */
	src(src, os, arch) {
		if (arguments.length === 0) {
			return this.#src;
		}

		let parsed;
		try {
			parsed = new URL(src);
		} catch {
			throw new Error(`Invalid URL: ${src}`);
		}

		if (!this.#options.allowedProtocols.includes(parsed.protocol)) {
			throw new Error(`Invalid protocol: ${parsed.protocol}`);
		}

		this.#src ||= [];
		this.#src.push({url: src, os, arch});

		return this;
	}

	/**
	 * Get or set the destination
	 *
	 * @param {string} [dest] - The destination path.
	 * @returns {string|undefined|this} - Returns the destination if no arguments are provided, otherwise returns `this`.
	 */
	dest(dest) {
		if (arguments.length === 0) {
			return this.#dest;
		}

		this.#dest = dest;

		return this;
	}

	/**
	 * Get or set the binary
	 *
	 * @param {string} [bin] - The binary name.
	 * @returns {string|undefined|this} - Returns the binary name if no arguments are provided, otherwise returns `this`.
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
	 * @returns {string|undefined|this} - Returns the semver range if no arguments are provided, otherwise returns `this`.
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
	 */
	path() {
		return path.join(this.dest(), this.use());
	}

	/**
	 * Check for the binary and download it if missing, then optionally verify it works.
	 *
	 * @param {string[]} [cmd=['--version']] - Arguments passed to the binary when checking it.
	 * @returns {Promise<void>}
	 */
	async run(cmd = ['--version']) {
		if (!Array.isArray(cmd)) {
			throw new TypeError('Invalid command: argument must be an array');
		}

		await this.#findExisting();

		if (this.#options.skipCheck) {
			return;
		}

		await this.#runCheck(cmd);
	}

	/**
	 * Run binary check
	 *
	 * @param {string[]} cmd - Arguments to pass to the binary.
	 * @returns {Promise<void>}
	 */
	async #runCheck(cmd) {
		const works = await binCheck(this.path(), cmd);
		if (!works) {
			throw new Error(`The "${this.path()}" binary doesn't seem to work correctly`);
		}

		if (this.version()) {
			await binaryVersionCheck(this.path(), this.version());
		}
	}

	/**
	 * Check whether the binary exists; download it if not.
	 *
	 * @returns {Promise<void>}
	 */
	async #findExisting() {
		try {
			await fs.access(this.path());
		} catch (error) {
			if (error?.code === 'ENOENT') {
				await this.#download();
			} else {
				throw error;
			}
		}
	}

	/**
	 * Download files matching the current OS/arch and make them executable.
	 *
	 * @returns {Promise<void>}
	 */
	async #download() {
		const files = osFilterObject(this.src() || []);

		if (files.length === 0) {
			throw new Error('No binary found matching your system. It\'s probably not supported.');
		}

		const urls = files.map(file => file.url);

		const results = await Promise.all(urls.map(url =>
			downloader(url, this.dest(), {
				extract: true,
				decompress: {
					strip: this.#options.strip,
				},
			})));

		const resultFiles = results.flatMap((item, index) => {
			if (Array.isArray(item)) {
				return item.map(file => file.path);
			}

			const parsedUrl = new URL(files[index].url);

			return path.parse(parsedUrl.pathname).base;
		});

		await Promise.all(resultFiles
			.filter(Boolean)
			.map(async file => {
				try {
					await fs.chmod(path.join(this.dest(), file), 0o755);
				} catch (error) {
					// We guess the saved name from the URL, but the downloader may
					// have used a different one, so skip a missing file.
					if (error?.code !== 'ENOENT') {
						throw error;
					}
				}
			}));
	}
}
