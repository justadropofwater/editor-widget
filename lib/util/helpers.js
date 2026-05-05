var path = require('path');

var boolStrings = { 'true': true, 'false': false };

function mod(n, m) {
  return ((n % m) + m) % m;
}

function typeOf(val) {
  return (val.__proto__.constructor.toString().match(/\w+\s+(\w+)/) || [])[1];
}

function callBase(self, BaseClass, name, arg1, arg2, etc) {
  return (typeof self[name] === 'function'
    ? self[name]
    : BaseClass.prototype[name]).apply(self, [].slice.call(arguments, 3));
}

function getterSetter(name, getter, setter) {
  getter = getter || identity;
  setter = setter || identity;
  return function () {
    if (arguments.length) {
      var newVal = setter.apply(this, arguments);
      this.data[name] = newVal;
      this.emit && this.emit(name, getter.call(this, newVal));
      return this;
    } else {
      return getter.call(this, this.data[name]);
    }
  };
}

function identity(val) { return val; }

// Recursively walks an opts tree, coercing string values that look like
// booleans or numbers into their typed forms. Replaces the legacy
// traverse(opts).map(...) call from slap-util.
function parseOpts(opts) {
  return mapDeep(opts);
}

function mapDeep(node) {
  if (Array.isArray(node)) {
    return node.map(mapDeep);
  }
  if (node && typeof node === 'object') {
    var out = {};
    for (var key in node) {
      if (Object.prototype.hasOwnProperty.call(node, key)) {
        out[key] = mapDeep(node[key]);
      }
    }
    return out;
  }
  if (typeof node === 'string') {
    if (node in boolStrings) return boolStrings[node];
    var number = Number(node);
    if (number === number) return number; // !isNaN
  }
  return node;
}

function resolvePath(givenPath) {
  if (!givenPath) givenPath = '';
  if (givenPath[0] === '~') {
    givenPath = path.join(process.platform !== 'win32'
      ? process.env.HOME
      : process.env.USERPROFILE
    , givenPath.slice(1));
  }
  return path.resolve.apply(null, [].slice.call(arguments, 1).concat([givenPath]));
}

module.exports = {
  mod: mod,
  typeOf: typeOf,
  callBase: callBase,
  getterSetter: getterSetter,
  parseOpts: parseOpts,
  resolvePath: resolvePath
};
