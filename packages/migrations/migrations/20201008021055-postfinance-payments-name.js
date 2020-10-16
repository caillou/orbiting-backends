const run = require('../run.js')

const dir = 'packages/republik-crowdfundings/migrations/sqls/'
const file = '20201008021055-postfinance-payments-name'

exports.up = (db) =>
  run(db, dir, `${file}-up.sql`)

exports.down = (db) =>
  run(db, dir, `${file}-down.sql`)
