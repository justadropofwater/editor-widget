var _ = require('lodash');

var editorWidgetOpts = require('./opts');
var Editor = require('./Editor');

class Field extends Editor {
  constructor(opts) {
    opts = _.merge({
      height: 1,
      multiLine: false
    }, editorWidgetOpts.field, opts);
    super(opts);
    this.language(false);
  }

  submit(value) { this.emit('submit', value); }
  cancel() { this.emit('cancel'); }

  _initHandlers() {
    var self = this;
    self.on('keypress', function (ch, key) {
      switch (self.resolveBinding(key)) {
        case 'submit': self.submit(self.textBuf.getText()); return false;
        case 'cancel': self.cancel(); return false;
      }
    });
    return Editor.prototype._initHandlers.apply(self, arguments);
  }
}

module.exports = Field;
