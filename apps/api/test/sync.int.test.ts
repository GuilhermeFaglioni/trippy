import { randomUUID } from 'node:crypto'
import pg, { type Pool } from 'pg'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { PostgresTripStore } from '@trippy/adapters/trips'
import { migrate } from '../../../packages/db/src/migrate.ts'
import { createApp } from '../src/app.ts'
import { createSyncRouter } from '../src/sync/router.ts'
import { createTripsRouter } from '../src/trips/router.ts'
import type { HealthChecks } from '../src/health.ts'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL não definido: configure o Postgres local')
const candidateSecret = 'segredo-de-candidato-integração-com-entropia-suficiente'

const testDatabaseName = `trippy_api_sync_${process.pid}_${randomUUID().replaceAll('-', '').slice(0, 12)}`
const adminUrl = new URL(databaseUrl)
adminUrl.pathname = '/postgres'
const testDatabaseUrl = new URL(databaseUrl)
testDatabaseUrl.pathname = `/${testDatabaseName}`

const tokenUsers = new Map<string, string>()
let databaseCreated = false
let pool: Pool
let app: ReturnType<typeof createApp>
let userId: string
let otherUserId: string
let outsiderId: string
let closeSync: () => Promise<void> = async () => {}

const healthyChecks: HealthChecks = {
  postgres: async () => {},
  storage: async () => {},
  queue: async () => {},
  mail: async () => {},
}

async function get(path: string, token = 'user-token') {
  return app.request(path, { headers: { authorization: `Bearer ${token}` } })
}

async function post(path: string, body: unknown, token = 'user-token') {
  return app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
}

async function createTrip(token = 'user-token'): Promise<string> {
  const response = await post(
    '/trips',
    {
      name: `Viagem ${randomUUID()}`,
      destination: 'Lisboa',
      startDate: '2026-11-01',
      endDate: '2026-11-05',
      timezone: 'Europe/Lisbon',
    },
    token,
  )
  expect(response.status).toBe(201)
  return ((await response.json()) as { trip: { id: string } }).trip.id
}

async function addActiveMember(tripId: string, memberId: string): Promise<void> {
  const sequence = await pool.query<{ seq_counter: string }>(
    'UPDATE trips SET seq_counter = seq_counter + 1 WHERE id = $1 RETURNING seq_counter',
    [tripId],
  )
  await pool.query(
    `INSERT INTO trip_members (trip_id, user_id, role, seq)
     VALUES ($1, $2, 'member', $3)`,
    [tripId, memberId, sequence.rows[0]!.seq_counter],
  )
}

