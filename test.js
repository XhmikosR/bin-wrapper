import fs, {promises as fsP} from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {fileURLToPath} from 'node:url';
import {isexe} from 'isexe';
import nock from 'nock';
import {temporaryDirectory} from 'tempy';
import test from 'ava';
import decompressTarxz from '@felipecrs/decompress-tarxz';
import BinWrapper from './index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const fixture = path.join.bind(path, __dirname, 'fixtures');
const isWindows = process.platform === 'win32';
const binary = isWindows ? 'gifsicle.exe' : 'gifsicle';

const removeDir = async dir => fsP.rm(dir, {force: true, recursive: true});

const pathExists = async path => {
	try {
		await fsP.access(path);
		return true;
	} catch {
		return false;
	}
};

test.beforeEach(() => {
	nock('http://foo.com')
		.get('/gifsicle.tar.gz')
		.replyWithFile(200, fixture(`gifsicle-${process.platform}.tar.gz`))
		.get('/gifsicle-darwin.tar.gz')
		.replyWithFile(200, fixture('gifsicle-darwin.tar.gz'))
		.get('/gifsicle-win32.tar.gz')
		.replyWithFile(200, fixture('gifsicle-win32.tar.gz'))
		.get('/test.js')
		.replyWithFile(200, __filename)
		.get('/gifsicle-linux.tar.xz')
		.replyWithFile(200, fixture('gifsicle-linux.tar.xz'));
});

test('expose a constructor', t => {
	t.is(typeof BinWrapper, 'function');
});

test('add a source', t => {
	const bin = new BinWrapper().src('http://foo.com/bar.tar.gz');
	t.is(bin.src()[0].url, 'http://foo.com/bar.tar.gz');
});

test('add a source to a specific os', t => {
	const bin = new BinWrapper().src('http://foo.com', process.platform);
	t.is(bin.src()[0].os, process.platform);
});

test('set destination directory', t => {
	const bin = new BinWrapper().dest(path.join(__dirname, 'foo'));
	t.is(bin.dest(), path.join(__dirname, 'foo'));
});

test('set which file to use as the binary', t => {
	const bin = new BinWrapper().use('foo');
	t.is(bin.use(), 'foo');
});

test('set a version range to test against', t => {
	const bin = new BinWrapper().version('1.0.0');
	t.is(bin.version(), '1.0.0');
});

test('get the binary path', t => {
	const bin = new BinWrapper()
		.dest('tmp')
		.use('foo');

	t.is(bin.path(), path.join('tmp', 'foo'));
});

test('resolvedUrls returns an untagged source', t => {
	const bin = new BinWrapper().src('http://foo.com/bar.tar.gz');
	t.deepEqual(bin.resolvedUrls(), ['http://foo.com/bar.tar.gz']);
});

test('resolvedUrls returns empty when no source matches the os', t => {
	const bin = new BinWrapper().src('http://foo.com/bar.tar.gz', 'nonexistent-os');
	t.deepEqual(bin.resolvedUrls(), []);
});

test('resolvedUrls returns empty when no source is set', t => {
	t.deepEqual(new BinWrapper().resolvedUrls(), []);
});

test('verify that a binary is working', async t => {
	const temporaryDir = temporaryDirectory();
	const bin = new BinWrapper()
		.src('http://foo.com/gifsicle.tar.gz')
		.dest(temporaryDir)
		.use(binary);

	await bin.run();
	t.true(await pathExists(bin.path()));
	await removeDir(bin.dest());
});

test('meet the desired version', async t => {
	const temporaryDir = temporaryDirectory();
	const bin = new BinWrapper()
		.src('http://foo.com/gifsicle.tar.gz')
		.dest(temporaryDir)
		.use(binary)
		.version('>=1.71');

	await bin.run();
	t.true(await pathExists(bin.path()));
	await removeDir(bin.dest());
});

test('download files even if they are not used', async t => {
	const temporaryDir = temporaryDirectory();
	const bin = new BinWrapper({strip: 0, skipCheck: true})
		.src('http://foo.com/gifsicle-darwin.tar.gz')
		.src('http://foo.com/gifsicle-win32.tar.gz')
		.src('http://foo.com/test.js')
		.dest(temporaryDir)
		.use(binary);

	await bin.run();
	const files = fs.readdirSync(bin.dest());

	t.is(files.length, 3);
	t.is(files[0], 'gifsicle');
	t.is(files[1], 'gifsicle.exe');
	t.is(files[2], 'test.js');

	await removeDir(bin.dest());
});

