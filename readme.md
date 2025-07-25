# bin-wrapper [![npm version](https://img.shields.io/npm/v/@xhmikosr/bin-wrapper?logo=npm&logoColor=fff)](https://www.npmjs.com/package/@xhmikosr/bin-wrapper) [![CI Status](https://img.shields.io/github/actions/workflow/status/XhmikosR/bin-wrapper/ci.yml?branch=master&label=CI&logo=github)](https://github.com/XhmikosR/bin-wrapper/actions/workflows/ci.yml?query=branch%3Amaster)

> Binary wrapper that makes your programs seamlessly available as local dependencies


## Install

```sh
npm install @xhmikosr/bin-wrapper
```


## Usage

```js
import path from 'node:path';
import BinWrapper from '@xhmikosr/bin-wrapper';

const base = 'https://github.com/imagemin/gifsicle-bin/raw/main/vendor';
const bin = new BinWrapper()
	.src(`${base}/macos/gifsicle`, 'darwin')
	.src(`${base}/linux/x64/gifsicle`, 'linux', 'x64')
	.src(`${base}/win/x64/gifsicle.exe`, 'win32', 'x64')
	.dest(path.join('vendor'))
	.use(process.platform === 'win32' ? 'gifsicle.exe' : 'gifsicle')
	.version('>=1.71');

(async () => {
	await bin.run(['--version']);
	console.log('gifsicle is working');
})();
```

Get the path to your binary with `bin.path()`:

```js
console.log(bin.path());
//=> 'path/to/vendor/gifsicle'
```


## API

### `new BinWrapper(options)`

Creates a new `BinWrapper` instance.

#### options

Type: `Object`

##### skipCheck

* Type: `boolean`
* Default: `false`

Whether to skip the binary check or not.

##### strip

* Type: `number`
* Default: `1`

Strip a number of leading paths from file names on extraction.

### .src(url, [os], [arch])

Adds a source to download.

#### url

Type: `string`

Accepts a URL pointing to a file to download.

#### os

Type: `string`

Tie the source to a specific OS.

#### arch

Type: `string`

Tie the source to a specific arch.

### .dest(destination)

#### destination

Type: `string`

Accepts a path which the files will be downloaded to.

### .use(binary)

#### binary

Type: `string`

Define which file to use as the binary.

### .path()

Returns the full path to your binary.

### .version(range)

#### range

Type: `string`

Define a [semver range](https://github.com/npm/node-semver#ranges) to check
the binary against.

### .run([arguments])

Runs the search for the binary. If no binary is found it will download the file
using the URL provided in `.src()`.

#### arguments

* Type: `Array`
* Default: `['--version']`

Command to run the binary with. If it exits with code `0` it means that the
binary is working.


## License

MIT © [Kevin Mårtensson](http://kevinmartensson.com)
