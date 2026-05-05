# editor-widget

Editor widget for [blessed](https://github.com/chjj/blessed) used by the
[slap](https://github.com/justadropofwater/slap) text editor.

This is a modernized fork of
[slap-editor/editor-widget](https://github.com/slap-editor/editor-widget),
maintained alongside the
[justadropofwater/slap](https://github.com/justadropofwater/slap) fork.

## What changed in 2.0.0

The 1.x line targeted Node 4/6 with a deep stack of abandoned dependencies.
The 2.0 modernization preserves the public API while:

* **Native `async`/`await`** -- Bluebird removed; `Editor.open`, `Editor.save`,
  `Editor.exists`, `Editor.copy`, `Editor.paste` and the highlight client all
  use native `Promise`.
* **ES6 classes** -- `Editor` and `Field` use `class ... extends ...` instead
  of prototype chains and the `__proto__` assignment trick.
* **Self-contained** -- the previously-external `base-widget` and `slap-util`
  packages are inlined into `lib/BaseWidget.js` and `lib/util/`, so no more
  abandoned `slap-editor/*` deps in the tree.
* **Single `text-buffer` line** -- pinned to 9.2.2 so consumers don't end up
  with two text-buffer copies (1.x previously dragged in `text-buffer@8.0.6`
  while base-widget pulled `text-buffer@9.2.2`).
* **Modern deps** -- `cheerio` 1.x, `highlight.js` 11.x, lodash 4.x, native
  `fs.promises` and `util.promisify` instead of `Promise.promisifyAll`.
* **GitHub Actions** -- replaces Travis CI; tests on Node 20 and 22.
* `engines: { "node": ">=20" }`.

## Example

```js
const blessed = require('blessed');
const Editor = require('editor-widget');

const screen = blessed.screen({ smartCSR: true, title: 'editor-widget example' });
const editor = new Editor({
  parent: screen,
  top: 0,
  left: 0,
  width: '100%',
  height: '100%'
});

const filePath = './file.txt';
editor.open(filePath);
screen.key(['C-s'], () => { editor.save(filePath); });

screen.key(['escape', 'q', 'C-c'], () => { process.exit(0); });
screen.render();
```

## License

MIT
