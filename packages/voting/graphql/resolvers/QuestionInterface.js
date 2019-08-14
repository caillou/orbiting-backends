const { turnout, userAnswer } = require('../../lib/Question')

module.exports = {
  __resolveType (question) {
    return `QuestionType${question.type}`
  },
  userAnswer: (question, args, { user: me, pgdb }) => {
    return userAnswer(question, me, pgdb)
  },
  turnout: async (question, args, { pgdb }) => {
    const { result } = question
    if (result && result.turnout) {
      return result.turnout
    }
    return turnout(question, pgdb)
  }
}
