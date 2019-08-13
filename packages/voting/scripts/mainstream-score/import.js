#!/usr/bin/env node
require('@orbiting/backend-modules-env').config()
require('isomorphic-unfetch') // for gsheets
const gsheets = require('gsheets')
const Promise = require('bluebird')
const PgDb = require('@orbiting/backend-modules-base/lib/PgDb')
const moment = require('moment')

const SPREADSHEET_ID = '1kmUhQ2Tihg0V1bBxKgYbhAgArSQqQk8q1Ee-tEMUu2A'

PgDb.connect().then(async pgdb => {
  const spreadsheet = await gsheets.getSpreadsheet(SPREADSHEET_ID)

  await Promise.each(
    spreadsheet.worksheets,
    async ({ id: worksheetId }) => {
      const sheet = await gsheets.getWorksheetById(SPREADSHEET_ID, worksheetId)

      const slug = `mss-${sheet.title}`
      const now = moment()

      if (await pgdb.public.questionnaires.findFirst({ slug })) {
        console.log(`skipping existing questionnaire: ${slug}`)
      } else {
        const questionnaire = await pgdb.public.questionnaires.insertAndGet({
          slug,
          description: slug,
          beginDate: now,
          endDate: moment(now).add(1, 'year'),
          allowedRoles: [],
          liveResult: true,
          submitAnswersImmediately: true
        })

        let counter = 0
        await pgdb.public.questions.insert(
          sheet.data.map(d => ({
            questionnaireId: questionnaire.id,
            order: counter++,
            text: d['Frage'],
            type: 'Choice',
            typePayload: {
              cardinality: 1,
              options: [
                { label: 'Ja', value: 'true' },
                { label: 'Nein', value: 'false' }
              ]
            }
          }))
        )

        console.log(`imported ${slug} with ${counter} questions`)
      }
    }
  )
  console.log('finished')
})
