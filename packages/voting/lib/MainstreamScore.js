const { getQuestionsWithResults, userAnswers: getUserAnswers } = require('./Questionnaire')
const Promise = require('bluebird')
const { descending, ascending } = require('d3-array')

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
      score: parseInt(key),
      count: scoresWithCounts[key]
    }))
    .sort((a, b) => descending(a.score, b.score))

  return result
}

const answersToBinaryString = (answers) =>
  answers.reduce(
    (agg, a) =>
      agg + (a.payload.value[0] == 'true' ? '1' : '0'),
    ''
  )

const stringToBinaryBuffer = (string) => Buffer.from(string, 'binary')
// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Bitwise_Operators
const binaryBufferToString = (buf) => {
  let result = ''
  for (var i = 0; i < buf.length; ++i) {
    result += buf[i] & 1
  }
  return result
}

const xorBuffers = (buf1, buf2) => {
  const length = Math.min(buf1.length, buf2.length)
  const result = Buffer.alloc(length)

  for (var i = 0; i < length; ++i) {
    result[i] = buf1[i] ^ buf2[i]
  }

  return result
}

const countBits = buf => {
  let counter = 0
  for (var i = 0; i < buf.length; ++i) {
    counter += buf[i] & 1
  }
  return counter
}

const invertBits = buf => {
  const length = buf.length
  const result = Buffer.alloc(length)

  for (var i = 0; i < length; ++i) {
    result[i] = ~buf[i]
  }

  return result
}

const getNumMismatchingAnswers = (set1, set2) => {
  const xor = xorBuffers(
    stringToBinaryBuffer(set1.values),
    stringToBinaryBuffer(set2.values)
  )
  return countBits(xor)
}

const answerSetsForQuestionnaire = async (questionnaire, args = {}, context) => {
  const { pgdb, user: me } = context

  const user = args.user || me

  const { id: questionnaireId } = questionnaire

  const numQuestions = await pgdb.public.questions.count({ questionnaireId })

  const countedAnswerSets = (await pgdb.query(`
    WITH questionnaire_answers AS (
      SELECT
        a."userId" as "userId",
        jsonb_array_elements(a.payload->'value') as value,
        questions.order as _order
      FROM answers a
      JOIN questions
        ON a."questionId" = questions.id
      WHERE
        a.submitted = true AND
        questions."questionnaireId" = :questionnaireId
      ORDER BY
        questions.order ASC
    ), user_values AS (
      SELECT
        string_agg(
          -- answersToBinaryString in SQL
          CASE WHEN value::text = '"true"'
            THEN '1'
            ELSE '0'
          END,
          ''
          ORDER BY _order ASC
        ) as values
      FROM questionnaire_answers
        GROUP BY
          "userId"
    )
    SELECT
      count(*) as "userCount",
      values,
      values as id
    FROM
      user_values
    GROUP BY values
    ORDER BY 1 DESC
  `, {
    questionnaireId
  }))
    .filter(set => set.values.length === numQuestions)

  const userAnswers = await getUserAnswers(questionnaire, user, pgdb)
  const userAnswerValues = answersToBinaryString(userAnswers)

  const userAnswerSet = countedAnswerSets.find(s => s.values == userAnswerValues)
  const userInvertedAnswerValues =
    binaryBufferToString(
      invertBits(
        stringToBinaryBuffer(userAnswerValues)
      )
    )
  const userInvertedAnswerSet = countedAnswerSets.find(s => s.values == userInvertedAnswerValues)

  const topAnswerSet = countedAnswerSets[0]

  const setRelationships = []
  const relationshipsIds = {}
  countedAnswerSets
    .filter(set => set.userCount > 1)
    .forEach((set1, index1, answerSets) => {
      if (index1 > 0) {
        set1.distToTop = getNumMismatchingAnswers(set1, topAnswerSet)
      }

      const nodeRelationships = []

      // for (let index2 = index1 + 1; index2 < answerSets.length; index2++) {
      for (let index2 = 0; index2 < answerSets.length; index2++) {
        if (index2 !== index1) {
          const set2 = answerSets[index2]
          const rel = {
            id: `${set1.values}-${set2.values}`,
            source: set1.values,
            target: set2.values,
            numMismatchingAnswers: getNumMismatchingAnswers(set1, set2),
            combinedUsersCount: set1.userCount + set2.userCount
          }
          nodeRelationships.push(rel)
        }
      }

      const minNumMismatchingAnswers = nodeRelationships.reduce((agg, r) => Math.min(agg, r.numMismatchingAnswers), 10)
      const maxCombinedUsersCount = nodeRelationships
        .filter(r => r.numMismatchingAnswers === minNumMismatchingAnswers)
        .reduce((agg, r) => Math.max(agg, r.combinedUsersCount), 0)

      // console.log(minNumMismatchingAnswers)
      nodeRelationships.forEach(r => {
        if (r.numMismatchingAnswers === minNumMismatchingAnswers && r.combinedUsersCount === maxCombinedUsersCount) {
          const relIds = [`${r.source}${r.target}`, `${r.target}${r.source}`]
          if (!relationshipsIds[relIds[0]] && !relationshipsIds[relIds[1]]) {
            relationshipsIds[relIds[0]] = true
            relationshipsIds[relIds[1]] = true
            setRelationships.push(r)
          }
        }
      })
    })

  const result = {
    sets: countedAnswerSets,
    userAnswerSet,
    userInvertedAnswerSet,
    setRelationships: setRelationships.sort(
      (a, b) =>
        descending(a.combinedUsersCount, b.combinedUsersCount) ||
        descending(a.numMismatchingAnswers, b.numMismatchingAnswers)
    )
  }

  return result
}

const questionResultHistory = async (question, args, context) => {
  const { pgdb } = context

  const dateCounts = await pgdb.query(`
    WITH all_values AS (
      -- 2019-08-20 13-30-10+00 | "true"
      -- 2019-08-20 13-30-01+00 | "true"
      SELECT
        date_trunc('second', "createdAt") as date,
        jsonb_array_elements(payload->'value') as value
      FROM
        answers
      WHERE
        submitted = true AND
        "questionId" = :questionId
    ), date_counts AS (
      -- 2019-08-20 00-06-04+00 |        23 |         77
      -- 2019-08-20 00-06-13+00 |       110 |         35
      SELECT
        date,
        COUNT(*) FILTER (WHERE value::text = '"true"') as "trueCount",
        COUNT(*) FILTER (WHERE value::text = '"false"') as "falseCount"
      FROM all_values
      GROUP BY
        1
      ORDER BY
        1 ASC
    )
    -- 2019-08-20 00-06-04+00 |        23 |         77
    -- 2019-08-20 00-06-13+00 |       133 |        112
    SELECT
      date,
      sum("trueCount") OVER (ORDER BY date ASC ROWS BETWEEN unbounded preceding and current row) as "trueCount",
      sum("falseCount") OVER (ORDER BY date ASC ROWS BETWEEN unbounded preceding and current row) as "falseCount"
    FROM
      date_counts
  `, {
    questionId: question.id
  })

  const result = dateCounts
    .map(({ date, trueCount, falseCount }) => ({
      date,
      trueRatio: parseInt(trueCount) / (parseInt(trueCount) + parseInt(falseCount))
    }))

  return result
}

module.exports = {
  userScoreForQuestionnaire,
  scoreStatsForQuestionnaire,
  answerSetsForQuestionnaire,
  questionResultHistory
}
