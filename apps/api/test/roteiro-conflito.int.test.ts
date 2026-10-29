import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pg from 'pg'
import { RECAP_SHARING_TERMS_VERSION } from '@trippy/sync'
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
  type SyncMember,
  type SyncPlace,
  type SyncTransport,
  type SyncVisit,
  type SyncWant,
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

const testDatabaseName = `trippy_roteiro_conflito_${process.pid}_${randomUUID().replaceAll('-', '').slice(0, 12)}`
const adminUrl = new URL(databaseUrl)
adminUrl.pathname = '/postgres'
const testDatabaseUrl = new URL(databaseUrl)
testDatabaseUrl.pathname = `/${testDatabaseName}`

type ClientControls = {
  online: boolean
  pullQueries: PullQuery[]
  pushRequests: PushRequest[]
  pushResponses: PushResponse[]
}

const tokenUsers = new Map<string, UUID>()
const clients: Array<{ database: NodeSqlDatabase; client: SyncClient }> = []
let databaseCreated = false
let sqliteDirectory: string | undefined
const candidateSecret = 'segredo-de-candidato-integração-com-entropia-suficiente'
type Pool = InstanceType<typeof pg.Pool>
let pool: Pool
let app: ReturnType<typeof createApp>
let organizerId: UUID
let coorganizerId: UUID
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

async function post(path: string, body: unknown, token: string): Promise<Response> {
  return apiRequest(path, token, { method: 'POST', body: JSON.stringify(body) })
}

async function jsonResponse<T>(response: Response): Promise<T> {
  const body: unknown = await response.json()
  if (!response.ok) {
    throw new Error(`API respondeu HTTP ${response.status}: ${JSON.stringify(body)}`)
  }
  return body as T
}

function isBootstrapRequired(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    'error' in value &&
    value.error === 'bootstrap_required'
  )
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
      controls.pushResponses.push(result)
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
        if (!(response.status === 403 && isNotMember(body))) {
          throw new Error(`API respondeu HTTP ${response.status}: ${JSON.stringify(body)}`)
        }
      }
      return body as PullResponse
    },
  }
}

function isNotMember(value: unknown): boolean {
  return (
    typeof value === 'object' && value !== null && 'error' in value && value.error === 'not_member'
  )
}

const controlsA: ClientControls = {
  online: true,
  pullQueries: [],
  pushRequests: [],
  pushResponses: [],
}
const controlsB: ClientControls = {
  online: true,
  pullQueries: [],
  pushRequests: [],
  pushResponses: [],
}
const controlsMember: ClientControls = {
  online: true,
  pullQueries: [],
  pushRequests: [],
  pushResponses: [],
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

function closeClient(database: NodeSqlDatabase): void {
  database.close()
  const index = clients.findIndex((entry) => entry.database === database)
  if (index >= 0) clients.splice(index, 1)
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
    `SELECT trip_id AS tripId, user_id AS userId, role, joined_at AS joinedAt, seq,
            deleted_at AS deletedAt
     FROM members WHERE trip_id = ?`,
    [currentTripId],
  )
  const wants = await database.all<SyncWant & Record<string, unknown>>(
    `SELECT place_id AS placeId, trip_id AS tripId, user_id AS userId, created_at AS createdAt,
            seq, deleted_at AS deletedAt
     FROM wants WHERE trip_id = ?`,
    [currentTripId],
  )
  return canonicalTripState({ places, visits, wants, members })
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
  const wantRows = await pool.query<SyncWant>(
    `SELECT place_id AS "placeId", trip_id AS "tripId", user_id AS "userId",
            created_at AS "createdAt", seq::text AS seq, deleted_at AS "deletedAt"
     FROM place_wants WHERE trip_id = $1`,
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
    wants: wantRows.rows.map((want) => ({
      ...want,
      createdAt: new Date(want.createdAt).toISOString(),
      deletedAt: want.deletedAt === null ? null : new Date(want.deletedAt).toISOString(),
    })),
    members: memberRows.rows.map((member) => ({
      ...member,
      joinedAt: new Date(member.joinedAt).toISOString(),
      deletedAt: member.deletedAt === null ? null : new Date(member.deletedAt).toISOString(),
    })),
  })
}

