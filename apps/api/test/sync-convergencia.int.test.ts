import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pg, { type Pool } from 'pg'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { PostgresInviteStore } from '@trippy/adapters/invites'
import { PostgresSyncStore } from '@trippy/adapters/sync'
import { PostgresTripStore } from '@trippy/adapters/trips'
import {
  canonicalTripState,
  createSyncClient,
  type PullQuery,
  type PullResponse,
  type PushRequest,
  type PushResponse,
  type SyncClient,
  type SyncPlace,
  type SyncTransport,
  type SyncVisit,
  type SyncMember,
  type UUID,
} from '@trippy/sync'
import { NodeSqlDatabase } from '@trippy/sync/node-sqlite'
import type { SqlDatabase } from '@trippy/sync'
import { migrate } from '../../../packages/db/src/migrate.ts'
import { createApp } from '../src/app.ts'
import { createInvitesRouter } from '../src/invites/router.ts'
import { createSyncRouter } from '../src/sync/router.ts'
import { createTripsRouter } from '../src/trips/router.ts'
import type { HealthChecks } from '../src/health.ts'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL não definido: configure o Postgres local')

const testDatabaseName = `trippy_sync_convergencia_${process.pid}_${randomUUID().replaceAll('-', '').slice(0, 12)}`
const adminUrl = new URL(databaseUrl)
adminUrl.pathname = '/postgres'
const testDatabaseUrl = new URL(databaseUrl)
testDatabaseUrl.pathname = `/${testDatabaseName}`

type ClientControls = {
  online: boolean
  loseNextPushResponse: boolean
  pullQueries: PullQuery[]
  pushRequests: PushRequest[]
}

const tokenUsers = new Map<string, UUID>()
const clients: Array<{ database: NodeSqlDatabase; client: SyncClient }> = []
let databaseCreated = false
let sqliteDirectory: string | undefined
let pool: Pool
let app: ReturnType<typeof createApp>
let organizerId: UUID
let memberId: UUID
let tripId: UUID

const healthyChecks: HealthChecks = {
  postgres: async () => {},
  storage: async () => {},
  queue: async () => {},
  mail: async () => {},
}

async function apiRequest(path: string, token: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers)
  headers.set('authorization', `Bearer ${token}`)
  if (init?.body !== undefined) headers.set('content-type', 'application/json')
  return app.fetch(new Request(new URL(path, 'http://trippy.test'), { ...init, headers }))
}

async function jsonResponse<T>(response: Response): Promise<T> {
  const body: unknown = await response.json()
  if (!response.ok) {
    throw new Error(`API respondeu HTTP ${response.status}: ${JSON.stringify(body)}`)
  }
  return body as T
}

function createTransport(token: string, controls: ClientControls): SyncTransport {
  return {
    async push(request) {
      controls.pushRequests.push(request)
      if (!controls.online) throw new TypeError('Network request failed')

      const response = await apiRequest('/sync/push', token, {
        method: 'POST',
        body: JSON.stringify(request),
      })
      const result = await jsonResponse<PushResponse>(response)
      if (controls.loseNextPushResponse) {
        controls.loseNextPushResponse = false
        throw new Error('Resposta de push perdida pelo transporte de teste.')
      }
      return result
    },

    async pull(query) {
      controls.pullQueries.push(query)
      if (!controls.online) throw new TypeError('Network request failed')

      const params = new URLSearchParams({ trip: query.tripId, limit: String(query.limit) })
      if (query.mode === 'incremental') params.set('cursor', query.cursor)
      else if ('snapshotSeq' in query) {
        params.set('snapshotSeq', query.snapshotSeq)
        params.set('cursor', query.cursor)
      }
      const response = await apiRequest(`/sync/pull?${params}`, token)
      const body: unknown = await response.json()
      if (!response.ok && !(response.status === 409 && isBootstrapRequired(body))) {
        throw new Error(`API respondeu HTTP ${response.status}: ${JSON.stringify(body)}`)
      }
      return body as PullResponse
    },
  }
}

function isBootstrapRequired(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    'error' in value &&
    value.error === 'bootstrap_required'
  )
}

async function openClient(userId: UUID, token: string, fileName: string, controls: ClientControls) {
  const database = new NodeSqlDatabase(join(sqliteDirectory!, fileName))
  const client = await createSyncClient({
    database,
    transport: createTransport(token, controls),
    userId,
    getTripIds: () => [tripId],
    idGenerator: randomUUID,
    pageSize: 1,
  })
  clients.push({ database, client })
  return { database, client }
}

async function post(path: string, body: unknown, token: string): Promise<Response> {
  return apiRequest(path, token, { method: 'POST', body: JSON.stringify(body) })
}

