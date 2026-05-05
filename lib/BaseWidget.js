var blessed = require('blessed');
var _ = require('lodash');
var Point = require('text-buffer/lib/point');

var util = require('./util');
var baseWidgetOpts = require('./baseWidgetOpts');

class BaseWidget extends blessed.Box {
  constructor(opts) {
    opts = _.merge({}, baseWidgetOpts, opts);
    if (!opts.screen) opts.screen = (opts.parent || {}).screen;
    if (!opts.parent) opts.parent = opts.screen;
    super(opts);
    BaseWidget._initBaseWidget(this, opts);
  }

  // Mixin used by subclasses that extend a built-in blessed widget
  // (Button, Label, FileBrowser, PaneList) instead of BaseWidget itself.
  // Replaces the legacy `BaseWidget.call(self, opts)` pattern.
  static _initBaseWidget(self, opts) {
    var loggerOpts = opts.logger
      || (opts.parent || {}).options.logger
      || (opts.screen || {}).options.logger;
    if (loggerOpts && !util.logger.stream) util.logger(loggerOpts);

    self.focusable = opts.focusable;

    util.logger.debug(util.typeOf(self), 'init {' + Object.keys(opts).join(',') + '}');
    self.ready = new Promise(function (resolve) { setImmediate(resolve); })
      .then(function () {
        return typeof self._initHandlers === 'function'
          ? self._initHandlers()
          : BaseWidget.prototype._initHandlers.call(self);
      })
      .then(function () {
        util.logger.debug(util.typeOf(self), 'ready');
        return self;
      });

    return self;
  }

  walkDepthFirst(direction, after, fn) {
    if (arguments.length === 2) fn = after;
    var children = this.children.slice();
    if (direction === -1) children.reverse();
    if (after) children = children.slice(children.indexOf(after) + 1);
    return children.some(function (child) {
      return fn.apply(child, arguments) || BaseWidget.prototype.walkDepthFirst.call(child, direction, fn);
    });
  }

  focusFirst(direction, after) {
    return this.walkDepthFirst(direction, after, function () {
      if (this.visible && this.focusable) {
        this.focus();
        return true;
      }
    });
  }

  _focusDirection(direction) {
    var self = this;
    var descendantParent;
    var descendant = self.screen.focused;
    while (descendant.hasAncestor(self)) {
      descendantParent = descendant.parent;
      if (BaseWidget.prototype.focusFirst.call(descendantParent, direction, descendant)) return self;
      descendant = descendantParent;
    }
    if (!self.focusFirst(direction)) throw new Error("no focusable descendant");
    return self;
  }

  focusNext() { return this._focusDirection(1); }
  focusPrev() { return this._focusDirection(-1); }

  focus() {
    if (!this.hasFocus()) return blessed.Box.prototype.focus.apply(this, arguments);
    return this;
  }

  isAttached() {
    return this.hasAncestor(this.screen);
  }

  hasFocus(asChild) {
    var self = this;
    var focused = self.screen.focused;
    return focused.visible && (focused === self || focused.hasAncestor(self) || (asChild && self.hasAncestor(focused)));
  }

  pos() {
    return new Point(this.atop + this.itop, this.aleft + this.ileft);
  }

  size() {
    if (!this.isAttached()) return new Point(0, 0); // hack
    return new Point(this.height - this.iheight, this.width - this.iwidth);
  }

  shrinkWidth() { return this.content.length + this.iwidth; }

  getBindings() {
    return this.options.bindings;
  }

  resolveBinding(key, source1, source2, etc) {
    return BaseWidget.resolveBinding.apply(this,
      [key, util.callBase(this, BaseWidget, 'getBindings')].concat([].slice.call(arguments, 1))
    );
  }

  static resolveBinding(key, source1, source2, etc) {
    var bindings = _.merge.apply(null, [{}].concat([].slice.call(arguments, 1)));
    for (var name in bindings) {
      if (bindings.hasOwnProperty(name)) {
        var keyBindings = bindings[name];
        if (!keyBindings) continue;
        if (typeof keyBindings === 'string') keyBindings = [keyBindings];
        if (keyBindings.some(function (binding) { return binding === key.full || binding === key.sequence; }))
          return name;
      }
    }
  }

  _initHandlers() {
    var self = this;
    self.on('focus', function () {
      util.logger.debug('focus', util.typeOf(self));
      if (!self.focusable) self.focusNext();
    });
    self.on('blur', function () { util.logger.debug('blur', util.typeOf(self)); });
    self.on('show', function () { self.setFront(); });
    self.on('element keypress', function (el, ch, key) {
      switch (util.callBase(this, BaseWidget, 'resolveBinding', key)) {
        case 'hide': self.hide(); return false;
        case 'focusNext': self.focusNext(); return false;
        case 'focusPrev': self.focusPrev(); return false;
      }
    });
  }
}

BaseWidget.blessed = blessed;

module.exports = BaseWidget;
