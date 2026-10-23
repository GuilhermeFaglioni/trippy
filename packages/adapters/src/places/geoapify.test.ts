import { readFileSync } from 'node:fs'
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

const beijing = {
  results: [{ lat: 39.9042, lon: 116.4074, country_code: 'cn' }],
}

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')) as unknown
}

const geocodingResponse = loadFixture('geoapify-geocoding-json.json')
const placesResponse = loadFixture('geoapify-places-geojson.json')

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 })
}

function syntheticPlace(id: string, name: string, lat: number, lng: number, countryCode: string) {
  return {
    type: 'Feature',
    properties: {
      place_id: id,
      name,
      lat,
      lon: lng,
      country_code: countryCode,
      formatted: name,
      datasource: {
        sourcename: 'openstreetmap',
        attribution: '© OpenStreetMap contributors',
        license: 'Open Database License',
      },
    },
    geometry: { type: 'Point', coordinates: [lng, lat] },
  }
}

describe('adaptador Geoapify', () => {
  it('interpreta resultados planos format=json e usa localização, filtro, idioma e limite', async () => {
    const requests: URL[] = []
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      requests.push(new URL(input.toString()))
      return requests.length === 1 ? json(location) : json(geocodingResponse)
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
    expect(requests[1]!.searchParams.get('format')).toBe('json')
    expect(candidates[0]).toMatchObject({
      provider: 'geoapify',
      providerRef: 'geoapify-geocoding-contract-1',
      name: 'Museu do Teste',
      localName: 'Nome local recebido',
      address: 'Praça do Teste, Lisboa',
      localAddress: 'Praça local, Lisboa',
      lat: 38.7223,
      lng: -9.1393,
      countryCode: 'pt',
      datasource: 'openstreetmap',
      attribution: '© OpenStreetMap contributors',
      license: 'Open Database License',
      method: 'geocoding',
    })
    expect(JSON.stringify(candidates)).not.toContain('chave-teste')
  })

  it('preserva o GeoJSON do Places somente na segunda tentativa e não mescla tentativas', async () => {
    const requests: URL[] = []
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      requests.push(new URL(input.toString()))
      return requests.length === 1 ? json(location) : json(placesResponse)
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
    expect(candidates[0]).toMatchObject({
      providerRef: 'geoapify-places-contract-1',
      name: 'Museu do Teste',
      lat: 38.7223,
      lng: -9.1393,
      datasource: 'openstreetmap',
      attribution: '© OpenStreetMap contributors',
      license: 'Open Database License',
    })
    expect(candidates[0]!.method).toBe('places')
  })

  it('descarta resultados incompletos sem descartar endereço opcional ausente', async () => {
    const requests: URL[] = []
    const result = (geocodingResponse as { results: Array<Record<string, unknown>> }).results[0]!
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      requests.push(new URL(input.toString()))
      if (requests.length === 1) return json(location)
      return json({
        results: [
          result,
          { ...result, place_id: '' },
          { ...result, name: ' ' },
          { ...result, lat: 91 },
          { ...result, datasource: { attribution: '© OpenStreetMap contributors' } },
          { ...result, formatted: null, local_address: null, local_name: null },
        ],
      })
    })
    const provider = new GeoapifyPlacesProvider('chave-teste', { fetcher: fetcher as typeof fetch })

    const candidates = await provider.search({
      query: 'Museu do Teste',
      destination: 'Lisboa',
      attempt: 'primary',
    })

    expect(candidates).toHaveLength(2)
    expect(candidates[1]).toMatchObject({
      providerRef: 'geoapify-geocoding-contract-1',
      address: null,
      localAddress: null,
      localName: null,
    })
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

  it('não aceita candidato primário de outro país se a resposta contrariar o filtro', async () => {
    const requests: URL[] = []
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(input.toString())
      requests.push(url)
      if (url.searchParams.get('type') === 'city') return json(beijing)
      return json({
        results: [
          {
            ...(geocodingResponse as { results: Array<Record<string, unknown>> }).results[0],
            place_id: 'synthetic-macau-result',
            name: 'Resultado sintético fora do país',
            lat: 22.1987,
            lon: 113.5439,
            country_code: 'mo',
          },
          {
            ...(geocodingResponse as { results: Array<Record<string, unknown>> }).results[0],
            place_id: 'synthetic-beijing-result',
            name: 'Resultado sintético em Pequim',
            lat: 39.9042,
            lon: 116.4074,
            country_code: 'cn',
          },
        ],
      })
    })
    const provider = new GeoapifyPlacesProvider('chave-teste', { fetcher: fetcher as typeof fetch })

    const candidates = await provider.search({
      query: 'Cidade Proibida',
      destination: 'Pequim, China',
      attempt: 'primary',
    })

    expect(requests[1]!.searchParams.get('filter')).toBe('countrycode:cn')
    expect(candidates.map((candidate) => candidate.providerRef)).toEqual([
      'synthetic-beijing-result',
    ])
  })

  it('mantém a segunda tentativa dentro do círculo solicitado ao fornecedor', async () => {
    const requests: URL[] = []
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(input.toString())
      requests.push(url)
      if (url.searchParams.get('type') === 'city') return json(beijing)
      return json({
        features: [
          syntheticPlace('synthetic-inside-circle', 'Dentro do círculo', 40.1, 116.4, 'cn'),
          syntheticPlace('synthetic-outside-circle', 'Fora do círculo', 22.1987, 113.5439, 'mo'),
        ],
      })
    })
    const provider = new GeoapifyPlacesProvider('chave-teste', { fetcher: fetcher as typeof fetch })

    const candidates = await provider.search({
      query: 'Cidade Proibida',
      destination: 'Pequim, China',
      attempt: 'secondary',
    })

    expect(requests[1]!.searchParams.get('filter')).toBe('circle:116.4074,39.9042,50000')
    expect(candidates.map((candidate) => candidate.providerRef)).toEqual([
      'synthetic-inside-circle',
    ])
  })

  it('compõe o timeout do destino e da busca num único prazo por consulta', async () => {
    let now = 1_000
    const requests: URL[] = []
    const calls: unknown[] = []
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(input.toString())
      requests.push(url)
      if (url.searchParams.get('type') === 'city') {
        now += 4_500
        return json(beijing)
      }
      now += 600
      return json({ results: [] })
    })
    const provider = new GeoapifyPlacesProvider('chave-teste', {
      fetcher: fetcher as typeof fetch,
      timeoutMs: 5_000,
      now: () => now,
    })

    await expect(
      provider.search(
        { query: 'Cidade Proibida', destination: 'Pequim, China', attempt: 'primary' },
        async (call) => {
          calls.push(call)
        },
      ),
    ).rejects.toMatchObject({ kind: 'provider_timeout' })

    expect(requests).toHaveLength(2)
    expect(calls).toMatchObject([
      { provider: 'geoapify', sku: 'geocoding', status: '200' },
      { provider: 'geoapify', sku: 'geocoding', status: 'timeout' },
    ])
  })

  it('não reutiliza geocodificação do destino entre idiomas diferentes', async () => {
    const requests: URL[] = []
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(input.toString())
      requests.push(url)
      if (url.searchParams.get('type') === 'city') {
        return url.searchParams.get('lang') === 'zh' ? json(beijing) : json(location)
      }
      return json({ results: [] })
    })
    const provider = new GeoapifyPlacesProvider('chave-teste', { fetcher: fetcher as typeof fetch })

    await provider.search({
      query: 'Museu',
      destination: 'Destino ambíguo',
      attempt: 'primary',
      lang: 'pt',
    })
    await provider.search({
      query: '博物馆',
      destination: 'Destino ambíguo',
      attempt: 'primary',
      lang: 'zh',
    })

    const destinationRequests = requests.filter((url) => url.searchParams.get('type') === 'city')
    expect(destinationRequests.map((url) => url.searchParams.get('lang'))).toEqual(['pt', 'zh'])
    expect(requests[3]!.searchParams.get('bias')).toBe('proximity:116.4074,39.9042')
  })
})
