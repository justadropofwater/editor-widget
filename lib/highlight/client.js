var fork = require('child_process').fork;
var path = require('path');
var minimist = require('minimist');

var execOpts = minimist(process.execArgv);
var forkOpts = { silent: false };
var initPromise = Promise.resolve();
if (['inspect', 'inspect-brk'].some(function (opt) { return opt in execOpts; })) {
  initPromise = initPromise.then(function () {
    return new Promise(function (resolve) {
      // Use a free random port for the child inspector to avoid collisions.
      var net = require('net');
      var server = net.createServer();
      server.listen(0, function () {
        var port = server.address().port;
        server.close(function () {
          forkOpts.execArgv = ['--inspect=' + port];
          resolve();
        });
      });
    });
  }).then(function () { return null; });
}

function spawn() {
  return spawn.promise = spawn.promise.then(function (client) {
    // dontRespawn is the editor's signal that the entire highlight client
    // is being torn down. Kill the existing child and resolve to null so
    // a subsequent spawn (e.g. from a respawned Editor in a later test) is
    // able to start fresh -- in particular, so the `client.listeners(...)`
    // call below doesn't see a boolean from the previous kill() return.
    if (client && client.dontRespawn) {
      try { client.kill(); } catch (e) {}
      return null;
    }
    var oldMessageListeners = client && typeof client.listeners === 'function'
      ? client.listeners('message') : [];
    client = fork(path.join(__dirname, 'server.js'), forkOpts);
    client.setMaxListeners(100);
    client.on('exit', spawn);
    oldMessageListeners.forEach(function (listener) { client.on('message', listener); });
    return client;
  });
}
spawn.promise = initPromise;

spawn.buckets = 0;
spawn.getBucket = function () { return spawn.buckets++; };

module.exports = spawn;
