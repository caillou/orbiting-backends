const { userAnswer: getUserAnswer } = require('./Question')
const { result: getResult } = require('./Question/Choice')
// TODO dataloader
const { getQuestions } = require('./Questionnaire')
const Promise = require('bluebird')
// const uniq = require('lodash/uniq')

/*
  userAnswer: anonymous {
    id: '19473a65-2c36-45f9-a84a-c9fb1ee09385',
    questionnaireId: 'd9e6af06-338e-4c1b-a5ac-0ea2a5c9ef84',
    questionId: '09aa6eec-0bda-434d-a5a0-a1f61585b370',
    userId: 'b3054752-eefe-4cb4-9da0-b57a9c07d334',
    payload: { value: [ 'false' ] },
    submitted: true,
    createdAt: 2019-08-14T12:52:31.974Z,
    updatedAt: 2019-08-14T12:52:31.974Z
  },
  result: [
    { option: { label: 'Nein', value: 'false' }, count: 78 },
    { option: { label: 'Ja', value: 'true' }, count: 23 }
  ]
}
*/

const userScoreForQuestion = async (question, args = {}, context) => {
  const { user: me, pgdb } = context
  const user = args.user || me
  const userAnswer = await getUserAnswer(question, user, pgdb)
  if (!userAnswer) {
    return
  }

  // TODO dataloader
  const result = await getResult(question, {}, context)

  const numSubmitted = result.reduce(
    (agg, r) => r.count + agg,
    0
  )

  /*
  const majorityResult = result.find(r => r.count > numSubmitted / 2)

  if (majorityResult && userAnswer.payload.value == majorityResult.option.value) {
    return Math.round(100 / numSubmitted * majorityResult.count)
  }

  return 0
  */
  const userResult = result.find(r => r.option.value == userAnswer.payload.value)
  return Math.round(100 / numSubmitted * userResult.count)
}

const userScoreForQuestionnaire = async (questionnaire, args = {}, context) => {
  const { pgdb } = context
  const questions = await getQuestions(questionnaire, args, pgdb)

  const scores = await Promise.map(
    questions.filter(q => q.type === 'Choice'),
    (q) => userScoreForQuestion(q, args, context)
  )
  /*
  const total = scores
    .filter(Boolean)
    .reduce((agg, s) => s + agg, 0)
  return Math.round(total / scores.length)
  */
  const total = scores
    .filter(Boolean)
    .reduce((agg, s) => s > 50 ? agg + 1 : agg, 0)

  return Math.round(100 / questions.length * total)
}

const scoreStatsForQuestionnaire = async (questionnaire, args, context) => {
  const { pgdb } = context
  const questions = await getQuestions(questionnaire, args, pgdb)

  const users = await pgdb.query(`
      SELECT DISTINCT(u.*)
      FROM users u
      JOIN answers a
        ON a."userId" = u.id
      WHERE
        ARRAY[a."questionId"] && :questionIds AND
        a.submitted = true
    `, {
    questionIds: questions.map(q => q.id)
  })

  const scores = await Promise.map(
    users,
    (u) => userScoreForQuestionnaire(questionnaire, { user: u }, context)
  )

  const scoresWithCounts = scores
    .filter(Boolean)
    .reduce(
      (agg, s) => {
        if (agg[s]) {
          agg[s] += 1
        } else {
          agg[s] = 1
        }
        return agg
      },
      {}
    )

  const { descending } = require('d3-array')
  const result = Object.keys(scoresWithCounts)
    .map(key => ({
      score: `${key} MP`,
      sortKey: parseInt(key),
      count: scoresWithCounts[key]
    }))
    .sort((a, b) => descending(a.sortKey, b.sortKey))

  console.log(result)
  return result
  /*
    const d3 = require('d3')

    const numTicks = questions.length
    const extent = d3.extent([0, 100])
    const bins = d3.histogram()
      .domain(extent)
      .thresholds(
        d3.ticks(extent[0], extent[1], numTicks).slice(0, -1)
      )(scores)

    return bins.map(bin => ({
      //...bin,
      x0: bin.x0,
      x1: bin.x1,
      count: bin.length
    }))
    */
}

const updateUserScores = async (questionnaire, pgdb) => {
}

module.exports = {
  userScoreForQuestion,
  userScoreForQuestionnaire,
  scoreStatsForQuestionnaire
}
