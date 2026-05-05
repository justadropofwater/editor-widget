var stream = require('stream');
var blessed = require('blessed');

function readStreamFactory() {
  var s = new stream.PassThrough();
  s.setRawMode = function () {};
  return s;
}

function writeStreamFactory() {
  var s = new stream.PassThrough();
  s.rows = 24;
  s.columns = 80;
  return s;
}

function screenFactory(opts) {
  return new blessed.screen(Object.assign({
    input: readStreamFactory(),
    output: writeStreamFactory()
  }, opts || {}));
}

module.exports = {
  readStreamFactory: readStreamFactory,
  writeStreamFactory: writeStreamFactory,
  screenFactory: screenFactory
};
