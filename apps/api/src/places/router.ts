import { randomUUID } from 'node:crypto'
import { Hono } from 'hono'
import pg, { type Pool } from 'pg'
import { signPlaceSearchCandidate } from '@trippy/adapters/places'
import { GeoapifyPlacesProvider } from '@trippy/adapters/places/geoapify'
import { GooglePlacesProvider as GooglePlacesHttpProvider } from '@trippy/adapters/places/google'
import type {
  GooglePlacesProvider as GooglePlacesProviderPort,
  PlacesProvider,
} from '@trippy/adapters/places/provider'
import { PlacesProviderError } from '@trippy/adapters/places/provider'
import { PostgresPlacesUsageStore, type PlacesUsageStore } from '@trippy/adapters/places/usage-store'
import { SingleFlight } from '@trippy/adapters/places/single-flight'
import { PostgresTripStore, type TripStore } from '@trippy/adapters/trips'
import type { ApiConfig } from '../config.ts'
import { authenticate, type AuthEnvironment } from '../auth/authenticate.ts'
import { handleApiError } from '../auth/errors.ts'

type PlacesRouterConfig = Pick<
  ApiConfig,
  | 'databaseUrl'
  | 'placesCandidateSecret'
  | 'geoapifyApiKey'
  | 'googlePlacesApiKey'
  | 'placesSearchUserDailyLimit'
  | 'placesSearchTripDailyLimit'
  | 'placesGoogleDetailsUserDailyLimit'
  | 'placesGoogleDetailsTripDailyLimit'
  | 'placesGoogleRestrictionRadiusMeters'
  | 'placesGeoapifySearchRadiusMeters'
>

export interface PlacesRouterOptions {
  accessTokenVerifier: Parameters<typeof authenticate>[0]
  pool?: Pool
  tripStore?: TripStore
  usageStore?: PlacesUsageStore
  placesProvider?: PlacesProvider
  googleProvider?: GooglePlacesProviderPort
  now?: () => Date
}

interface SavedPlace {
  id: string
  provider: string | null
  name: string
  lat: number | null
  lng: number | null
}

const tripIdPattern = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/iu
const placeIdPattern = tripIdPattern
const MAX_QUERY_LENGTH = 120

