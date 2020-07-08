const express = require('express')
const cors = require('cors')
const { createServer } = require('http')
const checkEnv = require('check-env')
const compression = require('compression')
const timeout = require('connect-timeout')
const helmet = require('helmet')

const graphql = require('./express/graphql')
const graphiql = require('./express/graphiql')

const DEV = process.env.NODE_ENV && process.env.NODE_ENV !== 'production'

checkEnv([
  'DATABASE_URL',
  'SESSION_SECRET'
])

const {
  PORT,
  HOST = '::',
  CORS_ALLOWLIST_URL,
  SESSION_SECRET,
  COOKIE_DOMAIN,
  COOKIE_NAME,
  IGNORE_SSL_HOSTNAME,
  REQ_TIMEOUT
} = process.env

// middlewares
const { express: { auth: Auth } } = require('@orbiting/backend-modules-auth')
const requestLog = require('./express/requestLog')

// init httpServer and express and start listening
const start = async (
  graphqlSchema,
  middlewares,
  t,
  connectionContext,
  createGraphqlContext = identity => identity,
  loggingContext,
  workerId
) => {
  const { pgdb, redis } = connectionContext
  const { logger } = loggingContext

  const server = express()
  const httpServer = createServer(server)

  server.use(helmet({
    hsts: {
      maxAge: 60 * 60 * 24 * 365, // 1 year to get preload approval
      preload: true,
      includeSubDomains: true
    },
    referrerPolicy: {
      policy: 'no-referrer'
    }
  }))

  // prod only
  if (!DEV) {
    // enable compression
    server.use(compression())
    // trust first proxy
    server.enable('trust proxy')
    // redirect to https
    server.use((req, res, next) => {
      if (!req.secure && (!IGNORE_SSL_HOSTNAME || req.hostname !== IGNORE_SSL_HOSTNAME)) {
        res.redirect(`https://${req.hostname}${req.url}`)
      } else {
        next()
      }
    })
  }

  // add req._log()
  server.use(requestLog)

  // monitor timeouts
  if (REQ_TIMEOUT) {
    server.use(
      timeout(REQ_TIMEOUT, { respond: false }),
      (req, res, next) => {
        req.on('timeout', () => logger.error('request timed out:', req._log()))
        next()
      }
    )
  }

  if (CORS_ALLOWLIST_URL) {
    const corsOptions = {
      origin: CORS_ALLOWLIST_URL.split(','),
      credentials: true,
      optionsSuccessStatus: 200 // some legacy browsers (IE11, various SmartTVs) choke on 204
    }
    server.use('*', cors(corsOptions))
  }

  // Once DB is available, setup sessions and routes for authentication
  const auth = Auth.configure({
    server,
    secret: SESSION_SECRET,
    domain: COOKIE_DOMAIN || undefined,
    cookieName: COOKIE_NAME,
    dev: DEV,
    pgdb
  })

  const graphqlLogger = logger.child({ component: 'graphql' })

  graphql(
    server,
    httpServer,
    pgdb,
    graphqlSchema,
    createGraphqlContext,
    graphqlLogger
  )

  graphiql(server)

  for (const middleware of middlewares) {
    await middleware(server, pgdb, t, redis)
  }

  let closed = false
  const close = async () => {
    if (closed) {
      logger.warn('server already closed')
      return
    }

    closed = true

    httpServer.close()
    auth.close()
  }

  const result = {
    close,
    createGraphqlContext
  }

  return new Promise((resolve) => {
    const callback = () => {
      if (workerId) {
        logger.info(`server (${workerId}) is running on http://${HOST}:${PORT}`)
      } else {
        logger.info(`server is running on http://${HOST}:${PORT}`)
      }
      resolve(result)
    }

    httpServer.listen(PORT, HOST, callback)
  })
}

module.exports = {
  start
}
