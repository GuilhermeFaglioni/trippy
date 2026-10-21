import { isTripSummary, type TripSummary } from '../trips/trips-client'

export type InviteRequest = (path: string, init?: RequestInit) => Promise<Response>

export type InviteClient = {
  create(tripId: string): Promise<string>
  accept(token: string): Promise<TripSummary>
}

type ErrorPayload = { error?: unknown; message?: unknown }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return undefined
  }
}

function errorFrom(response: Response, payload: unknown): Error {
  const body = isRecord(payload) ? (payload as ErrorPayload) : undefined
  if (typeof body?.message === 'string' && body.message.trim()) {
    return new Error(body.message.trim())
  }
  return new Error(
    response.status === 404
      ? 'Este convite não existe ou foi revogado.'
      : 'Não foi possível concluir o convite. Tente novamente.',
  )
}

export function createInviteClient(request: InviteRequest): InviteClient {
  return {
    async create(tripId) {
      const response = await request(`/trips/${encodeURIComponent(tripId)}/invites`, {
        method: 'POST',
      })
      const payload = await readJson(response)
      if (!response.ok) throw errorFrom(response, payload)
      if (!isRecord(payload) || typeof payload.token !== 'string' || !payload.token.trim()) {
        throw new Error('A API retornou um código de convite inválido.')
      }
      return payload.token
    },

    async accept(token) {
      const normalizedToken = token.trim()
      if (!normalizedToken) throw new Error('Cole o código do convite.')
      const response = await request('/invites/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: normalizedToken }),
      })
      const payload = await readJson(response)
      if (!response.ok) throw errorFrom(response, payload)
      if (!isRecord(payload) || !isTripSummary(payload.trip)) {
        throw new Error('A API retornou uma viagem inválida para este convite.')
      }
      return payload.trip
    },
  }
}

export function getInviteErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message
  return 'Não foi possível concluir o convite. Tente novamente.'
}
