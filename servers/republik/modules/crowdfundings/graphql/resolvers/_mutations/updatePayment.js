const { Roles } = require('@orbiting/backend-modules-auth')
const logger = console
const generateMemberships = require('../../../lib/generateMemberships')
const { sendPaymentSuccessful } = require('../../../lib/Mail')
const { refreshPotForPledgeId } = require('../../../lib/membershipPot')

module.exports = async (_, args, { pgdb, req, t, redis, user: me }) => {
  Roles.ensureUserHasRole(me, 'supporter')

  const { paymentId, status, reason } = args
  const now = new Date()

  let updatedPledge
  const transaction = await pgdb.transactionBegin()
  try {
    const payment = await transaction.public.payments.findOne({ id: paymentId })
    if (!payment) {
      logger.error('payment not found', { req: req._log(), args })
      throw new Error(t('api/payment/404'))
    }

    // check if state transform is allowed
    if (status === 'PAID') {
      if (payment.status !== 'WAITING') {
        logger.error('only payments with status WAITING can be set to PAID',
          { req: req._log(), args, payment }
        )
        throw new Error(t('api/unexpected'))
      }
      if (!reason) {
        logger.error('need reason', { req: req._log(), args, payment })
        throw new Error(t('package/customize/userPrice/reason/error'))
      }
    } else if (status === 'REFUNDED') {
      if (payment.status !== 'WAITING_FOR_REFUND') {
        logger.error('only payments with status WAITING_FOR_REFUND can be REFUNDED',
          { req: req._log(), args, payment }
        )
        throw new Error(t('api/unexpected'))
      }
    } else {
      logger.error('only change to PAID and REFUNDED supported.', { req: req._log(), args, payment })
      throw new Error(t('api/unexpected'))
    }

    let prefixedReason
    if (reason) {
      prefixedReason = 'Support: ' + reason
    }
    await transaction.public.payments.updateOne({
      id: payment.id
    }, {
      status,
      pspPayload: prefixedReason,
      updatedAt: now
    }, {
      skipUndefined: true
    })

    // update pledge status
    if (status === 'PAID') {
      const pledge = (await transaction.query(`
        SELECT
          p.*
        FROM
          "pledgePayments" pp
        JOIN
          pledges p
          ON pp."pledgeId" = p.id
        WHERE
          pp."paymentId" = :paymentId
      `, {
        paymentId
      }))[0]

      if (pledge.status !== 'SUCCESSFUL') {
        updatedPledge = await transaction.public.pledges.updateAndGetOne({
          id: pledge.id
        }, {
          status: 'SUCCESSFUL',
          updatedAt: now
        })
      }

      const hasPledgeMemberships = await pgdb.public.memberships.count({
        pledgeId: pledge.id
      })

      // Only generate memberships (or periods) of pledge has not generated
      // memberships already.
      if (hasPledgeMemberships < 1) {
        await generateMemberships(pledge.id, transaction, t, redis)
      }

      await sendPaymentSuccessful({ pledgeId: pledge.id, pgdb: transaction, t })
    }

    await transaction.transactionCommit()
  } catch (e) {
    await transaction.transactionRollback()
    logger.info('transaction rollback', { req: req._log(), args, error: e })
    throw e
  }

  if (updatedPledge) {
    await refreshPotForPledgeId(updatedPledge.id, { pgdb })
      .catch(e => {
        console.error('error after payPledge', e)
      })
  }

  return pgdb.public.payments.findOne({ id: paymentId })
}
