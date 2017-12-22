module.exports = `

schema {
  query: queries
  mutation: mutations
}

type queries {
  crowdfundings: [Crowdfunding]
  crowdfunding(name: String!): Crowdfunding!
  pledges: [Pledge!]!
  pledge(id: ID!): Pledge
  draftPledge(id: ID!): Pledge!

  # required role: supporter
  adminUsers(
    limit: Int!,
    offset: Int,
    orderBy: OrderBy,
    search: String,
    dateRangeFilter: DateRangeFilter,
    stringArrayFilter: StringArrayFilter,
    booleanFilter: BooleanFilter
  ): Users!

  # required role: supporter
  payments(
    limit: Int!,
    offset: Int, orderBy: OrderBy,
    search: String,
    dateRangeFilter: DateRangeFilter,
    stringArrayFilter: StringArrayFilter,
    booleanFilter: BooleanFilter
  ): PledgePayments!

  # required role: supporter
  postfinancePayments(
    limit: Int!,
    offset: Int,
    orderBy: OrderBy,
    search: String,
    dateRangeFilter: DateRangeFilter,
    stringArrayFilter: StringArrayFilter,
    booleanFilter: BooleanFilter
  ): PostfinancePayments!

  # This exports a CSV containing all payments IN paymentIds
  # required role: accountant
  paymentsCSV(paymentIds: [ID!]): String!
}

type mutations {
  submitPledge(pledge: PledgeInput): PledgeResponse!
  payPledge(pledgePayment: PledgePaymentInput): PledgeResponse!
  reclaimPledge(pledgeId: ID!): Boolean!
  claimMembership(voucherCode: String!): Boolean!
  # adds a new paymentSource and makes it the default
  addPaymentSource(sourceId: String!): [PaymentSource!]!

  reactivateMembership(
    id: ID!
    membershipTypeId: ID!
  ): Membership!

  # required role: supporter
  updateUser(firstName: String, lastName: String, birthday: Date, phoneNumber: String, address: AddressInput, userId: ID!): User!

  # if userId is null, the logged in user's email is changed
  # required role to change other's email: supporter
  updateEmail(userId: ID, email: String!): User!

  # merges the belongings from source to target
  # required role: admin
  mergeUsers(targetUserId: ID!, sourceUserId: ID!): User!

  # required role: supporter
  cancelPledge(pledgeId: ID!): Pledge!

  # Tries to resolve the amount of a pledge to the total of it's PAID payment.
  # This comes handy if e.g. the payment is off by some cents (foreign wire transfer)
  # and the backoffice decides to not demand an additional wire transfer.
  # Required role: supporter
  resolvePledgeToPayment(pledgeId: ID!, reason: String!): Pledge!

  # required role: supporter
  updatePayment(paymentId: ID!, status: PaymentStatus!, reason: String): PledgePayment!

  # required role: supporter
  updatePostfinancePayment(pfpId: ID!, mitteilung: String!): PostfinancePayment!

  # This imports a CSV exported by PostFinance
  # required role: accountant
  importPostfinanceCSV(csv: String!): String!

  # required role: supporter
  rematchPayments: String!

  # required role: supporter
  sendPaymentReminders(paymentIds: [ID!]!, emailSubject: String): Int!

  # required role: supporter
  hidePostfinancePayment(id: ID!): PostfinancePayment!

  # required role: supporter
  manuallyMatchPostfinancePayment(id: ID!): PostfinancePayment!
}
`
