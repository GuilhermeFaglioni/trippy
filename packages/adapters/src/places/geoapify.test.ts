import { describe, expect, it, vi } from 'vitest'
import { GeoapifyPlacesProvider } from './geoapify.ts'

const placesCategories = [
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
]

const location = {
  results: [{ lat: 38.7223, lon: -9.1393, country_code: 'pt' }],
}

const feature = {
  geometry: { type: 'Point', coordinates: [-9.1393, 38.7223] },
  properties: {
    place_id: 'geoapify-123',
    name: 'Museu do Teste',
    local_name: 'Nome local recebido',
    formatted: 'Praça do Teste, Lisboa',
    local_address: 'Praça local, Lisboa',
    country_code: 'pt',
    datasource: {
      sourcename: 'test-dataset',
      attribution: 'Atribuição recebida',
      license: 'Licença recebida',
    },
  },
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 })
}

describe('adaptador Geoapify', () => {
  it('geocodifica destino e usa localização, filtro, idioma e limite na busca principal', async () => {
    const requests: URL[] = []
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      requests.push(new URL(input.toString()))
      return requests.length === 1 ? json(location) : json({ results: [feature] })
    })
    const provider = new GeoapifyPlacesProvider('chave-teste', { fetcher: fetcher as typeof fetch })

    const candidates = await provider.search({
      query: 'Museu do Teste',
      destination: 'Lisboa',
      attempt: 'primary',
      lang: 'pt',
    })

    expect(requests[0]).toMatchObject({
      hostname: 'api.geoapify.com',
      pathname: '/v1/geocode/search',
    })
    expect(requests[0]!.searchParams.get('text')).toBe('Lisboa')
    expect(requests[0]!.searchParams.get('type')).toBe('city')
    expect(requests[0]!.searchParams.get('limit')).toBe('1')
    expect(requests[1]!.pathname).toBe('/v1/geocode/search')
    expect(requests[1]!.searchParams.get('name')).toBe('Museu do Teste')
    expect(requests[1]!.searchParams.get('type')).toBe('amenity')
    expect(requests[1]!.searchParams.get('limit')).toBe('5')
    expect(requests[1]!.searchParams.get('lang')).toBe('pt')
    expect(requests[1]!.searchParams.get('bias')).toBe('proximity:-9.1393,38.7223')
    expect(requests[1]!.searchParams.get('filter')).toBe('countrycode:pt')
    expect(candidates[0]).toMatchObject({
      provider: 'geoapify',
      providerRef: 'geoapify-123',
      name: 'Museu do Teste',
      localName: 'Nome local recebido',
      address: 'Praça do Teste, Lisboa',
      localAddress: 'Praça local, Lisboa',
      lat: 38.7223,
      lng: -9.1393,
      countryCode: 'pt',
      datasource: 'test-dataset',
      attribution: 'Atribuição recebida',
      license: 'Licença recebida',
      method: 'geocoding',
    })
    expect(JSON.stringify(candidates)).not.toContain('chave-teste')
  })

  it('usa Places somente na segunda tentativa, limita ao destino e não mescla tentativas', async () => {
    const requests: URL[] = []
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      requests.push(new URL(input.toString()))
      return requests.length === 1 ? json(location) : json({ features: [feature] })
    })
    const provider = new GeoapifyPlacesProvider('chave-teste', { fetcher: fetcher as typeof fetch })

    const candidates = await provider.search({
      query: 'Museu do Teste',
      destination: 'Lisboa',
      attempt: 'secondary',
    })

    expect(requests).toHaveLength(2)
    expect(requests[1]!.pathname).toBe('/v2/places')
    expect(requests[1]!.searchParams.get('name')).toBe('Museu do Teste')
    expect(requests[1]!.searchParams.get('limit')).toBe('5')
    expect(requests[1]!.searchParams.get('bias')).toBe('proximity:-9.1393,38.7223')
    expect(requests[1]!.searchParams.get('filter')).toBe('circle:-9.1393,38.7223,50000')
    expect(requests[1]!.searchParams.get('categories')?.split(',')).toEqual(placesCategories)
    expect(candidates).toHaveLength(1)
    expect(candidates[0]!.method).toBe('places')
  })

  it('permite configurar o raio espacial da busca Places', async () => {
    const requests: URL[] = []
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      requests.push(new URL(input.toString()))
      return requests.length === 1 ? json(location) : json({ features: [] })
    })
    const provider = new GeoapifyPlacesProvider('chave-teste', {
      fetcher: fetcher as typeof fetch,
      searchRadiusMeters: 25_000,
    })

    await provider.search({ query: 'Museu do Teste', destination: 'Lisboa', attempt: 'secondary' })

    expect(requests[1]!.searchParams.get('filter')).toBe('circle:-9.1393,38.7223,25000')
  })

  it('compartilha geocodificação concorrente do mesmo destino e respeita ausência de lang', async () => {
    const requests: URL[] = []
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      requests.push(new URL(input.toString()))
      if (requests.length === 1) return json(location)
      return json({ results: [] })
    })
    const provider = new GeoapifyPlacesProvider('chave-teste', { fetcher: fetcher as typeof fetch })

    await Promise.all([
      provider.search({ query: 'Primeira', destination: 'Lisboa', attempt: 'primary' }),
      provider.search({ query: 'Segunda', destination: 'Lisboa', attempt: 'primary' }),
    ])

    expect(requests).toHaveLength(3)
    expect(requests[2]!.searchParams.has('lang')).toBe(false)
    expect(requests.filter((url) => url.searchParams.get('type') === 'city')).toHaveLength(1)
  })

  it('registra cada chamada externa sem incluir chave ou corpo remoto', async () => {
    const calls: unknown[] = []
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(input.toString())
      return url.pathname === '/v1/geocode/search' && url.searchParams.get('type') === 'city'
        ? json(location)
        : json({ results: [] })
    })
    const provider = new GeoapifyPlacesProvider('segredo', { fetcher: fetcher as typeof fetch })

    await provider.search(
      { query: 'Ausente', destination: 'Lisboa', attempt: 'primary' },
      async (call) => {
        calls.push(call)
      },
    )

    expect(calls).toMatchObject([
      { provider: 'geoapify', sku: 'geocoding', status: '200' },
      { provider: 'geoapify', sku: 'geocoding', status: '200' },
    ])
    expect(JSON.stringify(calls)).not.toContain('segredo')
  })
})
