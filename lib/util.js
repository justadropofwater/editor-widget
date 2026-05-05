var fs = require('fs');

var helpers = require('./util/helpers');
var text = require('./util/text');
var markup = require('./util/markup');


var noop = function () {};

function logger(opts) {
  if (!opts) opts = {};
  logger.stream = null;

  if (opts.stream) {
    logger.stream = opts.stream;
  } else if (opts.file) {
    logger.stream = fs.createWriteStream(opts.file, { flags: 'a' });
  }

  logger._level = opts.level || 'info';
  logger._opts = opts;

  var levels = { error: 0, warn: 1, info: 2, verbose: 3, debug: 4, silly: 5 };
  var threshold = levels[logger._level] !== undefined ? levels[logger._level] : 2;

  function log(level, args) {
    if (!logger.stream) return;
    if (levels[level] > threshold) return;
    var msg = [level + ':'].concat([].slice.call(args)).map(function (a) {
      return typeof a === 'object' ? JSON.stringify(a) : String(a);
    }).join(' ');
    logger.stream.write(msg + '\n');
  }

  logger.error = function () { log('error', arguments); };
  logger.warn = function () { log('warn', arguments); };
  logger.info = function () { log('info', arguments); };
  logger.verbose = function () { log('verbose', arguments); };
  logger.debug = function () { log('debug', arguments); };
  logger.silly = function () { log('silly', arguments); };
}

logger.error = noop;
logger.warn = noop;
logger.info = noop;
logger.verbose = noop;
logger.debug = noop;
logger.silly = noop;

module.exports = {
  text: text,
  markup: markup,
  mod: helpers.mod,
  typeOf: helpers.typeOf,
  callBase: helpers.callBase,
  getterSetter: helpers.getterSetter,
  parseOpts: helpers.parseOpts,
  resolvePath: helpers.resolvePath,
  logger: logger
};