async function readLocalState(database: SqlDatabase, currentTripId: UUID) {
  const places = await database.all<SyncPlace & Record<string, unknown>>(
    `SELECT id, trip_id AS tripId, provider, provider_ref AS providerRef, name,
            local_name AS localName, address, local_address AS localAddress, lat, lng,
            suggested_by AS suggestedBy, comment, day_index AS dayIndex, position, seq,
            deleted_at AS deletedAt, created_at AS createdAt
     FROM places WHERE trip_id = ?`,
    [currentTripId],
  )
  const visits = await database.all<SyncVisit & Record<string, unknown>>(
    `SELECT place_id AS placeId, trip_id AS tripId, user_id AS userId, marked_by AS markedBy,
            visited_at AS visitedAt, visited_tz AS visitedTz, seq, deleted_at AS deletedAt
     FROM visits WHERE trip_id = ?`,
    [currentTripId],
  )
  const members = await database.all<SyncMember & Record<string, unknown>>(
    `SELECT trip_id AS tripId, user_id AS userId, role, joined_at AS joinedAt,
            seq, deleted_at AS deletedAt
     FROM members WHERE trip_id = ?`,
    [currentTripId],
  )
  return canonicalTripState({ places, visits, members })
}

async function readServerState(currentTripId: UUID) {
  const placeRows = await pool.query<SyncPlace>(
    `SELECT id, trip_id AS "tripId", provider, provider_ref AS "providerRef", name,
            local_name AS "localName", address, local_address AS "localAddress", lat, lng,
            suggested_by AS "suggestedBy", comment, day_index AS "dayIndex", position,
            seq::text AS seq, deleted_at AS "deletedAt", created_at AS "createdAt"
     FROM places WHERE trip_id = $1`,
    [currentTripId],
  )
  const visitRows = await pool.query<SyncVisit>(
    `SELECT place_id AS "placeId", trip_id AS "tripId", user_id AS "userId",
            marked_by AS "markedBy", visited_at AS "visitedAt", visited_tz AS "visitedTz",
            seq::text AS seq, deleted_at AS "deletedAt"
     FROM visits WHERE trip_id = $1`,
    [currentTripId],
  )
  const memberRows = await pool.query<SyncMember>(
    `SELECT trip_id AS "tripId", user_id AS "userId", role, joined_at AS "joinedAt",
            seq::text AS seq, left_at AS "deletedAt"
     FROM trip_members WHERE trip_id = $1`,
    [currentTripId],
  )
  return canonicalTripState({
    places: placeRows.rows.map((place) => ({
      ...place,
      createdAt: new Date(place.createdAt).toISOString(),
      deletedAt: place.deletedAt === null ? null : new Date(place.deletedAt).toISOString(),
    })),
    visits: visitRows.rows.map((visit) => ({
      ...visit,
      visitedAt: new Date(visit.visitedAt).toISOString(),
      deletedAt: visit.deletedAt === null ? null : new Date(visit.deletedAt).toISOString(),
    })),
    members: memberRows.rows.map((member) => ({
      ...member,
      joinedAt: new Date(member.joinedAt).toISOString(),
      deletedAt: member.deletedAt === null ? null : new Date(member.deletedAt).toISOString(),
    })),
  })
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
  sqliteDirectory = await mkdtemp(join(tmpdir(), 'trippy-sync-convergencia-'))
  const users = await pool.query<{ id: UUID }>(
    'INSERT INTO users (email) VALUES ($1), ($2) RETURNING id',
    [`sync-a-${randomUUID()}@example.test`, `sync-b-${randomUUID()}@example.test`],
  )
  organizerId = users.rows[0]!.id
  memberId = users.rows[1]!.id
  tokenUsers.set('convergencia-organizador', organizerId)
  tokenUsers.set('convergencia-membro', memberId)

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
    { databaseUrl: testDatabaseUrl.toString() },
    { syncStore: new PostgresSyncStore(pool), accessTokenVerifier },
  )
  const invites = createInvitesRouter(
    { databaseUrl: testDatabaseUrl.toString() },
    { inviteStore: new PostgresInviteStore(pool), accessTokenVerifier },
  )
  app = createApp(healthyChecks, 1_000, undefined, trips.router, sync.router, invites.router)
})

