import {promises as fs} from 'node:fs';
import path from 'node:path';
import binCheck from '@xhmikosr/bin-check';
import binaryVersionCheck from 'binary-version-check';
import downloader from '@xhmikosr/downloader';
import osFilterObject from '@xhmikosr/os-filter-obj';

/**
 * @typedef {Object} BinWrapperOptions
 * @property {number} [strip=1] - Number of leading paths to strip from the archive.
 * @property {boolean} [skipCheck=false] - Skip binary checks.
 * @property {object} [decompress={}] - Extra options forwarded to @xhmikosr/decompress (e.g. `{ plugins: [...] }`). The `strip` key here is ignored; use the top-level `strip` option.
 */

/**
 * @typedef {Object} SourceFile
 * @property {string} url - The URL of the file.
 * @property {string} [os] - The operating system the file is for.
 * @property {string} [arch] - The architecture the file is for.
 */

export default class BinWrapper {
	/**
	 * @param {BinWrapperOptions} [options]
	 */
	constructor(options = {}) {
		const {strip = 1, skipCheck = false, decompress = {}} = options;

		this.options = {
			strip: Math.max(0, strip),
			skipCheck,
			decompress: {...decompress},
		};
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
			return this._src;
		}

		this._src ||= [];
		this._src.push({url: src, os, arch});

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
			return this._dest;
		}

		this._dest = dest;

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
			return this._use;
		}

		this._use = bin;

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
			return this._version;
		}

		this._version = range;

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
	 * Get the source URLs matching the current OS and arch
	 *
	 * @returns {string[]}
	 */
	resolvedUrls() {
		return osFilterObject(this.src() || []).map(file => file.url);
	}

	/**
	 * Check for the binary and download it if missing, then optionally verify it works.
	 *
	 * @param {string[]} [cmd=['--version']] - Arguments passed to the binary when checking it.
	 * @returns {Promise<void>}
	 */
	async run(cmd = ['--version']) {
		await this.findExisting();

		if (this.options.skipCheck) {
			return;
		}

		await this.runCheck(cmd);
	}

	/**
	 * Run binary check
	 *
	 * @param {string[]} cmd - Arguments to pass to the binary.
	 * @returns {Promise<void>}
	 * @api private
	 */
	async runCheck(cmd) {
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
	 * @api private
	 */
	async findExisting() {
		try {
			await fs.access(this.path());
		} catch (error) {
			if (error?.code === 'ENOENT') {
				await this.download();
			} else {
				throw error;
			}
		}
	}

	/**
	 * Download files matching the current OS/arch and make them executable.
	 *
	 * @returns {Promise<void>}
	 * @api private
	 */
	async download() {
		const urls = this.resolvedUrls();

		if (urls.length === 0) {
			throw new Error('No binary found matching your system. It\'s probably not supported.');
		}

		const results = await Promise.all(urls.map(url =>
			downloader(url, this.dest(), {
				extract: true,
				decompress: {
					...this.options.decompress,
					strip: this.options.strip,
				},
			})));

		const resultFiles = results.flatMap((item, index) => {
			if (Array.isArray(item)) {
				return item.map(file => file.path);
			}

			const parsedUrl = new URL(urls[index]);

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
