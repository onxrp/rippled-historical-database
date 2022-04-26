var nconf = require('nconf');

nconf.argv().env()

var configName = nconf.get('configName')
if (configName) {
  // nconf.use('defaults', { type: 'file', file: __dirname + '/' + configName + '.config.json' });
  nconf.file('user', __dirname + '/' + configName + '.config.json' );
}

nconf.file('defaults', __dirname + '/config.json');

module.exports = nconf;
