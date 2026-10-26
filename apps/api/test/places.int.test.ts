import { randomUUID } from 'node:crypto'
import pg from 'pg'

type Pool = InstanceType<typeof pg.Pool>
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { PostgresTripStore } from '@trippy/adapters/trips'
import {
  PostgresPlacesUsageStore,
  type PlacesUsageStore,
} from '@trippy/adapters/places/usage-store'
import type { GooglePlacesProvider, PlacesProvider } from '@trippy/adapters/places/provider'
import { PlacesProviderError } from '@trippy/adapters/places/provider'
import type { GoogleDetailsResponse, PlaceSearchCandidateFields } from '@trippy/domain/places'
import { migrate } from '../../../packages/db/src/migrate.ts'
import { createApp } from '../src/app.ts'
import { createPlacesRouter } from '../src/places/router.ts'
import type { HealthChecks } from '../src/health.ts'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL não definido: configure o Postgres local')

const testDatabaseName = `trippy_api_places_${process.pid}_${randomUUID().replaceAll('-', '').slice(0, 12)}`
const adminUrl = new URL(databaseUrl)
adminUrl.pathname = '/postgres'
const testDatabaseUrl = new URL(databaseUrl)
testDatabaseUrl.pathname = `/${testDatabaseName}`
const candidateSecret = 'segredo-de-candidato-integração-com-entropia-suficiente'
const tokenUsers = new Map<string, string>()
const users = new Map<string, string>()
const healthyChecks: HealthChecks = {
  postgres: async () => {},
  storage: async () => {},
  queue: async () => {},
  mail: async () => {},
}

let databaseCreated = false
let pool: Pool
let tripStore: PostgresTripStore
let organizerId: string
let memberId: string
let outsiderId: string

const candidateFields: PlaceSearchCandidateFields = {
  provider: 'geoapify',
  providerRef: 'geoapify-test-id',
  name: 'Museu de teste',
  localName: 'Museu de teste',
  address: 'Praça de teste, Lisboa',
  localAddress: null,
  lat: 38.7223,
  lng: -9.1393,
  countryCode: 'pt',
  datasource: 'dataset-de-teste',
  attribution: 'Atribuição de teste',
  license: 'Licença de teste',
  method: 'geocoding',
}

