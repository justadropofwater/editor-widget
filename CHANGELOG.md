# Changelog

All notable changes to this fork are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.1.0] - 2026-05-05

Adds optional per-line git diff markers in the editor gutter. Consumers
opt in by setting `editor.gitDiff` to an object of the form
`{ added: Set<row>, modified: Set<row>, deletedAtRow: Set<row> }` and
calling `editor._updateContent()` to re-render. When `gitDiff` is
falsy (the default) the gutter renders exactly as before.

The marker char consumes one column out of the existing
`gutterWidth` budget, so the gutter shape doesn't shift when diff data
appears or disappears. Style hooks live under `editor.style.git`:

```ini
[editor.style.git]
added = "{green-fg}{bold}"
modified = "{yellow-fg}{bold}"
deleted = "{red-fg}{bold}"
```

Marker glyphs: U+2503 (heavy vertical bar) for added/modified, U+2581
(lower one-eighth block) for the row immediately following a deletion.

No public-API changes; existing consumers are unaffected.

## [2.0.0] - 2026-05-05

First release of the modernized fork of
[slap-editor/editor-widget](https://github.com/slap-editor/editor-widget).
Maintained alongside [`justadropofwater/slap`](https://github.com/justadropofwater/slap),
which consumes this package via a packed tarball.

### Public API

- `Editor` and `Field` keep the same surface as the 1.x line. Existing
  consumers should work without code changes — the constructors, `open`,
  `save`, `copy`, `paste`, `matchingBracket`, marker conventions, and
  blessed children layout are all preserved.

### Promises

- Bluebird removed. `Editor.open`, `Editor.save`, `Editor.exists`,
  `Editor.copy`, `Editor.paste`, and the highlight client all use native
  `Promise`. `Promise.method` / `.tap` / `.return` / `.spread` /
  `Promise.promisifyAll` / `Promise.try` / `.done()` are gone.
- `fs.promises` and `util.promisify` replace the manual promisification
  layer (`copy-paste` is wrapped via `util.promisify` instead of
  `Promise.promisifyAll`).

### Inheritance

- ES6 classes throughout: `class Editor extends BaseWidget` and
  `class Field extends Editor`. The legacy
  `Editor.prototype.__proto__ = BaseWidget.prototype` pattern is gone.

### Self-contained

- The previously-external `base-widget` and `slap-util` packages are
  inlined into `lib/BaseWidget.js`, `lib/baseWidgetOpts.js`,
  `lib/util.js`, and `lib/util/{text,markup,helpers}.js`. The fork no
  longer drags in the abandoned `slap-editor/*` packages from npm.

### Dependency tree

- `text-buffer` pinned to 9.2.2. The 1.x line previously used
  `text-buffer@8.0.6` while consumers like slap pulled `text-buffer@9.2.2`
  via `base-widget`; consolidating on a single line removes the
  duplicate from the consumer tree.
- `cheerio` upgraded to 1.x.
- `highlight.js` upgraded to 11.x; the highlight server now uses the
  options-object API (`hljs.highlight(text, { language, ignoreIllegals })`)
  instead of the deprecated positional form.
- `lodash` 4.x.
- Removed: `bluebird`, `es6-set` polyfill outside the small piece
  `text-buffer` needs, the `iconv-lite` shim, the Node-version
  conditional in `lib/Editor.js`.

### Toolchain

- `engines: { "node": ">=20" }`.
- Travis CI replaced by GitHub Actions (`.github/workflows/ci.yml`)
  testing on Node 20 and 22 across Ubuntu and macOS.

### Bugfixes

- `Editor`'s selection marker is created with
  `markPosition({ invalidate: 'never' })` followed by
  `setProperties({ type: 'selection' })`. Previously the constructor
  passed `{ type: 'selection', invalidate: 'never' }` to `markPosition`,
  which silently dropped the `type` field on text-buffer 9.x (only
  `tailed` and `invalidate` are forwarded). The result was an "unknown
  marker: undefined" throw at the first render.
- `BaseWidget._initBaseWidget` now uses `self.parent`/`self.screen`
  (set by the blessed Element constructor in `super(opts)`) and guards
  each `.options` dereference. The mixin path doesn't normalize
  `opts.parent`/`opts.screen` the way the constructor path does, so
  trusting `opts.*` led to "Cannot read properties of undefined
  (reading 'logger')" when constructing children whose immediate parent
  hadn't propagated those fields.

### Backwards-incompatible

- Drops Node 4/6/8 support.
- Consumers passing custom marker properties through
  `textBuf.markPosition` will hit text-buffer 9.x's silent drop; switch
  to `markPosition` + `setProperties`. `markRange` still accepts custom
  properties (with a deprecation warning) and is unaffected.

[2.1.0]: https://github.com/justadropofwater/editor-widget/releases/tag/v2.1.0
[2.0.0]: https://github.com/justadropofwater/editor-widget/releases/tag/v2.0.0
