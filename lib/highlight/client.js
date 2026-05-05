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
    if (client && client.dontRespawn) return client.kill();
    var oldMessageListeners = client ? client.listeners('message') : [];
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
