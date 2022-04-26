var EventEmitter = require('events').EventEmitter
var config = require('../config')
var rippleAPI = require('./rippleApi')
var events = require('events')
var winston = require('winston')
var Logger = require('./logger')
var moment = require('moment')

var GENESIS_LEDGER = config.get('genesis_ledger') || 1
var TIMEOUT = 30 * 1000

/**
 * Importer
 */

class Importer extends EventEmitter {
  log = new Logger({
    scope: 'importer',
    level: config.get('logLevel') || 3,
    file: config.get('logFile'),
  })

  // separate hash errors from main log
  hashErrorLog = new (require('winston').Logger)({
    transports: [new winston.transports.Console(), new winston.transports.File({ filename: './hashErrors.log' })],
  })

  api = rippleAPI

  constructor(options) {
    super(options)
    this.api.connect()
  }

  /**
   * backFill
   * begin a new backfilling thread
   */
  backFill = (stopIndex, startIndex, callback) => {
    var bf = this.BackFiller(stopIndex, startIndex, callback)
  }

  /**
   * liveStream
   * begin a live streaming thread
   */
  liveStream = () => {
    if (this.stream) {
      this._active = true
      return this.stream
    } else {
      this.stream = this.LiveStream()
    }

    return this.stream
  }

  /**
   * stop
   * stop live stream
   */
  stop = () => {
    if (this._active) {
      this._active = false
    }
  }

  /**
   * BackFiller
   * back fill the history with validated ledgers
   * from a specific starting point or latest
   * validated ledger to a specified end point
   * or the effective genesis ledger
   */
  BackFiller = (stopIndex, startIndex, callback) => {
    var queue = {}
    var earliest
    var earliestParentHash

    if (stopIndex < GENESIS_LEDGER) {
      stopIndex = GENESIS_LEDGER
    }

    if (startIndex < GENESIS_LEDGER) {
      this.log.info('start index precedes genesis ledger (' + GENESIS_LEDGER + ')')
      if (typeof callback === 'function') callback()
      return
    }

    if (startIndex < stopIndex) {
      this.log.info('start index precedes stop index', stopIndex, startIndex)
      if (typeof callback === 'function') callback()
      return
    }

    this.api.connect().then(() => {
      getLedger(startIndex)
    })

    /**
     * getLedger
     * get a specific ledger from rippled
     * if multiple ledgers are being retreived
     * simultaneously, add a little padding
     * between requests
     */
    var getLedger = (index, count) => {
      var options = {
        ledgerVersion: index,
      }

      if (!count) count = 0

      setTimeout(() => {
        this.getLedger(options, (err, ledger) => {
          if (ledger) {
            setImmediate(handleLedger, ledger)
          } else {
            this.log.error(err)
            callback('import failure', err)
          }
        })
      }, count * 100)
    }

    /**
     * handleLedger
     * process the ledger returned from rippled
     */
    var handleLedger = (ledger) => {
      var current = Number(ledger.ledger_index)

      //if this is the first ledger,
      //we will not add it to the queue because
      //we are just getting the parent hash
      //for validation
      if (!earliest) {
        earliest = current
        earliestParentHash = ledger.parent_hash

        //add it to the queue
      } else {
        queue[current] = ledger

        //move the que forward if possible
        advanceQueue()

        if (earliest === stopIndex) {
          this.log.info('backfill complete:', stopIndex, '-', startIndex)
          if (typeof callback === 'function') callback()
        }
      }

      //get more ledgers if there is room
      //if the queue has available space
      updateQueue()
    }

    /**
     * updateQueue
     * update the queue with new ledger
     * requests if there is any free space
     */
    var updateQueue = () => {
      var max = 20
      var num = earliest - stopIndex + 1
      var length = Object.keys(queue).length
      var count = 0

      if (length >= max) num = 0
      else if (num > max) num = max

      for (var i = 0; i < num; i++) {
        var index = earliest - i

        if (index < stopIndex) {
          break
        }

        if (!queue[index]) {
          queue[index] = 'pending'
          getLedger(index, count++)
        }
      }
    }

    /**
     * advanceQueue
     * remove as many validated ledgers
     * from the queue as possible
     */
    var advanceQueue = () => {
      //move the queue if possible
      var index = earliest
      while (1) {
        if (queue[index] === 'pending') {
          break
        } else if (queue[index] === 'failed') {
          this.log.warn('retry failed ledger:', index)
          getLedger(index)
          break
        } else if (queue[index]) {
          if (
            earliestParentHash &&
            earliestParentHash != queue[index].ledger_hash &&
            earliestParentHash != queue[index].parent_hash
          ) {
            this.log.error('expected different parent hash:', index)
            callback('Unable to complete backfill: parent hash mismatch')
            break
          } else if (earliest != index) {
            this.log.error('unexpected index:', index)
            callback('Unable to complete backfill: unexpected index')
            break
          }

          earliest = index - 1
          earliestParentHash = queue[index].parent_hash

          this.emit('ledger', queue[index])
          delete queue[index]
          index--
        } else {
          break
        }
      }
    }
  }

