import { randomUUID } from 'node:crypto'
import { readdir, readFile, rm, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  GetObjectCommand,
  ListBucketsCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3'
import pg, { type Pool } from 'pg'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { PostgresSyncStore } from '@trippy/adapters/sync'
import { PostgresTripStore } from '@trippy/adapters/trips'
import { GooglePlacesProvider } from '@trippy/adapters/places/google'
import type { PlacesProvider } from '@trippy/adapters/places/provider'
import type { PlaceSearchCandidateFields, PlaceSearchResponse } from '@trippy/domain/places'
import {
  createSyncClient,
  type PullQuery,
  type PullResponse,
  type PushRequest,
  type PushResponse,
  type SyncClient,
  type SyncTransport,
  type UUID,
} from '@trippy/sync'
import { NodeSqlDatabase } from '@trippy/sync/node-sqlite'
import { migrate } from '../../../packages/db/src/migrate.ts'
import { createApp } from '../src/app.ts'
import { createPlacesRouter } from '../src/places/router.ts'
import { createSyncRouter } from '../src/sync/router.ts'
import { createTripsRouter } from '../src/trips/router.ts'
import type { HealthChecks } from '../src/health.ts'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL não definido: configure o Postgres local')

const testDatabaseName = `trippy_google_nao_persistido_${process.pid}_${randomUUID().replaceAll('-', '').slice(0, 12)}`
const adminUrl = new URL(databaseUrl)
adminUrl.pathname = '/postgres'
const testDatabaseUrl = new URL(databaseUrl)
testDatabaseUrl.pathname = `/${testDatabaseName}`
const candidateSecret = 'segredo-de-candidato-integração-com-entropia-suficiente'
const googlePlaceId = 'ChIJGooglePlaceIdPermitido25'
const sentinels = [
  'SENTINELA_GOOGLE_NOME_25_8b3811',
  'SENTINELA_GOOGLE_ENDERECO_25_8b3811',
  'SENTINELA_GOOGLE_TIPO_25_8b3811',
  'SENTINELA_GOOGLE_MAPS_URI_25_8b3811',
  'SENTINELA_GOOGLE_PHOTO_NAME_25_8b3811',
  'SENTINELA_GOOGLE_PHOTO_URI_25_8b3811',
  'SENTINELA_GOOGLE_AUTOR_NOME_25_8b3811',
  'SENTINELA_GOOGLE_AUTOR_URI_25_8b3811',
  'SENTINELA_GOOGLE_AUTOR_FOTO_URI_25_8b3811',
]
const candidate: PlaceSearchCandidateFields = {
  provider: 'geoapify',
  providerRef: 'geoapify:lisboa:conformidade-25',
  name: 'Museu durável da Geoapify',
  localName: 'Museu durável da Geoapify',
  address: 'Rua da Geoapify, 25',
  localAddress: 'Rua da Geoapify, 25',
  lat: 38.725,
  lng: -9.116,
  countryCode: 'pt',
  datasource: 'dataset-de-teste',
  attribution: 'Atribuição de teste',
  license: 'Licença de teste',
  method: 'geocoding',
}
const tokenUsers = new Map<string, UUID>()
const clients: Array<{ database: NodeSqlDatabase; client: SyncClient }> = []
const healthyChecks: HealthChecks = {
  postgres: async () => {},
  storage: async () => {},
  queue: async () => {},
  mail: async () => {},
}

let databaseCreated = false
let sqliteDirectory: string | undefined
let pool: Pool
let tripStore: PostgresTripStore
let app: ReturnType<typeof createApp>
let organizerId: UUID
let tripId: UUID

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
  sqliteDirectory = await mkdtemp(join(tmpdir(), 'trippy-google-nao-persistido-'))
  const user = await pool.query<{ id: UUID }>(
    'INSERT INTO users (email) VALUES ($1) RETURNING id',
    [`google-conformidade-${randomUUID()}@example.test`],
  )
  organizerId = user.rows[0]!.id
  tokenUsers.set('organizer-token', organizerId)
  tripStore = new PostgresTripStore(pool)
  const trip = await tripStore.createTrip({
    organizerId,
    name: 'Viagem de conformidade Google',
    destination: 'Lisboa',
    startDate: '2026-11-01',
    endDate: '2026-11-05',
    timezone: 'Europe/Lisbon',
  })
  tripId = trip.id

  const accessTokenVerifier = async (token: string) => {
    const userId = tokenUsers.get(token)
    if (!userId) throw new Error('Token inválido')
    return { userId }
  }
  const trips = createTripsRouter(
    { databaseUrl: testDatabaseUrl.toString() },
    { tripStore, accessTokenVerifier },
  )
  const sync = createSyncRouter(
    { databaseUrl: testDatabaseUrl.toString(), placesCandidateSecret: candidateSecret },
    {
      syncStore: new PostgresSyncStore(pool, candidateSecret),
      accessTokenVerifier,
    },
  )
  const places = createPlacesRouter(
    {
      databaseUrl: testDatabaseUrl.toString(),
      placesCandidateSecret: candidateSecret,
      geoapifyApiKey: 'chave-geoapify-falsa',
      googlePlacesApiKey: 'chave-google-falsa',
      placesSearchUserDailyLimit: 200,
      placesSearchTripDailyLimit: 1_000,
      placesGoogleDetailsUserDailyLimit: 30,
      placesGoogleDetailsTripDailyLimit: 150,
      placesGoogleRestrictionRadiusMeters: 1_000,
    },
    {
      pool,
      tripStore,
      accessTokenVerifier,
      placesProvider: fakeGeoapifyProvider(),
      googleProvider: fakeGoogleProvider(),
    },
  )
  app = createApp(healthyChecks, 1_000, undefined, trips.router, sync.router, undefined, places.router)
}, 60_000)

