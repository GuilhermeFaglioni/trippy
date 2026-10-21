import { describe, expect, it, vi } from 'vitest'
import { GooglePlacesProvider } from './google.ts'

const placeId = 'ChIJ-lugar-123'
const photoName = `places/${placeId}/photos/foto-123`

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

const searchResult = { places: [{ id: placeId }, { id: 'ChIJ-lugar-456' }] }
const detailsResult = {
  id: placeId,
  displayName: { text: 'Nome Google sentinela' },
  primaryTypeDisplayName: { text: 'Tipo Google sentinela' },
  formattedAddress: 'Endereço Google sentinela',
  googleMapsUri: 'https://maps.google.test/sentinela',
  photos: [
    {
      name: photoName,
      widthPx: 1600,
      heightPx: 900,
      authorAttributions: [
        {
          displayName: 'Autoria Google sentinela',
          uri: 'https://maps.google.test/autor-sentinela',
          photoUri: 'https://maps.google.test/foto-autor-sentinela',
        },
      ],
    },
  ],
}

describe('adaptador Google Places', () => {
  it('usa máscaras exatas IDs Only e Pro e restrição retangular das coordenadas salvas', async () => {
    const requests: Array<{ url: URL; init?: RequestInit }> = []
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input.toString())
      requests.push({ url, ...(init ? { init } : {}) })
      if (url.pathname.endsWith(':searchText')) return json(searchResult)
      if (url.pathname.endsWith('/media')) return json({ photoUri: 'https://foto.google.test/temp' })
      return json(detailsResult)
    })
    const provider = new GooglePlacesProvider('chave-secreta', {
      fetcher: fetcher as typeof fetch,
      restrictionRadiusMeters: 1_000,
      photoWidthPx: 800,
      sleep: async () => {},
      random: () => 0,
    })

    const result = await provider.getDetails({ name: 'Nome Geoapify', lat: 39.9163, lng: 116.3972 })

    expect(requests).toHaveLength(3)
    const search = requests[0]!
    expect(search.url.pathname).toBe('/v1/places:searchText')
    expect(search.init?.headers).toMatchObject({
      'X-Goog-Api-Key': 'chave-secreta',
      'X-Goog-FieldMask': 'places.id',
    })
    expect(search.init?.headers).not.toMatchObject({ 'X-Goog-FieldMask': '*' })
    expect(JSON.parse(String(search.init?.body))).toEqual({
      textQuery: 'Nome Geoapify',
      pageSize: 5,
      locationRestriction: {
        rectangle: {
          low: expect.objectContaining({ latitude: expect.any(Number), longitude: expect.any(Number) }),
          high: expect.objectContaining({ latitude: expect.any(Number), longitude: expect.any(Number) }),
        },
      },
    })
    const details = requests[1]!
    expect(details.url.pathname).toBe(`/v1/places/${placeId}`)
    expect(details.init?.headers).toMatchObject({
      'X-Goog-Api-Key': 'chave-secreta',
      'X-Goog-FieldMask':
        'id,displayName,primaryTypeDisplayName,formattedAddress,googleMapsUri,photos',
    })
    const photo = requests[2]!
    expect(photo.url.pathname).toBe(`/v1/${photoName}/media`)
    expect(photo.url.searchParams.get('maxWidthPx')).toBe('800')
    expect(photo.url.searchParams.get('skipHttpRedirect')).toBe('true')
    expect(photo.url.searchParams.has('key')).toBe(false)
    expect(result).toMatchObject({
      candidateIds: [placeId, 'ChIJ-lugar-456'],
      current: {
        googlePlaceId: placeId,
        name: 'Nome Google sentinela',
        type: 'Tipo Google sentinela',
        address: 'Endereço Google sentinela',
        googleMapsUri: 'https://maps.google.test/sentinela',
        photo: {
          uri: 'https://foto.google.test/temp',
          widthPx: 1600,
          heightPx: 900,
          authorAttributions: [
            {
              displayName: 'Autoria Google sentinela',
              uri: 'https://maps.google.test/autor-sentinela',
              photoUri: 'https://maps.google.test/foto-autor-sentinela',
            },
          ],
        },
      },
    })
    expect(JSON.stringify(requests.map(({ url }) => url))).not.toContain('chave-secreta')
  })

  it('usa o ID alternativo somente quando Text Search o devolve', async () => {
    const requests: URL[] = []
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      requests.push(new URL(input.toString()))
      return requests.at(-1)!.pathname.endsWith(':searchText')
        ? json(searchResult)
        : json({ ...detailsResult, id: 'ChIJ-lugar-456', photos: [] })
    })
    const provider = new GooglePlacesProvider('chave-secreta', { fetcher: fetcher as typeof fetch })

    await provider.getDetails({
      name: 'Nome Geoapify',
      lat: 39.9163,
      lng: 116.3972,
      googlePlaceId: 'ChIJ-lugar-456',
    })
    expect(requests[1]!.pathname).toBe('/v1/places/ChIJ-lugar-456')

    await expect(
      provider.getDetails({
        name: 'Nome Geoapify',
        lat: 39.9163,
        lng: 116.3972,
        googlePlaceId: 'ChIJ-fora-da-lista',
      }),
    ).rejects.toMatchObject({ kind: 'invalid_google_place' })
  })

  it('repete uma vez em 429 com backoff e registra os dois SKUs sem conteúdo', async () => {
    const sleeps: number[] = []
    const calls: unknown[] = []
    let searchAttempts = 0
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(input.toString())
      if (url.pathname.endsWith(':searchText')) {
        searchAttempts += 1
        if (searchAttempts === 1) return json({ error: 'corpo não deve persistir' }, 429)
        return json({ places: [{ id: placeId }] })
      }
      return json({ ...detailsResult, photos: [] })
    })
    const provider = new GooglePlacesProvider('chave-secreta', {
      fetcher: fetcher as typeof fetch,
      sleep: async (delay) => {
        sleeps.push(delay)
      },
      random: () => 0,
    })

    await provider.getDetails(
      { name: 'Nome Geoapify', lat: 39.9163, lng: 116.3972 },
      async (call) => {
        calls.push(call)
      },
    )

    expect(searchAttempts).toBe(2)
    expect(sleeps).toEqual([500])
    expect(calls).toMatchObject([
      { provider: 'google', sku: 'text_search_ids_only', status: '429' },
      { provider: 'google', sku: 'text_search_ids_only', status: '200' },
      { provider: 'google', sku: 'place_details_pro', status: '200' },
    ])
    expect(JSON.stringify(calls)).not.toContain('corpo não deve persistir')
    expect(JSON.stringify(calls)).not.toContain('chave-secreta')
  })

  it('repete uma vez em 5xx com backoff de 200 ms mais jitter', async () => {
    const sleeps: number[] = []
    let searchAttempts = 0
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(input.toString())
      if (url.pathname.endsWith(':searchText')) {
        searchAttempts += 1
        if (searchAttempts === 1) return json({ error: 'erro remoto' }, 503)
        return json({ places: [{ id: placeId }] })
      }
      return json({ ...detailsResult, photos: [] })
    })
    const provider = new GooglePlacesProvider('chave-secreta', {
      fetcher: fetcher as typeof fetch,
      sleep: async (delay) => {
        sleeps.push(delay)
      },
      random: () => 0.5,
    })

    await provider.getDetails({ name: 'Nome Geoapify', lat: 39.9163, lng: 116.3972 })

    expect(searchAttempts).toBe(2)
    expect(sleeps).toEqual([250])
  })

  it('aplica timeout e não repete falha de transporte', async () => {
    const fetcher = vi.fn(async () => {
      throw new DOMException('Tempo esgotado', 'TimeoutError')
    })
    const provider = new GooglePlacesProvider('chave-secreta', {
      fetcher: fetcher as typeof fetch,
      timeoutMs: 5_000,
    })
    const calls: unknown[] = []

    await expect(
      provider.getDetails(
        { name: 'Nome Geoapify', lat: 39.9163, lng: 116.3972 },
        async (call) => {
          calls.push(call)
        },
      ),
    ).rejects.toMatchObject({ kind: 'provider_timeout' })

    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(calls).toMatchObject([
      { provider: 'google', sku: 'text_search_ids_only', status: 'timeout' },
    ])
  })

  it('retorna sem foto quando Google não devolve referência de foto', async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(input.toString())
      return url.pathname.endsWith(':searchText')
        ? json(searchResult)
        : json({ ...detailsResult, photos: [] })
    })
    const provider = new GooglePlacesProvider('chave-secreta', { fetcher: fetcher as typeof fetch })

    const result = await provider.getDetails({ name: 'Nome Geoapify', lat: 39.9163, lng: 116.3972 })

    expect(result.current.photo).toBeNull()
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
})
