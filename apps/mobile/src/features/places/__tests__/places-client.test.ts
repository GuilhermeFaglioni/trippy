import type { GoogleDetailsResponse, PlaceSearchCandidate } from '@trippy/domain'

import { createPlacesClient, PlacesApiError } from '../places-client'

const candidate: PlaceSearchCandidate = {
  provider: 'geoapify',
  providerRef: 'geo-1',
  name: 'Café da Praça',
  localName: null,
  address: 'Praça da Sé, 1',
  localAddress: null,
  lat: -23.55,
  lng: -46.63,
  countryCode: 'br',
  datasource: 'openstreetmap',
  attribution: '© OpenStreetMap contributors',
  license: 'ODbL',
  method: 'geocoding',
  token: 'candidate-token',
}

const googleDetails: GoogleDetailsResponse = {
  candidateIds: ['google-place-1'],
  current: {
    googlePlaceId: 'google-place-1',
    name: 'Café da Praça',
    type: 'Cafeteria',
    address: 'Praça da Sé, 1',
    photo: null,
    googleMapsUri: 'https://maps.google.com/?q=Cafe',
  },
}

function response(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status })
}

describe('cliente HTTP de lugares', () => {
  it('busca candidatos com consulta codificada e tentativa principal ou secundária', async () => {
    const request = jest.fn().mockResolvedValue(response({ candidates: [candidate] }))
    const client = createPlacesClient(request)

    await expect(client.search('trip-1', 'Café da Praça', 'secondary')).resolves.toEqual({
      candidates: [candidate],
    })

    expect(request).toHaveBeenCalledWith(
      '/trips/trip-1/places/search?q=Caf%C3%A9%20da%20Pra%C3%A7a&attempt=secondary',
    )
  })

  it('busca detalhes do Google sem persistir a resposta e envia ID só para outro candidato', async () => {
    const request = jest.fn().mockImplementation(async () => response(googleDetails))
    const client = createPlacesClient(request)

    await client.googleDetails('trip-1', 'place-1')
    await client.googleDetails('trip-1', 'place-1', 'google-place-2')

    expect(request).toHaveBeenNthCalledWith(1, '/trips/trip-1/places/place-1/google-details', {
      method: 'POST',
    })
    expect(request).toHaveBeenNthCalledWith(2, '/trips/trip-1/places/place-1/google-details', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ googlePlaceId: 'google-place-2' }),
    })
  })

  it.each([
    [503, 'provider_unavailable'],
    [422, 'place_without_provider_data'],
    [429, 'rate_limited'],
  ])('preserva status e código HTTP para %i', async (status, errorCode) => {
    const request = jest
      .fn()
      .mockResolvedValue(response({ error: errorCode, message: 'Falha controlada' }, status))
    const client = createPlacesClient(request)

    await expect(client.search('trip-1', 'Museu', 'primary')).rejects.toMatchObject<
      Partial<PlacesApiError>
    >({
      status,
      code: errorCode,
      message: 'Falha controlada',
    })
  })

  it('busca lugares perto da coordenada no endpoint nearby e valida a mesma resposta', async () => {
    const request = jest.fn().mockResolvedValue(response({ candidates: [candidate] }))
    const client = createPlacesClient(request)

    await expect(client.nearby('trip-1', -23.55, -46.63)).resolves.toEqual({
      candidates: [candidate],
    })
    expect(request).toHaveBeenCalledWith('/trips/trip-1/places/nearby?lat=-23.55&lng=-46.63')

    request.mockResolvedValueOnce(response({ candidates: [{ name: 'sem contrato' }] }))
    await expect(client.nearby('trip-1', -23.55, -46.63)).rejects.toMatchObject({
      status: 502,
      code: 'unexpected_error',
    })
  })
})
