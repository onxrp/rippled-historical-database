/* eslint-disable no-continue,no-param-reassign,@typescript-eslint/no-this-alias,func-names,prefer-template,object-shorthand,prefer-destructuring,import/no-unresolved,import/extensions,@typescript-eslint/no-var-requires,no-var */

var moment = require('moment')
var Promise = require('bluebird')
var BigNumber = require('bignumber.js')
var smoment = require('../smoment')
var hbase = require('../hbase')
var utils = require('../utils')
var Logger = require('../logger')
var config = require('../../config')

var LI_PAD = 12
var I_PAD = 5

/**
 * PaymentsAggregation
 */

function PaymentsAggregation(options) {
  var self = this
  var logOpts = {
    scope: 'payments aggregation',
    file: config.get('logFile'),
    level: config.get('logLevel'),
  }

  this.log = new Logger(logOpts)
  this.ready = true
  this.currency = options.currency
  this.issuer = options.issuer
  this.pending = []
  this.cached = {
    hour: {},
    day: {},
  }

  setImmediate(function () {
    self.aggregate()
  })

  // remove older data every hour
  this.purge = setInterval(function () {
    self.ready = false

    const payments = moment.utc().startOf('hour').subtract(2, 'hour')
    const hour = moment.utc().startOf('day').subtract(1, 'day')
    const day = moment.utc().startOf('day').subtract(7, 'day')

    // remove cached payments
    // eslint-disable-next-line no-restricted-syntax
    for (const time in self.cached.hour) {
      if (payments.diff(time) > 0 && self.cached.hour[time].payments) {
        self.cached.hour[time].payments = {}
      }
    }

    // remove cached payments
    // eslint-disable-next-line no-restricted-syntax
    for (const time in self.cached.hour) {
      if (hour.diff(time) > 0) {
        delete self.cached.hour[time]
      }
    }

    // remove cached days
    // eslint-disable-next-line no-restricted-syntax
    for (const time in self.cached.day) {
      if (day.diff(time) > 0) {
        delete self.cached.day[time]
      }
    }

    self.ready = true
  }, 60 * 60 * 1000)
}

/**
 * aggregate
 * aggregate incoming payments
 */

