import type { Coordinates, PlaceCandidate } from './evaluation.ts'
import type { PlannedRequest, ProviderMethod } from './plan.ts'

export type SearchStatus = 'success' | 'not-found' | 'error'
export type SearchErrorKind =
  | 'unauthorized'
  | 'forbidden'
  | 'rate-limited'
  | 'http-error'
  | 'timeout'
  | 'network-error'
  | 'invalid-json'

export interface ProviderSearchResult {
  caseId: string
  method: ProviderMethod
  status: SearchStatus
  httpStatus: number | null
  latencyMs: number
  candidates: PlaceCandidate[]
  estimatedCredits: number | null
  errorKind?: SearchErrorKind
}

export interface SearchOptions {
  timeoutMs?: number
  fetcher?: typeof fetch
}

const API_BASE = 'https://api.geoapify.com'
const RESULT_LIMIT = 5

interface ProviderAdapter {
  endpoint: string
  configureUrl(request: PlannedRequest, url: URL): void
  readResults(body: unknown): unknown[]
  estimateCredits(resultCount: number): number
}

const providerAdapters: Record<ProviderMethod, ProviderAdapter> = {
  geocoding: {
    endpoint: '/v1/geocode/search',
    configureUrl(request, url) {
      const { benchmarkCase } = request
      url.searchParams.set('format', 'json')
      url.searchParams.set('filter', `countrycode:${benchmarkCase.countryCode}`)
      if (benchmarkCase.kind === 'poi') {
        url.searchParams.set('name', benchmarkCase.query)
        url.searchParams.set('city', benchmarkCase.city)
        url.searchParams.set('country', benchmarkCase.countryCode)
        url.searchParams.set('type', 'amenity')
      } else {
        url.searchParams.set('text', benchmarkCase.query)
      }
    },
    readResults(body) {
      return asArray(asRecord(body)?.results)
    },
    estimateCredits: () => 1,
  },
  places: {
    endpoint: '/v2/places',
    configureUrl(request, url) {
      const { benchmarkCase } = request
      if (!benchmarkCase.placesCategory) {
        throw new Error(`Categoria Places ausente para o caso ${benchmarkCase.id}.`)
      }
      url.searchParams.set('categories', benchmarkCase.placesCategory)
      url.searchParams.set('name', benchmarkCase.query)
      url.searchParams.set(
        'bias',
        `proximity:${benchmarkCase.coordinates.lon},${benchmarkCase.coordinates.lat}`,
      )
    },
    readResults(body) {
      return asArray(asRecord(body)?.features)
    },
    estimateCredits: (resultCount) => Math.max(1, Math.ceil(resultCount / 20)),
  },
}

export function buildApiUrl(request: PlannedRequest, apiKey: string): URL {
  const { benchmarkCase } = request
  const adapter = providerAdapters[request.method]
  const url = new URL(adapter.endpoint, API_BASE)
  url.searchParams.set('apiKey', apiKey)
  url.searchParams.set('lang', benchmarkCase.language)
  url.searchParams.set('limit', String(RESULT_LIMIT))
  adapter.configureUrl(request, url)
  return url
}

export async function searchGeoapify(
  request: PlannedRequest,
  apiKey: string,
  options: SearchOptions = {},
): Promise<ProviderSearchResult> {
  const startedAt = Date.now()
  const fetcher = options.fetcher ?? fetch

  try {
    const response = await fetcher(buildApiUrl(request, apiKey), {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
    })
    const latencyMs = Date.now() - startedAt
    if (!response.ok) {
      return {
        ...baseResult(request, latencyMs),
        status: 'error',
        httpStatus: response.status,
        candidates: [],
        estimatedCredits: null,
        errorKind: errorKindForStatus(response.status),
      }
    }

    let body: unknown
    try {
      body = await response.json()
    } catch {
      return {
        ...baseResult(request, Date.now() - startedAt),
        status: 'error',
        httpStatus: response.status,
        candidates: [],
        estimatedCredits: null,
        errorKind: 'invalid-json',
      }
    }

    const candidates = normalizeCandidates(request.method, body)
    return {
      ...baseResult(request, Date.now() - startedAt),
      status: candidates.length > 0 ? 'success' : 'not-found',
      httpStatus: response.status,
      candidates,
      estimatedCredits: providerAdapters[request.method].estimateCredits(candidates.length),
    }
  } catch (error) {
    const errorName = error instanceof Error ? error.name : ''
    return {
      ...baseResult(request, Date.now() - startedAt),
      status: 'error',
      httpStatus: null,
      candidates: [],
      estimatedCredits: null,
      errorKind:
        errorName === 'AbortError' || errorName === 'TimeoutError' ? 'timeout' : 'network-error',
    }
  }
}

function baseResult(request: PlannedRequest, latencyMs: number) {
  return { caseId: request.caseId, method: request.method, latencyMs }
}

function errorKindForStatus(status: number): SearchErrorKind {
  if (status === 401) return 'unauthorized'
  if (status === 403) return 'forbidden'
  if (status === 429) return 'rate-limited'
  return 'http-error'
}

function normalizeCandidates(method: ProviderMethod, body: unknown): PlaceCandidate[] {
  return providerAdapters[method].readResults(body).flatMap((row) => {
    const item = asRecord(row)
    const properties = asRecord(item?.properties) ?? item
    if (!properties) return []

    const coordinates = readCoordinates(properties, item)
    const name = readString(properties.name)
    const aliases = Object.entries(properties)
      .filter(([key, value]) => key.startsWith('name:') && typeof value === 'string')
      .map(([, value]) => value as string)
    const addressParts = [
      'formatted',
      'address_line1',
      'address_line2',
      'name',
      'housenumber',
      'street',
      'district',
      'suburb',
      'city',
      'state',
      'postcode',
      'country',
    ]
      .map((key) => readString(properties[key]))
      .filter((part): part is string => part !== undefined)
    const placeId = readString(properties.place_id)

    return [
      {
        ...(name ? { name } : {}),
        ...(aliases.length ? { aliases } : {}),
        ...(addressParts.length ? { addressParts } : {}),
        ...(coordinates ? { coordinates } : {}),
        ...(placeId ? { placeId } : {}),
      },
    ]
  })
}

function readCoordinates(
  properties: Record<string, unknown>,
  item: Record<string, unknown> | undefined,
): Coordinates | undefined {
  const geometry = asRecord(item?.geometry)
  const geometryCoordinates = asArray(geometry?.coordinates)
  const longitude = readNumber(properties.lon) ?? readNumber(geometryCoordinates[0])
  const latitude = readNumber(properties.lat) ?? readNumber(geometryCoordinates[1])
  if (latitude === undefined || longitude === undefined) return undefined
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return undefined
  return { lat: latitude, lon: longitude }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}
