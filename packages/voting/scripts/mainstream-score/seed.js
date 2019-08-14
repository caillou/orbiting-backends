#!/usr/bin/env node
require('@orbiting/backend-modules-env').config()
const Promise = require('bluebird')
const PgDb = require('@orbiting/backend-modules-base/lib/PgDb')
const Questionnaire = require('@orbiting/backend-modules-voting/lib/Questionnaire')

const getRandomUserId = (questionnaireId, pgdb) =>
  pgdb.queryOneField(`
    SELECT u.id
    FROM users u
    WHERE
      u.id NOT IN (
        SELECT "userId"
        FROM answers a
        WHERE
          a."questionnaireId" = :questionnaireId
      )
      AND u.roles @> '["member"]'
    LIMIT 1
  `, {
    questionnaireId
  })

PgDb.connect().then(async pgdb => {
  const slug = process.argv[2]
  const numUsers = parseInt(process.argv[3]) || 120
  if (!slug) {
    throw new Error('first parameter must be the questionnaire slug to seed')
  }

  const questionnaire = await Questionnaire.findBySlug(slug, pgdb)
  if (!questionnaire) {
    throw new Error(`questionnaire with slug (${slug}) not found`)
  }

  const questions = await Questionnaire.getQuestions(questionnaire, {}, pgdb)

  await Promise.each(
    questions,
    async (q) => {
      const bias = Math.round(Math.random())

      await Promise.each(
        Array(numUsers).fill(1),
        async (_, index) => {
          const userId = await getRandomUserId(questionnaire.id, pgdb)

          const optionIndex = Math.round(Math.random()) === 1
            ? bias
            : Math.round(Math.random())

          const option = q.options[optionIndex]

          await pgdb.public.answers.insert({
            questionId: q.id,
            questionnaireId: questionnaire.id,
            userId,
            payload: { value: [option.value] },
            submitted: true
          })
        }
      )
    }
  )

  console.log('finished')
})
