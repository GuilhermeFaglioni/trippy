import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { PostgresSyncStore } from '@trippy/adapters/sync'
import { PostgresTripStore } from '@trippy/adapters/trips'
import { migrate } from '../../../packages/db/src/migrate.ts'
import { createApp } from '../src/app.ts'
import { createSyncRouter } from '../src/sync/router.ts'
import { createTripsRouter } from '../src/trips/router.ts'
import type { HealthChecks } from '../src/health.ts'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL não definido: configure o Postgres local')

const testDatabaseName = `trippy_api_sync_roteiro_${process.pid}_${randomUUID().replaceAll('-', '').slice(0, 12)}`
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
let memberId: string
let outsiderId: string
let closeSync: () => Promise<void> = async () => {}

const healthyChecks: HealthChecks = {
  postgres: async () => {},
  storage: async () => {},
  queue: async () => {},
  mail: async () => {},
}

function verifier(token: string): { userId: string } | undefined {
  const userId = tokenUsers.get(token)
  return userId ? { userId } : undefined
}

async function get(path: string, token = 'organizer-token', targetApp = app) {
  return targetApp.request(path, { headers: { authorization: `Bearer ${token}` } })
}

async function post(path: string, body: unknown, token = 'organizer-token', targetApp = app) {
  return targetApp.request(path, {
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

async function addPlace(tripId: string, placeId = randomUUID()) {
  const operation = {
    type: 'place.add' as const,
    opId: randomUUID(),
    tripId,
    placeId,
    name: `Lugar ${placeId.slice(0, 8)}`,
  }
  const response = await post('/sync/push', { operations: [operation] })
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({ results: [{ status: 'applied' }] })
  return operation
}

async function addMember(tripId: string, userId: string): Promise<void> {
  const sequence = await pool.query<{ seq_counter: string }>(
    'UPDATE trips SET seq_counter = seq_counter + 1 WHERE id = $1 RETURNING seq_counter',
    [tripId],
  )
  await pool.query(
    `INSERT INTO trip_members (trip_id, user_id, role, seq)
     VALUES ($1, $2, 'member', $3)`,
    [tripId, userId, sequence.rows[0]!.seq_counter],
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
    'INSERT INTO users (email) VALUES ($1), ($2), ($3) RETURNING id',
    [
      `sync-roteiro-${randomUUID()}@example.test`,
      `sync-roteiro-${randomUUID()}@example.test`,
      `sync-roteiro-${randomUUID()}@example.test`,
    ],
  )
  organizerId = users.rows[0]!.id
  memberId = users.rows[1]!.id
  outsiderId = users.rows[2]!.id
  tokenUsers.set('organizer-token', organizerId)
  tokenUsers.set('member-token', memberId)
  tokenUsers.set('outsider-token', outsiderId)

  const trips = createTripsRouter(
    { databaseUrl: testDatabaseUrl.toString() },
    {
      tripStore: new PostgresTripStore(pool),
      accessTokenVerifier: async (token) => {
        const verified = verifier(token)
        if (!verified) throw new Error('Token inválido')
        return verified
      },
    },
  )
  const sync = createSyncRouter(
    { databaseUrl: testDatabaseUrl.toString(), placesCandidateSecret: candidateSecret },
    {
      accessTokenVerifier: async (token) => {
        const verified = verifier(token)
        if (!verified) throw new Error('Token inválido')
        return verified
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

it('aplica um único arrange concorrente e reproduz o conflito pelo mesmo op_id', async () => {
  const tripId = await createTrip()
  const first = await addPlace(tripId)
  const second = await addPlace(tripId)
  const third = await addPlace(tripId)
  const seedArrangement = await post('/sync/push', {
    operations: [
      {
        type: 'itinerary.arrange',
        opId: randomUUID(),
        tripId,
        baseVersion: 0,
        days: [{ dayIndex: 0, placeIds: [third.placeId] }],
      },
    ],
  })
  expect(await seedArrangement.json()).toMatchObject({ results: [{ status: 'applied' }] })
  const baseCounter = await pool.query<{ seq_counter: string }>(
    'SELECT seq_counter::text AS seq_counter FROM trips WHERE id = $1',
    [tripId],
  )

  const poolA = new pg.Pool({ connectionString: testDatabaseUrl.toString(), max: 1 })
  const poolB = new pg.Pool({ connectionString: testDatabaseUrl.toString(), max: 1 })
  const syncA = createSyncRouter(
    { databaseUrl: testDatabaseUrl.toString(), placesCandidateSecret: candidateSecret },
    {
      syncStore: new PostgresSyncStore(poolA, candidateSecret),
      accessTokenVerifier: async (token) => {
        const verified = verifier(token)
        if (!verified) throw new Error('Token inválido')
        return verified
      },
    },
  )
  const syncB = createSyncRouter(
    { databaseUrl: testDatabaseUrl.toString(), placesCandidateSecret: candidateSecret },
    {
      syncStore: new PostgresSyncStore(poolB, candidateSecret),
      accessTokenVerifier: async (token) => {
        const verified = verifier(token)
        if (!verified) throw new Error('Token inválido')
        return verified
      },
    },
  )
  const appA = createApp(healthyChecks, 1_000, undefined, undefined, syncA.router)
  const appB = createApp(healthyChecks, 1_000, undefined, undefined, syncB.router)
  const firstOperation = {
    type: 'itinerary.arrange' as const,
    opId: randomUUID(),
    tripId,
    baseVersion: 1,
    days: [{ dayIndex: 0, placeIds: [first.placeId, second.placeId] }],
  }
  const secondOperation = {
    type: 'itinerary.arrange' as const,
    opId: randomUUID(),
    tripId,
    baseVersion: 1,
    days: [{ dayIndex: 0, placeIds: [second.placeId, first.placeId] }],
  }

  try {
    const responses = await Promise.all([
      post('/sync/push', { operations: [firstOperation] }, 'organizer-token', appA),
      post('/sync/push', { operations: [secondOperation] }, 'organizer-token', appB),
    ])
    const bodies = await Promise.all(
      responses.map(async (response) => {
        expect(response.status).toBe(200)
        return (await response.json()) as {
          results: Array<{ opId: string; status: string; currentVersion?: number }>
        }
      }),
    )
    const results = bodies.map((body) => body.results[0]!)
    expect(results.map((result) => result.status).sort()).toEqual(['applied', 'conflict'])

    const trip = await pool.query<{ itinerary_version: number; seq_counter: string }>(
      'SELECT itinerary_version, seq_counter::text AS seq_counter FROM trips WHERE id = $1',
      [tripId],
    )
    expect(trip.rows[0]!.itinerary_version).toBe(2)
    expect(BigInt(trip.rows[0]!.seq_counter)).toBe(BigInt(baseCounter.rows[0]!.seq_counter) + 3n)

    const winner = results.find((result) => result.status === 'applied')!
    const winningOperation = winner.opId === firstOperation.opId ? firstOperation : secondOperation
    const order = await pool.query<{ id: string; position: number }>(
      `SELECT id, position FROM places WHERE id = ANY($1::uuid[]) ORDER BY position`,
      [[first.placeId, second.placeId]],
    )
    expect(order.rows).toEqual(
      winningOperation.days[0]!.placeIds.map((id, position) => ({ id, position })),
    )

    const losingOperation = winner.opId === firstOperation.opId ? secondOperation : firstOperation
    const replay = await post('/sync/push', { operations: [losingOperation] })
    expect(await replay.json()).toEqual({
      results: [{ opId: losingOperation.opId, status: 'conflict', currentVersion: 2 }],
    })
  } finally {
    await syncA.close()
    await syncB.close()
    await poolA.end()
    await poolB.end()
  }

  const unassigned = await pool.query<{ day_index: number | null; position: number | null }>(
    'SELECT day_index, position FROM places WHERE id = $1',
    [third.placeId],
  )
  expect(unassigned.rows[0]).toEqual({ day_index: null, position: null })
})

it('rejeita membro comum e valida dias, lugares da viagem e lugares ativos', async () => {
  const tripId = await createTrip()
  await addMember(tripId, memberId)
  const first = await addPlace(tripId)
  const foreignTripId = await createTrip()
  const foreign = await addPlace(foreignTripId)
  const deleted = await addPlace(tripId)
  const removed = await post('/sync/push', {
    operations: [{ type: 'place.remove', opId: randomUUID(), tripId, placeId: deleted.placeId }],
  })
  expect(await removed.json()).toMatchObject({ results: [{ status: 'applied' }] })

  const forbiddenOperation = {
    type: 'itinerary.arrange' as const,
    opId: randomUUID(),
    tripId,
    baseVersion: 0,
    days: [{ dayIndex: 0, placeIds: [first.placeId] }],
  }
  const forbidden = await post('/sync/push', { operations: [forbiddenOperation] }, 'member-token')
  expect(await forbidden.json()).toEqual({
    results: [{ opId: forbiddenOperation.opId, status: 'rejected', reason: 'forbidden' }],
  })

  const invalidOperations = [
    {
      type: 'itinerary.arrange' as const,
      opId: randomUUID(),
      tripId,
      baseVersion: 0,
      days: [{ dayIndex: 5, placeIds: [] }],
    },
    {
      type: 'itinerary.arrange' as const,
      opId: randomUUID(),
      tripId,
      baseVersion: 0,
      days: [{ dayIndex: 0, placeIds: [foreign.placeId] }],
    },
    {
      type: 'itinerary.arrange' as const,
      opId: randomUUID(),
      tripId,
      baseVersion: 0,
      days: [{ dayIndex: 0, placeIds: [deleted.placeId] }],
    },
  ]
  for (const operation of invalidOperations) {
    const response = await post('/sync/push', { operations: [operation] })
    expect(await response.json()).toEqual({
      results: [{ opId: operation.opId, status: 'rejected', reason: 'invalid' }],
    })
  }

  const unchanged = await pool.query<{ itinerary_version: number }>(
    'SELECT itinerary_version FROM trips WHERE id = $1',
    [tripId],
  )
  expect(unchanged.rows[0]!.itinerary_version).toBe(0)
})

it('expõe versão do roteiro e seq_counter atual mesmo ao continuar bootstrap antigo', async () => {
  const tripId = await createTrip()
  const first = await addPlace(tripId)
  const second = await addPlace(tripId)
  const firstPageResponse = await get(`/sync/pull?trip=${tripId}&limit=1`)
  const firstPage = (await firstPageResponse.json()) as {
    snapshotSeq: string
    nextCursor: string
    hasMore: boolean
  }
  expect(firstPage.hasMore).toBe(true)

  const arranged = await post('/sync/push', {
    operations: [
      {
        type: 'itinerary.arrange',
        opId: randomUUID(),
        tripId,
        baseVersion: 0,
        days: [{ dayIndex: 1, placeIds: [first.placeId, second.placeId] }],
      },
    ],
  })
  expect(await arranged.json()).toMatchObject({ results: [{ status: 'applied' }] })

  const pull = await get(
    `/sync/pull?trip=${tripId}&limit=1&snapshotSeq=${firstPage.snapshotSeq}&cursor=${firstPage.nextCursor}`,
  )
  const body = (await pull.json()) as {
    itinerary: { version: number; atSeq: string }
    nextCursor: string
    hasMore: boolean
  }
  const persisted = await pool.query<{ itinerary_version: number; seq_counter: string }>(
    'SELECT itinerary_version, seq_counter::text AS seq_counter FROM trips WHERE id = $1',
    [tripId],
  )
  expect(body.itinerary).toEqual({
    version: persisted.rows[0]!.itinerary_version,
    atSeq: persisted.rows[0]!.seq_counter,
  })
  expect(body.itinerary.version).toBe(1)
  expect(BigInt(body.itinerary.atSeq)).toBeGreaterThan(BigInt(firstPage.snapshotSeq))
  expect(body.hasMore).toBe(false)
  expect(body.nextCursor).toBe(firstPage.snapshotSeq)
})

it('cria lugar já posicionado num dia do roteiro, inclusive para membro comum, e ignora lugares removidos', async () => {
  const tripId = await createTrip()
  await addMember(tripId, memberId)
  const pushPlace = async (token: string, dayIndex: number | undefined, placeId = randomUUID()) => {
    const operation = {
      type: 'place.add' as const,
      opId: randomUUID(),
      tripId,
      placeId,
      name: `Lugar ${placeId.slice(0, 8)}`,
      ...(dayIndex === undefined ? {} : { dayIndex }),
    }
    const response = await post('/sync/push', { operations: [operation] }, token)
    expect(await response.json()).toEqual({
      results: [{ opId: operation.opId, status: 'applied' }],
    })
    return placeId
  }
  const placements = async () =>
    (
      await pool.query<{ id: string; day_index: number | null; position: number | null }>(
        'SELECT id, day_index, position FROM places WHERE trip_id = $1 ORDER BY seq',
        [tripId],
      )
    ).rows

  const first = await pushPlace('organizer-token', 2)
  const second = await pushPlace('member-token', 2)
  const outside = await pushPlace('member-token', undefined)
  const removed = await pushPlace('organizer-token', 2)
  const removal = await post('/sync/push', {
    operations: [{ type: 'place.remove', opId: randomUUID(), tripId, placeId: removed }],
  })
  expect(await removal.json()).toMatchObject({ results: [{ status: 'applied' }] })
  const third = await pushPlace('member-token', 2)

  expect(await placements()).toEqual([
    { id: first, day_index: 2, position: 0 },
    { id: second, day_index: 2, position: 1 },
    { id: outside, day_index: null, position: null },
    { id: removed, day_index: 2, position: 2 },
    { id: third, day_index: 2, position: 2 },
  ])
})
