import type { PullQuery, PullResponse, PushRequest, PushResponse, SyncTransport } from '@trippy/sync'

export type SyncRequest = (path: string, init?: RequestInit) => Promise<Response>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function readPayload(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    throw new Error('A API de sincronização retornou uma resposta inválida.')
  }
}

async function readSuccess<T>(response: Response): Promise<T> {
  const payload = await readPayload(response)
  if (!response.ok) {
    const message =
      isRecord(payload) && typeof payload.message === 'string'
        ? payload.message
        : 'Não foi possível sincronizar. Tente novamente.'
    throw new Error(message)
  }
  return payload as T
}

function pullPath(query: PullQuery): string {
  const params = new URLSearchParams()
  params.set('trip', query.tripId)
  params.set('limit', String(query.limit))

  if (query.mode === 'incremental') {
    params.set('cursor', query.cursor)
  } else if ('snapshotSeq' in query) {
    params.set('cursor', query.cursor)
    params.set('snapshotSeq', query.snapshotSeq)
  }

  return `/sync/pull?${params.toString()}`
}

export function createSyncTransport(request: SyncRequest): SyncTransport {
  return {
    async push(body: PushRequest): Promise<PushResponse> {
      const response = await request('/sync/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      return readSuccess<PushResponse>(response)
    },

    async pull(query: PullQuery): Promise<PullResponse> {
      const response = await request(pullPath(query), { method: 'GET' })
      const payload = await readPayload(response)

      if (isRecord(payload) && payload.error === 'bootstrap_required') {
        return { error: 'bootstrap_required' }
      }
      if (!response.ok) {
        const message =
          isRecord(payload) && typeof payload.message === 'string'
            ? payload.message
            : 'Não foi possível baixar as atualizações. Tente novamente.'
        throw new Error(message)
      }

      return payload as PullResponse
    },
  }
}