afterAll(async () => {
  for (const { database } of clients.reverse()) database.close()
  if (pool) await pool.end()
  if (sqliteDirectory) await rm(sqliteDirectory, { recursive: true, force: true })
  if (!databaseCreated) return
  const admin = new pg.Client({ connectionString: adminUrl.toString() })
  await admin.connect()
  try {
    await admin.query(`DROP DATABASE "${testDatabaseName}"`)
  } finally {
    await admin.end()
  }
}, 60_000)

function fakeGeoapifyProvider(): PlacesProvider {
  return {
    async search() {
      return [candidate]
    },
  }
}

function fakeGoogleProvider(): GooglePlacesProvider {
  const googleFetch: typeof fetch = async (input) => {
    const url = new URL(input.toString())
    if (url.pathname.endsWith(':searchText')) {
      return json({ places: [{ id: googlePlaceId }] })
    }
    if (url.pathname.endsWith('/media')) {
      return json({ photoUri: `https://maps.google.test/${sentinels[5]}` })
    }
    return json({
      id: googlePlaceId,
      displayName: { text: sentinels[0] },
      primaryTypeDisplayName: { text: sentinels[2] },
      formattedAddress: sentinels[1],
      googleMapsUri: `https://maps.google.test/${sentinels[3]}`,
      photos: [
        {
          name: `places/${googlePlaceId}/photos/${sentinels[4]}`,
          widthPx: 900,
          heightPx: 600,
          authorAttributions: [
            {
              displayName: sentinels[6],
              uri: `https://maps.google.test/${sentinels[7]}`,
              photoUri: `https://maps.google.test/${sentinels[8]}`,
            },
          ],
        },
      ],
    })
  }
  return new GooglePlacesProvider('chave-google-falsa', {
    fetcher: googleFetch,
    restrictionRadiusMeters: 1_000,
    sleep: async () => {},
    random: () => 0,
  })
}

async function jsonResponse<T>(response: Response): Promise<T> {
  const body: unknown = await response.json()
  if (!response.ok) {
    throw new Error(`API respondeu HTTP ${response.status}: ${JSON.stringify(body)}`)
  }
  return body as T
}