afterAll(async () => {
  for (const { database } of clients.reverse()) database.close()
  if (pool) await pool.end()
  if (sqliteDirectory) await rm(sqliteDirectory, { recursive: true, force: true })
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

it('converge após resposta perdida, fechamento offline, remoção e escritas simultâneas', async () => {
  const tripResponse = await post(
    '/trips',
    {
      name: `Convergência ${randomUUID()}`,
      destination: 'Lisboa',
      startDate: '2026-12-01',
      endDate: '2026-12-05',
      timezone: 'Europe/Lisbon',
    },
    'convergencia-organizador',
  )
  expect(tripResponse.status).toBe(201)
  tripId = ((await tripResponse.json()) as { trip: { id: UUID } }).trip.id

  const inviteResponse = await post(`/trips/${tripId}/invites`, {}, 'convergencia-organizador')
  expect(inviteResponse.status).toBe(201)
  const { token } = (await inviteResponse.json()) as { token: string }
  const acceptResponse = await post('/invites/accept', { token }, 'convergencia-membro')
  expect(acceptResponse.status).toBe(200)

  const controlsA: ClientControls = {
    online: true,
    loseNextPushResponse: false,
    pullQueries: [],
    pushRequests: [],
  }
  const controlsB: ClientControls = {
    online: true,
    loseNextPushResponse: false,
    pullQueries: [],
    pushRequests: [],
  }
  let { database: databaseA, client: clientA } = await openClient(
    organizerId,
    'convergencia-organizador',
    'cliente-a.sqlite',
    controlsA,
  )
  const { database: databaseB, client: clientB } = await openClient(
    memberId,
    'convergencia-membro',
    'cliente-b.sqlite',
    controlsB,
  )

  await clientA.syncNow()
  await clientB.syncNow()

  controlsA.online = false
  const offlinePlaceId = await clientA.addPlace(tripId, 'Lugar offline de A')
  await clientA.markVisit(tripId, offlinePlaceId)
  expect(clientA.getStatus().pending).toBe(2)

  databaseA.close()
  const closedDatabaseIndex = clients.findIndex(({ database }) => database === databaseA)
  if (closedDatabaseIndex >= 0) clients.splice(closedDatabaseIndex, 1)
  const reopenedA = await openClient(
    organizerId,
    'convergencia-organizador',
    'cliente-a.sqlite',
    controlsA,
  )
  databaseA = reopenedA.database
  clientA = reopenedA.client
  expect(clientA.getStatus().pending).toBe(2)

  controlsA.online = true
  controlsA.loseNextPushResponse = true
  await expect(clientA.syncNow()).rejects.toThrow('Resposta de push perdida')
  expect(clientA.getStatus().pending).toBe(2)
  const persistedCounts = async () => {
    const response = await pool.query<{
      places: string
      visits: string
      operations: string
    }>(
      `SELECT
         (SELECT count(*) FROM places WHERE id = $1)::text AS places,
         (SELECT count(*) FROM visits WHERE place_id = $1 AND user_id = $2)::text AS visits,
         (SELECT count(*) FROM applied_ops WHERE trip_id = $3 AND user_id = $2)::text AS operations`,
      [offlinePlaceId, organizerId, tripId],
    )
    return response.rows[0]
  }
  expect(await persistedCounts()).toEqual({ places: '1', visits: '1', operations: '2' })

  const pushesBeforeRetry = controlsA.pushRequests.length
  await clientA.syncNow()
  const sentAfterLostResponse = controlsA.pushRequests.slice(pushesBeforeRetry - 1)
  expect(sentAfterLostResponse).toHaveLength(2)
  expect(sentAfterLostResponse[0]).toEqual(sentAfterLostResponse[1])
  expect(await persistedCounts()).toEqual({ places: '1', visits: '1', operations: '2' })
  expect(clientA.getStatus().pending).toBe(0)

  await clientB.syncNow()
  expect(await databaseB.all('SELECT id FROM places WHERE id = ?', [offlinePlaceId])).toHaveLength(
    1,
  )
  expect(
    await databaseB.all('SELECT place_id FROM visits WHERE place_id = ?', [offlinePlaceId]),
  ).toHaveLength(1)

  const memberPlaceId = await clientB.addPlace(tripId, 'Lugar de B removido')
  await clientB.syncNow()
  await clientA.syncNow()
  await clientB.removePlace(tripId, memberPlaceId)
  await clientB.syncNow()
  await clientA.syncNow()
  const removedByB = await databaseA.get<{ deletedAt: string | null } & Record<string, unknown>>(
    'SELECT deleted_at AS deletedAt FROM places WHERE id = ?',
    [memberPlaceId],
  )
  expect(removedByB?.deletedAt).toEqual(expect.any(String))
  expect(await clientA.listPlaces(tripId)).not.toEqual(
    expect.arrayContaining([expect.objectContaining({ id: memberPlaceId })]),
  )

  controlsA.online = false
  controlsB.online = false
  const [concurrentPlaceA, concurrentPlaceB] = await Promise.all([
    clientA.addPlace(tripId, 'Escrita offline de A'),
    clientB.addPlace(tripId, 'Escrita offline de B'),
  ])
  await Promise.all([
    clientA.markVisit(tripId, concurrentPlaceA),
    clientB.markVisit(tripId, concurrentPlaceB),
  ])
  controlsA.online = true
  controlsB.online = true
  await Promise.all([clientA.syncNow(), clientB.syncNow()])
  await Promise.all([clientA.syncNow(), clientB.syncNow()])

  const localA = await readLocalState(databaseA, tripId)
  const localB = await readLocalState(databaseB, tripId)
  const server = await readServerState(tripId)
  expect(localA).toEqual(localB)
  expect(localA).toEqual(server)
  expect(controlsA.pullQueries.every((query) => query.limit === 1)).toBe(true)
  expect(controlsB.pullQueries.every((query) => query.limit === 1)).toBe(true)
  expect(controlsA.pullQueries.length + controlsB.pullQueries.length).toBeGreaterThan(8)
  expect(clientA.getStatus().pending).toBe(0)
  expect(clientB.getStatus().pending).toBe(0)
})