export function createPlacesRouter(config: PlacesRouterConfig, options: PlacesRouterOptions) {
  const pool = options.pool ?? new pg.Pool({ connectionString: config.databaseUrl, max: 5 })
  const tripStore = options.tripStore ?? new PostgresTripStore(pool)
  const usageStore =
    options.usageStore ?? new PostgresPlacesUsageStore(pool, options.now ?? (() => new Date()))
  const placesProvider =
    options.placesProvider ??
    (config.geoapifyApiKey
      ? new GeoapifyPlacesProvider(config.geoapifyApiKey, {
          searchRadiusMeters: config.placesGeoapifySearchRadiusMeters ?? 50_000,
        })
      : undefined)
  const googleProvider =
    options.googleProvider ??
    (config.googlePlacesApiKey
      ? new GooglePlacesHttpProvider(config.googlePlacesApiKey, {
          restrictionRadiusMeters: config.placesGoogleRestrictionRadiusMeters ?? 1_000,
        })
      : undefined)
  const authenticateRequest = authenticate(options.accessTokenVerifier)
  const singleFlight = new SingleFlight()
  const router = new Hono<AuthEnvironment>()

  router.get('/trips/:tripId/places/search', authenticateRequest, async (context) => {
    const tripId = context.req.param('tripId')
    if (!tripIdPattern.test(tripId)) {
      return context.json({ error: 'trip_not_found', message: 'Viagem não encontrada.' }, 404)
    }
    const trip = await tripStore.getTripForMember(context.get('userId'), tripId)
    if (!trip) {
      return context.json({ error: 'trip_not_found', message: 'Viagem não encontrada.' }, 404)
    }

    const query = context.req.query('q')?.trim()
    const attempt = context.req.query('attempt')
    if (
      !query ||
      query.length < 2 ||
      query.length > MAX_QUERY_LENGTH ||
      (attempt !== 'primary' && attempt !== 'secondary')
    ) {
      return context.json(
        {
          error: 'invalid_search',
          message: `Informe um termo de 2 a ${MAX_QUERY_LENGTH} caracteres e uma tentativa válida.`,
        },
        400,
      )
    }
    const language = requestedLanguage(context.req.query('lang'), context.req.header('accept-language'))
    if (language === null) {
      return context.json({ error: 'invalid_search', message: 'O idioma informado é inválido.' }, 400)
    }
    if (!config.geoapifyApiKey || !placesProvider) {
      return context.json(
        { error: 'provider_unavailable', message: 'A busca de lugares está indisponível.' },
        503,
      )
    }

    const userId = context.get('userId')
    const usage = await usageStore.consume({
      userId,
      tripId,
      provider: 'geoapify',
      usageType: 'search',
      userDailyLimit: config.placesSearchUserDailyLimit ?? 200,
      tripDailyLimit: config.placesSearchTripDailyLimit ?? 1_000,
    })
    if (!usage.allowed) {
      const message =
        usage.exceeded === 'user'
          ? 'Você atingiu o limite diário de buscas de lugares da sua conta.'
          : 'Esta viagem atingiu o limite diário de buscas de lugares.'
      return context.json({ error: 'rate_limited', message }, 429)
    }

    const touchId = randomUUID()
    try {
      const candidates = await placesProvider.search(
        { query, destination: trip.destination, attempt, ...(language ? { lang: language } : {}) },
        (call) => usageStore.recordCall({ userId, tripId, placeId: null, touchId, call }),
      )
      return context.json({
        candidates: candidates.slice(0, 5).map((candidate) =>
          signPlaceSearchCandidate(candidate, config.placesCandidateSecret),
        ),
      })
    } catch (error) {
      if (error instanceof PlacesProviderError) return providerErrorResponse(context, error)
      throw error
    }
  })

  router.post(
    '/trips/:tripId/places/:placeId/google-details',
    authenticateRequest,
    async (context) => {
      context.header('Cache-Control', 'no-store')
      const tripId = context.req.param('tripId')
      const placeId = context.req.param('placeId')
      if (!tripIdPattern.test(tripId)) {
        return context.json({ error: 'trip_not_found', message: 'Viagem não encontrada.' }, 404)
      }
      if (!placeIdPattern.test(placeId)) {
        return context.json({ error: 'place_not_found', message: 'Lugar não encontrado.' }, 404)
      }
      const trip = await tripStore.getTripForMember(context.get('userId'), tripId)
      if (!trip) {
        return context.json({ error: 'trip_not_found', message: 'Viagem não encontrada.' }, 404)
      }

      const savedPlace = await findPlace(pool, tripId, placeId)
      if (!savedPlace) {
        return context.json({ error: 'place_not_found', message: 'Lugar não encontrado.' }, 404)
      }
      if (
        savedPlace.provider !== 'geoapify' ||
        savedPlace.lat === null ||
        savedPlace.lng === null
      ) {
        return context.json(
          {
            error: 'place_location_unavailable',
            message: 'Este lugar não tem coordenadas Geoapify para buscar no Google.',
          },
          422,
        )
      }

      const body = await readOptionalBody(context.req.raw)
      if (!body.valid) {
        return context.json(
          { error: 'invalid_google_place', message: 'O candidato Google informado é inválido.' },
          400,
        )
      }
      if (!config.googlePlacesApiKey || !googleProvider) {
        return context.json(
          { error: 'provider_unavailable', message: 'Detalhes do Google estão indisponíveis.' },
          503,
        )
      }

      const userId = context.get('userId')
      const usage = await usageStore.consume({
        userId,
        tripId,
        provider: 'google',
        usageType: 'google_details',
        userDailyLimit: config.placesGoogleDetailsUserDailyLimit ?? 30,
        tripDailyLimit: config.placesGoogleDetailsTripDailyLimit ?? 150,
      })
      if (!usage.allowed) {
        const message =
          usage.exceeded === 'user'
            ? 'Você atingiu o limite diário de Detalhes do Google da sua conta.'
            : 'Esta viagem atingiu o limite diário de Detalhes do Google.'
        return context.json({ error: 'rate_limited', message }, 429)
      }

      const touchId = randomUUID()
      const googlePlaceId = body.googlePlaceId
      const flightKey = `${placeId}:${googlePlaceId ?? 'primeiro-candidato'}`
      try {
        const details = await singleFlight.run(flightKey, () =>
          googleProvider.getDetails(
            {
              name: savedPlace.name,
              lat: savedPlace.lat!,
              lng: savedPlace.lng!,
              ...(googlePlaceId ? { googlePlaceId } : {}),
            },
            (call) => usageStore.recordCall({ userId, tripId, placeId, touchId, call }),
          ),
        )
        return context.json(details)
      } catch (error) {
        if (error instanceof PlacesProviderError) return providerErrorResponse(context, error)
        throw error
      }
    },
  )

  router.onError(handleApiError)
  return {
    router,
    close: async () => {
      if (!options.pool) await pool.end()
    },
  }
}

