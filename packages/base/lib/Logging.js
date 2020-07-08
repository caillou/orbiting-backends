const bunyan = require('bunyan')

module.exports = function (options) {
  return {
    logger: bunyan.createLogger(options)
  }
}
