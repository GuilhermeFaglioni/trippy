import { randomInt } from 'node:crypto'
import { Hono } from 'hono'
import pg, { type Pool } from 'pg'
import {
  EMAIL_CODE_TTL_MS,
  REFRESH_TOKEN_TTL_MS,
  isValidEmail,
  normalizeEmail,
  type AuthSession,
} from '@trippy/domain'
import {
  PostgresAuthStore,
  createDevAuthTokens,
  createJwksAccessTokenVerifier,
  createOpaqueRefreshToken,
  hashEmailCode,
  hashRefreshToken,
  type AccessTokenVerifier,
  type AuthStore,
  type AuthTokens,
} from '@trippy/adapters/auth'
import { createSmtpEmailSender, type EmailSender } from '@trippy/adapters/email'
import type { ApiConfig } from '../config.ts'
import { AuthHttpError, handleApiError } from './errors.ts'
import { authenticate, type AuthEnvironment } from './authenticate.ts'

export interface AuthRouterOptions {
  now?: () => Date
  codeGenerator?: () => string
  authStore?: AuthStore
  emailSender?: EmailSender
  authTokens?: AuthTokens
  accessTokenVerifier?: AccessTokenVerifier
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const value: unknown = await request.json()
    return isRecord(value) ? value : null
  } catch {
    return null
  }
}

function authUnavailable() {
  return new AuthHttpError(503, 'auth_unavailable', 'Autenticação por e-mail indisponível.')
}

function requireValidEmail(value: unknown): string {
  if (typeof value !== 'string') {
    throw new AuthHttpError(400, 'invalid_email', 'Informe um endereço de e-mail válido.')
  }
  const email = normalizeEmail(value)
  if (email.length > 254 || !isValidEmail(email)) {
    throw new AuthHttpError(400, 'invalid_email', 'Informe um endereço de e-mail válido.')
  }
  return email
}