function addOperation(tripId: string, placeId = randomUUID()) {
  return {
    type: 'place.add' as const,
    opId: randomUUID(),
    tripId,
    placeId,
    name: `Lugar ${placeId.slice(0, 8)}`,
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
  const users = await pool.query<{ id: string }>(
    'INSERT INTO users (email) VALUES ($1), ($2), ($3) RETURNING id',
    [
      `sync-${randomUUID()}@example.test`,
      `sync-${randomUUID()}@example.test`,
      `sync-${randomUUID()}@example.test`,
    ],
  )
  userId = users.rows[0]!.id
  otherUserId = users.rows[1]!.id
  outsiderId = users.rows[2]!.id
  tokenUsers.set('user-token', userId)
  tokenUsers.set('other-token', otherUserId)
  tokenUsers.set('outsider-token', outsiderId)

  const trips = createTripsRouter(
    { databaseUrl: testDatabaseUrl.toString() },
    {
      tripStore: new PostgresTripStore(pool),
      accessTokenVerifier: async (token) => {
        const verifiedUserId = tokenUsers.get(token)
        if (!verifiedUserId) throw new Error('Token inválido')
        return { userId: verifiedUserId }
      },
    },
  )
  const sync = createSyncRouter(
    { databaseUrl: testDatabaseUrl.toString(), placesCandidateSecret: candidateSecret },
    {
      accessTokenVerifier: async (token) => {
        const verifiedUserId = tokenUsers.get(token)
        if (!verifiedUserId) throw new Error('Token inválido')
        return { userId: verifiedUserId }
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

it('reenvia lote como duplicado e serializa op_id concorrente', async () => {
  const tripId = await createTrip()
  const operation = addOperation(tripId)

  const first = await post('/sync/push', { operations: [operation] })
  const repeated = await post('/sync/push', { operations: [operation] })
  expect(first.status).toBe(200)
  expect(await first.json()).toEqual({ results: [{ opId: operation.opId, status: 'applied' }] })
  expect(await repeated.json()).toEqual({
    results: [{ opId: operation.opId, status: 'duplicate' }],
  })

  const concurrentTrip = await createTrip()
  const concurrentOperation = addOperation(concurrentTrip)
  const responses = await Promise.all([
    post('/sync/push', { operations: [concurrentOperation] }),
    post('/sync/push', { operations: [concurrentOperation] }),
  ])
  const results = await Promise.all(
    responses.map(
      async (response) =>
        (await response.json()) as {
          results: Array<{ status: string }>
        },
    ),
  )
  expect(results.map((result) => result.results[0]!.status).sort()).toEqual([
    'applied',
    'duplicate',
  ])

  const persisted = await pool.query<{ count: string }>(
    'SELECT count(*)::text AS count FROM places WHERE id = $1',
    [concurrentOperation.placeId],
  )
  expect(persisted.rows[0]!.count).toBe('1')

  const memberTrip = await createTrip()
  await addActiveMember(memberTrip, otherUserId)
  const ownedByFirstUser = addOperation(memberTrip)
  await post('/sync/push', { operations: [ownedByFirstUser] })
  const samePlace = { ...addOperation(memberTrip, ownedByFirstUser.placeId) }
  const byPlaceId = await post('/sync/push', { operations: [samePlace] })
  expect(await byPlaceId.json()).toMatchObject({ results: [{ status: 'duplicate' }] })
  const byOtherUser = await post('/sync/push', { operations: [ownedByFirstUser] }, 'other-token')
  expect(await byOtherUser.json()).toMatchObject({
    results: [{ status: 'rejected', reason: 'invalid' }],
  })
})

it('serializa pushes da mesma viagem com sequências contínuas no pull', async () => {
  const tripId = await createTrip()
  const operations = Array.from({ length: 8 }, () => addOperation(tripId))
  const responses = await Promise.all(
    operations.map((operation) => post('/sync/push', { operations: [operation] })),
  )
  expect(responses.every((response) => response.status === 200)).toBe(true)

  const pull = await get(`/sync/pull?trip=${tripId}&cursor=0&limit=100`)
  const page = (await pull.json()) as {
    places: Array<{ seq: string }>
    members: Array<{ seq: string }>
  }
  const sequences = [...page.places, ...page.members]
    .map((row) => BigInt(row.seq))
    .sort((a, b) => (a < b ? -1 : 1))
  expect(new Set(sequences.map(String)).size).toBe(sequences.length)
  expect(sequences.slice(1).every((sequence, index) => sequence === sequences[index]! + 1n)).toBe(
    true,
  )
})

it('inclui remoções, pagina bootstrap estável e entrega escrita feita durante as páginas', async () => {
  const tripId = await createTrip()
  const firstPlace = addOperation(tripId)
  const secondPlace = addOperation(tripId)
  await post('/sync/push', { operations: [firstPlace, secondPlace] })

  const firstPageResponse = await get(`/sync/pull?trip=${tripId}&limit=1`)
  const firstPage = (await firstPageResponse.json()) as {
    snapshotSeq: string
    nextCursor: string
    hasMore: boolean
    places: Array<{ id: string }>
    members: Array<{ userId: string; seq: string }>
  }
  expect(firstPage.hasMore).toBe(true)
  expect(firstPage.members).toHaveLength(1)
  expect(BigInt(firstPage.members[0]!.seq)).toBeGreaterThan(0n)

  const arrivingDuringBootstrap = addOperation(tripId)
  await post('/sync/push', { operations: [arrivingDuringBootstrap] })

  const bootstrapItems = [...firstPage.places.map((place) => place.id)]
  let cursor = firstPage.nextCursor
  let hasMore = firstPage.hasMore
  while (hasMore) {
    const response = await get(
      `/sync/pull?trip=${tripId}&limit=1&snapshotSeq=${firstPage.snapshotSeq}&cursor=${cursor}`,
    )
    const page = (await response.json()) as {
      nextCursor: string
      hasMore: boolean
      places: Array<{ id: string }>
    }
    bootstrapItems.push(...page.places.map((place) => place.id))
    cursor = page.nextCursor
    hasMore = page.hasMore
    if (!hasMore) expect(page.nextCursor).toBe(firstPage.snapshotSeq)
  }
  expect(bootstrapItems).toContain(firstPlace.placeId)
  expect(bootstrapItems).toContain(secondPlace.placeId)
  expect(bootstrapItems).not.toContain(arrivingDuringBootstrap.placeId)

  const incremental = await get(`/sync/pull?trip=${tripId}&limit=1&cursor=${cursor}`)
  expect(await incremental.json()).toMatchObject({
    mode: 'incremental',
    places: [{ id: arrivingDuringBootstrap.placeId }],
  })

  const removed = await post('/sync/push', {
    operations: [{ type: 'place.remove', opId: randomUUID(), tripId, placeId: firstPlace.placeId }],
  })
  expect(await removed.json()).toMatchObject({ results: [{ status: 'applied' }] })
  const changes = await get(`/sync/pull?trip=${tripId}&limit=10&cursor=${firstPage.snapshotSeq}`)
  const changesBody = (await changes.json()) as {
    places: Array<{ id: string; deletedAt: string | null }>
  }
  expect(changesBody.places).toContainEqual(
    expect.objectContaining({ id: firstPlace.placeId, deletedAt: expect.any(String) }),
  )
})

it('retorna bootstrap_required, esconde viagens de não membro e aplica permissão de remoção', async () => {
  const tripId = await createTrip()
  const created = addOperation(tripId)
  await post('/sync/push', { operations: [created] })
  await addActiveMember(tripId, otherUserId)

  const forbidden = await post(
    '/sync/push',
    {
      operations: [{ type: 'place.remove', opId: randomUUID(), tripId, placeId: created.placeId }],
    },
    'other-token',
  )
  expect(await forbidden.json()).toMatchObject({
    results: [{ status: 'rejected', reason: 'forbidden' }],
  })

  const notMemberOperation = {
    type: 'place.remove' as const,
    opId: randomUUID(),
    tripId,
    placeId: created.placeId,
  }
  const notMember = await post('/sync/push', { operations: [notMemberOperation] }, 'outsider-token')
  const notMemberResult = {
    results: [{ status: 'rejected', reason: 'not_member' }],
  }
  expect(await notMember.json()).toMatchObject(notMemberResult)
  const replayedNotMember = await post(
    '/sync/push',
    { operations: [notMemberOperation] },
    'outsider-token',
  )
  expect(await replayedNotMember.json()).toMatchObject(notMemberResult)
  expect((await get(`/sync/pull?trip=${tripId}&cursor=0&limit=10`, 'outsider-token')).status).toBe(
    404,
  )

  const highCursor = await get(`/sync/pull?trip=${tripId}&cursor=99999&limit=10`)
  expect(await highCursor.json()).toEqual({ error: 'bootstrap_required' })

  await pool.query('UPDATE trips SET sync_floor_seq = 4 WHERE id = $1', [tripId])
  const expiredCursor = await get(`/sync/pull?trip=${tripId}&cursor=3&limit=10`)
  expect(await expiredCursor.json()).toEqual({ error: 'bootstrap_required' })

  const secondTrip = await createTrip()
  const secondPlace = addOperation(secondTrip)
  await post('/sync/push', { operations: [secondPlace] })
  const otherTripPlace = addOperation(secondTrip, created.placeId)
  const duplicatePlaceId = await post('/sync/push', { operations: [otherTripPlace] })
  expect(await duplicatePlaceId.json()).toMatchObject({ results: [{ status: 'rejected' }] })
})

it('marca e desmarca só a própria visita, reativa com seq novo e remove visitas vivas', async () => {
  const tripId = await createTrip()
  await addActiveMember(tripId, otherUserId)
  const place = addOperation(tripId)
  await post('/sync/push', { operations: [place] })

  const mark = (type: 'visit.mark' | 'visit.unmark') => ({
    type,
    opId: randomUUID(),
    tripId,
    placeId: place.placeId,
  })
  const firstMark = await post('/sync/push', { operations: [mark('visit.mark')] }, 'other-token')
  expect(await firstMark.json()).toMatchObject({ results: [{ status: 'applied' }] })
  const ownVisit = await pool.query<{
    user_id: string
    marked_by: string
    seq: string
    deleted_at: Date | null
  }>('SELECT user_id, marked_by, seq::text AS seq, deleted_at FROM visits WHERE place_id = $1', [
    place.placeId,
  ])
  expect(ownVisit.rows[0]).toMatchObject({
    user_id: otherUserId,
    marked_by: otherUserId,
    deleted_at: null,
  })
  const firstSequence = ownVisit.rows[0]!.seq

  const repeatedMark = await post('/sync/push', { operations: [mark('visit.mark')] }, 'other-token')
  expect(await repeatedMark.json()).toMatchObject({ results: [{ status: 'duplicate' }] })
  const unmarked = await post('/sync/push', { operations: [mark('visit.unmark')] }, 'other-token')
  expect(await unmarked.json()).toMatchObject({ results: [{ status: 'applied' }] })
  const removedVisit = await pool.query<{ seq: string; deleted_at: Date | null }>(
    'SELECT seq::text AS seq, deleted_at FROM visits WHERE place_id = $1 AND user_id = $2',
    [place.placeId, otherUserId],
  )
  expect(removedVisit.rows[0]!.deleted_at).toBeInstanceOf(Date)
  expect(removedVisit.rows[0]!.seq).not.toBe(firstSequence)

  const reactivated = await post('/sync/push', { operations: [mark('visit.mark')] }, 'other-token')
  expect(await reactivated.json()).toMatchObject({ results: [{ status: 'applied' }] })
  const reactivatedVisit = await pool.query<{ seq: string; deleted_at: Date | null }>(
    'SELECT seq::text AS seq, deleted_at FROM visits WHERE place_id = $1 AND user_id = $2',
    [place.placeId, otherUserId],
  )
  expect(reactivatedVisit.rows[0]!.deleted_at).toBeNull()
  expect(BigInt(reactivatedVisit.rows[0]!.seq)).toBeGreaterThan(BigInt(removedVisit.rows[0]!.seq))

  const removedPlace = await post('/sync/push', {
    operations: [{ type: 'place.remove', opId: randomUUID(), tripId, placeId: place.placeId }],
  })
  expect(await removedPlace.json()).toMatchObject({ results: [{ status: 'applied' }] })
  const removedRows = await pool.query<{
    place_seq: string
    visit_seq: string
    deleted_at: Date | null
  }>(
    `SELECT places.seq::text AS place_seq, visits.seq::text AS visit_seq, visits.deleted_at
     FROM places JOIN visits ON visits.place_id = places.id
     WHERE places.id = $1 AND visits.user_id = $2`,
    [place.placeId, otherUserId],
  )
  expect(removedRows.rows[0]!.deleted_at).toBeInstanceOf(Date)
  expect(removedRows.rows[0]!.place_seq).not.toBe(removedRows.rows[0]!.visit_seq)

  const markRemoved = await post('/sync/push', { operations: [mark('visit.mark')] }, 'other-token')
  expect(await markRemoved.json()).toMatchObject({
    results: [{ status: 'rejected', reason: 'invalid' }],
  })
})

it('valida operações e limita o lote de push', async () => {
  const invalid = await post('/sync/push', { operations: [{ type: 'place.add' }] })
  expect(invalid.status).toBe(400)
  expect(await invalid.json()).toMatchObject({
    error: 'invalid_sync_request',
    message: expect.any(String),
  })

  const tooMany = await post('/sync/push', {
    operations: Array.from({ length: 101 }, () => ({ type: 'place.add' })),
  })
  expect(tooMany.status).toBe(413)
  expect(await tooMany.json()).toMatchObject({ error: 'sync_batch_too_large' })
})
