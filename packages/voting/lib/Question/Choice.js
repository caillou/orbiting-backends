const { descending } = require('d3-array')

const validate = (value, question, { t }) => {
  if (!Array.isArray(value)) {
    throw new Error(t('api/questionnaire/answer/wrongType'))
  }
  if (value.length === 0) {
    return true
  } else {
    if (question.typePayload.cardinality > 0 && value.length > question.typePayload.cardinality) {
      throw new Error(t('api/questionnaire/answer/Choice/tooMany', { max: question.typePayload.cardinality }))
    }
    for (let v of value) {
      if (!question.typePayload.options.find(ov => ov.value === v)) {
        throw new Error(t('api/questionnaire/answer/Choice/value/404', { value: v }))
      }
    }
  }
  return false
}

const getResult = async (question, { top, min }, context) => {
  const { pgdb } = context
  const aggs = await pgdb.query(`
    SELECT
      COUNT(*) AS count,
      jsonb_array_elements(payload->'value') as value
    FROM
      answers
    WHERE
      submitted = true AND
      "questionId" = :questionId
    GROUP BY
      2
    ${min ? 'HAVING COUNT(*) >= :min' : ''}
    ORDER BY
      1 DESC
    ${top ? 'LIMIT :top' : ''}
  `, {
    questionId: question.id,
    top,
    min
  })
  const options = question.options
    .map(option => {
      const agg = aggs.find(a => a.value === option.value)
      return {
        option,
        count: (agg && agg.count) || 0
      }
    })
    .sort((a, b) => descending(a.count, b.count))
  return options
}

const userMainstreamScore = async (question, args, context) => {
  const { userAnswer: getUserAnswer } = require('./index')

  const { user: me, pgdb } = context
  const userAnswer = await getUserAnswer(question, me, pgdb)
  if (!userAnswer) {
    return
  }
  const result = await getResult(question, {}, context)

  const numSubmitted = result.reduce(
    (agg, r) => r.count + agg,
    0
  )

  const majorityResult = result.find(r => r.count > numSubmitted / 2)

  if (majorityResult && userAnswer.payload.value == majorityResult.option.value) {
    return Math.round(100 / numSubmitted * majorityResult.count)
  }

  return 0
}

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

module.exports = {
  validate,
  result: getResult,
  userMainstreamScore
}