function syncTransport(token: string): SyncTransport {
  return {
    async push(request: PushRequest): Promise<PushResponse> {
      const response = await apiRequest('/sync/push', token, {
        method: 'POST',
        body: JSON.stringify(request),
      })
      return jsonResponse<PushResponse>(response)
    },
    async pull(query: PullQuery): Promise<PullResponse> {
      const params = new URLSearchParams({ trip: query.tripId, limit: String(query.limit) })
      if (query.mode === 'incremental') params.set('cursor', query.cursor)
      else if ('snapshotSeq' in query) {
        params.set('snapshotSeq', query.snapshotSeq)
        params.set('cursor', query.cursor)
      }
      const response = await apiRequest(`/sync/pull?${params}`, token)
      return jsonResponse<PullResponse>(response)
    },
  }
}

async function apiRequest(path: string, token: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers)
  headers.set('authorization', `Bearer ${token}`)
  if (init?.body !== undefined) headers.set('content-type', 'application/json')
  return app.fetch(new Request(new URL(path, 'http://trippy.test'), { ...init, headers }))
}

async function scanPostgresTextColumns(): Promise<string[]> {
  const columns = await pool.query<{
    table_schema: string
    table_name: string
    column_name: string
  }>(
    `SELECT table_schema, table_name, column_name
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND data_type IN ('text', 'character varying', 'character', 'json', 'jsonb')
     ORDER BY table_name, ordinal_position`,
  )
  const findings: string[] = []
  for (const column of columns.rows) {
    const result = await pool.query<{ value: string | null }>(
      `SELECT ${quoteIdentifier(column.column_name)}::text AS value
       FROM ${quoteIdentifier(column.table_schema)}.${quoteIdentifier(column.table_name)}`,
    )
    for (const row of result.rows) {
      if (row.value && sentinels.some((sentinel) => row.value!.includes(sentinel))) {
        findings.push(`${column.table_name}.${column.column_name}`)
      }
    }
  }
  return findings
}

async function scanSqliteFiles(): Promise<string[]> {
  const findings: string[] = []
  const files = await readdir(sqliteDirectory!)
  for (const file of files) {
    const bytes = await readFile(join(sqliteDirectory!, file))
    if (sentinels.some((sentinel) => bytes.includes(Buffer.from(sentinel)))) findings.push(file)
  }
  return findings
}

