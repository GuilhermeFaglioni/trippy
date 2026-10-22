import { readFileSync } from 'node:fs'

export const sample25Segments = [
  'china-atracao',
  'china-hotel',
  'china-restaurante',
  'global-atracao',
  'global-restaurante',
  'global-hotel',
  'endereco',
] as const

export type Sample25Segment = (typeof sample25Segments)[number]
export type Sample25Datum = 'WGS-84' | 'GCJ-02' | 'BD-09'

export interface Sample25Reference {
  url: string
  type:
    | 'site-oficial'
    | 'autoridade-turismo'
    | 'wikidata'
    | 'wikipedia'
    | 'mapa-oficial'
    | 'registro-postal'
}

export interface Sample25Case {
  id: string
  segment: Sample25Segment
  city: string
  countryCode: string
  queries: { pt: string; en: string; local: string }
  acceptedNames: string[]
  expectedLocalAddressTokens: string[]
  referenceCoordinate: {
    lat: number
    lon: number
    datum: Sample25Datum
    wgs84: { lat: number; lon: number }
    conversion: { method: string; description: string } | null
  }
  toleranceMeters: number
  toleranceReason: string
  expectedBranchOrEntrance?: string
  essential?: boolean
  references: Sample25Reference[]
  verification: {
    status: 'verified' | 'unverified'
    verifiedAt: string
    criterion: string
    reason?: string
  }
}

export interface Sample25 {
  method: {
    chosenAt: string
    selectionRule: string
    exclusionRule: string
    noProviderCallsBeforeCommit: boolean
  }
  cases: Sample25Case[]
}

const allowedReferenceTypes = new Set<Sample25Reference['type']>([
  'site-oficial',
  'autoridade-turismo',
  'wikidata',
  'wikipedia',
  'mapa-oficial',
  'registro-postal',
])
const independentReferenceTypes = new Set<Sample25Reference['type']>([
  ...[...allowedReferenceTypes].filter((type) => type !== 'registro-postal'),
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireText(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Amostra #25: ${field} deve ser texto não vazio`)
  }
  return value
}

function requireNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Amostra #25: ${field} deve ser número finito`)
  }
  return value
}

