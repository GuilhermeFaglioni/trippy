import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { PostgresTripStore } from '@trippy/adapters/trips'
import { migrate } from '../../../packages/db/src/migrate.ts'
import { createApp } from '../src/app.ts'
import { createSyncRouter } from '../src/sync/router.ts'
import { createTripsRouter } from '../src/trips/router.ts'
import type { HealthChecks } from '../src/health.ts'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL não definido: configure o Postgres local')

const testDatabaseName = `trippy_api_sync_membros_${process.pid}_${randomUUID().replaceAll('-', '').slice(0, 12)}`
const adminUrl = new URL(databaseUrl)
adminUrl.pathname = '/postgres'
const testDatabaseUrl = new URL(databaseUrl)
testDatabaseUrl.pathname = `/${testDatabaseName}`

const tokenUsers = new Map<string, string>()
let databaseCreated = false
const candidateSecret = 'segredo-de-candidato-integração-com-entropia-suficiente'
type Pool = InstanceType<typeof pg.Pool>
let pool: Pool
let app: ReturnType<typeof createApp>
let organizerId: string
let coorganizerId: string
let memberId: string
let outsiderId: string
let closeSync: () => Promise<void> = async () => {}

const healthyChecks: HealthChecks = {
  postgres: async () => {},
  storage: async () => {},
  queue: async () => {},
  mail: async () => {},
}

async function get(path: string, token = 'organizer-token') {
  return app.request(path, { headers: { authorization: `Bearer ${token}` } })
}

async function post(path: string, body: unknown, token = 'organizer-token') {
  return app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
}

async function createTrip(): Promise<string> {
  const response = await post('/trips', {
    name: `Viagem ${randomUUID()}`,
    destination: 'Lisboa',
    startDate: '2026-11-01',
    endDate: '2026-11-05',
    timezone: 'Europe/Lisbon',
  })
  expect(response.status).toBe(201)
  return ((await response.json()) as { trip: { id: string } }).trip.id
}

async function addMember(tripId: string, userId: string, role: 'coorganizer' | 'member') {
  const sequence = await pool.query<{ seq_counter: string }>(
    'UPDATE trips SET seq_counter = seq_counter + 1 WHERE id = $1 RETURNING seq_counter',
    [tripId],
  )
  await pool.query(
    `INSERT INTO trip_members (trip_id, user_id, role, seq)
     VALUES ($1, $2, $3, $4)`,
    [tripId, userId, role, sequence.rows[0]!.seq_counter],
  )
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
  const users = await pool.query<{ id: string }>(
    'INSERT INTO users (email) VALUES ($1), ($2), ($3), ($4) RETURNING id',
    [
      `sync-membros-${randomUUID()}@example.test`,
      `sync-membros-${randomUUID()}@example.test`,
      `sync-membros-${randomUUID()}@example.test`,
      `sync-membros-${randomUUID()}@example.test`,
    ],
  )
  organizerId = users.rows[0]!.id
  coorganizerId = users.rows[1]!.id
  memberId = users.rows[2]!.id
  outsiderId = users.rows[3]!.id
  tokenUsers.set('organizer-token', organizerId)
  tokenUsers.set('coorganizer-token', coorganizerId)
  tokenUsers.set('member-token', memberId)
  tokenUsers.set('outsider-token', outsiderId)

  const trips = createTripsRouter(
    { databaseUrl: testDatabaseUrl.toString() },
    {
      tripStore: new PostgresTripStore(pool),
      accessTokenVerifier: async (token) => {
        const userId = tokenUsers.get(token)
        if (!userId) throw new Error('Token inválido')
        return { userId }
      },
    },
  )
  const sync = createSyncRouter(
    { databaseUrl: testDatabaseUrl.toString(), placesCandidateSecret: candidateSecret },
    {
      accessTokenVerifier: async (token) => {
        const userId = tokenUsers.get(token)
        if (!userId) throw new Error('Token inválido')
        return { userId }
      },
    },
  )
  closeSync = sync.close
  app = createApp(healthyChecks, 1_000, undefined, trips.router, sync.router)
})

afterAll(async () => {
  await closeSync()
  if (pool) await pool.end()
  if (databaseCreated) {
    const admin = new pg.Client({ connectionString: adminUrl.toString() })
    await admin.connect()
    try {
      await admin.query(`DROP DATABASE "${testDatabaseName}"`)
    } finally {
      await admin.end()
    }
  }
})

