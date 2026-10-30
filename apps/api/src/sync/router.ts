import { Hono } from 'hono'
import pg from 'pg'
import {
  validatePullQuery,
  validatePullResponse,
  validatePushRequest,
  validatePushResponse,
} from '@trippy/sync'
import { PostgresSyncStore, type SyncStore } from '@trippy/adapters/sync'
import type { AccessTokenVerifier } from '@trippy/adapters/auth'
import type { ApiConfig } from '../config.ts'
import { authenticate, type AuthEnvironment } from '../auth/authenticate.ts'
import { handleApiError } from '../auth/errors.ts'

type Pool = InstanceType<typeof pg.Pool>

export interface SyncRouterOptions {
  syncStore?: SyncStore
  accessTokenVerifier: AccessTokenVerifier
}

const DEFAULT_PULL_LIMIT = 100
const MAX_PULL_LIMIT = 500
const MAX_PUSH_OPERATIONS = 100

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

export function createSyncRouter(
  config: Pick<ApiConfig, 'databaseUrl' | 'placesCandidateSecret'>,
  options: SyncRouterOptions,
) {
  const pool: Pool | undefined = options.syncStore
    ? undefined
    : new pg.Pool({ connectionString: config.databaseUrl, max: 5 })
  const store = options.syncStore ?? new PostgresSyncStore(pool!, config.placesCandidateSecret)
  const authenticateRequest = authenticate(options.accessTokenVerifier)
  const router = new Hono<AuthEnvironment>()

  router.post('/sync/push', authenticateRequest, async (context) => {
    const body = await readBody(context.req.raw)
    if (
      isRecord(body) &&
      Array.isArray(body.operations) &&
      body.operations.length > MAX_PUSH_OPERATIONS
    ) {
      return context.json(
        {
          error: 'sync_batch_too_large',
          message: `O lote deve ter no máximo ${MAX_PUSH_OPERATIONS} operações.`,
        },
        413,
      )
    }

    const validation = validatePushRequest(body)
    if (!validation.success) {
      return context.json(
        {
          error: 'invalid_sync_request',
          message: 'Confira as operações de sincronização informadas.',
          fields: validation.issues,
        },
        400,
      )
    }

    const results = []
    for (const operation of validation.value.operations) {
      results.push(await store.applyOperation(context.get('userId'), operation))
    }
    const response = validatePushResponse({ results })
    if (!response.success) {
      console.error('[sync] resposta de push inválida', JSON.stringify(response.issues))
      return context.json({ error: 'internal_error', message: 'Erro interno do servidor.' }, 500)
    }
    return context.json(response.value)
  })

  router.get('/sync/pull', authenticateRequest, async (context) => {
    const query = context.req.query()
    const validation = validatePullQuery({
      ...query,
      limit: query.limit ?? String(DEFAULT_PULL_LIMIT),
    })
    if (!validation.success) {
      return context.json(
        {
          error: 'invalid_sync_query',
          message: 'Confira os parâmetros da sincronização.',
          fields: validation.issues,
        },
        400,
      )
    }

    const pullQuery = {
      ...validation.value,
      limit: Math.min(validation.value.limit, MAX_PULL_LIMIT),
    }
    const response = await store.pull(context.get('userId'), pullQuery)
    if (!response) {
      return context.json({ error: 'trip_not_found', message: 'Viagem não encontrada.' }, 404)
    }
    if ('error' in response && response.error === 'not_member') {
      return context.json(
        { error: 'not_member', message: 'Você não faz mais parte desta viagem.' },
        403,
      )
    }
    const validResponse = validatePullResponse(response)
    if (!validResponse.success) {
      console.error('[sync] resposta de pull inválida', JSON.stringify(validResponse.issues))
      return context.json({ error: 'internal_error', message: 'Erro interno do servidor.' }, 500)
    }
    return context.json(validResponse.value)
  })

  router.onError(handleApiError)

  return {
    router,
    close: async () => {
      if (pool) await pool.end()
    },
  }
}
