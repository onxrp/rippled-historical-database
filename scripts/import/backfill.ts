import exitHook from 'async-exit-hook'
import config from '../../config'
import HistoricalImport from './history'

var historicalImport = new HistoricalImport();

var start = config.get('startIndex');
var stop  = config.get('stopIndex') || 'validated';
var force = config.get('force');

setTimeout(function() {
  historicalImport.start(start, stop, force, function() {
    process.exit();
  });
}, 500);

exitHook(async () => {
  console.log('exiting')
  await historicalImport.importer.api.disconnect()
})