it('limita a gestão de membros ao papel certo e promove coorganizador apto a editar roteiro', async () => {
  const tripId = await createTrip()
  await addMember(tripId, coorganizerId, 'coorganizer')
  await addMember(tripId, memberId, 'member')

  const organizerRemoval = {
    type: 'member.remove' as const,
    opId: randomUUID(),
    tripId,
    userId: organizerId,
  }
  const removeOrganizer = await post(
    '/sync/push',
    { operations: [organizerRemoval] },
    'coorganizer-token',
  )
  expect(await removeOrganizer.json()).toEqual({
    results: [{ opId: organizerRemoval.opId, status: 'rejected', reason: 'forbidden' }],
  })

  const changeMemberRole = {
    type: 'member.set_role' as const,
    opId: randomUUID(),
    tripId,
    userId: memberId,
    role: 'coorganizer' as const,
  }
  const changeRole = await post(
    '/sync/push',
    { operations: [changeMemberRole] },
    'coorganizer-token',
  )
  expect(await changeRole.json()).toEqual({
    results: [{ opId: changeMemberRole.opId, status: 'rejected', reason: 'forbidden' }],
  })

  const memberBeforePromotion = await pool.query<{ seq: string; role: string }>(
    'SELECT seq::text AS seq, role FROM trip_members WHERE trip_id = $1 AND user_id = $2',
    [tripId, memberId],
  )
  const promote = await post('/sync/push', {
    operations: [
      {
        type: 'member.set_role',
        opId: randomUUID(),
        tripId,
        userId: memberId,
        role: 'coorganizer',
      },
    ],
  })
  expect(await promote.json()).toMatchObject({ results: [{ status: 'applied' }] })
  const memberAfterPromotion = await pool.query<{ seq: string; role: string }>(
    'SELECT seq::text AS seq, role FROM trip_members WHERE trip_id = $1 AND user_id = $2',
    [tripId, memberId],
  )
  expect(memberAfterPromotion.rows[0]!.role).toBe('coorganizer')
  expect(BigInt(memberAfterPromotion.rows[0]!.seq)).toBeGreaterThan(
    BigInt(memberBeforePromotion.rows[0]!.seq),
  )

  const arrange = await post(
    '/sync/push',
    {
      operations: [
        {
          type: 'itinerary.arrange',
          opId: randomUUID(),
          tripId,
          baseVersion: 0,
          days: [{ dayIndex: 0, placeIds: [] }],
        },
      ],
    },
    'member-token',
  )
  expect(await arrange.json()).toMatchObject({ results: [{ status: 'applied' }] })

  const organizer = await pool.query<{ role: string; left_at: Date | null }>(
    'SELECT role, left_at FROM trip_members WHERE trip_id = $1 AND user_id = $2',
    [tripId, organizerId],
  )
  expect(organizer.rows[0]).toMatchObject({ role: 'organizer', left_at: null })
})

it('remove membro grava tombstone e bloqueia push e pull da pessoa removida', async () => {
  const tripId = await createTrip()
  await addMember(tripId, memberId, 'member')
  const beforeRemoval = await pool.query<{ seq: string }>(
    'SELECT seq::text AS seq FROM trip_members WHERE trip_id = $1 AND user_id = $2',
    [tripId, memberId],
  )

  const removal = {
    type: 'member.remove' as const,
    opId: randomUUID(),
    tripId,
    userId: memberId,
  }
  const removed = await post('/sync/push', { operations: [removal] })
  expect(await removed.json()).toEqual({ results: [{ opId: removal.opId, status: 'applied' }] })

  const membership = await pool.query<{ seq: string; left_at: Date | null }>(
    'SELECT seq::text AS seq, left_at FROM trip_members WHERE trip_id = $1 AND user_id = $2',
    [tripId, memberId],
  )
  expect(membership.rows[0]!.left_at).toBeInstanceOf(Date)
  expect(BigInt(membership.rows[0]!.seq)).toBeGreaterThan(BigInt(beforeRemoval.rows[0]!.seq))

  const rejectedPush = await post(
    '/sync/push',
    {
      operations: [
        {
          type: 'place.add',
          opId: randomUUID(),
          tripId,
          placeId: randomUUID(),
          name: 'Lugar offline',
        },
      ],
    },
    'member-token',
  )
  expect(await rejectedPush.json()).toMatchObject({
    results: [{ status: 'rejected', reason: 'not_member' }],
  })

  const pull = await get(`/sync/pull?trip=${tripId}&cursor=0&limit=100`, 'member-token')
  expect(pull.status).toBe(403)
  expect(await pull.json()).toEqual({
    error: 'not_member',
    message: 'Você não faz mais parte desta viagem.',
  })

  const neverMember = await get(`/sync/pull?trip=${tripId}&cursor=0&limit=100`, 'outsider-token')
  expect(neverMember.status).toBe(404)
})

it('rejeita alvo removido em operações de papel e remoção', async () => {
  const tripId = await createTrip()
  await addMember(tripId, memberId, 'member')
  const initialRemoval = await post('/sync/push', {
    operations: [
      {
        type: 'member.remove',
        opId: randomUUID(),
        tripId,
        userId: memberId,
      },
    ],
  })
  expect(await initialRemoval.json()).toMatchObject({ results: [{ status: 'applied' }] })

  const results = await post('/sync/push', {
    operations: [
      {
        type: 'member.remove',
        opId: randomUUID(),
        tripId,
        userId: memberId,
      },
      {
        type: 'member.set_role',
        opId: randomUUID(),
        tripId,
        userId: memberId,
        role: 'coorganizer',
      },
    ],
  })
  expect(await results.json()).toMatchObject({
    results: [
      { status: 'rejected', reason: 'invalid' },
      { status: 'rejected', reason: 'invalid' },
    ],
  })
})
