const run = require('../run.js')

const dir = 'packages/collections/migrations/sqls/'
const file = '20200518021758-rem-unused-indices'

exports.up = (db) =>
  run(db, dir, `${file}-up.sql`)

exports.down = (db) =>
  run(db, dir, `${file}-down.sql`)
