import { isExpired } from './time.ts'

export const ACCESS_TOKEN_TTL_MS = 15 * 60 * 1000
export const REFRESH_TOKEN_TTL_MS = 365 * 24 * 60 * 60 * 1000

export interface AuthSessionUser {
  id: string
  email: string
  name: string | null
}

export interface AuthSession {
  accessToken: string
  accessTokenExpiresAt: string
  refreshToken: string
  user: AuthSessionUser
}

export function evaluateRefreshTokenRotation(input: {
  usedAt: Date | null
  revokedAt: Date | null
  expiresAt: Date
  now: Date
}): 'reused' | 'invalid' | 'rotatable' {
  if (input.usedAt) return 'reused'
  if (input.revokedAt || isExpired(input.expiresAt, input.now)) return 'invalid'
  return 'rotatable'
}
