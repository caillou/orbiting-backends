const { ApolloServer } = require('apollo-server-express')
const { makeExecutableSchema } = require('apollo-server')
const cookie = require('cookie')
const cookieParser = require('cookie-parser')

const { transformUser } = require('@orbiting/backend-modules-auth')

const {
  WS_KEEPALIVE_INTERVAL,
  RES_KEEPALIVE
} = process.env

const DEV = process.env.NODE_ENV && process.env.NODE_ENV !== 'production'

module.exports = (
  server,
  httpServer,
  pgdb,
  graphqlSchema,
  createGraphqlContext = identity => identity,
  logger
) => {
  const executableSchema = makeExecutableSchema({
    ...graphqlSchema,
    resolverValidationOptions: {
      requireResolversForResolveType: false
    }
  })

  const createContext = ({ user, ...rest } = {}) => {
    const context = createGraphqlContext({
      ...rest,
      user: (global && global.testUser !== undefined)
        ? global.testUser
        : user
    })
    // prime User dataloader with me
    if (
      context.user && context.user.id && // global.testUser has no id
      context.loaders && context.loaders.User
    ) {
      context.loaders.User.byId.prime(
        context.user.id,
        context.user
      )
    }
    return context
  }

  const apolloServer = new ApolloServer({
    schema: executableSchema,
    context: ({ req, connection }) => connection
      ? connection.context
      : createContext({ user: req.user, req }),
    debug: DEV,
    introspection: true,
    playground: false, // see ./graphiql.js
    subscriptions: {
      onConnect: async (connectionParams, websocket) => {
        try {
          // apollo-fetch used in tests sends cookie on the connectionParams
          const cookiesRaw = (DEV && connectionParams.cookies)
            ? connectionParams.cookies
            : websocket.upgradeReq.headers.cookie
          if (!cookiesRaw) {
            return createContext()
          }
          const cookies = cookie.parse(cookiesRaw)
          const authCookie = cookies['connect.sid']
          const sid = authCookie && cookieParser.signedCookie(
            authCookie,
            process.env.SESSION_SECRET
          )
          const session = sid && await pgdb.public.sessions.findOne({ sid })
          if (session && session.sess && session.sess.passport && session.sess.passport.user) {
            const user = await pgdb.public.users.findOne({ id: session.sess.passport.user })
            return createContext({
              user: transformUser(user)
            })
          }
          return createContext()
        } catch (e) {
          logger.error(e)
        }
      },
      keepAlive: WS_KEEPALIVE_INTERVAL || 40000
    },
    formatError: err => {
      logger.error(err)
      return err
    },
    formatResponse: (response, { context }) => {
      // strip problematic character (\u2028) for requests from our iOS app
      // see https://github.com/orbiting/app/issues/159
      const { req } = context
      const ua = req.headers['user-agent']
      if (ua && ua.includes('RepublikApp') && (
        ua.includes('iPhone') || ua.includes('iPad') || ua.includes('iPod')
      )) {
        return JSON.parse(
          JSON.stringify(response).replace(/\u2028/g, '')
        )
      }
      return response
    }
  })

  if (RES_KEEPALIVE) {
    server.use('/graphql', require('./keepalive'))
  }

  apolloServer.applyMiddleware({
    app: server,
    cors: false,
    bodyParserConfig: {
      limit: '128mb'
    }
  })

  apolloServer.installSubscriptionHandlers(httpServer)
}
