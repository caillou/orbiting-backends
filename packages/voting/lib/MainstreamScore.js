const { getQuestionsWithResults, userAnswers: getUserAnswers } = require('./Questionnaire')
const Promise = require('bluebird')
const { descending } = require('d3-array')

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

const userScoreForQuestionnaire = async (questionnaire, args = {}, context, { questionsWithResults }) => {
  const { user: me, pgdb } = context
  const user = args.user || me

  // TODO dataloader
  if (!questionsWithResults) {
    questionsWithResults = await getQuestionsWithResults(questionnaire, context)
  }
  const userAnswers = await getUserAnswers(questionnaire, user, pgdb)

  const numInRelativeMajority = questionsWithResults.reduce(
    (agg, question) => {
      const userAnswer = userAnswers.find(a => a.questionId === question.id)
      if (userAnswer) {
        const majorityResult = question.result.payload.find(r => r.hasRelativeMajority)
        if (majorityResult && majorityResult.option.value == userAnswer.payload.value[0]) {
          return agg + 1
        }
      }
      return agg
    },
    0
  )

  return Math.round(100 / questionsWithResults.length * numInRelativeMajority)
}

const scoreStatsForQuestionnaire = async (questionnaire, args, context) => {
  const { pgdb } = context

  const users = await pgdb.query(`
      SELECT DISTINCT(u.*)
      FROM users u
      JOIN answers a
        ON a."userId" = u.id
      JOIN questions
        ON a."questionId" = questions.id
      WHERE
        questions."questionnaireId" = :questionnaireId AND
        a.submitted = true
    `, {
    questionnaireId: questionnaire.id
  })

  const questionsWithResults = await getQuestionsWithResults(questionnaire, context)

  const scores = await Promise.map(
    users,
    (u) => userScoreForQuestionnaire(questionnaire, { user: u }, context, { questionsWithResults })
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

  const result = Object.keys(scoresWithCounts)
    .map(key => ({
      score: `${key} MP`,
      sortKey: parseInt(key),
      count: scoresWithCounts[key]
    }))
    .sort((a, b) => descending(a.sortKey, b.sortKey))

  return result
}

const updateAnswerAfterHook = async (questionnaire, pgdb) => {
  // getResult for question
  // update question.result
  // result: [
  //   { option: { label: 'Nein', value: 'false' }, count: 78, majority: true },
  //   { option: { label: 'Ja', value: 'true' }, count: 23, majority: false }
  // ]

  // if question.result.option.majority changes
  // update questionnaire.result

  // read all answers of user
  // update questionnaire submission
  // agg qsub to questionnaire
  //
  // qs.ansers
  // q.result

}

const userNumIdenticalQuestionnaireSubmissions = async (questionnaire, args, context) => {
  // load users questionnaire submission
  // count

}

module.exports = {
  userScoreForQuestionnaire,
  scoreStatsForQuestionnaire
}
