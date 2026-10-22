import type {
  GoogleDetailsResponse,
  GooglePlacePhoto,
  GooglePhotoAuthorAttribution,
} from '@trippy/domain/places'
import {
  PlacesProviderError,
  type GoogleDetailsInput,
  type GooglePlacesProvider as GooglePlacesProviderPort,
  type ProviderCallHandler,
} from './provider.ts'

export interface GooglePlacesOptions {
  fetcher?: typeof fetch
  timeoutMs?: number
  restrictionRadiusMeters?: number
  photoWidthPx?: number
  sleep?: (milliseconds: number) => Promise<void>
  random?: () => number
}

interface GooglePhotoRow {
  name?: unknown
  widthPx?: unknown
  heightPx?: unknown
  authorAttributions?: unknown
}

const API_BASE = 'https://places.googleapis.com/v1/'
const TEXT_SEARCH_FIELD_MASK = 'places.id'
// A máscara de Details fica no SKU Pro: displayName, primaryTypeDisplayName e
// googleMapsUri são Pro; id e photos são Essentials (IDs Only), e formattedAddress
// é Essentials. A cobrança usa o maior SKU da máscara, portanto ela não aciona Enterprise.
// Fonte oficial: https://developers.google.com/maps/documentation/places/web-service/data-fields
const DETAILS_FIELD_MASK =
  'id,displayName,primaryTypeDisplayName,formattedAddress,googleMapsUri,photos'
const MAX_CANDIDATES = 5
const DEFAULT_TIMEOUT_MS = 5_000
const DEFAULT_RESTRICTION_RADIUS_METERS = 1_000
const DEFAULT_PHOTO_WIDTH_PX = 800

export class GooglePlacesProvider implements GooglePlacesProviderPort {
  private readonly fetcher: typeof fetch
  private readonly timeoutMs: number
  private readonly restrictionRadiusMeters: number
  private readonly photoWidthPx: number
  private readonly sleep: (milliseconds: number) => Promise<void>
  private readonly random: () => number