function validateCase(value: unknown, index: number): Sample25Case {
  const prefix = `Amostra #25: caso ${index + 1}`
  if (!isRecord(value)) throw new Error(`${prefix} deve ser objeto`)

  const id = requireText(value.id, `${prefix}.id`)
  if (!sample25Segments.includes(value.segment as Sample25Segment)) {
    throw new Error(`${prefix}.segmento inválido: ${String(value.segment)}`)
  }
  const segment = value.segment as Sample25Segment
  const city = requireText(value.city, `${prefix}.cidade`)
  const countryCode = requireText(value.countryCode, `${prefix}.countryCode`)
  if (!/^[a-z]{2}$/.test(countryCode))
    throw new Error(`${prefix}.countryCode deve ser ISO 3166-1 alpha-2 minúsculo`)

  if (!isRecord(value.queries)) throw new Error(`${prefix}.consultas deve ser objeto`)
  const queries = {
    pt: requireText(value.queries.pt, `${prefix}.consultas.pt`),
    en: requireText(value.queries.en, `${prefix}.consultas.en`),
    local: requireText(value.queries.local, `${prefix}.consultas.local`),
  }
  if (countryCode === 'cn' && !/[\u3400-\u9fff]/u.test(queries.local)) {
    throw new Error(`${prefix}: consulta local da China deve conter caracteres chineses`)
  }

  if (
    !Array.isArray(value.acceptedNames) ||
    !value.acceptedNames.every((name) => typeof name === 'string' && name.trim())
  ) {
    throw new Error(`${prefix}.acceptedNames deve ser lista de nomes não vazios`)
  }
  const acceptedNames = value.acceptedNames as string[]
  if (segment !== 'endereco' && acceptedNames.length === 0) {
    throw new Error(`${prefix}: POI precisa de nome ou alias aceito`)
  }
  if (
    !Array.isArray(value.expectedLocalAddressTokens) ||
    !value.expectedLocalAddressTokens.every((token) => typeof token === 'string' && token.trim())
  ) {
    throw new Error(`${prefix}.expectedLocalAddressTokens deve ser lista de tokens não vazios`)
  }
  const expectedLocalAddressTokens = value.expectedLocalAddressTokens as string[]
  if (segment === 'endereco' && expectedLocalAddressTokens.length === 0) {
    throw new Error(`${prefix}: endereço precisa de tokens esperados`)
  }

  if (!isRecord(value.referenceCoordinate))
    throw new Error(`${prefix}.referenceCoordinate deve ser objeto`)
  const coordinate = value.referenceCoordinate
  if (!['WGS-84', 'GCJ-02', 'BD-09'].includes(String(coordinate.datum))) {
    throw new Error(`${prefix}.referenceCoordinate.datum inválido`)
  }
  if (!isRecord(coordinate.wgs84))
    throw new Error(`${prefix}.referenceCoordinate.wgs84 deve ser objeto`)
  const referenceCoordinate = {
    lat: requireNumber(coordinate.lat, `${prefix}.referenceCoordinate.lat`),
    lon: requireNumber(coordinate.lon, `${prefix}.referenceCoordinate.lon`),
    datum: coordinate.datum as Sample25Datum,
    wgs84: {
      lat: requireNumber(coordinate.wgs84.lat, `${prefix}.referenceCoordinate.wgs84.lat`),
      lon: requireNumber(coordinate.wgs84.lon, `${prefix}.referenceCoordinate.wgs84.lon`),
    },
    conversion:
      coordinate.conversion === null
        ? null
        : isRecord(coordinate.conversion)
          ? {
              method: requireText(
                coordinate.conversion.method,
                `${prefix}.referenceCoordinate.conversion.method`,
              ),
              description: requireText(
                coordinate.conversion.description,
                `${prefix}.referenceCoordinate.conversion.description`,
              ),
            }
          : (() => {
              throw new Error(`${prefix}.referenceCoordinate.conversion deve ser objeto ou null`)
            })(),
  }
  if (
    referenceCoordinate.lat < -90 ||
    referenceCoordinate.lat > 90 ||
    referenceCoordinate.wgs84.lat < -90 ||
    referenceCoordinate.wgs84.lat > 90
  ) {
    throw new Error(`${prefix}: latitude fora do intervalo`)
  }
  if (
    referenceCoordinate.lon < -180 ||
    referenceCoordinate.lon > 180 ||
    referenceCoordinate.wgs84.lon < -180 ||
    referenceCoordinate.wgs84.lon > 180
  ) {
    throw new Error(`${prefix}: longitude fora do intervalo`)
  }
  if (referenceCoordinate.datum === 'WGS-84' && referenceCoordinate.conversion !== null) {
    throw new Error(`${prefix}: WGS-84 não deve declarar conversão`)
  }
  if (
    referenceCoordinate.datum === 'WGS-84' &&
    (referenceCoordinate.lat !== referenceCoordinate.wgs84.lat ||
      referenceCoordinate.lon !== referenceCoordinate.wgs84.lon)
  ) {
    throw new Error(`${prefix}: coordenada WGS-84 deve coincidir com o resultado WGS-84`)
  }
  if (referenceCoordinate.datum !== 'WGS-84' && referenceCoordinate.conversion === null) {
    throw new Error(`${prefix}: datum chinês exige conversão documentada para WGS-84`)
  }

  const toleranceMeters = requireNumber(value.toleranceMeters, `${prefix}.toleranceMeters`)
  if (toleranceMeters <= 0) throw new Error(`${prefix}.toleranceMeters deve ser positivo`)
  const toleranceReason = requireText(value.toleranceReason, `${prefix}.toleranceReason`)

  const optionalText = (field: 'expectedBranchOrEntrance') => {
    const entry = value[field]
    if (entry === undefined) return undefined
    return requireText(entry, `${prefix}.${field}`)
  }
  if (value.essential !== undefined && typeof value.essential !== 'boolean') {
    throw new Error(`${prefix}.essential deve ser booleano`)
  }
  if (value.essential === true && segment !== 'china-atracao') {
    throw new Error(`${prefix}: essential só pode marcar atração da China`)
  }

  if (!Array.isArray(value.references)) throw new Error(`${prefix}.references deve ser lista`)
  const references = value.references.map((entry, referenceIndex): Sample25Reference => {
    if (!isRecord(entry)) throw new Error(`${prefix}.references[${referenceIndex}] deve ser objeto`)
    const url = requireText(entry.url, `${prefix}.references[${referenceIndex}].url`)
    let parsedUrl: URL
    try {
      parsedUrl = new URL(url)
    } catch {
      throw new Error(`${prefix}.references[${referenceIndex}].url inválida`)
    }
    if (parsedUrl.protocol !== 'https:')
      throw new Error(`${prefix}.references[${referenceIndex}].url deve usar HTTPS`)
    if (/openstreetmap|nominatim|geoapify/i.test(parsedUrl.hostname)) {
      throw new Error(`${prefix}: referência dependente de OSM/Geoapify não pode ser usada`)
    }
    if (!allowedReferenceTypes.has(entry.type as Sample25Reference['type'])) {
      throw new Error(`${prefix}.references[${referenceIndex}].type inválido`)
    }
    return { url, type: entry.type as Sample25Reference['type'] }
  })

  if (!isRecord(value.verification)) throw new Error(`${prefix}.verification deve ser objeto`)
  const verification = value.verification
  if (verification.status !== 'verified' && verification.status !== 'unverified') {
    throw new Error(`${prefix}.verification.status inválido`)
  }
  const verifiedAt = requireText(verification.verifiedAt, `${prefix}.verification.verifiedAt`)
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(verifiedAt) ||
    Number.isNaN(Date.parse(`${verifiedAt}T00:00:00Z`))
  ) {
    throw new Error(`${prefix}.verification.verifiedAt deve usar YYYY-MM-DD`)
  }
  const criterion = requireText(verification.criterion, `${prefix}.verification.criterion`)
  const reason =
    verification.reason === undefined
      ? undefined
      : requireText(verification.reason, `${prefix}.verification.reason`)
  if (verification.status === 'verified' && references.length === 0) {
    throw new Error(`${prefix}: caso medido precisa de fonte independente`)
  }
  if (
    verification.status === 'verified' &&
    !references.some((reference) => independentReferenceTypes.has(reference.type))
  ) {
    throw new Error(`${prefix}: caso medido precisa de fonte independente de OSM`)
  }
  if (verification.status === 'unverified' && reason === undefined) {
    throw new Error(`${prefix}: caso unverified precisa de motivo e fica fora das métricas`)
  }

  return {
    id,
    segment,
    city,
    countryCode,
    queries,
    acceptedNames,
    expectedLocalAddressTokens,
    referenceCoordinate,
    toleranceMeters,
    toleranceReason,
    ...(optionalText('expectedBranchOrEntrance') === undefined
      ? {}
      : { expectedBranchOrEntrance: optionalText('expectedBranchOrEntrance')! }),
    ...(value.essential === undefined ? {} : { essential: value.essential }),
    references,
    verification: {
      status: verification.status,
      verifiedAt,
      criterion,
      ...(reason === undefined ? {} : { reason }),
    },
  }
}