test('skip running binary check', async t => {
	const temporaryDir = temporaryDirectory();
	const bin = new BinWrapper({skipCheck: true})
		.src('http://foo.com/gifsicle.tar.gz')
		.dest(temporaryDir)
		.use(binary);

	await bin.run(['--shouldNotFailAnyway']);
	t.true(await pathExists(bin.path()));
	await removeDir(bin.dest());
});

test('error if no binary is found and no source is provided', async t => {
	const temporaryDir = temporaryDirectory();
	const bin = new BinWrapper()
		.dest(temporaryDir)
		.use(binary);

	await t.throwsAsync(
		bin.run(),
		undefined,
		'No binary found matching your system. It\'s probably not supported.',
	);
	await removeDir(temporaryDir);
});

test('downloaded files are set to be executable', async t => {
	const temporaryDir = temporaryDirectory();
	const bin = new BinWrapper({strip: 0, skipCheck: true})
		.src('http://foo.com/gifsicle-darwin.tar.gz')
		.src('http://foo.com/gifsicle-win32.tar.gz')
		.src('http://foo.com/test.js')
		.dest(temporaryDir)
		.use(binary);

	await bin.run();

	const files = fs.readdirSync(bin.dest());

	await t.true(files.every(async file => isexe(path.join(bin.dest(), file))));
	await removeDir(temporaryDir);
});

(isWindows ? test.skip : test)('do not chmod the destination directory for a basename-less URL', async t => {
	const temporaryDir = temporaryDirectory();
	await fsP.chmod(temporaryDir, 0o700);

	// URL with no path basename -> bin-wrapper derives an empty name. The
	// downloader still saves the file (here named via content-disposition).
	nock('http://foo.com')
		.get('/')
		.reply(200, 'not-an-archive', {'content-disposition': 'attachment; filename="real.bin"'});

	const bin = new BinWrapper({skipCheck: true})
		.src('http://foo.com')
		.dest(temporaryDir)
		.use('real.bin');

	try {
		await bin.run();
		// The destination directory's mode must be left untouched (not 0o755).
		const stats = await fsP.stat(temporaryDir);
		t.is(stats.mode & 0o777, 0o700); // eslint-disable-line no-bitwise
	} finally {
		await removeDir(temporaryDir);
	}
});

test('use custom decompress plugins', async t => {
	const temporaryDir = temporaryDirectory();
	const bin = new BinWrapper({skipCheck: true, decompress: {plugins: [decompressTarxz()]}})
		.src('http://foo.com/gifsicle-linux.tar.xz')
		.dest(temporaryDir)
		.use('gifsicle');

	await bin.run();
	t.true(await pathExists(bin.path()));
	await removeDir(temporaryDir);
});

test('forward decompress options to the downloader', async t => {
	const temporaryDir = temporaryDirectory();
	const bin = new BinWrapper({skipCheck: true, decompress: {filter: () => false}})
		.src('http://foo.com/gifsicle.tar.gz')
		.dest(temporaryDir)
		.use(binary);

	await bin.run();
	t.false(await pathExists(bin.path()));
	await removeDir(temporaryDir);
});

test('tolerate a non-archive file saved under a different name than the URL', async t => {
	const temporaryDir = temporaryDirectory();

	// URL basename is `download`, but the downloader saves `actual-bin` (from
	// content-disposition), so bin-wrapper's guessed chmod target won't exist.
	nock('http://foo.com')
		.get('/download')
		.reply(200, 'not-an-archive', {'content-disposition': 'attachment; filename="actual-bin"'});

	const bin = new BinWrapper({skipCheck: true})
		.src('http://foo.com/download')
		.dest(temporaryDir)
		.use('actual-bin');

	try {
		await t.notThrowsAsync(bin.run());
		t.true(await pathExists(path.join(temporaryDir, 'actual-bin')));
	} finally {
		await removeDir(temporaryDir);
	}
});

(isWindows ? test.skip : test)('re-throw non-ENOENT errors from findExisting', async t => {
	const temporaryDir = temporaryDirectory();
	try {
		// A file where the dir should be makes fs.access() fail with ENOTDIR.
		const destAsFile = path.join(temporaryDir, 'notadir');
		await fsP.writeFile(destAsFile, '');

		const bin = new BinWrapper()
			.dest(destAsFile)
			.use(binary);

		const error = await t.throwsAsync(bin.run());
		t.is(error.code, 'ENOTDIR');
	} finally {
		await removeDir(temporaryDir);
	}
});
