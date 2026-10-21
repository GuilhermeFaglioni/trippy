import { useMemo } from 'react'

import { useSession } from '../auth/session-provider'

export type TripPhase = 'planning' | 'traveling' | 'ended'

export type TripRole = 'organizer' | 'coorganizer' | 'member'

export type TripSummary = {
  id: string
  name: string
  destination: string
  startDate: string
  endDate: string
  timezone: string
  role: TripRole
  phase: TripPhase
  createdAt: string
}

export type CreateTripInput = Pick<
  TripSummary,
  'name' | 'destination' | 'startDate' | 'endDate' | 'timezone'
>

export type TripsRequest = (path: string, init?: RequestInit) => Promise<Response>

export type TripsClient = {
  listTrips(): Promise<TripSummary[]>
  createTrip(input: CreateTripInput): Promise<TripSummary>
}

type ApiErrorPayload = {
  error?: unknown
  message?: unknown
  fields?: unknown
}

export class TripsApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields?: unknown,
  ) {
    super(message)
    this.name = 'TripsApiError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isTripSummary(value: unknown): value is TripSummary {
  if (!isRecord(value)) return false

  return (
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.destination === 'string' &&
    typeof value.startDate === 'string' &&
    typeof value.endDate === 'string' &&
    typeof value.timezone === 'string' &&
    (value.role === 'organizer' || value.role === 'coorganizer' || value.role === 'member') &&
    (value.phase === 'planning' || value.phase === 'traveling' || value.phase === 'ended') &&
    typeof value.createdAt === 'string'
  )
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return undefined
  }
}

function createApiError(response: Response, payload: unknown): TripsApiError {
  const body = isRecord(payload) ? (payload as ApiErrorPayload) : undefined
  const code = typeof body?.error === 'string' ? body.error : 'unexpected_error'
  const message =
    typeof body?.message === 'string' && body.message.trim()
      ? body.message.trim()
      : 'Não foi possível concluir a solicitação. Tente novamente.'

  return new TripsApiError(response.status, code, message, body?.fields)
}

function invalidResponse(): TripsApiError {
  return new TripsApiError(
    502,
    'unexpected_error',
    'O servidor retornou uma resposta inválida. Tente novamente.',
  )
}

export function createTripsClient(request: TripsRequest): TripsClient {
  return {
    async listTrips() {
      const response = await request('/trips')
      const payload = await readJson(response)

      if (!response.ok) throw createApiError(response, payload)
      if (
        !isRecord(payload) ||
        !Array.isArray(payload.trips) ||
        !payload.trips.every(isTripSummary)
      ) {
        throw invalidResponse()
      }

      return payload.trips
    },
    async createTrip(input) {
      const response = await request('/trips', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
      const payload = await readJson(response)

      if (!response.ok) throw createApiError(response, payload)
      if (!isRecord(payload) || !isTripSummary(payload.trip)) throw invalidResponse()

      return payload.trip
    },
  }
}

export function useTripsClient(): TripsClient {
  const { request } = useSession()

  return useMemo(() => createTripsClient(request), [request])
}

export function getTripsErrorMessage(error: unknown): string {
  if (error instanceof TripsApiError) return error.message
  if (error instanceof Error && error.message.trim()) return error.message
  return 'Não foi possível conectar. Confira sua internet e tente novamente.'
}
