import { describe, expect, it } from 'vitest'
import { buildApiUrl, searchGeoapify } from './client.ts'
import { sampleCases } from './sample.ts'
import { createRequestPlan } from './plan.ts'

const requests = createRequestPlan(sampleCases.slice(0, 2))
const geocodingPoi = requests[0]!
const placesPoi = requests[1]!
const geocodingAddress = createRequestPlan(
  sampleCases.filter((item) => item.kind === 'address').slice(0, 1),
)[0]!

describe('cliente Geoapify', () => {
  it('monta Geocoding amenity com contexto, limite e idioma local', () => {
    const url = buildApiUrl(geocodingPoi, 'test-key').searchParams

    expect(url.get('name')).toBe('故宫博物院')
    expect(url.get('city')).toBe('Beijing')
    expect(url.get('type')).toBe('amenity')
    expect(url.get('lang')).toBe('zh')
    expect(url.get('limit')).toBe('5')
    expect(url.get('filter')).toBe('countrycode:cn')
  })

  it('monta Geocoding de endereço como texto livre, sem misturar entrada estruturada', () => {
    const params = buildApiUrl(geocodingAddress, 'test-key').searchParams

    expect(params.get('text')).toBe('1600 Pennsylvania Avenue NW, Washington, DC 20500')
    expect(params.has('name')).toBe(false)
    expect(params.has('type')).toBe(false)
    expect(params.get('limit')).toBe('5')
  })

  it('monta Places com categoria, nome e bias espacial', () => {
    const url = buildApiUrl(placesPoi, 'test-key')

    expect(url.pathname).toBe('/v2/places')
    expect(url.searchParams.get('name')).toBe('故宫博物院')
    expect(url.searchParams.get('categories')).toBe('tourism.attraction')
    expect(url.searchParams.get('bias')).toBe('proximity:116.3972,39.9163')
    expect(url.searchParams.get('limit')).toBe('5')
    expect(url.searchParams.get('lang')).toBe('zh')
  })

  it('normaliza resposta Places e estima créditos sem armazenar URL nem corpo bruto', async () => {
    const responseBody = {
      features: [
        {
          geometry: { type: 'Point', coordinates: [116.3974, 39.9165] },
          properties: {
            name: '故宫博物院',
            'name:en': 'Palace Museum',
            formatted: '故宫博物院, 景山前街, 东城区, 北京市',
            place_id: 'geoapify-id-1',
          },
        },
      ],
    }
    const result = await searchGeoapify(placesPoi, 'test-secret', {
      fetcher: async () => new Response(JSON.stringify(responseBody), { status: 200 }),
    })

    expect(result.status).toBe('success')
    expect(result.candidates[0]).toMatchObject({
      name: '故宫博物院',
      aliases: ['Palace Museum'],
      coordinates: { lat: 39.9165, lon: 116.3974 },
      placeId: 'geoapify-id-1',
    })
    expect(result.estimatedCredits).toBe(1)
    expect(JSON.stringify(result)).not.toContain('test-secret')
    expect(JSON.stringify(result)).not.toContain('api.geoapify.com')
  })

  it('marca ausência só para resposta HTTP válida sem resultados', async () => {
    const result = await searchGeoapify(geocodingPoi, 'test-key', {
      fetcher: async () => new Response(JSON.stringify({ results: [] }), { status: 200 }),
    })

    expect(result.status).toBe('not-found')
    expect(result.candidates).toEqual([])
    expect(result.estimatedCredits).toBe(1)
    expect(result.errorKind).toBeUndefined()
  })

  it('classifica erro de autenticação sem expor chave, URL ou corpo remoto', async () => {
    const result = await searchGeoapify(geocodingPoi, 'secret-value', {
      fetcher: async () =>
        new Response(JSON.stringify({ message: 'secret-value rejected' }), { status: 401 }),
    })

    expect(result.status).toBe('error')
    expect(result.errorKind).toBe('unauthorized')
    expect(result.httpStatus).toBe(401)
    expect(result.estimatedCredits).toBe(null)
    expect(JSON.stringify(result)).not.toContain('secret-value')
    expect(JSON.stringify(result)).not.toContain('api.geoapify.com')
  })
})