  /**
   * LiveStream
   * importer class that tracks last
   * ledger closed to import in real time
   */
   LiveStream = () => {
    var latest //latest ledger from rippled
    var first //first ledger from rippled
    this._active = true

    this.log.info('import: starting live stream')
    this.api.on('ledger', (resp) => {
      if (!this._active) return
      this.log.info('[' + new Date().toISOString() + ']', 'ledger closed:', resp.ledgerVersion)
      getValidatedLedger(resp.ledgerVersion)
    })

    var getValidatedLedger = (index) => {
      var options = {
        ledgerVersion: index,
        includeAllData: true,
        includeTransactions: true,
      }

      this.getLedger(options, (err, ledger) => {
        if (ledger) {
          handleLedger(ledger)
        } else if (err) {
          this.log.error(err)
        }
      })
    }

    var handleLedger = (ledger) => {
      var current = ledger.ledgerVersion

      // first to come in
      if (!first) {
        first = current
        latest = current
      }

      // check for gap
      if (current > latest + 1) {
        this.log.info('starting backfill:', latest + 1, '-', current - 1)
        this.backFill(latest + 1, current - 1)
      }

      this.emit('ledger', ledger)
      latest = current
    }
  }

  /**
   * getLedger
   * @param {Object} options
   * @param {Object} callback
   */
   getLedger = (options, callback) => {
    if (!options) options = {}

    var attempts = options.attempts || 0

    delete options.attempts
    options.includeAllData = true
    options.includeTransactions = true

    /**
     * requestLedger
     */
    var requestLedger = (options, callback) => {
      this.log.info('[' + new Date().toISOString() + ']', 'requesting ledger:', options.ledgerVersion)

      this.api
        .getLedger(options)
        .then((ledger) => processLedger(ledger))
        .catch((e) => {
          this.log.error('error requesting ledger:', options.ledgerVersion, e)
          setImmediate(this.retry, options, attempts, callback)
        })

      /**
       * handleResponse
       */
      var processLedger = (ledger) => {
        var hash

        //if we didn't request transactions,
        //we can't calculate the transactions hash
        if (!options.includeAllData || !options.includeTransactions) {
          callback(null, this.convertLedger(ledger))
          return
        }

        // check hash but dont require
        try {
          hash = this.api.computeLedgerHash(ledger)
        } catch (err) {
          this.log.error('Error calculating ledger hash: ', ledger.ledgerVersion, err)
          this.hashErrorLog.error(ledger.ledgerVersion, err.toString())
          //callback('unable to validate ledger: ' + ledger.ledgerVersion);
          //return;
        }

        // check but dont require
        if (hash !== ledger.ledgerHash) {
          this.hashErrorLog.error('hash does not match:', hash, ledger.ledgerHash, ledger.ledgerVersion)
          //callback('unable to validate ledger: ' + ledger.ledgerVersion);
          //return;
        }

        this.log.info('[' + new Date().toISOString() + ']', 'Got ledger: ' + ledger.ledgerVersion)
        callback(null, this.convertLedger(ledger))
      }
    }

    if (this.api.isConnected()) {
      requestLedger(options, callback)
    } else {
      this.api.connect().then(() => {
        requestLedger(options, callback)
      })
    }
  }

  convertLedger = (ledger) => {
    var converted = {
      account_hash: ledger.stateHash,
      close_time: moment.utc(ledger.closeTime).unix(),
      close_time_human: moment.utc(ledger.closeTime).format('YYYY-MMM-DD hh:mm:ss'),
      close_time_resolution: ledger.closeTimeResolution,
      close_flags: ledger.closeFlags,
      hash: ledger.ledgerHash,
      ledger_hash: ledger.ledgerHash,
      ledger_index: ledger.ledgerVersion.toString(),
      seqNum: ledger.ledgerVersion.toString(),
      parent_hash: ledger.parentLedgerHash,
      parent_close_time: moment.utc(ledger.parentCloseTime).unix(),
      total_coins: ledger.totalDrops,
      totalCoins: ledger.totalDrops,
      transaction_hash: ledger.transactionHash,
      transactions: [],
    }

    if (ledger.transactions) {
      converted.transactions = ledger.transactions.map((transaction) => {
        var parsedTX = JSON.parse(transaction.rawTransaction)
        parsedTX.metaData = parsedTX.meta
        delete parsedTX.meta
        return parsedTX
      })
    }

    return converted
  }

  /**
   * retry
   * @param {Object} ledgerIndex
   * @param {Object} attempts
   * @param {Object} callback
   */
  retry = (options, attempts, callback) => {
    if (attempts >= 10) {
      this.log.error('failed to get ledger after ' + attempts + ' attempts:', options.ledgerVersion)
      callback('failed to get ledger')
      return
    }

    options.attempts = attempts + 1
    this.log.info('retry attempts:', options.attempts)

    setTimeout((opts, att, cb) => {
      this.getLedger(options, callback)
    }, 90000) // sleep a bit longer
  }
}

module.exports = new Importer()

/*
function sizeof(normal_val) {
  // Force string type
  normal_val = JSON.stringify(normal_val);

  var byteLen = 0;
  for (var i = 0; i < normal_val.length; i++) {
    var c = normal_val.charCodeAt(i);
    byteLen += c < (1 <<  7) ? 1 :
               c < (1 << 11) ? 2 :
               c < (1 << 16) ? 3 :
               c < (1 << 21) ? 4 :
               c < (1 << 26) ? 5 :
               c < (1 << 31) ? 6 : Number.NaN;
  }
  return byteLen / 1000;
}
*/