async function createInviteAndAccept(token: string, acceptingToken: string): Promise<void> {
  const invite = await post(`/trips/${tripId}/invites`, {}, token)
  expect(invite.status).toBe(201)
  const { token: inviteToken } = (await invite.json()) as { token: string }
  const accepted = await post(
    '/invites/accept',
    { token: inviteToken, termsVersion: RECAP_SHARING_TERMS_VERSION },
    acceptingToken,
  )
  expect(accepted.status).toBe(200)
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
  sqliteDirectory = await mkdtemp(join(tmpdir(), 'trippy-roteiro-conflito-'))
  const users = await pool.query<{ id: UUID }>(
    'INSERT INTO users (email) VALUES ($1), ($2), ($3) RETURNING id',
    [
      `roteiro-a-${randomUUID()}@example.test`,
      `roteiro-b-${randomUUID()}@example.test`,
      `roteiro-membro-${randomUUID()}@example.test`,
    ],
  )
  organizerId = users.rows[0]!.id
  coorganizerId = users.rows[1]!.id
  memberId = users.rows[2]!.id
  tokenUsers.set('roteiro-organizador', organizerId)
  tokenUsers.set('roteiro-coorganizador', coorganizerId)
  tokenUsers.set('roteiro-membro', memberId)

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
    { syncStore: new PostgresSyncStore(pool, candidateSecret), accessTokenVerifier },
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

it('preserva conflito de roteiro, exige papel apto e bloqueia alterações após remoção', async () => {
  const created = await post(
    '/trips',
    {
      name: `Conflito de roteiro ${randomUUID()}`,
      destination: 'Recife',
      startDate: '2026-12-01',
      endDate: '2026-12-04',
      timezone: 'America/Recife',
    },
    'roteiro-organizador',
  )
  expect(created.status).toBe(201)
  tripId = ((await created.json()) as { trip: { id: UUID } }).trip.id

  await createInviteAndAccept('roteiro-organizador', 'roteiro-coorganizador')
  const openedA = await openClient(
    organizerId,
    'roteiro-organizador',
    'cliente-a.sqlite',
    controlsA,
  )
  const openedB = await openClient(
    coorganizerId,
    'roteiro-coorganizador',
    'cliente-b.sqlite',
    controlsB,
  )
  const databaseA = openedA.database
  const clientA = openedA.client
  let databaseB = openedB.database
  let clientB = openedB.client

  await clientA.syncNow()
  await clientB.syncNow()
  await clientA.setMemberRole(tripId, coorganizerId, 'coorganizer')
  await clientA.syncNow()
  await clientB.syncNow()
  expect(await clientB.listMembers(tripId)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ userId: coorganizerId, role: 'coorganizer' }),
    ]),
  )

  const placeNames = ['Lugar Alfa', 'Lugar Bravo', 'Lugar Charlie']
  const placeIds = await Promise.all(placeNames.map((name) => clientA.addPlace(tripId, name)))
  await clientA.syncNow()
  await clientB.syncNow()
  expect(await clientB.listPlaces(tripId)).toHaveLength(3)

  controlsA.online = false
  controlsB.online = false
  await clientA.arrangeItinerary(tripId, [
    { dayIndex: 0, placeIds: [placeIds[1]!, placeIds[0]!, placeIds[2]!] },
  ])
  await clientB.arrangeItinerary(tripId, [
    { dayIndex: 0, placeIds: [placeIds[2]!, placeIds[1]!, placeIds[0]!] },
  ])
  await expect(clientA.syncNow()).rejects.toThrow('Network request failed')
  await expect(clientB.syncNow()).rejects.toThrow('Network request failed')
  expect((await clientA.listPlaces(tripId)).map((place) => place.id)).toEqual([
    placeIds[1],
    placeIds[0],
    placeIds[2],
  ])
  expect((await clientB.listPlaces(tripId)).map((place) => place.id)).toEqual([
    placeIds[2],
    placeIds[1],
    placeIds[0],
  ])

  controlsA.online = true
  await clientA.syncNow()
  const versionAfterA = await pool.query<{ itinerary_version: number }>(
    'SELECT itinerary_version FROM trips WHERE id = $1',
    [tripId],
  )
  expect(versionAfterA.rows[0]!.itinerary_version).toBe(1)
  expect(controlsA.pushResponses.at(-1)?.results).toEqual([
    expect.objectContaining({ status: 'applied' }),
  ])

  controlsB.online = true
  await clientB.syncNow()
  expect(controlsB.pushResponses.at(-1)?.results).toEqual([
    expect.objectContaining({ status: 'conflict', currentVersion: 1 }),
  ])
  expect(await clientB.listItineraryDrafts(tripId)).toMatchObject([
    {
      baseVersion: 0,
      currentVersion: 1,
      days: [{ dayIndex: 0, placeIds: [placeIds[2], placeIds[1], placeIds[0]] }],
    },
  ])
  expect((await clientB.listPlaces(tripId)).map((place) => place.id)).toEqual([
    placeIds[1],
    placeIds[0],
    placeIds[2],
  ])

  closeClient(databaseB)
  const reopenedB = await openClient(
    coorganizerId,
    'roteiro-coorganizador',
    'cliente-b.sqlite',
    controlsB,
  )
  databaseB = reopenedB.database
  clientB = reopenedB.client
  expect(await clientB.listItineraryDrafts(tripId)).toMatchObject([
    {
      baseVersion: 0,
      currentVersion: 1,
      days: [{ dayIndex: 0, placeIds: [placeIds[2], placeIds[1], placeIds[0]] }],
    },
  ])

  await createInviteAndAccept('roteiro-organizador', 'roteiro-membro')
  const openedMember = await openClient(
    memberId,
    'roteiro-membro',
    'cliente-membro.sqlite',
    controlsMember,
  )
  const clientMember = openedMember.client
  await clientMember.syncNow()
  await clientMember.arrangeItinerary(tripId, [
    { dayIndex: 0, placeIds: [placeIds[0]!, placeIds[2]!, placeIds[1]!] },
  ])
  await clientMember.syncNow()
  expect(controlsMember.pushResponses.at(-1)?.results).toEqual([
    expect.objectContaining({ status: 'rejected', reason: 'forbidden' }),
  ])
  expect(await clientMember.countNotSent(tripId)).toBeGreaterThan(0)
  expect((await clientMember.listPlaces(tripId)).map((place) => place.id)).toEqual([
    placeIds[1],
    placeIds[0],
    placeIds[2],
  ])

  const draft = (await clientB.listItineraryDrafts(tripId))[0]!
  await clientB.reapplyItineraryDraft(draft.opId)
  await clientB.syncNow()
  expect(controlsB.pushResponses.at(-1)?.results).toEqual([
    expect.objectContaining({ status: 'applied' }),
  ])
  expect(controlsB.pushRequests.at(-1)?.operations).toMatchObject([
    { type: 'itinerary.arrange', baseVersion: 1 },
  ])
  await clientA.syncNow()
  expect((await clientA.listPlaces(tripId)).map((place) => place.id)).toEqual([
    placeIds[2],
    placeIds[1],
    placeIds[0],
  ])
  expect((await clientB.listItineraryDrafts(tripId)).length).toBe(0)

  controlsB.online = false
  const unsentPlaceId = await clientB.addPlace(tripId, 'Lugar offline de B')
  await expect(clientB.syncNow()).rejects.toThrow('Network request failed')
  expect(clientB.getStatus().pending).toBeGreaterThan(0)

  await clientA.removeMember(tripId, coorganizerId)
  await clientA.syncNow()
  controlsB.online = true
  await clientB.syncNow()

  expect(await clientB.listRemovedTrips()).toContain(tripId)
  expect(await clientB.countNotSent(tripId)).toBeGreaterThan(0)
  expect(await clientB.listPlaces(tripId)).toEqual([])
  expect(await clientB.listMembers(tripId)).toEqual([])
  expect(await databaseB.all('SELECT id FROM places WHERE id = ?', [unsentPlaceId])).toEqual([])
  const unsentOnServer = await pool.query('SELECT id FROM places WHERE id = $1', [unsentPlaceId])
  expect(unsentOnServer.rows).toHaveLength(0)

  const serverVersion = await pool.query<{ itinerary_version: number }>(
    'SELECT itinerary_version FROM trips WHERE id = $1',
    [tripId],
  )
  expect(serverVersion.rows[0]!.itinerary_version).toBe(2)
  const localA = await readLocalState(databaseA, tripId)
  const server = await readServerState(tripId)
  expect(localA).toEqual(server)
  const orderedServerPlaces = await pool.query<{ id: UUID }>(
    `SELECT id FROM places
     WHERE trip_id = $1 AND deleted_at IS NULL AND day_index = 0
     ORDER BY position`,
    [tripId],
  )
  expect(orderedServerPlaces.rows.map((place) => place.id)).toEqual([
    placeIds[2],
    placeIds[1],
    placeIds[0],
  ])
  expect(server.members.find((member) => member.userId === coorganizerId)?.deletedAt).not.toBeNull()
  expect(controlsA.pullQueries.length + controlsB.pullQueries.length).toBeGreaterThan(4)
})