const googleDetails: GoogleDetailsResponse = {
  candidateIds: ['google-place-1', 'google-place-2'],
  current: {
    googlePlaceId: 'google-place-1',
    name: 'Nome Google de teste',
    type: 'Tipo Google de teste',
    address: 'Endereço Google de teste',
    photo: null,
    googleMapsUri: 'https://maps.google.test/lugar',
  },
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
  tripStore = new PostgresTripStore(pool)
  const createdUsers = await pool.query<{ id: string }>(
    'INSERT INTO users (email) VALUES ($1), ($2), ($3) RETURNING id',
    [
      `places-owner-${randomUUID()}@example.test`,
      `places-member-${randomUUID()}@example.test`,
      `places-outsider-${randomUUID()}@example.test`,
    ],
  )
  organizerId = createdUsers.rows[0]!.id
  memberId = createdUsers.rows[1]!.id
  outsiderId = createdUsers.rows[2]!.id
  users.set('organizer-token', organizerId)
  users.set('member-token', memberId)
  users.set('outsider-token', outsiderId)
  for (const [token, userId] of users) tokenUsers.set(token, userId)
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

async function createTrip(ownerId = organizerId): Promise<string> {
  const trip = await tripStore.createTrip({
    organizerId: ownerId,
    name: `Viagem de teste ${randomUUID()}`,
    destination: 'Lisboa',
    startDate: '2026-11-01',
    endDate: '2026-11-05',
    timezone: 'Europe/Lisbon',
  })
  return trip.id
}

async function addMember(tripId: string, userId = memberId): Promise<void> {
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

async function addPlace(
  tripId: string,
  options: { provider?: string | null; lat?: number | null; lng?: number | null } = {},
): Promise<string> {
  const placeId = randomUUID()
  await pool.query(
    `INSERT INTO places (
       id, trip_id, provider, provider_ref, name, lat, lng, suggested_by, seq
     ) VALUES ($1, $2, $3, 'geoapify-ref', 'Nome salvo da Geoapify', $4, $5, $6, 900)`,
    [
      placeId,
      tripId,
      options.provider === undefined ? 'geoapify' : options.provider,
      options.lat === undefined ? 38.7223 : options.lat,
      options.lng === undefined ? -9.1393 : options.lng,
      organizerId,
    ],
  )
  return placeId
}

function createTestApp(
  options: {
    geoapifyApiKey?: string
    googlePlacesApiKey?: string
    placesProvider?: PlacesProvider
    googleProvider?: GooglePlacesProvider
    searchUserLimit?: number
    searchTripLimit?: number
    detailsUserLimit?: number
    detailsTripLimit?: number
    now?: Date
    usageStore?: PlacesUsageStore
  } = {},
) {
  const router = createPlacesRouter(
    {
      databaseUrl: testDatabaseUrl.toString(),
      placesCandidateSecret: candidateSecret,
      ...(options.geoapifyApiKey ? { geoapifyApiKey: options.geoapifyApiKey } : {}),
      ...(options.googlePlacesApiKey ? { googlePlacesApiKey: options.googlePlacesApiKey } : {}),
      placesSearchUserDailyLimit: options.searchUserLimit ?? 200,
      placesSearchTripDailyLimit: options.searchTripLimit ?? 1_000,
      placesGoogleDetailsUserDailyLimit: options.detailsUserLimit ?? 30,
      placesGoogleDetailsTripDailyLimit: options.detailsTripLimit ?? 150,
      placesGoogleRestrictionRadiusMeters: 1_000,
    },
    {
      pool,
      tripStore,
      accessTokenVerifier: async (token) => {
        const userId = tokenUsers.get(token)
        if (!userId) throw new Error('Token inválido')
        return { userId }
      },
      ...(options.placesProvider ? { placesProvider: options.placesProvider } : {}),
      ...(options.googleProvider ? { googleProvider: options.googleProvider } : {}),
      ...(options.usageStore ? { usageStore: options.usageStore } : {}),
      now: () => options.now ?? new Date(),
    },
  )
  return createApp(healthyChecks, 1_000, undefined, undefined, undefined, undefined, router.router)
}

function providerWithCalls(
  candidates: PlaceSearchCandidateFields[] = [candidateFields],
): PlacesProvider {
  return {
    search: vi.fn(async (_input, onProviderCall) => {
      await onProviderCall?.({
        provider: 'geoapify',
        sku: 'geocoding',
        status: '200',
        latencyMs: 5,
      })
      return candidates
    }),
  }
}

function googleProviderWithCalls(
  onDetails?: (name: string, lat: number, lng: number) => void,
): GooglePlacesProvider {
  return {
    async getDetails(input, onProviderCall) {
      onDetails?.(input.name, input.lat, input.lng)
      await onProviderCall?.({
        provider: 'google',
        sku: 'text_search_ids_only',
        status: '200',
        latencyMs: 5,
      })
      await onProviderCall?.({
        provider: 'google',
        sku: 'place_details_pro',
        status: '200',
        latencyMs: 6,
      })
      return googleDetails
    },
  }
}

async function get(
  app: ReturnType<typeof createApp>,
  path: string,
  token = 'organizer-token',
): Promise<Response> {
  return app.request(path, { headers: { authorization: `Bearer ${token}` } })
}

async function post(
  app: ReturnType<typeof createApp>,
  path: string,
  body?: unknown,
  token = 'organizer-token',
): Promise<Response> {
  return app.request(path, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

it('exige autenticação e oculta a viagem de não membros', async () => {
  const tripId = await createTrip()
  const provider = { search: vi.fn(async () => [candidateFields]) }
  const app = createTestApp({ geoapifyApiKey: 'geo-key', placesProvider: provider })

  const unauthenticated = await app.request(
    `/trips/${tripId}/places/search?q=Museu&attempt=primary`,
  )
  const outsider = await get(
    app,
    `/trips/${tripId}/places/search?q=Museu&attempt=primary`,
    'outsider-token',
  )

  expect(unauthenticated.status).toBe(401)
  expect(outsider.status).toBe(404)
  expect(provider.search).not.toHaveBeenCalled()
})

it('busca a tentativa pedida, assina cada candidato e registra chamadas Geoapify', async () => {
  const tripId = await createTrip()
  const provider: PlacesProvider = {
    async search(input, onProviderCall) {
      expect(input).toMatchObject({
        query: 'Museu',
        attempt: 'secondary',
        lang: 'pt',
        destination: 'Lisboa',
      })
      await onProviderCall?.({ provider: 'geoapify', sku: 'places', status: '200', latencyMs: 8 })
      return [{ ...candidateFields, method: 'places' }]
    },
  }
  const app = createTestApp({ geoapifyApiKey: 'geo-key', placesProvider: provider })

  const response = await get(
    app,
    `/trips/${tripId}/places/search?q=Museu&attempt=secondary&lang=pt`,
  )
  const result = (await response.json()) as {
    candidates: Array<PlaceSearchCandidateFields & { token: string }>
  }

  expect(response.status).toBe(200)
  expect(result.candidates).toHaveLength(1)
  expect(result.candidates[0]).toMatchObject({ method: 'places', token: expect.any(String) })
  const { token, ...fields } = result.candidates[0]!
  const { verifyPlaceSearchCandidate } = await import('@trippy/adapters/places')
  expect(verifyPlaceSearchCandidate({ ...fields, token }, candidateSecret)).toBe(true)
  const logged = await pool.query(
    'SELECT provider, sku, status, latency_ms FROM places_provider_calls WHERE trip_id = $1',
    [tripId],
  )
  expect(logged.rows).toEqual([
    { provider: 'geoapify', sku: 'places', status: '200', latency_ms: 8 },
  ])
})

it('respeita idioma do Accept-Language e deixa o provider aplicar o padrão sem idioma', async () => {
  const tripId = await createTrip()
  const languages: Array<string | undefined> = []
  const provider: PlacesProvider = {
    async search(input) {
      languages.push(input.lang)
      return []
    },
  }
  const app = createTestApp({ geoapifyApiKey: 'geo-key', placesProvider: provider })

  const regional = await app.request(`/trips/${tripId}/places/search?q=Museu&attempt=primary`, {
    headers: { authorization: 'Bearer organizer-token', 'accept-language': 'pt-BR,pt;q=0.9' },
  })
  const noLanguage = await app.request(`/trips/${tripId}/places/search?q=Museu&attempt=primary`, {
    headers: { authorization: 'Bearer organizer-token', 'accept-language': '*' },
  })

  expect(regional.status).toBe(200)
  expect(noLanguage.status).toBe(200)
  expect(languages).toEqual(['pt', undefined])
})

it('retorna 503 sem chave Geoapify ou Google', async () => {
  const tripId = await createTrip()
  const placeId = await addPlace(tripId)
  const provider = { search: vi.fn(async () => [candidateFields]) }
  const google = { getDetails: vi.fn(async () => googleDetails) }
  const app = createTestApp({ placesProvider: provider, googleProvider: google })

  const search = await get(app, `/trips/${tripId}/places/search?q=Museu&attempt=primary`)
  const details = await post(app, `/trips/${tripId}/places/${placeId}/google-details`)

  expect(search.status).toBe(503)
  expect(await search.json()).toMatchObject({ error: 'provider_unavailable' })
  expect(details.status).toBe(503)
  expect(await details.json()).toMatchObject({ error: 'provider_unavailable' })
  expect(provider.search).not.toHaveBeenCalled()
  expect(google.getDetails).not.toHaveBeenCalled()
})

it('retorna 422 para lugar sem coordenadas ou sem fornecedor Geoapify', async () => {
  const tripId = await createTrip()
  const noCoordinates = await addPlace(tripId, { lat: null, lng: null })
  const otherProvider = await addPlace(tripId, { provider: 'manual' })
  const google = { getDetails: vi.fn(async () => googleDetails) }
  const app = createTestApp({ googlePlacesApiKey: 'google-key', googleProvider: google })

  const missing = await post(app, `/trips/${tripId}/places/${noCoordinates}/google-details`)
  const providerMismatch = await post(
    app,
    `/trips/${tripId}/places/${otherProvider}/google-details`,
  )

  expect(missing.status).toBe(422)
  expect(providerMismatch.status).toBe(422)
  expect(google.getDetails).not.toHaveBeenCalled()
})

it('carrega coordenadas e nome do banco, responde no-store e deduplica toque concorrente', async () => {
  const tripId = await createTrip()
  const placeId = await addPlace(tripId)
  let started!: () => void
  let release!: () => void
  const providerStarted = new Promise<void>((resolve) => {
    started = resolve
  })
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const received: Array<{ name: string; lat: number; lng: number }> = []
  let detailsUsageCount = 0
  let resolveSecondUsage!: () => void
  const secondUsage = new Promise<void>((resolve) => {
    resolveSecondUsage = resolve
  })
  const postgresUsageStore = new PostgresPlacesUsageStore(pool)
  const usageStore: PlacesUsageStore = {
    async consume(input) {
      const result = await postgresUsageStore.consume(input)
      if (input.usageType === 'google_details' && ++detailsUsageCount === 2) resolveSecondUsage()
      return result
    },
    recordCall: (input) => postgresUsageStore.recordCall(input),
  }
  const google: GooglePlacesProvider = {
    async getDetails(input, onProviderCall) {
      received.push({ name: input.name, lat: input.lat, lng: input.lng })
      started()
      await gate
      await onProviderCall?.({
        provider: 'google',
        sku: 'text_search_ids_only',
        status: '200',
        latencyMs: 4,
      })
      return googleDetails
    },
  }
  const app = createTestApp({
    googlePlacesApiKey: 'google-key',
    googleProvider: google,
    usageStore,
  })
  const path = `/trips/${tripId}/places/${placeId}/google-details`
  const first = post(app, path)
  await providerStarted
  const second = post(app, path)
  await secondUsage
  await new Promise<void>((resolve) => setImmediate(resolve))
  release()
  const [firstResponse, secondResponse] = await Promise.all([first, second])

  expect(firstResponse.status).toBe(200)
  expect(secondResponse.status).toBe(200)
  expect(firstResponse.headers.get('cache-control')).toBe('no-store')
  expect(received).toEqual([{ name: 'Nome salvo da Geoapify', lat: 38.7223, lng: -9.1393 }])
  expect(await firstResponse.json()).toMatchObject({ current: googleDetails.current })
  const calls = await pool.query(
    'SELECT provider, sku, status, latency_ms, touch_id FROM places_provider_calls WHERE trip_id = $1',
    [tripId],
  )
  expect(calls.rows).toHaveLength(1)
  expect(calls.rows[0]).toMatchObject({
    provider: 'google',
    sku: 'text_search_ids_only',
    status: '200',
    latency_ms: 4,
  })
})

it('mantém no-store quando a busca de Detalhes do Google falha', async () => {
  const tripId = await createTrip()
  const placeId = await addPlace(tripId)
  const google: GooglePlacesProvider = {
    async getDetails() {
      throw new PlacesProviderError('provider_error')
    },
  }
  const app = createTestApp({ googlePlacesApiKey: 'google-key', googleProvider: google })

  const response = await post(app, `/trips/${tripId}/places/${placeId}/google-details`)

  expect(response.status).toBe(502)
  expect(response.headers.get('cache-control')).toBe('no-store')
})

it('aplica limites diários por usuário e por viagem com mensagem em português', async () => {
  const tripId = await createTrip()
  await addMember(tripId)
  const provider = providerWithCalls()
  const app = createTestApp({
    geoapifyApiKey: 'geo-key',
    placesProvider: provider,
    searchUserLimit: 1,
    searchTripLimit: 2,
    now: new Date('2099-01-01T18:00:00.000Z'),
  })
  const path = `/trips/${tripId}/places/search?q=Museu&attempt=primary`

  expect((await get(app, path, 'organizer-token')).status).toBe(200)
  const userLimit = await get(app, path, 'organizer-token')
  expect(userLimit.status).toBe(429)
  expect(await userLimit.json()).toMatchObject({
    error: 'rate_limited',
    message: expect.stringMatching(/limite diário/i),
  })
  expect((await get(app, path, 'member-token')).status).toBe(200)
  const tripLimit = await get(app, path, 'member-token')
  expect(tripLimit.status).toBe(429)
  expect(await tripLimit.json()).toMatchObject({ error: 'rate_limited' })
  expect(provider.search).toHaveBeenCalledTimes(2)
})

it('conta cada toque de Detalhes do Google dentro da janela UTC diária', async () => {
  const tripId = await createTrip()
  const placeId = await addPlace(tripId)
  const google = googleProviderWithCalls()
  const app = createTestApp({
    googlePlacesApiKey: 'google-key',
    googleProvider: google,
    detailsUserLimit: 1,
    detailsTripLimit: 5,
    now: new Date('2099-01-02T23:59:59.000Z'),
  })
  const path = `/trips/${tripId}/places/${placeId}/google-details`

  expect((await post(app, path)).status).toBe(200)
  const limited = await post(app, path)
  expect(limited.status).toBe(429)
  expect(await limited.json()).toMatchObject({
    error: 'rate_limited',
    message: expect.stringMatching(/limite diário/i),
  })
})