async function scanMinioObjects(): Promise<string[]> {
  const client = new S3Client({
    region: process.env.AWS_REGION ?? 'us-east-1',
    ...(process.env.S3_ENDPOINT ? { endpoint: process.env.S3_ENDPOINT } : {}),
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
    ...(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
      ? {
          credentials: {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
          },
        }
      : {}),
  })
  const findings: string[] = []
  try {
    const buckets = await client.send(new ListBucketsCommand({}))
    for (const bucket of buckets.Buckets ?? []) {
      if (!bucket.Name) continue
      let continuationToken: string | undefined
      do {
        const listing = await client.send(
          new ListObjectsV2Command({ Bucket: bucket.Name, ContinuationToken: continuationToken }),
        )
        for (const object of listing.Contents ?? []) {
          if (!object.Key) continue
          const response = await client.send(
            new GetObjectCommand({ Bucket: bucket.Name, Key: object.Key }),
          )
          const bytes = response.Body ? await response.Body.transformToByteArray() : new Uint8Array()
          if (sentinels.some((sentinel) => Buffer.from(bytes).includes(Buffer.from(sentinel)))) {
            findings.push(`${bucket.Name}/${object.Key}`)
          }
        }
        continuationToken = listing.IsTruncated ? listing.NextContinuationToken : undefined
      } while (continuationToken)
    }
  } finally {
    client.destroy()
  }
  return findings
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`
}

function captureProcessOutput() {
  const output: string[] = []
  const originalStdout = process.stdout.write
  const originalStderr = process.stderr.write
  const silentWrite = ((chunk: unknown) => {
    output.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk as Uint8Array).toString())
    return true
  }) as typeof process.stdout.write
  process.stdout.write = silentWrite
  process.stderr.write = silentWrite as typeof process.stderr.write

  const consoleSpies = [
    vi.spyOn(console, 'debug'),
    vi.spyOn(console, 'info'),
    vi.spyOn(console, 'log'),
    vi.spyOn(console, 'warn'),
    vi.spyOn(console, 'error'),
    vi.spyOn(console, 'trace'),
  ]
  for (const spy of consoleSpies) {
    spy.mockImplementation((...args: unknown[]) => {
      output.push(args.map((argument) => stringifyLogArgument(argument)).join(' '))
    })
  }

  return {
    output,
    restore() {
      process.stdout.write = originalStdout
      process.stderr.write = originalStderr
      for (const spy of consoleSpies) spy.mockRestore()
    },
  }
}

function stringifyLogArgument(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200 })
}

it('não persiste nem registra campos de Detalhes do Google após buscar, salvar, confirmar e recusar', async () => {
  const sqlitePath = join(sqliteDirectory!, 'cliente-google.sqlite')
  const sqlite = new NodeSqlDatabase(sqlitePath)
  const syncClient = await createSyncClient({
    database: sqlite,
    transport: syncTransport('organizer-token'),
    userId: organizerId,
    getTripIds: () => [tripId],
    idGenerator: randomUUID,
  })
  clients.push({ database: sqlite, client: syncClient })
  const captured = captureProcessOutput()

  try {
    const search = await apiRequest(
      `/trips/${tripId}/places/search?q=Museu&attempt=primary&lang=pt`,
      'organizer-token',
    )
    const { candidates } = await jsonResponse<PlaceSearchResponse>(search)
    expect(candidates).toHaveLength(1)
    const placeId = await syncClient.addPlaceFromCandidate(tripId, candidates[0]!)
    await syncClient.syncNow()

    const detailsResponse = await apiRequest(
      `/trips/${tripId}/places/${placeId}/google-details`,
      'organizer-token',
      { method: 'POST' },
    )
    expect(detailsResponse.headers.get('cache-control')).toBe('no-store')
    const details = await jsonResponse<{
      candidateIds: string[]
      current: { googlePlaceId: string; name: string; address: string; type: string; photo: unknown }
    }>(detailsResponse)
    expect(details.current).toMatchObject({
      googlePlaceId,
      name: sentinels[0],
      address: sentinels[1],
      type: sentinels[2],
    })
    expect(details.current.photo).toBeTruthy()

    await syncClient.linkGooglePlace(tripId, placeId, googlePlaceId)
    await syncClient.syncNow()
    const confirmed = await pool.query<{ google_place_id: string; google_match: string }>(
      'SELECT google_place_id, google_match FROM places WHERE id = $1',
      [placeId],
    )
    expect(confirmed.rows).toEqual([{ google_place_id: googlePlaceId, google_match: 'matched' }])

    await syncClient.linkGooglePlace(tripId, placeId, null)
    await syncClient.syncNow()
    const declined = await pool.query<{ google_place_id: string | null; google_match: string }>(
      'SELECT google_place_id, google_match FROM places WHERE id = $1',
      [placeId],
    )
    expect(declined.rows).toEqual([{ google_place_id: null, google_match: 'no_match' }])
  } finally {
    captured.restore()
  }

  const [databaseFindings, sqliteFindings, minioFindings] = await Promise.all([
    scanPostgresTextColumns(),
    scanSqliteFiles(),
    scanMinioObjects(),
  ])
  const logFindings = sentinels.filter((sentinel) => captured.output.some((line) => line.includes(sentinel)))

  expect(databaseFindings).toEqual([])
  expect(sqliteFindings).toEqual([])
  expect(minioFindings).toEqual([])
  expect(logFindings).toEqual([])
}, 60_000)
