/* eslint-disable @typescript-eslint/no-this-alias,func-names,prefer-template,object-shorthand,prefer-destructuring,import/no-unresolved,import/extensions,@typescript-eslint/no-var-requires,no-var */

// var config = require('./config');
// var nodemailer = require('nodemailer');
// var transporter = nodemailer.createTransport();
// var to = config.get('recipients');
// var name = config.get('name') || 'unnamed';
var exec = require('child_process').exec
var spawn = require('child_process').spawn

var log

/**
 * notify
 */

// function notify(message, callback) {
//   var params = {
//     from: 'Storm Import<storm-import@ripple.com>',
//     to: to,
//     subject: name + ' - uncaughtException',
//     html: 'The import topology received ' +
//       'an uncaught exception error: <br /><br />\n' +
//       '<blockquote><pre>' + message + '</pre></blockquote><br />\n'
//   };

//   transporter.sendMail(params, callback);
// }

/**
 * killTopology
 */

function killTopology() {
  exec('storm kill "ripple-ledger-importer"', function callback(e, stdout, stderr) {
    if (e) log.error(e)
    if (stderr) log.error(stderr)
    if (stdout) log.info(stdout)
  })
}

let timeout = -1
function restartTopology() {
  if (timeout >= 0) clearTimeout(timeout)
  timeout = setTimeout(() => {
    timeout = -1
    const subProcess = spawn('/usr/local/ripple-historical-database/storm/production/importer.sh restart', [], {
      detached: true,
      stdio: 'ignore',
    })
    subProcess.unref()
  }, 60000)
}

module.exports = function (logger) {
  log = logger

  // handle uncaught exception
  process.on('uncaughtException', function (e) {
    log.error('Unhandled Exception:', e)
    log.error('Unhandled Stacktrace:', e.stack)

    // send notification
    // notify(e.stack, function(err, info) {
    //   if (err) {
    //     log.error(err);
    //   } else {
    //     log.info('Notification sent: ', info.accepted);
    //   }
    // });

    // kill the topology
    // killTopology()
    restartTopology()
  })
}
