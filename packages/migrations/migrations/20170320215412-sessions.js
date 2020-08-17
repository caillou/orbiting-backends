const run = require('../run.js')

const dir = 'packages/republik/migrations/crowdfunding/sqls'
const file = '20170320215412-sessions'

exports.up = (db) =>
  run(db, dir, `${file}-up.sql`)

exports.down = (db) =>
  run(db, dir, `${file}-down.sql`)
