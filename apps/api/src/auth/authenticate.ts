import type { MiddlewareHandler } from 'hono'
import type { AccessTokenVerifier } from '@trippy/adapters/auth'
import { AuthHttpError } from './errors.ts'

export type AuthEnvironment = {
  Variables: { userId: string }
}

export function authenticate(
  verifyAccessToken: AccessTokenVerifier,
): MiddlewareHandler<AuthEnvironment> {
  return async (context, next) => {
    const authorization = context.req.header('authorization')
    const match = /^Bearer\s+(.+)$/iu.exec(authorization ?? '')
    if (!match) throw new AuthHttpError(401, 'unauthorized', 'Autenticação necessária.')

    let userId: string
    try {
      userId = (await verifyAccessToken(match[1]!)).userId
    } catch {
      throw new AuthHttpError(401, 'unauthorized', 'Autenticação necessária.')
    }
    context.set('userId', userId)
    await next()
  }
}
