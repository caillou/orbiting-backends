#!/usr/bin/env node
require('@orbiting/backend-modules-env').config()

const { csvFormat, csvParse } = require('d3-dsv')
const { transformUser, AccessToken } = require('@orbiting/backend-modules-auth')
const { encode } = require('@orbiting/backend-modules-base64u')
const fs = require('fs').promises
const path = require('path')
const PgDb = require('@orbiting/backend-modules-base/lib/PgDb')
const Promise = require('bluebird')
const yargs = require('yargs')

const argv = yargs
  .option('file', {
    description: 'CSV file to append token to',
    alias: 'f',
    required: true,
    coerce: input => path.resolve(input)
  })
  .option('identifier', {
    description: 'attribute name which points to a user ID',
    alias: 'i',
    default: 'userId'
  })
  .option('scope', {
    description: 'Access Token scope',
    alias: 's',
    default: 'CUSTOM_PLEDGE'
  })
  .argv

PgDb.connect().then(async pgdb => {
  const listRaw = await fs.readFile(argv.file, 'utf-8')

  const listArray = csvParse(listRaw)

  /* const users = await pgdb.public.users.find({ id: listArray.map(row => row[argv.identifier]) })
    .then(users => users.map(transformUser)) */

  const users = await pgdb.public.users.find({ email: listArray.map(row => row[argv.identifier]) })
    .then(users => users.map(transformUser))

  const accessGrants = await pgdb.public.accessGrants.find({
    recipientUserId: users.map(u => u.id),
    accessCampaignId: '3d0fc18e-0c80-46a9-ac8a-a697f912877f'
  })

  console.warn('users: ', users.length, 'accessGrants:', accessGrants.length)

  const list = await Promise.map(listArray, async (row, index) => {
    if (index % 100 === 1) {
      console.warn(`  ${index + 1}`)
    }

    const user = users.find(user => user.email.toLowerCase() === row[argv.identifier].toLowerCase())
    const accessGrant = user && accessGrants.find(a => a.recipientUserId === user.id)

    if (!user) {
      console.warn(`User with ID "${row[argv.identifier]}" not found.`)
      return
      // throw new Error(`User with ID "${row[argv.identifier]}" not found.`)
    }

    const token = await AccessToken.generateForUser(user, argv.scope)

    return {
      email: user.email,
      EMAILB64U: encode(user.email),
      AS_ATOKEN: token,
      COVID19_AG: accessGrant ? 'Y' : ''
    }
  })

  console.log(csvFormat(list.filter(Boolean)))

  await pgdb.close()
})
