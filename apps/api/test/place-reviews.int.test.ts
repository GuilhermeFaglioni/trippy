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

const testDatabaseName = `trippy_api_place_reviews_${process.pid}_${randomUUID().replaceAll('-', '').slice(0, 12)}`
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

async function addPlace(tripId: string): Promise<string> {
  const placeId = randomUUID()
  const response = await post('/sync/push', {
    operations: [{ type: 'place.add', opId: randomUUID(), tripId, placeId, name: 'Jardim' }],
  })
  expect(await response.json()).toEqual({
    results: [expect.objectContaining({ status: 'applied' })],
  })
  return placeId
}

function reviewOperation(
  type: 'place.favorite' | 'place.rate' | 'place.note',
  tripId: string,
  placeId: string,
  value: { favorite: boolean } | { rating: number | null } | { note: string | null },
) {
  return { type, opId: randomUUID(), tripId, placeId, ...value }
}

async function pushStatus(operation: unknown, token = 'organizer-token'): Promise<string> {
  const response = await post('/sync/push', { operations: [operation] }, token)
  const body = (await response.json()) as { results: Array<{ status: string; reason?: string }> }
  const result = body.results[0]!
  return result.status === 'rejected' ? `rejected:${result.reason}` : result.status
}

type PullReview = {
  placeId: string
  userId: string
  favorite: boolean
  rating: number | null
  note: string | null
  deletedAt: string | null
}

async function bootstrapReviews(tripId: string, token = 'organizer-token'): Promise<PullReview[]> {
  const response = await get(`/sync/pull?trip=${tripId}&limit=100`, token)
  return ((await response.json()) as { reviews: PullReview[] }).reviews
}

