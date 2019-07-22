#!/usr/bin/env node
require('@orbiting/backend-modules-env').config()

const Promise = require('bluebird')

const { sendMailTemplate } = require('@orbiting/backend-modules-mail')
const PgDb = require('@orbiting/backend-modules-base/lib/PgDb')

PgDb.connect().then(async pgdb => {
  const recipients = [
    'inbox@domain.tld'
  ]

  await Promise.each(recipients, async recipient => {
    await sendMailTemplate(
      {
        to: recipient,
        subject: 'Da lief etwas nicht nach Plan: Ihr Abo',
        templateName: 'membership_winback_mistake_manual'
      },
      {
        pgdb
      }
    )

    console.log({ recipient })
  })

  await pgdb.close()
})
