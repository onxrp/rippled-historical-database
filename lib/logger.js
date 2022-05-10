'use strict'

var winston = require('winston')
var moment = require('moment')
var config = require('../config')
var colors = require('colors')

class Log {
  logger = null
  level = 3
  scope = null
  transports = []

  constructor(options) {
    this.level = options.level
    this.scope = options.scope || null
    if (this.level === undefined) {
      this.level = config.get('logLevel') === undefined ? 3 : config.get('logLevel')
    }

    // for storm we will log everything to a
    // file, including console logging
    if (options.file) {
      this.transports.push(
        new winston.transports.File({
          filename: options.file,
          format: winston.format.combine(winston.format.uncolorize(), winston.format.json()),
        }),
      )

      // replace console.log function
      console.log = (...args) => {
        if (this.level) {
          // args = Array.prototype.slice.call(args)
          args.unshift('CONSOLE')
          this.log('info', args)
        }
      }
    }

    if (!options.disableConsoleLog) {
      this.transports.push(
        new winston.transports.Console({
          level: 'debug',
          format: winston.format.combine(winston.format.colorize(), winston.format.simple()),
        }),
      )
    }

    this.logger = winston.createLogger({
      transports: this.transports,
    })
  }

  /**
   * log
   */
  log = (type, args) => {
    args = Array.prototype.slice.call(args)

    if (this.scope) {
      args.unshift(this.scope.toUpperCase().grey.underline)
    }
    args.unshift(('[' + moment.utc().format('YYYY-MM-DD HH:mm:ss.SSS') + ']').cyan.dim)

    this.logger.log({
      level: type,
      message: args.join(' '),
    })
  }

  level = (l) => {
    this.level = parseInt(l, 10)
  }

  debug = (...args) => {
    if (this.level > 3) {
      this.log('debug', args)
    }
  }

  info = (...args) => {
    if (this.level > 2) {
      this.log('info', args)
    }
  }

  warn = (...args) => {
    if (this.level > 1) {
      this.log('warn', args)
    }
  }

  error = (...args) => {
    if (this.level) {
      this.log('error', args)
    }
  }
}

module.exports = Log