export async function createAuthRouter(config: ApiConfig, options: AuthRouterOptions = {}) {
  const pool: Pool | undefined = options.authStore
    ? undefined
    : new pg.Pool({ connectionString: config.databaseUrl, max: 5 })
  const store = options.authStore ?? new PostgresAuthStore(pool!)
  const ownsPool = pool !== undefined
  const emailSender =
    options.emailSender ?? createSmtpEmailSender({ host: config.smtpHost, port: config.smtpPort })
  let authTokens: AuthTokens | undefined

  if (options.authTokens) authTokens = options.authTokens
  else if (config.authMode === 'dev') {
    if (!config.authDevJwtPrivateKey) {
      throw new Error('AUTH_DEV_JWT_PRIVATE_KEY obrigatório para AUTH_MODE=dev.')
    }
    authTokens = await createDevAuthTokens({
      privateKey: config.authDevJwtPrivateKey,
      issuer: config.authIssuer,
      audience: config.authAudience,
      keyId: 'trippy-dev',
      ...(options.now ? { now: options.now } : {}),
    })
  }

  const verifyAccessToken: AccessTokenVerifier =
    options.accessTokenVerifier ??
    authTokens?.verifyAccessToken ??
    (config.authJwksUrl
      ? createJwksAccessTokenVerifier({
          issuer: config.authIssuer,
          audience: config.authAudience,
          jwksUrl: config.authJwksUrl,
        })
      : async () => {
          throw new Error('Verificador de access token não configurado.')
        })

  const now = options.now ?? (() => new Date())
  const codeGenerator =
    options.codeGenerator ?? (() => randomInt(0, 1_000_000).toString().padStart(6, '0'))
  const router = new Hono<AuthEnvironment>()

  if (config.authMode === 'dev') {
    const codeSecret = config.authCodeSecret
    if (!codeSecret) throw new Error('AUTH_CODE_SECRET obrigatório para AUTH_MODE=dev.')

    router.post('/auth/email/start', async (context) => {
      const body = await readBody(context.req.raw)
      const email = requireValidEmail(body?.email)

      const code = codeGenerator()
      const codeHmac = hashEmailCode(code, codeSecret)
      const requestedAt = now()
      const created = await store.createEmailLoginCode(
        email,
        codeHmac,
        new Date(requestedAt.getTime() + EMAIL_CODE_TTL_MS),
        requestedAt,
      )
      if (!created) {
        throw new AuthHttpError(
          429,
          'too_many_requests',
          'Aguarde 60 segundos antes de solicitar outro código.',
        )
      }

      try {
        await emailSender.sendLoginCode(email, code)
      } catch (error) {
        await store.invalidateEmailLoginCode(email, codeHmac, now())
        throw error
      }
      return context.json({}, 202)
    })

    router.post('/auth/email/verify', async (context) => {
      const body = await readBody(context.req.raw)
      const email = requireValidEmail(body?.email)
      const code = body?.code
      if (typeof code !== 'string' || code.length > 64) {
        throw new AuthHttpError(401, 'invalid_code', 'Código inválido ou expirado.')
      }

      const result = await store.verifyEmailLoginCode(email, code, codeSecret, now())
      if (result.status === 'too_many_attempts') {
        throw new AuthHttpError(
          429,
          'too_many_attempts',
          'Limite de tentativas atingido. Solicite outro código.',
        )
      }
      if (result.status === 'invalid') {
        throw new AuthHttpError(401, 'invalid_code', 'Código inválido ou expirado.')
      }
      return context.json(await createSession(result.user, createOpaqueRefreshToken()))
    })

    router.post('/auth/refresh', async (context) => {
      const body = await readBody(context.req.raw)
      if (typeof body?.refreshToken !== 'string' || body.refreshToken.length > 256) {
        throw new AuthHttpError(401, 'invalid_refresh_token', 'Refresh token inválido.')
      }
      const next = createOpaqueRefreshToken()
      const refreshedAt = now()
      const rotated = await store.rotateRefreshToken(
        hashRefreshToken(body.refreshToken),
        next.hash,
        new Date(refreshedAt.getTime() + REFRESH_TOKEN_TTL_MS),
        refreshedAt,
      )
      if (rotated.status !== 'rotated') {
        throw new AuthHttpError(401, 'invalid_refresh_token', 'Refresh token inválido.')
      }
      return context.json(await createSession(rotated.user, next, false))
    })

    router.post('/auth/logout', async (context) => {
      const body = await readBody(context.req.raw)
      if (typeof body?.refreshToken === 'string' && body.refreshToken.length <= 256) {
        await store.revokeRefreshToken(hashRefreshToken(body.refreshToken), now())
      }
      return context.body(null, 204)
    })
  } else {
    for (const path of ['/auth/email/start', '/auth/email/verify', '/auth/refresh']) {
      router.post(path, () => {
        throw authUnavailable()
      })
    }
    router.post('/auth/logout', (context) => context.body(null, 204))
  }

  router.get('/me', authenticate(verifyAccessToken), async (context) => {
    const userId = context.get('userId')
    const user = await store.getUser(userId)
    if (!user) throw new AuthHttpError(401, 'unauthorized', 'Autenticação necessária.')
    return context.json({ user })
  })

  router.onError(handleApiError)

  async function createSession(
    user: { id: string; email: string; name: string | null },
    refresh: ReturnType<typeof createOpaqueRefreshToken>,
    persistRefresh = true,
  ): Promise<AuthSession> {
    if (!authTokens) throw authUnavailable()
    const issued = await authTokens.issueAccessToken(user.id)
    const createdAt = now()
    if (persistRefresh) {
      await store.createRefreshToken(
        user.id,
        refresh.hash,
        new Date(createdAt.getTime() + REFRESH_TOKEN_TTL_MS),
        createdAt,
      )
    }
    return {
      accessToken: issued.token,
      accessTokenExpiresAt: issued.expiresAt.toISOString(),
      refreshToken: refresh.token,
      user,
    }
  }

  return {
    router,
    verifyAccessToken,
    close: async () => {
      if (ownsPool) await pool!.end()
    },
  }
}
