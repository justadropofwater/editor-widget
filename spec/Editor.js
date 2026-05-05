#!/usr/bin/env node

var test = require('tape');
var fs = require('fs');
var path = require('path');

var screenFactory = require('./util').screenFactory;
var Editor = require('../.');

test('Editor', function (t) {
  var screen = screenFactory();
  screen.key('C-q', function () { process.exit(); });
  var editor = new Editor({ parent: screen });

  t.test('.open should throw EACCES for a file with perms 000', function (st) {
    st.plan(1);

    var perms000File = path.resolve(__dirname, 'fixtures/perms-000');
    var originalPerms = (fs.statSync(perms000File).mode.toString(8).match(/[0-7]{3}$/) || [])[0] || '644';
    fs.chmodSync(perms000File, '000');

    editor.open(perms000File)
      .then(function () { st.fail('expected EACCES'); })
      .catch(function (err) { st.equal(err.code, 'EACCES'); })
      .finally(function () { fs.chmodSync(perms000File, originalPerms); });
  });

  t.on('end', function () {
    Editor.highlightClient.then(function (client) {
      client.dontRespawn = true;
      editor.detach();
    });
  });
});
