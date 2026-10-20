import type { Pool, PoolClient } from 'pg'
import {
  evaluateEmailCodeAttempt,
  evaluateRefreshTokenRotation,
  isEmailCodeRequestThrottled,
} from '@trippy/domain'
import { compareEmailCodeHmac } from './secrets.ts'

export interface AuthUser {
  id: string
  email: string
  name: string | null
}

export type EmailCodeCheck =
  { status: 'valid'; user: AuthUser } | { status: 'invalid' } | { status: 'too_many_attempts' }

export type RefreshRotation =
  { status: 'rotated'; user: AuthUser } | { status: 'invalid' } | { status: 'reused' }

export interface AuthStore {
  createEmailLoginCode(
    email: string,
    codeHmac: string,
    expiresAt: Date,
    now: Date,
  ): Promise<boolean>
  invalidateEmailLoginCode(email: string, codeHmac: string, now: Date): Promise<void>
  verifyEmailLoginCode(
    email: string,
    code: string,
    secret: string,
    now: Date,
  ): Promise<EmailCodeCheck>
  createRefreshToken(userId: string, tokenHash: string, expiresAt: Date, now: Date): Promise<void>
  rotateRefreshToken(
    tokenHash: string,
    nextTokenHash: string,
    expiresAt: Date,
    now: Date,
  ): Promise<RefreshRotation>
  revokeRefreshToken(tokenHash: string, now: Date): Promise<void>
  getUser(userId: string): Promise<AuthUser | null>
}

interface LoginCodeRow {
  id: string
  code_hmac: string
  expires_at: Date
  attempts: number
  invalidated_at: Date | null
  invalidation_reason: 'superseded' | 'expired' | 'too_many_attempts' | null
  consumed_at: Date | null
}

interface RefreshTokenRow {
  id: string
  user_id: string
  family_id: string
  expires_at: Date
  used_at: Date | null
  revoked_at: Date | null
}

interface UserRow {
  id: string
  email: string
  name: string | null
}

async function inTransaction<T>(client: PoolClient, operation: () => Promise<T>): Promise<T> {
  await client.query('BEGIN')
  try {
    const result = await operation()
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  }
}

export class PostgresAuthStore implements AuthStore {
  constructor(private readonly pool: Pool) {}

