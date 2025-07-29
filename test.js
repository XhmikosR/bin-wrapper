import fs, {promises as fsP} from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {fileURLToPath} from 'node:url';
import isexe from 'isexe';
import nock from 'nock';
import {temporaryDirectory} from 'tempy';
import test from 'ava';
import BinWrapper from './index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const fixture = path.join.bind(path, __dirname, 'fixtures');
const binary = process.platform === 'win32' ? 'gifsicle.exe' : 'gifsicle';

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
		.replyWithFile(200, __filename);
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
