export type BenchmarkGroup = 'china' | 'global' | 'address'
export type BenchmarkKind = 'poi' | 'address'
export type ReferencePrecision =
  'unverified' | 'street-level' | 'building-level' | 'venue-footprint'
export type CoordinateQuality =
  'within-tolerance' | 'outside-tolerance' | 'missing-coordinate' | 'unmatched'

export interface Coordinates {
  lat: number
  lon: number
}

export interface BenchmarkCase {
  id: string
  group: BenchmarkGroup
  kind: BenchmarkKind
  query: string
  language: string
  city: string
  countryCode: string
  expectedNames: readonly string[]
  expectedAddressTokens: readonly string[]
  coordinates: Coordinates
  coordinateToleranceMeters: number
  referencePrecision: ReferencePrecision
  sourceUrls: readonly string[]
  placesCategory?: string
}

export interface PlaceCandidate {
  name?: string
  aliases?: readonly string[]
  addressParts?: readonly string[]
  coordinates?: Coordinates
  placeId?: string
}

export interface CaseEvaluation {
  top1NameMatch: boolean | null
  top1Hit: boolean
  topKHit: boolean
  matchedRank: number | null
  top1DistanceMeters: number | null
  matchedDistanceMeters: number | null
  localAddressComplete: boolean
  localAddressCompleteness: number
  coordinateQuality: CoordinateQuality
  duplicateCount: number
}

const TOP_K = 5

export function evaluateCase(
  benchmarkCase: BenchmarkCase,
  candidates: readonly PlaceCandidate[],
): CaseEvaluation {
  const topCandidates = candidates.slice(0, TOP_K)
  const relevantRank = topCandidates.findIndex((candidate) => matchesCase(benchmarkCase, candidate))
  const relevantCandidate = relevantRank >= 0 ? topCandidates[relevantRank] : undefined
  const inToleranceRank = topCandidates.findIndex((candidate) => {
    if (!matchesCase(benchmarkCase, candidate) || !candidate.coordinates) return false

    return (
      haversineMeters(benchmarkCase.coordinates, candidate.coordinates) <=
      benchmarkCase.coordinateToleranceMeters
    )
  })
  const matchedRank = inToleranceRank >= 0 ? inToleranceRank : relevantRank
  const matchedCandidate = matchedRank >= 0 ? topCandidates[matchedRank] : undefined
  const top1Candidate = topCandidates[0]
  const top1NameMatch =
    benchmarkCase.kind === 'poi'
      ? top1Candidate
        ? matchesName(benchmarkCase.expectedNames, candidateNames(top1Candidate))
        : false
      : null
  const top1Address =
    benchmarkCase.kind === 'address' && top1Candidate
      ? addressCompleteness(benchmarkCase.expectedAddressTokens, top1Candidate.addressParts)
      : 0
  const localAddressCompleteness = matchedCandidate
    ? addressCompleteness(benchmarkCase.expectedAddressTokens, matchedCandidate.addressParts)
    : 0
  const localAddressComplete =
    benchmarkCase.expectedAddressTokens.length > 0 && localAddressCompleteness === 1
  const matchedDistanceMeters = matchedCandidate?.coordinates
    ? haversineMeters(benchmarkCase.coordinates, matchedCandidate.coordinates)
    : null
  const top1DistanceMeters = top1Candidate?.coordinates
    ? haversineMeters(benchmarkCase.coordinates, top1Candidate.coordinates)
    : null
  const top1Hit =
    benchmarkCase.kind === 'poi'
      ? top1NameMatch === true &&
        top1DistanceMeters !== null &&
        top1DistanceMeters <= benchmarkCase.coordinateToleranceMeters
      : top1Address === 1 &&
        top1DistanceMeters !== null &&
        top1DistanceMeters <= benchmarkCase.coordinateToleranceMeters

  return {
    top1NameMatch,
    top1Hit,
    topKHit: inToleranceRank >= 0,
    matchedRank: matchedRank >= 0 ? matchedRank + 1 : null,
    top1DistanceMeters: roundMeters(top1DistanceMeters),
    matchedDistanceMeters: roundMeters(matchedDistanceMeters),
    localAddressComplete,
    localAddressCompleteness,
    coordinateQuality:
      relevantCandidate === undefined
        ? 'unmatched'
        : inToleranceRank >= 0
          ? 'within-tolerance'
          : !relevantCandidate.coordinates
            ? 'missing-coordinate'
            : 'outside-tolerance',
    duplicateCount: countDuplicates(topCandidates),
  }
}

export function haversineMeters(from: Coordinates, to: Coordinates): number {
  const earthRadiusMeters = 6_371_000
  const radians = Math.PI / 180
  const deltaLatitude = (to.lat - from.lat) * radians
  const deltaLongitude = (to.lon - from.lon) * radians
  const startLatitude = from.lat * radians
  const endLatitude = to.lat * radians
  const haversine =
    Math.sin(deltaLatitude / 2) ** 2 +
    Math.cos(startLatitude) * Math.cos(endLatitude) * Math.sin(deltaLongitude / 2) ** 2

  return 2 * earthRadiusMeters * Math.asin(Math.sqrt(haversine))
}

function matchesCase(benchmarkCase: BenchmarkCase, candidate: PlaceCandidate): boolean {
  if (benchmarkCase.kind === 'poi') {
    return matchesName(benchmarkCase.expectedNames, candidateNames(candidate))
  }

  return addressCompleteness(benchmarkCase.expectedAddressTokens, candidate.addressParts) === 1
}

function matchesName(expectedNames: readonly string[], names: readonly string[]): boolean {
  const normalizedExpectedNames = expectedNames.map(normalizeForMatch).filter(Boolean)
  const normalizedNames = names.map(normalizeForMatch).filter(Boolean)

  return normalizedExpectedNames.some((expected) =>
    normalizedNames.some(
      (name) => name === expected || name.includes(expected) || expected.includes(name),
    ),
  )
}

function candidateNames(candidate: PlaceCandidate): string[] {
  return [candidate.name, ...(candidate.aliases ?? [])].filter((name): name is string =>
    Boolean(name),
  )
}

function addressCompleteness(
  expectedTokens: readonly string[],
  addressParts: readonly string[] = [],
): number {
  if (expectedTokens.length === 0) return 0

  const normalizedAddress = normalizeForMatch(addressParts.join(' '))
  const matchedTokenCount = expectedTokens.filter((token) => {
    const normalizedToken = normalizeForMatch(token)
    return normalizedToken.length > 0 && normalizedAddress.includes(normalizedToken)
  }).length

  return matchedTokenCount / expectedTokens.length
}

function normalizeForMatch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '')
}

function countDuplicates(candidates: readonly PlaceCandidate[]): number {
  const seen = new Set<string>()
  let duplicateCount = 0

  for (const candidate of candidates) {
    const identityKeys = [
      candidate.placeId ? `id:${candidate.placeId}` : null,
      candidate.name && candidate.coordinates
        ? `name-position:${normalizeForMatch(candidate.name)}:${candidate.coordinates.lat.toFixed(5)}:${candidate.coordinates.lon.toFixed(5)}`
        : null,
    ].filter((key): key is string => key !== null)

    if (identityKeys.some((key) => seen.has(key))) duplicateCount += 1
    for (const key of identityKeys) seen.add(key)
  }

  return duplicateCount
}

function roundMeters(distance: number | null): number | null {
  return distance === null ? null : Math.round(distance * 10) / 10
}
