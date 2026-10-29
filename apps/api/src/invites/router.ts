import { createHash, randomBytes } from 'node:crypto'
import { Hono } from 'hono'
import pg from 'pg'
import { tripPhase, type TripSummary } from '@trippy/domain'
import { PostgresInviteStore, type InviteStore } from '@trippy/adapters/invites'
import type { TripRecord } from '@trippy/adapters/trips'
import { validateAcceptInviteRequest, validateCreateInviteParams } from '@trippy/sync'
import type { AccessTokenVerifier } from '@trippy/adapters/auth'
import type { ApiConfig } from '../config.ts'
import { authenticate, type AuthEnvironment } from '../auth/authenticate.ts'
import { handleApiError } from '../auth/errors.ts'
import { renderInvitePage, renderInviteUnavailablePage } from './page.ts'

type Pool = InstanceType<typeof pg.Pool>

export interface InvitesRouterOptions {
  inviteStore?: InviteStore
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

const htmlSecurityHeaders = {
  'Content-Type': 'text/html; charset=utf-8',
  'Content-Security-Policy':
    "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
  'X-Frame-Options': 'DENY',
}

function summarizeTrip(trip: TripRecord, now: Date): TripSummary {
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

export function createInvitesRouter(
  config: Pick<ApiConfig, 'databaseUrl'>,
  options: InvitesRouterOptions,
) {
  const pool: Pool | undefined = options.inviteStore
    ? undefined
    : new pg.Pool({ connectionString: config.databaseUrl, max: 5 })
  const store = options.inviteStore ?? new PostgresInviteStore(pool!)
  const now = options.now ?? (() => new Date())
  const authenticateRequest = authenticate(options.accessTokenVerifier)
  const router = new Hono<AuthEnvironment>()

  router.post('/trips/:id/invites', authenticateRequest, async (context) => {
    const validation = validateCreateInviteParams({ tripId: context.req.param('id') })
    if (!validation.success) {
      return context.json({ error: 'trip_not_found', message: 'Viagem não encontrada.' }, 404)
    }

    const token = randomBytes(32).toString('base64url')
    const tokenHash = createHash('sha256').update(token).digest('hex')
    const result = await store.createInvite({
      tripId: validation.value.tripId,
      createdBy: context.get('userId'),
      tokenHash,
    })
    if (result === 'not_found') {
      return context.json({ error: 'trip_not_found', message: 'Viagem não encontrada.' }, 404)
    }
    if (result === 'forbidden') {
      return context.json(
        { error: 'forbidden', message: 'Somente organizadores podem criar convites.' },
        403,
      )
    }
    return context.json({ token }, 201)
  })

  router.post('/invites/accept', authenticateRequest, async (context) => {
    const validation = validateAcceptInviteRequest(await readBody(context.req.raw))
    if (!validation.success) {
      return context.json(
        {
          error: 'invalid_invite',
          message: 'Informe um token de convite válido e aceite o aviso do recap.',
        },
        400,
      )
    }

    const tokenHash = createHash('sha256').update(validation.value.token).digest('hex')
    const trip = await store.acceptInvite(
      context.get('userId'),
      tokenHash,
      validation.value.termsVersion,
    )
    if (!trip) {
      return context.json({ error: 'invite_not_found', message: 'Convite não encontrado.' }, 404)
    }
    return context.json({ trip: summarizeTrip(trip, now()) })
  })

  router.get('/i/:codigo', async (context) => {
    const codigo = context.req.param('codigo')
    const tokenHash = createHash('sha256').update(codigo).digest('hex')
    const preview = await store.getInvitePreview(tokenHash)
    if (!preview) {
      return context.body(renderInviteUnavailablePage(), 404, htmlSecurityHeaders)
    }
    return context.body(renderInvitePage(preview, codigo), 200, htmlSecurityHeaders)
  })

  router.onError(handleApiError)

  return {
    router,
    close: async () => {
      if (pool) await pool.end()
    },
  }
}
