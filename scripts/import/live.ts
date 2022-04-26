import exitHook from 'async-exit-hook'
import config from '../../config'
import Logger from '../../lib/logger'
import importer from '../../lib/ripple-importer'
import hbase from './client'

require('nodeify').extend();

var log = new Logger({
  scope: 'live import',
  level: config.get('logLevel') || 0,
  file: config.get('logFile'),
})

// hbase.initPeakInfo();
//start import stream
importer.liveStream();

log.info('Saving Ledgers to HBase');

importer.on('ledger', function (ledger: any) {
  console.log("saving ledger")
  hbase.saveLedger(ledger, function (err: any, resp: any) {
    if (err) {
      log.error(err)
    }
  })
})

exitHook(async () => {
  console.log('exiting')
  await importer.api.disconnect()
})
