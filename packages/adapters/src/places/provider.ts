import type {
  GoogleDetailsResponse,
  PlaceSearchCandidateFields,
} from '@trippy/domain/places'

export interface PlacesSearchInput {
  query: string
  destination: string
  attempt: 'primary' | 'secondary'
  lang?: string
}

export interface GoogleDetailsInput {
  name: string
  lat: number
  lng: number
  googlePlaceId?: string
}

export interface ProviderCall {
  provider: 'geoapify' | 'google'
  sku: string
  status: string
  latencyMs: number
}

export type ProviderCallHandler = (call: ProviderCall) => Promise<void>

export interface PlacesProvider {
  search(
    input: PlacesSearchInput,
    onProviderCall?: ProviderCallHandler,
  ): Promise<PlaceSearchCandidateFields[]>
}

export interface GooglePlacesProvider {
  getDetails(
    input: GoogleDetailsInput,
    onProviderCall?: ProviderCallHandler,
  ): Promise<GoogleDetailsResponse>
}

export type PlacesProviderErrorKind =
  | 'location_unavailable'
  | 'provider_error'
  | 'provider_timeout'
  | 'google_place_not_found'
  | 'invalid_google_place'

/** Erro seguro para HTTP; não carrega URL, chave nem corpo do fornecedor. */
export class PlacesProviderError extends Error {
  constructor(readonly kind: PlacesProviderErrorKind) {
    super(kind)
  }
}