  async createEmailLoginCode(
    email: string,
    codeHmac: string,
    expiresAt: Date,
    now: Date,
  ): Promise<boolean> {
    const client = await this.pool.connect()
    try {
      return await inTransaction(client, async () => {
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [email])
        const recent = await client.query<{ created_at: Date }>(
          'SELECT created_at FROM email_login_codes WHERE email = $1 ORDER BY created_at DESC LIMIT 1',
          [email],
        )
        const lastRequestAt = recent.rows[0]?.created_at
        if (isEmailCodeRequestThrottled(lastRequestAt ? new Date(lastRequestAt) : null, now)) {
          return false
        }

        await client.query(
          `UPDATE email_login_codes
           SET invalidated_at = $2, invalidation_reason = 'superseded'
           WHERE email = $1 AND invalidated_at IS NULL AND consumed_at IS NULL`,
          [email, now],
        )
        await client.query(
          `INSERT INTO email_login_codes (email, code_hmac, expires_at, created_at)
           VALUES ($1, $2, $3, $4)`,
          [email, codeHmac, expiresAt, now],
        )
        return true
      })
    } finally {
      client.release()
    }
  }

  async invalidateEmailLoginCode(email: string, codeHmac: string, now: Date): Promise<void> {
    await this.pool.query(
      `UPDATE email_login_codes
       SET invalidated_at = $3, invalidation_reason = 'expired'
       WHERE email = $1 AND code_hmac = $2 AND invalidated_at IS NULL AND consumed_at IS NULL`,
      [email, codeHmac, now],
    )
  }

  async verifyEmailLoginCode(
    email: string,
    code: string,
    secret: string,
    now: Date,
  ): Promise<EmailCodeCheck> {
    const client = await this.pool.connect()
    try {
      return await inTransaction(client, async () => {
        const result = await client.query<LoginCodeRow>(
          `SELECT id, code_hmac, expires_at, attempts, invalidated_at, invalidation_reason, consumed_at
           FROM email_login_codes WHERE email = $1 ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
          [email],
        )
        const loginCode = result.rows[0]
        if (!loginCode) return { status: 'invalid' }
        if (loginCode.invalidation_reason === 'too_many_attempts') {
          return { status: 'too_many_attempts' }
        }
        if (loginCode.invalidated_at || loginCode.consumed_at) return { status: 'invalid' }
        const decision = evaluateEmailCodeAttempt({
          expiresAt: new Date(loginCode.expires_at),
          attempts: Number(loginCode.attempts),
          codeMatches: compareEmailCodeHmac(code, secret, loginCode.code_hmac),
          now,
        })
        if (decision.status === 'expired') {
          await client.query(
            `UPDATE email_login_codes
             SET invalidated_at = $2, invalidation_reason = 'expired'
             WHERE id = $1`,
            [loginCode.id, now],
          )
          return { status: 'invalid' }
        }

        if (decision.status === 'invalid' || decision.status === 'too_many_attempts') {
          const exhausted = decision.status === 'too_many_attempts'
          await client.query(
            `UPDATE email_login_codes
             SET attempts = $2,
                 invalidated_at = CASE WHEN $3 THEN $4 ELSE invalidated_at END,
                 invalidation_reason = CASE WHEN $3 THEN 'too_many_attempts' ELSE invalidation_reason END
             WHERE id = $1`,
            [loginCode.id, decision.attempts, exhausted, now],
          )
          return { status: decision.status }
        }

        await client.query('UPDATE email_login_codes SET consumed_at = $2 WHERE id = $1', [
          loginCode.id,
          now,
        ])
        const userResult = await client.query<UserRow>(
          `INSERT INTO users (email) VALUES ($1)
           ON CONFLICT (lower(email)) DO UPDATE SET email = EXCLUDED.email
           RETURNING id, email, name`,
          [email],
        )
        const user = userResult.rows[0]!
        await client.query(
          `INSERT INTO identities (user_id, provider, provider_subject)
           VALUES ($1, 'email', $2)
           ON CONFLICT (provider, provider_subject) DO NOTHING`,
          [user.id, email],
        )
        const identityResult = await client.query<{ user_id: string }>(
          `SELECT user_id FROM identities WHERE provider = 'email' AND provider_subject = $1`,
          [email],
        )
        if (identityResult.rows[0]?.user_id !== user.id) {
          throw new Error('Identidade de e-mail já vinculada a outra conta.')
        }
        return { status: 'valid', user }
      })
    } finally {
      client.release()
    }
  }

  async createRefreshToken(userId: string, tokenHash: string, expiresAt: Date, now: Date) {
    await this.pool.query(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at, created_at)
       VALUES ($1, $2, $3, $4)`,
      [userId, tokenHash, expiresAt, now],
    )
  }

  async rotateRefreshToken(
    tokenHash: string,
    nextTokenHash: string,
    expiresAt: Date,
    now: Date,
  ): Promise<RefreshRotation> {
    const client = await this.pool.connect()
    try {
      return await inTransaction(client, async () => {
        const result = await client.query<RefreshTokenRow>(
          `SELECT id, user_id, family_id, expires_at, used_at, revoked_at
           FROM refresh_tokens WHERE token_hash = $1 FOR UPDATE`,
          [tokenHash],
        )
        const refreshToken = result.rows[0]
        if (!refreshToken) return { status: 'invalid' }
        const decision = evaluateRefreshTokenRotation({
          usedAt: refreshToken.used_at ? new Date(refreshToken.used_at) : null,
          revokedAt: refreshToken.revoked_at ? new Date(refreshToken.revoked_at) : null,
          expiresAt: new Date(refreshToken.expires_at),
          now,
        })
        if (decision === 'reused') {
          await client.query(
            'UPDATE refresh_tokens SET revoked_at = COALESCE(revoked_at, $2) WHERE family_id = $1',
            [refreshToken.family_id, now],
          )
          return { status: 'reused' }
        }
        if (decision === 'invalid') return { status: 'invalid' }

        const userResult = await client.query<UserRow>(
          'SELECT id, email, name FROM users WHERE id = $1',
          [refreshToken.user_id],
        )
        const user = userResult.rows[0]
        if (!user) return { status: 'invalid' }

        await client.query('UPDATE refresh_tokens SET used_at = $2 WHERE id = $1', [
          refreshToken.id,
          now,
        ])
        await client.query(
          `INSERT INTO refresh_tokens (user_id, family_id, token_hash, expires_at, created_at)
           VALUES ($1, $2, $3, $4, $5)`,
          [user.id, refreshToken.family_id, nextTokenHash, expiresAt, now],
        )
        return { status: 'rotated', user }
      })
    } finally {
      client.release()
    }
  }

  async revokeRefreshToken(tokenHash: string, now: Date): Promise<void> {
    const client = await this.pool.connect()
    try {
      await inTransaction(client, async () => {
        const result = await client.query<{ family_id: string }>(
          'SELECT family_id FROM refresh_tokens WHERE token_hash = $1 FOR UPDATE',
          [tokenHash],
        )
        const familyId = result.rows[0]?.family_id
        if (familyId) {
          await client.query(
            'UPDATE refresh_tokens SET revoked_at = COALESCE(revoked_at, $2) WHERE family_id = $1',
            [familyId, now],
          )
        }
      })
    } finally {
      client.release()
    }
  }

  async getUser(userId: string): Promise<AuthUser | null> {
    const result = await this.pool.query<UserRow>(
      'SELECT id, email, name FROM users WHERE id = $1',
      [userId],
    )
    return result.rows[0] ?? null
  }
}
