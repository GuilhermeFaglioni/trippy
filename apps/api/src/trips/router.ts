import { Hono } from 'hono'
import pg from 'pg'
import { tripPhase, validateCreateTripInput, type TripSummary } from '@trippy/domain'
import { PostgresTripStore, type TripStore } from '@trippy/adapters/trips'
import type { AccessTokenVerifier } from '@trippy/adapters/auth'
import type { ApiConfig } from '../config.ts'
import { authenticate, type AuthEnvironment } from '../auth/authenticate.ts'
import { handleApiError } from '../auth/errors.ts'

type Pool = InstanceType<typeof pg.Pool>

export interface TripsRouterOptions {
  tripStore?: TripStore
  accessTokenVerifier: AccessTokenVerifier
  now?: () => Date
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function readBody(request: Request): Promise<unknown> {
  try {
    const value: unknown = await request.json()
    return isRecord(value) ? value : null
  } catch {
    return null
  }
}

function summarizeTrip(
  trip: Awaited<ReturnType<TripStore['getTripForMember']>> & {},
  now: Date,
): TripSummary {
  return {
    id: trip.id,
    name: trip.name,
    destination: trip.destination,
    startDate: trip.startDate,
    endDate: trip.endDate,
    timezone: trip.timezone,
    role: trip.role,
    phase: tripPhase(trip, now),
    createdAt: trip.createdAt.toISOString(),
  }
}

const tripIdPattern = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/iu

export function createTripsRouter(
  config: Pick<ApiConfig, 'databaseUrl'>,
  options: TripsRouterOptions,
) {
  const pool: Pool | undefined = options.tripStore
    ? undefined
    : new pg.Pool({ connectionString: config.databaseUrl, max: 5 })
  const store = options.tripStore ?? new PostgresTripStore(pool!)
  const now = options.now ?? (() => new Date())
  const authenticateRequest = authenticate(options.accessTokenVerifier)
  const router = new Hono<AuthEnvironment>()

  router.post('/trips', authenticateRequest, async (context) => {
    const validation = validateCreateTripInput(await readBody(context.req.raw))
    if (!validation.success) {
      return context.json(
        {
          error: 'invalid_trip',
          message: 'Confira os dados informados para a viagem.',
          fields: validation.fields,
        },
        400,
      )
    }

    const trip = await store.createTrip({
      ...validation.value,
      organizerId: context.get('userId'),
    })
    return context.json({ trip: summarizeTrip(trip, now()) }, 201)
  })

  router.get('/trips', authenticateRequest, async (context) => {
    const trips = await store.listTripsForUser(context.get('userId'))
    return context.json({ trips: trips.map((trip) => summarizeTrip(trip, now())) })
  })

  router.get('/trips/:id', authenticateRequest, async (context) => {
    const id = context.req.param('id')
    if (!tripIdPattern.test(id)) {
      return context.json({ error: 'trip_not_found', message: 'Viagem não encontrada.' }, 404)
    }

    const trip = await store.getTripForMember(context.get('userId'), id)
    if (!trip) {
      return context.json({ error: 'trip_not_found', message: 'Viagem não encontrada.' }, 404)
    }
    return context.json({ trip: summarizeTrip(trip, now()) })
  })

  router.onError(handleApiError)

  return {
    router,
    close: async () => {
      if (pool) await pool.end()
    },
  }
}
