import { googleMapsAllowedHosts } from './hosts.ts'

/** Coordenada WGS-84 extraída do texto de um link do Google Maps. */
export interface GoogleMapsCoordinates {
  latitude: number
  longitude: number
}

/** Resultado seguro do parser; coordenadas `@lat,lng` nunca entram em `coordinates`. */
export type GoogleMapsUrlParseResult =
  | {
      kind: 'coordinates'
      coordinates: GoogleMapsCoordinates
      source: 'query' | 'place'
      query?: string
    }
  | {
      kind: 'query'
      query: string
      reason: 'query' | 'place_name' | 'viewport' | 'opaque_id'
    }
  | {
      kind: 'fallback'
      reason: 'opaque_id' | 'list' | 'viewport' | 'unsupported'
    }

const coordinatePair = /^\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*,\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*$/

/**
 * Extrai somente informação presente no texto da URL. IDs opacos, listas,
 * links sem destino e coordenadas de câmera retornam busca/fallback.
 */
export function parseGoogleMapsUrl(url: string): GoogleMapsUrlParseResult {
  let parsedUrl: URL
  try {
    parsedUrl = new URL(url)
  } catch {
    return { kind: 'fallback', reason: 'unsupported' }
  }

  if (
    parsedUrl.protocol !== 'https:' ||
    !googleMapsAllowedHosts.has(parsedUrl.hostname.toLowerCase()) ||
    parsedUrl.username !== '' ||
    parsedUrl.password !== '' ||
    (parsedUrl.port !== '' && parsedUrl.port !== '443')
  ) {
    return { kind: 'fallback', reason: 'unsupported' }
  }

  const pathname = decodePath(parsedUrl.pathname)
  const queryText =
    cleanText(parsedUrl.searchParams.get('q') ?? '') ??
    cleanText(parsedUrl.searchParams.get('query') ?? '') ??
    ''
  const queryOpaqueId = queryText !== undefined && isOpaqueQueryId(queryText)
  const placeSegment = getPlaceSegment(parsedUrl.pathname)
  const opaquePlaceId = placeSegment !== undefined && isOpaquePlaceId(placeSegment)
  const placeName = opaquePlaceId ? undefined : placeSegment
  const pathAndData = decodePath(`${parsedUrl.pathname}${parsedUrl.search}${parsedUrl.hash}`)

  if (/\/maps\/(?:dir|list|placelists)(?:\/|$)/i.test(pathname)) {
    return { kind: 'fallback', reason: 'list' }
  }

  const placeCoordinates = getMarkedCoordinates(pathAndData)
  if (placeCoordinates) {
    return {
      kind: 'coordinates',
      coordinates: placeCoordinates,
      source: 'place',
      ...(placeName ? { query: placeName } : {}),
    }
  }

  if (queryText) {
    const queryCoordinates = parseCoordinatePair(queryText)
    if (queryCoordinates) {
      return { kind: 'coordinates', coordinates: queryCoordinates, source: 'query' }
    }
  }

  const viewport = /@([+-]?(?:\d+(?:\.\d*)?|\.\d+)),\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))/i.test(
    pathAndData,
  )
  const hasOpaqueId =
    parsedUrl.searchParams.has('cid') ||
    parsedUrl.searchParams.has('ftid') ||
    queryOpaqueId ||
    opaquePlaceId ||
    /!1s[^!/?&#]+/i.test(pathAndData)

  if (queryText && !parseCoordinatePair(queryText) && !queryOpaqueId) {
    return { kind: 'query', query: queryText, reason: 'query' }
  }

  if (placeName) {
    return {
      kind: 'query',
      query: placeName,
      reason: hasOpaqueId ? 'opaque_id' : viewport ? 'viewport' : 'place_name',
    }
  }

  if (hasOpaqueId) return { kind: 'fallback', reason: 'opaque_id' }
  if (viewport) return { kind: 'fallback', reason: 'viewport' }
  return { kind: 'fallback', reason: 'unsupported' }
}

function getMarkedCoordinates(text: string): GoogleMapsCoordinates | undefined {
  const latitude = /!3d([+-]?(?:\d+(?:\.\d*)?|\.\d+))/i.exec(text)?.[1]
  const longitude = /!4d([+-]?(?:\d+(?:\.\d*)?|\.\d+))/i.exec(text)?.[1]
  if (latitude === undefined || longitude === undefined) return undefined
  return makeCoordinates(Number(latitude), Number(longitude))
}

function parseCoordinatePair(text: string): GoogleMapsCoordinates | undefined {
  const match = coordinatePair.exec(text)
  if (!match) return undefined
  return makeCoordinates(Number(match[1]), Number(match[2]))
}

function makeCoordinates(latitude: number, longitude: number): GoogleMapsCoordinates | undefined {
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    return undefined
  }
  return { latitude, longitude }
}

function getPlaceSegment(pathname: string): string | undefined {
  const segments = pathname.split('/').filter(Boolean)
  const placeIndex = segments.findIndex((segment) => segment.toLowerCase() === 'place')
  if (placeIndex === -1) return undefined
  const segment = cleanText(decodePath(segments[placeIndex + 1] ?? ''))
  if (!segment || segment.startsWith('@') || segment.startsWith('data=')) return undefined
  return segment
}

function isOpaquePlaceId(segment: string): boolean {
  return (
    isExplicitPlaceId(segment) ||
    isDocumentedPlaceId(segment) ||
    /^0x[0-9a-f]+:0x[0-9a-f]+$/i.test(segment)
  )
}

function isOpaqueQueryId(query: string): boolean {
  return isOpaquePlaceId(query)
}

function isExplicitPlaceId(value: string): boolean {
  return /^place_id:\s*\S/i.test(value)
}

function isDocumentedPlaceId(value: string): boolean {
  const normalized = value.trim()
  const encodedId = /^(ChIJ|GhIJ|Eic|IhoS)([A-Za-z0-9_-]{16,})$/i.exec(normalized)
  if (encodedId) {
    const payload = encodedId[2]
    if (!payload) return false
    // Texto cru pode ser ambíguo: preserve TitleCase claro; nos demais tokens, priorize fallback seguro.
    return /[0-9_-]/.test(payload) || !looksLikeCamelCaseName(payload)
  }

  // O exemplo oficial EpID é longo; o limiar evita confundir nomes iniciados por "Epid" com IDs.
  return /^EpID(?=[A-Za-z0-9_,\s-]{64,}$)(?=.*\d)[A-Za-z0-9_,\s-]+$/i.test(normalized)
}

function looksLikeCamelCaseName(value: string): boolean {
  if (!/^[A-Za-z]+$/.test(value)) return false
  const words = value.match(/[A-Z]?[a-z]+/g) ?? []
  return words.length >= 3 && words.filter((word) => word.length >= 3).length >= 2
}

function decodePath(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '))
  } catch {
    return value.replace(/%21/gi, '!').replace(/\+/g, ' ')
  }
}

function cleanText(value: string): string | undefined {
  const cleaned = value.trim().replace(/\s+/g, ' ')
  return cleaned === '' ? undefined : cleaned
}
