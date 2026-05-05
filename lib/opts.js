var path = require('path');
var rc = require('rc');

var util = require('./util');
var pkg = require('../package');

var configFile = path.resolve(__dirname, '..', pkg.name + '.ini');

module.exports = util.parseOpts(rc(pkg.name, configFile));