export function validateSample25(value: unknown): Sample25 {
  if (!isRecord(value)) throw new Error('Amostra #25 deve ser objeto')
  if (!isRecord(value.method)) throw new Error('Amostra #25.method deve ser objeto')
  const noProviderCallsBeforeCommit = value.method.noProviderCallsBeforeCommit === true
  const method = {
    chosenAt: requireText(value.method.chosenAt, 'Amostra #25.method.chosenAt'),
    selectionRule: requireText(value.method.selectionRule, 'Amostra #25.method.selectionRule'),
    exclusionRule: requireText(value.method.exclusionRule, 'Amostra #25.method.exclusionRule'),
    noProviderCallsBeforeCommit,
  }
  if (method.noProviderCallsBeforeCommit !== true) {
    throw new Error('Amostra #25 exige confirmação de rótulos antes de chamadas aos fornecedores')
  }
  if (!Array.isArray(value.cases)) throw new Error('Amostra #25.cases deve ser lista')
  const cases = value.cases.map(validateCase)
  if (cases.length !== 60)
    throw new Error(`Amostra #25: cobertura deve conter 60 casos; encontrada ${cases.length}`)

  const ids = new Set<string>()
  for (const item of cases) {
    if (ids.has(item.id)) throw new Error(`Amostra #25: id duplicado ${item.id}`)
    ids.add(item.id)
  }

  const count = (predicate: (item: Sample25Case) => boolean) => cases.filter(predicate).length
  const coverage = [
    ['China', count((item) => item.segment.startsWith('china-')), 30],
    ['Pequim', count((item) => item.city === 'Pequim'), 15],
    ['Xangai', count((item) => item.city === 'Xangai'), 15],
    ['global', count((item) => item.segment.startsWith('global-')), 20],
    ['endereço', count((item) => item.segment === 'endereco'), 10],
  ] as const
  for (const [label, actual, expected] of coverage) {
    if (actual !== expected)
      throw new Error(
        `Amostra #25: cobertura de ${label} deve ser ${expected}; encontrada ${actual}`,
      )
  }

  const requiredSegments: Sample25Segment[] = [
    'china-atracao',
    'china-hotel',
    'china-restaurante',
    'global-atracao',
    'global-restaurante',
    'global-hotel',
  ]
  for (const segment of requiredSegments) {
    if (count((item) => item.segment === segment) === 0) {
      throw new Error(`Amostra #25: cobertura ausente para ${segment}`)
    }
  }
  if (count((item) => item.segment === 'china-atracao' && item.essential === true) < 10) {
    throw new Error('Amostra #25: precisa marcar ao menos 10 atrações essenciais da China')
  }
  return { method, cases }
}

export function loadSample25(): Sample25 {
  const json = readFileSync(new URL('../data/amostra-25.json', import.meta.url), 'utf8')
  return validateSample25(JSON.parse(json) as unknown)
}

export const sample25 = loadSample25()
export const measuredSample25 = sample25.cases.filter(
  (item) => item.verification.status === 'verified',
)
