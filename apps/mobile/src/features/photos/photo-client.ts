import { useMemo } from 'react'

import { useSession } from '../auth/session-provider'

export type PhotoUploadMetadata = {
  id: string
  takenAtOriginal: string | null
  takenTz: string | null
  lat: number | null
  lng: number | null
}

export type RemoteTripPhoto = {
  id: string
  status: string
  placeId: string | null
  takenAtOriginal: string | null
  takenTz: string | null
  lat: number | null
  lng: number | null
}

export type PhotoRequest = (path: string, init?: RequestInit) => Promise<Response>

export type PhotosClient = {
  reserveUpload(
    tripId: string,
    photo: PhotoUploadMetadata,
  ): Promise<{ id: string; uploadUrl: string }>
  completeUpload(tripId: string, photoId: string): Promise<void>
  listTripPhotos(tripId: string): Promise<RemoteTripPhoto[]>
}

type PhotoApiErrorPayload = {
  error?: unknown
  message?: unknown
}

export class PhotosApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'PhotosApiError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isFinite(value))
}

function isRemoteTripPhoto(value: unknown): value is RemoteTripPhoto {
  if (!isRecord(value)) return false
  return (
    typeof value.id === 'string' &&
    typeof value.status === 'string' &&
    isNullableString(value.placeId) &&
    isNullableString(value.takenAtOriginal) &&
    isNullableString(value.takenTz) &&
    isNullableNumber(value.lat) &&
    isNullableNumber(value.lng)
  )
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return undefined
  }
}

function createApiError(response: Response, payload: unknown): PhotosApiError {
  const body = isRecord(payload) ? (payload as PhotoApiErrorPayload) : undefined
  const code = typeof body?.error === 'string' ? body.error : 'unexpected_error'
  const message =
    typeof body?.message === 'string' && body.message.trim()
      ? body.message.trim()
      : 'Não foi possível enviar as fotos. Tente novamente.'
  return new PhotosApiError(response.status, code, message)
}

function invalidResponse(): PhotosApiError {
  return new PhotosApiError(
    502,
    'unexpected_error',
    'O servidor retornou uma resposta inválida. Tente novamente.',
  )
}

export function createPhotosClient(request: PhotoRequest): PhotosClient {
  return {
    async reserveUpload(tripId, photo) {
      const response = await request(`/trips/${encodeURIComponent(tripId)}/photos/uploads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(photo),
      })
      const payload = await readJson(response)

      if (!response.ok) throw createApiError(response, payload)
      if (
        !isRecord(payload) ||
        payload.id !== photo.id ||
        typeof payload.uploadUrl !== 'string' ||
        !payload.uploadUrl.trim()
      ) {
        throw invalidResponse()
      }

      // Keep the exact signed URL; changing its host or query invalidates the signature.
      return { id: payload.id, uploadUrl: payload.uploadUrl }
    },
    async completeUpload(tripId, photoId) {
      const response = await request(
        `/trips/${encodeURIComponent(tripId)}/photos/${encodeURIComponent(photoId)}/complete`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        },
      )
      if (!response.ok) throw createApiError(response, await readJson(response))
    },
    async listTripPhotos(tripId) {
      const response = await request(`/trips/${encodeURIComponent(tripId)}/photos`)
      const payload = await readJson(response)

      if (!response.ok) throw createApiError(response, payload)
      if (
        !isRecord(payload) ||
        !Array.isArray(payload.photos) ||
        !payload.photos.every(isRemoteTripPhoto)
      ) {
        throw invalidResponse()
      }
      return payload.photos
    },
  }
}

export function usePhotosClient(): PhotosClient {
  const { request } = useSession()
  return useMemo(() => createPhotosClient(request), [request])
}
