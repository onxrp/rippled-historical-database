var config = require("../../config");
var importer = require("../../lib/ripple-importer");
var Logger = require("../../lib/logger");
var hbase = require("../../lib/hbase");
var Parser = require("../../lib/ledgerParser");
var utils = require("../../lib/utils.js");
var Promise = require("bluebird");
var moment = require("moment");

var GENESIS_LEDGER = config.get("genesis_ledger") || 1;
var EPOCH_OFFSET = 946684800;

var HistoricalImport = function () {
  this.importer = importer;

  this.count = 0;
  this.total = 0;
  this.section = {};

  var log = new Logger({
    scope: "hbase_history",
    level: config.get("logLevel") || 0,
    file: config.get("logFile"),
  });

  var self = this;
  var stopIndex;
  var cb;

  /**
   * handle ledgers from the importer
   */

  this.importer.on("ledger", function (ledger) {
    saveLedger(ledger, function (err, resp) {
      self.count++;
      if (err) {
        log.error(err);
        self.section.error = true;
        setTimeout(function() {
          log.info("Errored in section - retry after 60 secs", self.section.startIndex, "-", self.section.stopIndex);
          self._findGaps(self.section.startIndex, stopIndex);
        }, 60000) // retry after 1 min
      } else if (resp) {
        log.info(self.count, "of", self.total);
        if (resp.ledger_index === self.section.stopIndex) {
          self.section.stopHash = resp.ledger_hash;
        }

        if (self.count === self.total) {
          if (self.force) {
            if (cb) cb();
          } else if (self.section.error) {
            log.info(
              "Error in section - retrying:",
              self.section.startIndex,
              "-",
              self.section.stopIndex
            );
            self._findGaps(self.section.startIndex, stopIndex);
          } else {
            log.info(
              "gap filled:",
              self.section.startIndex,
              "-",
              self.section.stopIndex
            );
            if (self.section.stopIndex === stopIndex) {
              log.info("stop index reached: ", stopIndex);
              if (cb) cb();
              return;
            }

            self._findGaps(self.section.stopIndex + 1, stopIndex);
          }
        }
      }
    });
  });

  this.start = function (start, stop, force, callback) {
    var self = this;

    if (!start || start < GENESIS_LEDGER) {
      start = GENESIS_LEDGER;
    }

    cb = callback;
    stopIndex = stop;
    self.force = force;

    log.info("starting historical import: ", start, stop);

    if (stop && stop !== "validated") {
      if (force) {
        self.total = stop - start;
        self.importer.backFill(start, stop, function (err) {
          if (err) log.error(err);
        });
      } else {
        self._findGaps(start, stop);
      }
      //get latest validated ledger as the
      //stop point for historical importing
    } else {
      self._getLedgerRecursive(undefined, 0, function (err, ledger) {
        if (err) {
          log.error("failed to get latest validated ledger");
          callback("failed to get latest validated ledger");
          return;
        }

        stopIndex = parseInt(ledger.ledger_index, 10) - 1;
        if (force) {
          self.total = stopIndex - start;
          self.importer.backFill(start, stopIndex, function (err) {
            if (err) log.error(err);
          });
        } else {
          self._findGaps(start, stopIndex);
        }
      });
    }
  };

  this._getLedgerRecursive = function (index, attempts, callback) {
    var self = this;

    if (attempts && attempts > 10) {
      callback("failed to get ledger");
      return;
    }

    self.importer.getLedger({ ledgerVersion: index }, function (err, ledger) {
      if (err) {
        log.error(err, "retrying");
        self._getLedgerRecursive(index, ++attempts, callback);
        return;
      }

      callback(null, ledger);
    });
  };

  this._findGaps = function (start, stop) {
    log.info("finding gaps from ledgers:", start, stop);
    var self = this;

    this._findGap(
      {
        index: start,
        start: start,
        stop: stop,
      },
      function (err, resp) {
        if (err) {
          log.error(err);
        } else if (resp) {
          self.importer.backFill(
            resp.startIndex,
            resp.stopIndex,
            function (err) {
              if (err) {
                if (cb) cb(err);
              }
            }
          );

          self.count = 0;
          self.total = resp.stopIndex - resp.startIndex + 1;
          self.section = resp;
        }
      }
    );
  };

  this._findGap = function (params, callback) {
    var self = this;
    var end = params.index + 200;
    var startIndex = params.index;
    var stopIndex = end;
    var ledgerHash = params.ledger_hash;

    if (params.stop && end > params.stop) {
      end = params.stop;
    }

    log.info("validating ledgers:", startIndex, "-", end);

    hbase.getLedgersByIndex(
      {
        startIndex: startIndex,
        stopIndex: end,
        descending: false,
      },
      function (err, ledgers) {
        if (err) {
          callback(err);
          return;
        }

        if (!ledgers.length) {
          log.info("missing ledger at:", startIndex);
          callback(null, { startIndex: startIndex, stopIndex: end });
          return;
        }

        for (var i = 0; i < ledgers.length; i++) {
          if (ledgers[i].ledger_index === startIndex - 1) {
            log.info("duplicate ledger index:", ledgers[i].ledger_index);
            var keys = [ledgers[i - 1].rowkey, ledgers[i].rowkey];
            hbase
              .deleteRows({
                table: "lu_ledgers_by_index",
                rowkeys: keys,
              })
              .then(function (resp) {
                callback(null, {
                  startIndex: startIndex - 1,
                  stopIndex: startIndex - 1,
                });
              });
            return;
          } else if (ledgers[i].ledger_index !== startIndex) {
            log.info("missing ledger at:", startIndex);
            log.info("gap ends at:", ledgers[i].ledger_index);
            callback(null, {
              startIndex: startIndex,
              stopIndex: ledgers[i].ledger_index - 1,
            });
            return;
          } else if (ledgerHash && ledgerHash !== ledgers[i].parent_hash) {
            log.info("incorrect parent hash at:", startIndex);
            var keys = [ledgers[i - 1].rowkey, ledgers[i].rowkey];
            hbase
              .deleteRows({
                table: "lu_ledgers_by_index",
                rowkeys: keys,
              })
              .then(function (resp) {
                callback(null, {
                  startIndex: startIndex - 1,
                  stopIndex: startIndex - 1,
                });
              });
            return;
          }

          ledgerHash = ledgers[i].ledger_hash;
          startIndex++;
        }

        if (end <= params.stop) {
          self._findGap(
            {
              index: startIndex,
              stop: params.stop,
              ledger_hash: ledgerHash,
            },
            callback
          );
        } else {
          log.info("stop index reached: ", params.stop);
          callback(null, null);
          if (cb) cb();
          return;
        }
      }
    );
  };

  function saveLedger(ledger, callback) {
    var parsed = Parser.parseLedger(ledger);

    hbase.saveParsedData({ data: parsed }, function (err, resp) {
      if (err) {
        callback(
          "unable to save parsed data for ledger: " + ledger.ledger_index
        );
        return;
      }

      log.info("parsed data saved: ", ledger.ledger_index);

      hbase.saveTransactions(parsed.transactions, function (err, resp) {
        if (err) {
          callback(
            "unable to save transactions for ledger: " + ledger.ledger_index
          );
          return;
        }

        log.info(
          parsed.transactions.length + " transactions(s) saved: ",
          ledger.ledger_index
        );

        hbase.saveLedger(parsed.ledger, function (err, resp) {
          if (err) {
            log.error(err);
            callback("unable to save ledger: " + ledger.ledger_index);
          } else {
            log.info("ledger saved: ", ledger.ledger_index);
            callback(null, true);
          }
        });
      });
    });
  }
};

module.exports = HistoricalImport;
