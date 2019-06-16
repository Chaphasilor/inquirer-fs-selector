# inquirer-fs-selector

A filesystem prompt selector plugin for [Inquirer.js](https://github.com/SBoudrias/Inquirer.js).

<div align="center">

[![dependency status](https://david-dm.org/micalevisk/inquirer-fs-selector.svg)](https://david-dm.org/micalevisk/inquirer-fs-selector)

</div>

## Installation

```bash
npm install --save inquirer-fs-selector
```

## Features

- Support for symlinked files
- Vim style navigation
- Search for file with <kbd>/</kbd> key
- **Customize (or disable) file and directory icons**
- **Select file (optionally) or directory**

### Key Maps

- Press <kbd>/</kbd> key to enter search mode
- Press <kbd>-</kbd> key to go up (back) a directory
- Press <kbd>.</kbd> key to select the current directory

## Usage

This prompt is anonymous, meaning you can register this prompt with the type name you please:

```javascript
inquirer.registerPrompt('fs-selector', require('inquirer-fs-selector'));

// so
inquirer.prompt({
  type: 'fs-selector',
  /* ... */
})
```

Change `fs-selector` to whatever you might prefer.

### Parameters

Takes `type`, `name`, `message`, `basePath` and [`options`](#options) properties.

See [inquirer.js README](https://github.com/SBoudrias/Inquirer.js/blob/master/README.md) for meaning of all except **basePath**.

Where **`basePath`** is the relative path from your current working directory.

#### Return

An object with the following shape

```typescript
{
  isDirectory: Boolean,
  isFile: Boolean,
  path: String // path to selected file or directory
}
```

#### [Example](./example.js)

[![asciicast demo](https://asciinema.org/a/251915.svg)](https://asciinema.org/a/251915)

### Options

| key | default | description |
|---|--------|:-----------|
`displayFiles` | `true` | Set this to `false` if you need to hide files
`displayHidden` | `false` | Set this to `true` if you to display hidden folders (and `displayFiles === true`)
`canSelectFile` | `true` (if `displayFiles === true`) | Set this to `false` to disable files selection
`icons.currentDir` | `'\u{1F4C2}'` (📂) | Set an icon for current directory
`icons.dir` | `'\u{1F4C1}'` (📁) | Set an icon for other directories
`icons.file` | `'\u{1F4C4}'` (📄) | Set an icon for files

To disable prompt **icons**, make `icons === false`.

## License

[MIT](./LICENSE)
