import type { PlaceSearchCandidateFields } from '@trippy/domain/places'
import {
  PlacesProviderError,
  type PlacesProvider,
  type PlacesSearchInput,
  type ProviderCallHandler,
} from './provider.ts'

interface Destination {
  lat: number
  lng: number
  countryCode: string
}

// GET /v2/places exige pelo menos uma categoria. Use categorias-raiz comuns
// para manter busca por nome ampla entre tipos de lugar.
const PLACES_SEARCH_CATEGORIES = [
  'accommodation',
  'activity',
  'airport',
  'commercial',
  'catering',
  'education',
  'entertainment',
  'healthcare',
  'heritage',
  'leisure',
  'natural',
  'office',
  'parking',
  'public_transport',
  'service',
  'sport',
  'tourism',
].join(',')

export interface GeoapifyPlacesOptions {
  fetcher?: typeof fetch
  timeoutMs?: number
  searchRadiusMeters?: number
}

const geoapifyUrl = (path: string): URL => new URL(path, 'https://api.geoapify.com')

export class GeoapifyPlacesProvider implements PlacesProvider {
  private readonly fetcher: typeof fetch
  private readonly timeoutMs: number
  private readonly searchRadiusMeters: number
  private readonly destinations = new Map<string, Promise<Destination | null>>()

  constructor(
    private readonly apiKey: string,
    options: GeoapifyPlacesOptions = {},
  ) {
    this.fetcher = options.fetcher ?? fetch
    this.timeoutMs = options.timeoutMs ?? 5_000
    this.searchRadiusMeters = options.searchRadiusMeters ?? 50_000
  }

  async search(
    input: PlacesSearchInput,
    onProviderCall?: ProviderCallHandler,
  ): Promise<PlaceSearchCandidateFields[]> {
    if (!this.apiKey) throw new PlacesProviderError('provider_error')

    const destination = await this.geocodeDestination(input.destination, input.lang, onProviderCall)
    if (!destination) throw new PlacesProviderError('location_unavailable')

    const method = input.attempt === 'primary' ? 'geocoding' : 'places'
    const path = method === 'geocoding' ? '/v1/geocode/search' : '/v2/places'
    const url = geoapifyUrl(path)
    url.searchParams.set('apiKey', this.apiKey)
    url.searchParams.set('name', input.query)
    url.searchParams.set('limit', '5')
    if (input.lang) url.searchParams.set('lang', input.lang)
    url.searchParams.set('bias', `proximity:${destination.lng},${destination.lat}`)
    if (method === 'geocoding') {
      url.searchParams.set('filter', `countrycode:${destination.countryCode}`)
      url.searchParams.set('type', 'amenity')
      url.searchParams.set('format', 'json')
    } else {
      // O filtro countrycode consta como "coming soon" no Places API; usamos
      // círculo + proximidade. GET exige categories além de name e filtro espacial.
      url.searchParams.set(
        'filter',
        `circle:${destination.lng},${destination.lat},${this.searchRadiusMeters}`,
      )
      url.searchParams.set('categories', PLACES_SEARCH_CATEGORIES)
    }

    const body = await this.requestJson(url, method, onProviderCall)
    const records = method === 'geocoding' ? asArray(asRecord(body)?.results) : asArray(asRecord(body)?.features)
    return records
      .map((feature) => mapCandidate(feature, method))
      .filter((candidate): candidate is PlaceSearchCandidateFields => candidate !== null)
      .slice(0, 5)
  }

  private async geocodeDestination(
    destinationText: string,
    lang: string | undefined,
    onProviderCall?: ProviderCallHandler,
  ): Promise<Destination | null> {
    const cached = this.destinations.get(destinationText)
    if (cached) return cached

    const lookup = this.fetchDestination(destinationText, lang, onProviderCall)
    this.destinations.set(destinationText, lookup)
    void lookup.catch(() => {
      if (this.destinations.get(destinationText) === lookup) this.destinations.delete(destinationText)
    })
    return lookup
  }

  private async fetchDestination(
    destinationText: string,
    lang: string | undefined,
    onProviderCall?: ProviderCallHandler,
  ): Promise<Destination | null> {
    const url = geoapifyUrl('/v1/geocode/search')
    url.searchParams.set('apiKey', this.apiKey)
    url.searchParams.set('text', destinationText)
    url.searchParams.set('type', 'city')
    url.searchParams.set('limit', '1')
    url.searchParams.set('format', 'json')
    if (lang) url.searchParams.set('lang', lang)

    const body = await this.requestJson(url, 'geocoding', onProviderCall)
    const first = asRecord(asArray(asRecord(body)?.results)[0])
    const lat = readNumber(first?.lat)
    const lng = readNumber(first?.lon)
    const countryCode = readString(first?.country_code)?.toLowerCase()
    if (lat === null || lng === null || !validCoordinates(lat, lng) || !countryCode) {
      return null
    }

    const result = { lat, lng, countryCode }
    return result
  }

  private async requestJson(
    url: URL,
    sku: string,
    onProviderCall?: ProviderCallHandler,
  ): Promise<unknown> {
    const startedAt = Date.now()
    let status = 'network_error'
    try {
      const response = await this.fetcher(url, {
        method: 'GET',
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(this.timeoutMs),
      })
      status = String(response.status)
      if (!response.ok) throw new PlacesProviderError('provider_error')
      try {
        return await response.json()
      } catch {
        status = 'invalid_json'
        throw new PlacesProviderError('provider_error')
      }
    } catch (error) {
      if (error instanceof PlacesProviderError) throw error
      status = isTimeout(error) ? 'timeout' : 'network_error'
      throw new PlacesProviderError(isTimeout(error) ? 'provider_timeout' : 'provider_error')
    } finally {
      await onProviderCall?.({
        provider: 'geoapify',
        sku,
        status,
        latencyMs: Math.max(0, Date.now() - startedAt),
      })
    }
  }
}

function mapCandidate(value: unknown, method: 'geocoding' | 'places'):
  | PlaceSearchCandidateFields
  | null {
  const feature = asRecord(value)
  // Geocoding `format=json` returns flat records in results[]. Places returns
  // GeoJSON features whose candidate fields live under properties.
  const properties = method === 'geocoding' ? feature : asRecord(feature?.properties)
  const datasource = asRecord(properties?.datasource)
  const datasourceName = readString(datasource?.sourcename) ?? readString(datasource?.name)
  if (!properties || !datasource || !datasourceName) return null

  const geometry = asRecord(feature?.geometry)
  const coordinates = asArray(geometry?.coordinates)
  const lat =
    readNumber(properties.lat) ?? (method === 'places' ? readNumber(coordinates[1]) : null)
  const lng =
    readNumber(properties.lon) ?? (method === 'places' ? readNumber(coordinates[0]) : null)
  const providerRef = readString(properties.place_id)
  const name = readString(properties.name)
  if (!providerRef || !name || lat === null || lng === null || !validCoordinates(lat, lng)) {
    return null
  }

  const countryCode = readString(properties.country_code)?.toLowerCase() ?? null
  return {
    provider: 'geoapify',
    providerRef,
    name,
    localName: readString(properties.local_name) ?? readString(properties['name:local']) ?? null,
    address: readString(properties.formatted) ?? null,
    localAddress: readString(properties.local_address) ?? null,
    lat,
    lng,
    countryCode,
    datasource: datasourceName,
    attribution: readString(datasource.attribution) ?? '',
    license: readString(datasource.license) ?? readString(datasource.license_name) ?? '',
    method,
  }
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
}

function validCoordinates(lat: number, lng: number): boolean {
  return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
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