PaymentsAggregation.prototype.aggregate = function () {
  var self = this
  var incoming
  var updated = {
    hour: {},
    day: {},
    week: {},
    month: {},
  }

  function aggregate() {
    self.aggregate()
  }

  if (!self.pending.length) {
    setTimeout(aggregate, 200)
    return
  }

  if (!self.ready) {
    setTimeout(aggregate, 200)
    return
  }

  incoming = self.pending
  self.pending = []
  self.ready = false

  prepareHours()
    .then(aggregateHours)
    .then(prepareDays)
    .then(aggregateDays)
    .then(update)
    .nodeify(function (err, resp) {
      if (err) {
        self.log.error(err, resp)
      }

      // execute callback functions
      // for incoming exchanges
      incoming.forEach(function (i) {
        if (i.callback) {
          i.callback()
        }
      })

      self.ready = true
      setImmediate(aggregate)
    })

  /**
   * fetchPayments
   */

  function fetchPayments(hour) {
    return new Promise(function (resolve, reject) {
      var time = smoment(hour.format('YYYY-MM-DDTHH'))
      // eslint-disable-next-line no-param-reassign
      hour = hour.format()

      hbase.getPayments(
        {
          currency: self.currency,
          issuer: self.issuer,
          start: time,
          end: time,
          descending: false,
        },
        function (err, resp) {
          // console.log(time.format(), self.currency, self.issuer, resp.rows.length)

          if (err) {
            reject(err)
          } else {
            self.cached.hour[hour].payments = {}
            resp.rows.forEach(function (payment) {
              // console.log(payment.rowkey, payment.currency, payment.issuer)
              self.cached.hour[hour].payments[payment.rowkey] = payment
            })
            resolve()
          }
        },
      )
    })
  }

  /**
   * prepareHours
   */

  function prepareHours() {
    var hours = {}

    // determine hours to update
    incoming.forEach(function (row) {
      var hour = moment.unix(row.payment.time).utc().startOf('hour')
      if (!self.cached.hour[hour.format()]) {
        self.cached.hour[hour.format()] = {}
        hours[hour.format()] = true
      }
    })

    // fetch all payments for
    // hours that are missing
    return Promise.map(Object.keys(hours), function (hour) {
      if (!self.cached.hour[hour].payments) {
        self.cached.hour[hour].payments = {}
        return fetchPayments(moment.utc(hour))
      }
      return Promise.resolve()
    }).then(function () {
      // add the new payments
      incoming.forEach(function (row) {
        var hour = moment.unix(row.payment.time).utc().startOf('hour')
        var rowkey = [
          row.payment.currency,
          row.payment.issuer || '',
          utils.formatTime(row.payment.time),
          utils.padNumber(row.payment.ledger_index, LI_PAD),
          utils.padNumber(row.payment.tx_index, I_PAD),
        ].join('|')

        hour = hour.format()
        // eslint-disable-next-line no-param-reassign
        row.payment.rowkey = rowkey
        if (!self.cached.hour[hour].payments) self.cached.hour[hour].payments = {}
        self.cached.hour[hour].payments[rowkey] = row.payment
        self.cached.hour[hour].updated = true
      })
    })
  }

  /**
   * aggregateHours
   */

  function aggregateHours() {
    return Promise.map(Object.keys(self.cached.hour), function (hour) {
      var cached = self.cached.hour[hour]
      if (cached.updated) {
        cached.updated = false
        cached.reduced = reduce(cached.payments)
        updated.hour[hour] = cached.reduced
      }
    })
  }

  /**
   * fetchHour
   */

  function fetchHour(time) {
    return new Promise(function (resolve, reject) {
      var rowkey = 'hour|' + self.currency + '|' + (self.issuer || '') + '|' + utils.formatTime(time)

      hbase.getRow(
        {
          table: 'agg_payments',
          rowkey: rowkey,
        },
        function (err, row) {
          if (err) {
            reject(err)
            return
          }

          if (row) {
            row.count = Number(row.count)
            row.amount = Number(row.amount)
            row.average = Number(row.average)
          }

          if (!self.cached.hour[time]) {
            self.cached.hour[time] = {}
          }

          self.cached.hour[time].reduced = row
          resolve()
        },
      )
    })
  }

  /**
   * prepareDays
   */

  function prepareDays() {
    var hours = {}

    // determine which hours we need
    // eslint-disable-next-line no-restricted-syntax, guard-for-in
    for (const hour in updated.hour) {
      const start = moment.utc(hour).startOf('day')
      const end = moment.utc(start).add(1, 'day')
      const now = moment.utc()

      if (!self.cached.day[start.format()]) {
        self.cached.day[start.format()] = {}
      }

      while (end.diff(start) > 0 && now.diff(start) > 0) {
        if (!self.cached.hour[start.format()]) {
          hours[start.format()] = true
        }

        start.add(1, 'hour')
      }
    }

    // fetch all hours that are missing
    return Promise.map(Object.keys(hours), fetchHour)
  }

  /**
   * aggregateDays
   */

  function aggregateDays() {
    var days = {}
    var hours = {}

    // determine which days to update
    // eslint-disable-next-line no-restricted-syntax, guard-for-in
    for (const hour in updated.hour) {
      const day = moment.utc(hour).startOf('day')
      days[day.format()] = day
    }

    // eslint-disable-next-line no-restricted-syntax, guard-for-in
    for (const day in days) {
      const time = days[day]
      const end = moment.utc(time).add(1, 'day')

      while (end.diff(time) > 0) {
        const hour = self.cached.hour[time.format()]
        hours[time.format()] = hour ? hour.reduced : undefined
        time.add(1, 'hour')
      }

      self.cached.day[day].reduced = reduce(hours, true)
      updated.day[day] = self.cached.day[day].reduced
    }
  }

  /**
   * update
   */

  function update() {
    var rows = {}
    var key = self.currency + '|' + (self.issuer || '')

    // eslint-disable-next-line no-restricted-syntax, guard-for-in
    for (const interval in updated) {
      // eslint-disable-next-line no-restricted-syntax, guard-for-in
      for (const time in updated[interval]) {
        const rowkey = interval + '|' + key + '|' + utils.formatTime(time)

        rows[rowkey] = updated[interval][time]
        rows[rowkey].currency = self.currency
        rows[rowkey].issuer = self.issuer
        rows[rowkey].date = time
      }
    }

    self.log.debug(Object.keys(rows))
    return hbase.putRows({
      table: 'agg_payments',
      rows: rows,
    })
  }

  /**
   * reduce
   */

  function reduce(rows, rereduce) {
    var amount = new BigNumber(0)
    var count = 0

    // eslint-disable-next-line no-restricted-syntax, guard-for-in
    for (const key in rows) {
      if (!rows[key]) {
        continue
      } else if (rereduce) {
        amount = amount.plus(rows[key].amount)
        count += rows[key].count
      } else {
        amount = amount.plus(rows[key].delivered_amount)
        count++
      }
    }

    return {
      amount: amount.toString(),
      count: count,
      average: amount.dividedBy(count).toString(),
    }
  }
}

/**
 * add
 */

PaymentsAggregation.prototype.add = function (payment, callback) {
  this.pending.push({
    payment: payment,
    callback: callback,
  })
}

module.exports = PaymentsAggregation