async function findPlace(pool: Pool, tripId: string, placeId: string): Promise<SavedPlace | null> {
  const result = await pool.query<SavedPlace>(
    `SELECT id, provider, name, lat, lng
     FROM places
     WHERE trip_id = $1 AND id = $2 AND deleted_at IS NULL`,
    [tripId, placeId],
  )
  return result.rows[0] ?? null
}

function requestedLanguage(
  queryLanguage: string | undefined,
  acceptLanguage: string | undefined,
): string | undefined | null {
  if (queryLanguage !== undefined) {
    return /^[a-z]{2}$/iu.test(queryLanguage) ? queryLanguage.toLowerCase() : null
  }
  const firstLanguage = acceptLanguage?.split(',')[0]?.split(';')[0]?.trim().split(/[-_]/u)[0]
  return firstLanguage && /^[a-z]{2}$/iu.test(firstLanguage) ? firstLanguage.toLowerCase() : undefined
}

async function readOptionalBody(
  request: Request,
): Promise<{ valid: true; googlePlaceId?: string } | { valid: false }> {
  let text: string
  try {
    text = await request.text()
  } catch {
    return { valid: false }
  }
  if (!text.trim()) return { valid: true }

  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return { valid: false }
  }
  if (!isRecord(value)) return { valid: false }
  if (value.googlePlaceId === undefined) return { valid: true }
  if (
    typeof value.googlePlaceId !== 'string' ||
    value.googlePlaceId.length === 0 ||
    value.googlePlaceId.length > 255 ||
    /\s/u.test(value.googlePlaceId)
  ) {
    return { valid: false }
  }
  return { valid: true, googlePlaceId: value.googlePlaceId }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function providerErrorResponse(context: Parameters<typeof handleApiError>[1], error: PlacesProviderError) {
  switch (error.kind) {
    case 'location_unavailable':
      return context.json(
        { error: 'destination_unavailable', message: 'Não foi possível localizar o destino da viagem.' },
        422,
      )
    case 'google_place_not_found':
      return context.json(
        { error: 'google_place_not_found', message: 'Nenhum lugar correspondente foi encontrado no Google.' },
        404,
      )
    case 'invalid_google_place':
      return context.json(
        { error: 'invalid_google_place', message: 'O candidato Google não pertence a esta busca.' },
        400,
      )
    case 'provider_timeout':
      return context.json(
        { error: 'provider_timeout', message: 'O fornecedor de lugares demorou para responder.' },
        504,
      )
    case 'provider_error':
      return context.json(
        { error: 'provider_error', message: 'O fornecedor de lugares falhou nesta tentativa.' },
        502,
      )
  }
}
