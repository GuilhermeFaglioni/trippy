// Sanitização das respostas da T5 (#46). Regra da ADR 0001: do Google só o
// `place_id` pode ser guardado; da Geoapify, só a allowlist abaixo, sem chave
// de API nem URL de requisição.

export type SanitizedGooglePlace = { placeId: string }

export type GeoapifyRank = { importance?: number | undefined; confidence?: number | undefined }

export type GeoapifyResult = {
  name?: string | undefined
  formatted?: string | undefined
  countryCode?: string | undefined
  city?: string | undefined
  lat?: number | undefined
  lon?: number | undefined
  resultType?: string | undefined
  rank?: GeoapifyRank | undefined
  placeId?: string | undefined
}

export type SanitizedGeoapifyGeocoding = {
  provider: 'geoapify'
  query: string
  results: GeoapifyResult[]
}

const MAX_GEOAPIFY_RESULTS = 10

// Campos do Google que nunca podem aparecer fora de um bloco Geoapify.
const GOOGLE_FORBIDDEN_KEYS: Record<string, true> = {
  location: true,
  latitude: true,
  longitude: true,
  displayName: true,
  formattedAddress: true,
  shortFormattedAddress: true,
  addressComponents: true,
  adrFormatAddress: true,
  plusCode: true,
  viewport: true,
  photos: true,
  googleMapsUri: true,
  websiteUri: true,
  regularOpeningHours: true,
  currentOpeningHours: true,
  internationalPhoneNumber: true,
  nationalPhoneNumber: true,
  reviews: true,
  rating: true,
  userRatingCount: true,
  priceLevel: true,
  editorialSummary: true,
  businessStatus: true,
}

// Chave de API do Google ou host da API do Google em qualquer string.
const GOOGLE_FORBIDDEN_STRING = /googleapis\.com|AIza[0-9A-Za-z_-]{20,}/i

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined

const asCoordinate = (value: unknown, limit: number): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= limit
    ? value
    : undefined

const firstNonEmpty = (...values: unknown[]): string | undefined => {
  for (const value of values) {
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
  }
  return undefined
}

const compact = <T extends object>(value: T): Partial<T> =>
  Object.fromEntries(
    Object.entries(value).filter(([, field]) => field !== undefined),
  ) as Partial<T>

export function sanitizeGooglePlace(raw: unknown): SanitizedGooglePlace | null {
  if (!isRecord(raw)) return null
  const placeId = firstNonEmpty(raw.place_id, raw.id)
  return placeId === undefined ? null : { placeId }
}

function toGeoapifyRank(raw: unknown): GeoapifyRank | undefined {
  if (!isRecord(raw)) return undefined
  const rank = compact({
    importance: asCoordinate(raw.importance, Number.MAX_SAFE_INTEGER),
    confidence: asCoordinate(raw.confidence, Number.MAX_SAFE_INTEGER),
  })
  return Object.keys(rank).length === 0 ? undefined : rank
}

function toGeoapifyResult(raw: Record<string, unknown>): GeoapifyResult {
  return compact({
    name: asString(raw.name),
    formatted: asString(raw.formatted),
    countryCode: asString(raw.country_code),
    city: asString(raw.city),
    lat: asCoordinate(raw.lat, 90),
    lon: asCoordinate(raw.lon, 180),
    resultType: asString(raw.result_type),
    rank: toGeoapifyRank(raw.rank),
    placeId: asString(raw.place_id),
  })
}

export function sanitizeGeoapifyGeocoding(
  raw: unknown,
  options: { query: string },
): SanitizedGeoapifyGeocoding {
  const rawResults = isRecord(raw) && Array.isArray(raw.results) ? raw.results : []
  const results = rawResults
    .filter(isRecord)
    .slice(0, MAX_GEOAPIFY_RESULTS)
    .map(toGeoapifyResult)
  return { provider: 'geoapify', query: options.query, results }
}

// Varre a estrutura inteira. Chaves proibidas do Google são checadas em qualquer
// nível, inclusive dentro de blocos marcados com `provider: 'geoapify'`: a marcação
// não é salvo-conduto. Strings proibidas também são checadas em qualquer lugar.
export function assertNoGoogleLeak(value: unknown): void {
  walkForGoogleLeak(value, '$')
}

function walkForGoogleLeak(value: unknown, path: string): void {
  if (typeof value === 'string') {
    if (GOOGLE_FORBIDDEN_STRING.test(value)) {
      throw new Error(`Vazamento do Google em ${path}: string proibida`)
    }
    return
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => walkForGoogleLeak(item, `${path}[${index}]`))
    return
  }
  if (!isRecord(value)) return

  for (const [key, child] of Object.entries(value)) {
    if (GOOGLE_FORBIDDEN_KEYS[key] === true) {
      throw new Error(`Vazamento do Google em ${path}.${key}`)
    }
    walkForGoogleLeak(child, `${path}.${key}`)
  }
}
