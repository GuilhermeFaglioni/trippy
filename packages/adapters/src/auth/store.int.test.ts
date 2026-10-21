import { randomUUID } from 'node:crypto'
import pg, { type PoolClient } from 'pg'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { migrate } from '../../../db/src/migrate.ts'
import { hashRefreshToken } from './secrets.ts'
import { PostgresAuthStore } from './store.ts'

type Pool = InstanceType<typeof pg.Pool>

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  throw new Error('DATABASE_URL não definido: configure o Postgres local')
}

const testDatabaseName = `trippy_race_${process.pid}_${randomUUID().replaceAll('-', '').slice(0, 12)}`
const adminUrl = new URL(databaseUrl)
adminUrl.pathname = '/postgres'
const testDatabaseUrl = new URL(databaseUrl)
testDatabaseUrl.pathname = `/${testDatabaseName}`

let databaseCreated = false
let pool: Pool

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

function createBarrierPool(
  basePool: Pool,
  options: {
    usedTokenHash: string
    currentTokenHash: string
    nextTokenHash: string
  },
) {
  const currentRotationInsert = deferred<void>()
  const allowCurrentRotationInsert = deferred<void>()
  const replaySerializationPoint = deferred<'family_lock' | 'family_revoke'>()
  let currentTokenCommitted = false
  let replayRevokedBeforeCurrentCommit = false

  const barrierPool = {
    connect: async () => {
      const client = await basePool.connect()
      let operationTokenHash: string | undefined

      return {
        query: async (sql: string, values?: unknown[]) => {
          const normalizedSql = sql.trimStart()
          if (
            normalizedSql.startsWith('SELECT') &&
            normalizedSql.includes('FROM refresh_tokens') &&
            normalizedSql.includes('WHERE token_hash = $1')
          ) {
            const tokenHash = values?.[0]
            if (typeof tokenHash === 'string') operationTokenHash = tokenHash
          }

          if (
            operationTokenHash === options.currentTokenHash &&
            normalizedSql.startsWith('INSERT INTO refresh_tokens') &&
            values?.[2] === options.nextTokenHash
          ) {
            currentRotationInsert.resolve()
            await allowCurrentRotationInsert.promise
          }

          if (operationTokenHash === options.usedTokenHash) {
            if (normalizedSql.includes('pg_advisory_xact_lock')) {
              replaySerializationPoint.resolve('family_lock')
            }
            if (normalizedSql.startsWith('UPDATE refresh_tokens SET revoked_at')) {
              replayRevokedBeforeCurrentCommit = !currentTokenCommitted
              replaySerializationPoint.resolve('family_revoke')
            }
          }

          const result = await client.query(sql, values as never)
          if (operationTokenHash === options.currentTokenHash && normalizedSql === 'COMMIT') {
            currentTokenCommitted = true
          }
          return result
        },
        release: () => client.release(),
      } as unknown as PoolClient
    },
    query: basePool.query.bind(basePool),
  }

  return {
    pool: barrierPool as unknown as Pool,
    currentRotationInsert: currentRotationInsert.promise,
    allowCurrentRotationInsert: allowCurrentRotationInsert.resolve,
    replaySerializationPoint: replaySerializationPoint.promise,
    get replayRevokedBeforeCurrentCommit() {
      return replayRevokedBeforeCurrentCommit
    },
  }
}

beforeAll(async () => {
  const admin = new pg.Client({ connectionString: adminUrl.toString() })
  await admin.connect()
  try {
    await admin.query(`CREATE DATABASE "${testDatabaseName}"`)
    databaseCreated = true
  } finally {
    await admin.end()
  }

  await migrate({ databaseUrl: testDatabaseUrl.toString() })
  pool = new pg.Pool({ connectionString: testDatabaseUrl.toString() })
})

afterAll(async () => {
  if (pool) await pool.end()
  if (!databaseCreated) return

  const admin = new pg.Client({ connectionString: adminUrl.toString() })
  await admin.connect()
  try {
    await admin.query(`DROP DATABASE "${testDatabaseName}"`)
  } finally {
    await admin.end()
  }
})

it('revoga descendente criado durante replay concorrente da mesma família', async () => {
  const userResult = await pool.query<{ id: string }>(
    'INSERT INTO users (email) VALUES ($1) RETURNING id',
    [`refresh-race-${randomUUID()}@example.test`],
  )
  const userId = userResult.rows[0]!.id
  const familyId = randomUUID()
  const usedTokenHash = hashRefreshToken(randomUUID())
  const currentTokenHash = hashRefreshToken(randomUUID())
  const nextTokenHash = hashRefreshToken(randomUUID())
  const unusedDescendantHash = hashRefreshToken(randomUUID())
  const now = new Date()
  const expiresAt = new Date(now.getTime() + 60_000)

  await pool.query(
    `INSERT INTO refresh_tokens (user_id, family_id, token_hash, expires_at, used_at, created_at)
     VALUES ($1, $2, $3, $4, $5, $6), ($1, $2, $7, $4, NULL, $6)`,
    [userId, familyId, usedTokenHash, expiresAt, now, now, currentTokenHash],
  )

  const barrier = createBarrierPool(pool, {
    usedTokenHash,
    currentTokenHash,
    nextTokenHash,
  })
  const store = new PostgresAuthStore(barrier.pool)
  const currentRotation = store.rotateRefreshToken(currentTokenHash, nextTokenHash, expiresAt, now)

  try {
    await barrier.currentRotationInsert
    const replay = store.rotateRefreshToken(
      usedTokenHash,
      unusedDescendantHash,
      expiresAt,
      new Date(now.getTime() + 1),
    )
    await barrier.replaySerializationPoint
    barrier.allowCurrentRotationInsert()

    const [rotationResult, replayResult] = await Promise.all([currentRotation, replay])
    expect(rotationResult.status).toBe('rotated')
    expect(replayResult.status).toBe('reused')
    expect(barrier.replayRevokedBeforeCurrentCommit).toBe(false)

    const descendant = await pool.query<{ revoked_at: Date | null }>(
      'SELECT revoked_at FROM refresh_tokens WHERE token_hash = $1',
      [nextTokenHash],
    )
    expect(descendant.rows[0]?.revoked_at).not.toBeNull()

    const attemptedRotation = await store.rotateRefreshToken(
      nextTokenHash,
      unusedDescendantHash,
      expiresAt,
      new Date(now.getTime() + 2),
    )
    expect(attemptedRotation.status).toBe('invalid')
  } finally {
    barrier.allowCurrentRotationInsert()
    await currentRotation.catch(() => {})
  }
}, 30_000)
