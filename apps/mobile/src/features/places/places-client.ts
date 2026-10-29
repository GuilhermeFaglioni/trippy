import { useMemo } from 'react'
import type {
  GoogleDetailsResponse,
  PlaceSearchCandidate,
  PlaceSearchResponse,
} from '@trippy/domain'

import { useSession } from '../auth/session-provider'

export type PlacesRequest = (path: string, init?: RequestInit) => Promise<Response>
export type SearchAttempt = 'primary' | 'secondary'

export type PlacesClient = {
  search(tripId: string, query: string, attempt: SearchAttempt): Promise<PlaceSearchResponse>
  nearby(tripId: string, lat: number, lng: number): Promise<PlaceSearchResponse>
  googleDetails(
    tripId: string,
    placeId: string,
    googlePlaceId?: string,
  ): Promise<GoogleDetailsResponse>
}

type ApiErrorPayload = { error?: unknown; message?: unknown }

export class PlacesApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'PlacesApiError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isCandidate(value: unknown): value is PlaceSearchCandidate {
  if (!isRecord(value)) return false
  return (
    value.provider === 'geoapify' &&
    typeof value.providerRef === 'string' &&
    typeof value.name === 'string' &&
    (typeof value.localName === 'string' || value.localName === null) &&
    (typeof value.address === 'string' || value.address === null) &&
    (typeof value.localAddress === 'string' || value.localAddress === null) &&
    typeof value.lat === 'number' &&
    typeof value.lng === 'number' &&
    (typeof value.countryCode === 'string' || value.countryCode === null) &&
    typeof value.datasource === 'string' &&
    typeof value.attribution === 'string' &&
    typeof value.license === 'string' &&
    (value.method === 'geocoding' || value.method === 'places') &&
    typeof value.token === 'string'
  )
}

function isGoogleDetails(value: unknown): value is GoogleDetailsResponse {
  if (!isRecord(value) || !Array.isArray(value.candidateIds) || !isRecord(value.current)) {
    return false
  }

  const current = value.current
  const photo = current.photo
  const isPhoto =
    photo === null ||
    (isRecord(photo) &&
      typeof photo.uri === 'string' &&
      typeof photo.widthPx === 'number' &&
      typeof photo.heightPx === 'number' &&
      Array.isArray(photo.authorAttributions) &&
      photo.authorAttributions.every(
        (author) =>
          isRecord(author) &&
          typeof author.displayName === 'string' &&
          typeof author.uri === 'string' &&
          typeof author.photoUri === 'string',
      ))

  return (
    value.candidateIds.every((id) => typeof id === 'string') &&
    typeof current.googlePlaceId === 'string' &&
    typeof current.name === 'string' &&
    (typeof current.type === 'string' || current.type === null) &&
    (typeof current.address === 'string' || current.address === null) &&
    isPhoto &&
    typeof current.googleMapsUri === 'string'
  )
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return undefined
  }
}

function errorFor(response: Response, payload: unknown): PlacesApiError {
  const body = isRecord(payload) ? (payload as ApiErrorPayload) : undefined
  const code = typeof body?.error === 'string' ? body.error : 'unexpected_error'
  const message =
    typeof body?.message === 'string' && body.message.trim()
      ? body.message.trim()
      : response.status === 503
        ? 'O serviço de busca de lugares está indisponível agora.'
        : response.status === 422
          ? 'Este lugar não tem dados do fornecedor para mostrar detalhes.'
          : response.status === 429
            ? 'Limite de consultas atingido. Tente novamente mais tarde.'
            : 'Não foi possível concluir a solicitação. Tente novamente.'

  return new PlacesApiError(response.status, code, message)
}

function invalidResponse(): PlacesApiError {
  return new PlacesApiError(
    502,
    'unexpected_error',
    'O servidor retornou dados inválidos para lugares. Tente novamente.',
  )
}

async function requestCandidates(request: PlacesRequest, path: string): Promise<PlaceSearchResponse> {
  const response = await request(path)
  const payload = await readJson(response)

  if (!response.ok) throw errorFor(response, payload)
  if (!isRecord(payload)) throw invalidResponse()
  const candidates = payload.candidates
  if (!Array.isArray(candidates) || !candidates.every(isCandidate)) throw invalidResponse()

  return { candidates }
}

export function createPlacesClient(request: PlacesRequest): PlacesClient {
  return {
    async search(tripId, query, attempt) {
      const path = `/trips/${encodeURIComponent(tripId)}/places/search?q=${encodeURIComponent(query)}&attempt=${attempt}`
      return requestCandidates(request, path)
    },

    async nearby(tripId, lat, lng) {
      const path = `/trips/${encodeURIComponent(tripId)}/places/nearby?lat=${encodeURIComponent(String(lat))}&lng=${encodeURIComponent(String(lng))}`
      return requestCandidates(request, path)
    },

    async googleDetails(tripId, placeId, googlePlaceId) {
      const path = `/trips/${encodeURIComponent(tripId)}/places/${encodeURIComponent(placeId)}/google-details`
      const init: RequestInit =
        googlePlaceId === undefined
          ? { method: 'POST' }
          : {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ googlePlaceId }),
            }
      const response = await request(path, init)
      const payload = await readJson(response)

      if (!response.ok) throw errorFor(response, payload)
      if (!isGoogleDetails(payload)) throw invalidResponse()

      return payload
    },
  }
}

export function usePlacesClient(): PlacesClient {
  const { request } = useSession()
  return useMemo(() => createPlacesClient(request), [request])
}

export function getPlacesErrorMessage(error: unknown): string {
  if (error instanceof PlacesApiError) return error.message
  if (error instanceof Error && error.message.trim()) return error.message
  return 'Não foi possível conectar. Confira sua internet e tente novamente.'
}