async function bootstrapVisits(tripId: string, token = 'organizer-token') {
  const response = await get(`/sync/pull?trip=${tripId}&limit=100`, token)
  return (
    (await response.json()) as {
      visits: Array<{ userId: string; markedBy: string; deletedAt: string | null }>
    }
  ).visits
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
      `place-reviews-${randomUUID()}@example.test`,
      `place-reviews-${randomUUID()}@example.test`,
      `place-reviews-${randomUUID()}@example.test`,
    ],
  )
  organizerId = users.rows[0]!.id
  coorganizerId = users.rows[1]!.id
  memberId = users.rows[2]!.id
  tokenUsers.set('organizer-token', organizerId)
  tokenUsers.set('coorganizer-token', coorganizerId)
  tokenUsers.set('member-token', memberId)

  const accessTokenVerifier = async (token: string) => {
    const userId = tokenUsers.get(token)
    if (!userId) throw new Error('Token inválido')
    return { userId }
  }
  const trips = createTripsRouter(
    { databaseUrl: testDatabaseUrl.toString() },
    { tripStore: new PostgresTripStore(pool), accessTokenVerifier },
  )
  const sync = createSyncRouter(
    { databaseUrl: testDatabaseUrl.toString(), placesCandidateSecret: candidateSecret },
    { accessTokenVerifier },
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

it('favorito, nota e observação são idempotentes e convergem entre membros', async () => {
  const tripId = await createTrip()
  await addMember(tripId, coorganizerId, 'coorganizer')
  await addMember(tripId, memberId, 'member')
  const placeId = await addPlace(tripId)

  expect(
    await pushStatus(reviewOperation('place.favorite', tripId, placeId, { favorite: true })),
  ).toBe('applied')
  expect(
    await pushStatus(reviewOperation('place.favorite', tripId, placeId, { favorite: true })),
  ).toBe('duplicate')
  expect(
    await pushStatus(
      reviewOperation('place.favorite', tripId, placeId, { favorite: true }),
      'member-token',
    ),
  ).toBe('applied')

  expect(await pushStatus(reviewOperation('place.rate', tripId, placeId, { rating: 4 }))).toBe(
    'applied',
  )
  expect(await pushStatus(reviewOperation('place.rate', tripId, placeId, { rating: 4 }))).toBe(
    'duplicate',
  )
  expect(
    await pushStatus(reviewOperation('place.rate', tripId, placeId, { rating: 3 }), 'member-token'),
  ).toBe('applied')

  expect(
    await pushStatus(reviewOperation('place.note', tripId, placeId, { note: '  Mirante  ' })),
  ).toBe('applied')
  expect(
    await pushStatus(reviewOperation('place.note', tripId, placeId, { note: 'Mirante' })),
  ).toBe('duplicate')
  expect(await pushStatus(reviewOperation('place.note', tripId, placeId, { note: '   ' }))).toBe(
    'applied',
  )
  expect(await pushStatus(reviewOperation('place.note', tripId, placeId, { note: '   ' }))).toBe(
    'duplicate',
  )
  expect(
    await pushStatus(
      reviewOperation('place.note', tripId, placeId, { note: 'Chegue cedo' }),
      'member-token',
    ),
  ).toBe('applied')
  expect(
    await pushStatus(reviewOperation('place.favorite', tripId, placeId, { favorite: false })),
  ).toBe('applied')
  expect(
    await pushStatus(reviewOperation('place.favorite', tripId, placeId, { favorite: false })),
  ).toBe('duplicate')

  const fromOrganizer = await bootstrapReviews(tripId)
  const fromMember = await bootstrapReviews(tripId, 'member-token')
  expect(fromMember).toEqual(fromOrganizer)
  expect(fromOrganizer.find((review) => review.userId === organizerId)).toMatchObject({
    favorite: false,
    rating: 4,
    note: null,
    deletedAt: null,
  })
  expect(fromOrganizer.find((review) => review.userId === memberId)).toMatchObject({
    favorite: true,
    rating: 3,
    note: 'Chegue cedo',
    deletedAt: null,
  })

  expect(await pushStatus(reviewOperation('place.rate', tripId, placeId, { rating: null }))).toBe(
    'applied',
  )
  expect(await pushStatus(reviewOperation('place.rate', tripId, placeId, { rating: null }))).toBe(
    'duplicate',
  )
  expect(
    (await bootstrapReviews(tripId)).find((review) => review.userId === organizerId),
  ).toMatchObject({ rating: null })
})

it('valor de avaliação e observação fora dos limites é recusado antes de aplicar', async () => {
  const tripId = await createTrip()
  const placeId = await addPlace(tripId)

  for (const operation of [
    reviewOperation('place.rate', tripId, placeId, { rating: 0 }),
    reviewOperation('place.rate', tripId, placeId, { rating: 6 }),
    reviewOperation('place.rate', tripId, placeId, { rating: 2.5 }),
    reviewOperation('place.note', tripId, placeId, { note: 'x'.repeat(2001) }),
    reviewOperation('place.favorite', tripId, placeId, { favorite: 'sim' as unknown as boolean }),
  ]) {
    const response = await post('/sync/push', { operations: [operation] })
    expect(response.status).toBe(400)
  }
  expect(await bootstrapReviews(tripId)).toEqual([])
  expect(await pushStatus(reviewOperation('place.rate', tripId, placeId, { rating: 5 }))).toBe(
    'applied',
  )
})

it('lugar removido apaga as avaliações vivas e rejeita novas', async () => {
  const tripId = await createTrip()
  await addMember(tripId, memberId, 'member')
  const placeId = await addPlace(tripId)

  expect(
    await pushStatus(reviewOperation('place.favorite', tripId, placeId, { favorite: true })),
  ).toBe('applied')
  expect(
    await pushStatus(reviewOperation('place.rate', tripId, placeId, { rating: 5 }), 'member-token'),
  ).toBe('applied')
  expect(await bootstrapReviews(tripId)).toHaveLength(2)

  expect(await pushStatus({ type: 'place.remove', opId: randomUUID(), tripId, placeId })).toBe(
    'applied',
  )
  expect(await bootstrapReviews(tripId)).toEqual([])

  const row = await pool.query<{ deleted_at: Date | null }>(
    'SELECT deleted_at FROM place_reviews WHERE place_id = $1 ORDER BY user_id',
    [placeId],
  )
  expect(row.rows.map(({ deleted_at }) => deleted_at)).toEqual([expect.any(Date), expect.any(Date)])
  expect(
    await pushStatus(reviewOperation('place.rate', tripId, placeId, { rating: 2 }), 'member-token'),
  ).toBe('rejected:invalid')
})

it('marcar visita de outra pessoa exige organizador ou coorganizador e alvo membro', async () => {
  const tripId = await createTrip()
  await addMember(tripId, coorganizerId, 'coorganizer')
  await addMember(tripId, memberId, 'member')
  const placeId = await addPlace(tripId)
  const visit = (type: 'visit.mark' | 'visit.unmark', userId?: string) => ({
    type,
    opId: randomUUID(),
    tripId,
    placeId,
    ...(userId === undefined ? {} : { userId }),
  })

  expect(await pushStatus(visit('visit.mark', coorganizerId), 'member-token')).toBe(
    'rejected:forbidden',
  )
  expect(await pushStatus(visit('visit.mark', organizerId), 'member-token')).toBe(
    'rejected:forbidden',
  )
  expect(await pushStatus(visit('visit.mark', memberId), 'member-token')).toBe('applied')
  expect(await pushStatus(visit('visit.mark', randomUUID()))).toBe('rejected:invalid')

  expect(await pushStatus(visit('visit.mark', memberId), 'coorganizer-token')).toBe('duplicate')
  expect(await pushStatus(visit('visit.unmark', memberId), 'coorganizer-token')).toBe('applied')
  expect(await pushStatus(visit('visit.mark', memberId), 'coorganizer-token')).toBe('applied')
  expect(await pushStatus(visit('visit.mark'), 'coorganizer-token')).toBe('applied')
  expect(await pushStatus(visit('visit.unmark', coorganizerId), 'coorganizer-token')).toBe(
    'applied',
  )

  const marks = await pool.query<{ user_id: string; marked_by: string }>(
    'SELECT user_id, marked_by FROM visits WHERE place_id = $1 AND deleted_at IS NULL ORDER BY user_id',
    [placeId],
  )
  expect(marks.rows).toEqual([{ user_id: memberId, marked_by: coorganizerId }])

  expect(await pushStatus(visit('visit.unmark', organizerId), 'member-token')).toBe(
    'rejected:forbidden',
  )
  expect(await pushStatus(visit('visit.unmark', memberId), 'member-token')).toBe('applied')
  expect(
    (await bootstrapVisits(tripId, 'member-token')).filter(
      (item) => item.deletedAt === null && item.userId === memberId,
    ),
  ).toEqual([])
})
