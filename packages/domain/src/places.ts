import type { Role } from './roles.ts'

export interface PlaceSearchCandidateFields {
  provider: 'geoapify'
  providerRef: string
  name: string
  localName: string | null
  address: string | null
  localAddress: string | null
  lat: number
  lng: number
  countryCode: string | null
  datasource: string
  attribution: string
  license: string
  method: 'geocoding' | 'places'
}

/** Candidato de busca; token cobre todos os campos acima, sem incluir a si mesmo. */
export interface PlaceSearchCandidate extends PlaceSearchCandidateFields {
  token: string
}

export interface PlaceSearchResponse {
  candidates: PlaceSearchCandidate[]
}

export interface GooglePhotoAuthorAttribution {
  displayName: string
  uri: string
  photoUri: string
}

export interface GooglePlacePhoto {
  uri: string
  widthPx: number
  heightPx: number
  authorAttributions: GooglePhotoAuthorAttribution[]
}

export interface GoogleDetailsResponse {
  candidateIds: string[]
  current: {
    googlePlaceId: string
    name: string
    type: string | null
    address: string | null
    photo: GooglePlacePhoto | null
    googleMapsUri: string
  }
}

export type LocalDetailStatus = 'missing' | 'incomplete' | 'not_local_language' | 'ok'

export interface LocalDetailClassificationInput {
  userValue: string | null
  providerValue: string | null
  countryCode: string | null
  kind: 'name' | 'address'
}

export interface CanRemovePlaceInput {
  role: Role
  userId: string
  suggestedBy: string
}

/** Quem sugeriu o lugar ou tem papel de organização pode removê-lo. */
export function canRemovePlace({ role, userId, suggestedBy }: CanRemovePlaceInput): boolean {
  return userId === suggestedBy || role === 'organizer' || role === 'coorganizer'
}

/** Quem pode remover um lugar também pode confirmar ou recusar a correspondência do Google. */
export function canConfirmGooglePlace(input: CanRemovePlaceInput): boolean {
  return canRemovePlace(input)
}

const scriptsByCountry: Readonly<Record<string, readonly RegExp[]>> = {
  CN: [/\p{Script=Han}/u],
  HK: [/\p{Script=Han}/u],
  MO: [/\p{Script=Han}/u],
  TW: [/\p{Script=Han}/u],
  JP: [/\p{Script=Han}/u, /\p{Script=Hiragana}/u, /\p{Script=Katakana}/u],
  KR: [/\p{Script=Hangul}/u],
  TH: [/\p{Script=Thai}/u],
  RU: [/\p{Script=Cyrillic}/u],
  BY: [/\p{Script=Cyrillic}/u],
  UA: [/\p{Script=Cyrillic}/u],
  BG: [/\p{Script=Cyrillic}/u],
  KZ: [/\p{Script=Cyrillic}/u],
  KG: [/\p{Script=Cyrillic}/u],
  RS: [/\p{Script=Cyrillic}/u],
  MK: [/\p{Script=Cyrillic}/u],
  TJ: [/\p{Script=Cyrillic}/u],
  SA: [/\p{Script=Arabic}/u],
  AE: [/\p{Script=Arabic}/u],
  EG: [/\p{Script=Arabic}/u],
  AF: [/\p{Script=Arabic}/u],
  IR: [/\p{Script=Arabic}/u],
  IQ: [/\p{Script=Arabic}/u],
  JO: [/\p{Script=Arabic}/u],
  KW: [/\p{Script=Arabic}/u],
  LB: [/\p{Script=Arabic}/u],
  OM: [/\p{Script=Arabic}/u],
  QA: [/\p{Script=Arabic}/u],
  SD: [/\p{Script=Arabic}/u],
  SY: [/\p{Script=Arabic}/u],
  YE: [/\p{Script=Arabic}/u],
  IL: [/\p{Script=Hebrew}/u],
  BD: [/\p{Script=Bengali}/u],
  NP: [/\p{Script=Devanagari}/u],
  MM: [/\p{Script=Myanmar}/u],
  KH: [/\p{Script=Khmer}/u],
  LA: [/\p{Script=Lao}/u],
  GR: [/\p{Script=Greek}/u],
  GE: [/\p{Script=Georgian}/u],
  AM: [/\p{Script=Armenian}/u],
}