  constructor(
    private readonly apiKey: string,
    options: GooglePlacesOptions = {},
  ) {
    this.fetcher = options.fetcher ?? fetch
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.restrictionRadiusMeters =
      options.restrictionRadiusMeters ?? DEFAULT_RESTRICTION_RADIUS_METERS
    this.photoWidthPx = options.photoWidthPx ?? DEFAULT_PHOTO_WIDTH_PX
    this.sleep =
      options.sleep ??
      ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)))
    this.random = options.random ?? Math.random
  }

  async getDetails(
    input: GoogleDetailsInput,
    onProviderCall?: ProviderCallHandler,
  ): Promise<GoogleDetailsResponse> {
    if (!this.apiKey) throw new PlacesProviderError('provider_error')

    const searchResponse = await this.requestJson(
      'text_search_ids_only',
      'places:searchText',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': this.apiKey,
          'X-Goog-FieldMask': TEXT_SEARCH_FIELD_MASK,
        },
        body: JSON.stringify({
          textQuery: input.name,
          pageSize: MAX_CANDIDATES,
          locationRestriction: {
            rectangle: rectangleAround(input.lat, input.lng, this.restrictionRadiusMeters),
          },
        }),
      },
      onProviderCall,
    )
    const candidateIds = asArray(asRecord(searchResponse)?.places)
      .map((place) => readString(asRecord(place)?.id))
      .filter((placeId): placeId is string => placeId !== null)
      .slice(0, MAX_CANDIDATES)

    if (candidateIds.length === 0) throw new PlacesProviderError('google_place_not_found')
    if (input.googlePlaceId && !candidateIds.includes(input.googlePlaceId)) {
      throw new PlacesProviderError('invalid_google_place')
    }

    const selectedPlaceId = input.googlePlaceId ?? candidateIds[0]!
    const placeResponse = await this.requestJson(
      'place_details_pro',
      `places/${encodeURIComponent(selectedPlaceId)}`,
      {
        method: 'GET',
        headers: {
          'X-Goog-Api-Key': this.apiKey,
          'X-Goog-FieldMask': DETAILS_FIELD_MASK,
        },
      },
      onProviderCall,
    )
    const place = asRecord(placeResponse)
    const googlePlaceId = readString(place?.id)
    const name = readString(asRecord(place?.displayName)?.text)
    const googleMapsUri = readString(place?.googleMapsUri)
    if (!googlePlaceId || !name || !googleMapsUri) {
      throw new PlacesProviderError('provider_error')
    }

    const photoRow = asRecord(asArray(place?.photos)[0]) as GooglePhotoRow | null
    const photo = photoRow ? await this.readPhoto(photoRow, onProviderCall) : null
    return {
      candidateIds,
      current: {
        googlePlaceId,
        name,
        type: readString(asRecord(place?.primaryTypeDisplayName)?.text),
        address: readString(place?.formattedAddress),
        photo,
        googleMapsUri,
      },
    }
  }

  private async readPhoto(
    photo: GooglePhotoRow,
    onProviderCall?: ProviderCallHandler,
  ): Promise<GooglePlacePhoto | null> {
    const photoPath = photoMediaPath(readString(photo.name))
    if (!photoPath) return null

    const response = await this.requestJson(
      'place_photo',
      `${photoPath}?maxWidthPx=${this.photoWidthPx}&skipHttpRedirect=true`,
      {
        method: 'GET',
        headers: { 'X-Goog-Api-Key': this.apiKey },
      },
      onProviderCall,
    )
    const uri = readString(asRecord(response)?.photoUri)
    if (!uri) throw new PlacesProviderError('provider_error')

    return {
      uri,
      widthPx: readNumber(photo.widthPx) ?? this.photoWidthPx,
      heightPx: readNumber(photo.heightPx) ?? this.photoWidthPx,
      authorAttributions: asArray(photo.authorAttributions)
        .map(mapAuthorAttribution)
        .filter((value): value is GooglePhotoAuthorAttribution => value !== null),
    }
  }

  private async requestJson(
    sku: string,
    pathAndQuery: string,
    init: RequestInit,
    onProviderCall?: ProviderCallHandler,
  ): Promise<unknown> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const startedAt = Date.now()
      let status = 'network_error'
      let response: Response
      try {
        response = await this.fetcher(new URL(`${API_BASE}${pathAndQuery}`), {
          ...init,
          signal: AbortSignal.timeout(this.timeoutMs),
        })
        status = String(response.status)
      } catch (error) {
        status = isTimeout(error) ? 'timeout' : 'network_error'
        await onProviderCall?.({
          provider: 'google',
          sku,
          status,
          latencyMs: Math.max(0, Date.now() - startedAt),
        })
        throw new PlacesProviderError(isTimeout(error) ? 'provider_timeout' : 'provider_error')
      }

      await onProviderCall?.({
        provider: 'google',
        sku,
        status,
        latencyMs: Math.max(0, Date.now() - startedAt),
      })

      if (!response.ok) {
        if (attempt === 0 && isRetryableStatus(response.status)) {
          await this.sleep(retryDelay(response.status, this.random()))
          continue
        }
        throw new PlacesProviderError('provider_error')
      }

      try {
        return await response.json()
      } catch {
        throw new PlacesProviderError('provider_error')
      }
    }

    throw new PlacesProviderError('provider_error')
  }
}

function rectangleAround(lat: number, lng: number, radiusMeters: number) {
  const latitudeDelta = radiusMeters / 111_320
  const longitudeDelta = radiusMeters / (111_320 * Math.max(Math.cos((lat * Math.PI) / 180), 0.01))
  return {
    low: {
      latitude: Math.max(-90, lat - latitudeDelta),
      longitude: Math.max(-180, lng - longitudeDelta),
    },
    high: {
      latitude: Math.min(90, lat + latitudeDelta),
      longitude: Math.min(180, lng + longitudeDelta),
    },
  }
}

function photoMediaPath(name: string | null): string | null {
  if (!name) return null
  const match = /^places\/([^/]+)\/photos\/([^/]+)$/u.exec(name)
  if (!match) return null
  return `places/${encodeURIComponent(match[1]!)}/photos/${encodeURIComponent(match[2]!)}/media`
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500
}

function retryDelay(status: number, randomValue: number): number {
  const base = status === 429 ? 500 : 200
  return base + Math.floor(Math.max(0, Math.min(0.999_999, randomValue)) * 100)
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
}

function mapAuthorAttribution(value: unknown): GooglePhotoAuthorAttribution | null {
  const author = asRecord(value)
  if (!author) return null
  const displayName = readString(author.displayName)
  const uri = readString(author.uri)
  const photoUri = readString(author.photoUri)
  if (!displayName || !uri || !photoUri) return null
  return { displayName, uri, photoUri }
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}