const commonStreetMarkers =
  /\b(?:street|st|road|rd|avenue|ave|boulevard|blvd|lane|ln|highway|hwy|route|way|rua|av|avenida|estrada|rodovia|alameda|travessa|largo|praça|rue|r|chemin|via|calle|calzada|carrer|strada|straße|strasse|gasse|weg|platz|улица|ул|проспект|просп|переулок)\.?(?=[\s,]|$)/iu
const countryStreetMarkers: Readonly<Record<string, RegExp>> = {
  CN: /[路街号道巷弄]/u,
  HK: /[路街號道巷弄]/u,
  MO: /[路街號道巷弄]/u,
  TW: /[路街號道巷弄]/u,
  JP: /[丁目番地号通り道]/u,
  KR: /[로길동번]/u,
  TH: /[ถนนซอย]/u,
  RU: /(?:улица|ул|проспект|просп|переулок|шоссе)\.?(?=[\s,]|$)/iu,
  UA: /(?:вулиця|вул|проспект|провулок|шосе)\.?(?=[\s,]|$)/iu,
  SA: /(?:شارع|طريق)/u,
  AE: /(?:شارع|طريق)/u,
  EG: /(?:شارع|طريق)/u,
  BR: /\b(?:rua|av|avenida|estrada|rodovia|alameda|travessa|largo|praça)\.?(?=[\s,]|$)/iu,
  PT: /\b(?:rua|av|avenida|estrada|alameda|travessa|largo|praça)\.?(?=[\s,]|$)/iu,
}

/**
 * Prioriza a correção digitada pela pessoa. Endereço só é marcado incompleto por
 * comprimento ou falta conjunta de número e marcador de via; nome nunca recebe
 * esse estado. Alfabeto é apenas um sinal de destaque e só é usado quando o país
 * tem um script local conhecido; sem countryCode, idioma não é inferido e a
 * classificação não bloqueia o salvamento.
 */
export function classifyLocalDetail({
  userValue,
  providerValue,
  countryCode,
  kind,
}: LocalDetailClassificationInput): LocalDetailStatus {
  const value = userValue?.trim() || providerValue?.trim() || ''
  if (!value) return 'missing'

  const country = countryCode?.trim().toUpperCase() ?? ''
  if (kind === 'address') {
    const hasNumber = /\p{N}/u.test(value)
    const streetMarker = countryStreetMarkers[country] ?? commonStreetMarkers
    if (Array.from(value).length < 8 || (!hasNumber && !streetMarker.test(value))) {
      return 'incomplete'
    }
  }

  const expectedScripts = scriptsByCountry[country]
  if (
    expectedScripts &&
    hasLetters(value) &&
    !expectedScripts.some((script) => containsScript(value, script))
  ) {
    return 'not_local_language'
  }

  return 'ok'
}

function hasLetters(value: string): boolean {
  return /\p{L}/u.test(value)
}

function containsScript(value: string, script: RegExp): boolean {
  return Array.from(value).some((character) => script.test(character))
}

export type PlaceNameValidation =
  { success: true; value: string } | { success: false; message: string }

/** Valida e normaliza o nome manual do lugar para persistência e sincronização. */
export function validatePlaceName(value: unknown): PlaceNameValidation {
  if (typeof value !== 'string') {
    return { success: false, message: 'Informe o nome do lugar.' }
  }

  const trimmed = value.trim()
  const length = Array.from(trimmed).length
  if (length === 0) return { success: false, message: 'Informe o nome do lugar.' }
  if (length > 120) {
    return { success: false, message: 'O nome do lugar deve ter no máximo 120 caracteres.' }
  }

  return { success: true, value: trimmed }
}
