import { describe, expect, it } from 'vitest'
import {
  assertNoGoogleLeak,
  sanitizeGeoapifyGeocoding,
  sanitizeGooglePlace,
} from './sample-25-sanitize.ts'

// Dados fictícios: nenhuma chamada de rede, nenhum segredo real.
const FAKE_GEOAPIFY_KEY = 'fake-geoapify-key-0000'

describe('sanitização da resposta do Google', () => {
  it('descarta tudo menos o place_id de um objeto Google completo', () => {
    const googlePlace = {
      place_id: 'ChIJ-fake-place-id',
      name: 'places/ChIJ-fake-place-id',
      displayName: { text: 'Restaurante Fictício', languageCode: 'pt' },
      formattedAddress: 'Rua Inventada, 1, Pequim',
      location: { latitude: 39.9042, longitude: 116.4074 },
      photos: [{ name: 'places/x/photos/y', authorAttributions: [{ displayName: 'Fulano' }] }],
      googleMapsUri: 'https://maps.googleapis.com/maps?cid=1',
      rating: 4.5,
      regularOpeningHours: { openNow: true },
      types: ['restaurant'],
    }

    const sanitized = sanitizeGooglePlace(googlePlace)

    expect(sanitized).toEqual({ placeId: 'ChIJ-fake-place-id' })
    expect(Object.keys(sanitized ?? {})).toEqual(['placeId'])
    expect(() => assertNoGoogleLeak(sanitized)).not.toThrow()
  })

  it('aceita id quando place_id está ausente e prefere place_id quando os dois existem', () => {
    expect(sanitizeGooglePlace({ id: 'ChIJ-fake-id' })).toEqual({ placeId: 'ChIJ-fake-id' })
    expect(sanitizeGooglePlace({ place_id: 'ChIJ-a', id: 'ChIJ-b' })).toEqual({ placeId: 'ChIJ-a' })
  })

  it('devolve null para entradas sem place_id ou id utilizável', () => {
    expect(sanitizeGooglePlace(null)).toBeNull()
    expect(sanitizeGooglePlace('ChIJ-fake-place-id')).toBeNull()
    expect(sanitizeGooglePlace(['ChIJ-fake-place-id'])).toBeNull()
    expect(sanitizeGooglePlace({})).toBeNull()
    expect(sanitizeGooglePlace({ place_id: '' })).toBeNull()
    expect(sanitizeGooglePlace({ place_id: '   ', id: '' })).toBeNull()
    expect(sanitizeGooglePlace({ place_id: 42 })).toBeNull()
  })
})

describe('assertNoGoogleLeak', () => {
  it('aceita dados sem nada do Google', () => {
    expect(() =>
      assertNoGoogleLeak({ placeId: 'ChIJ-fake', results: [{ name: 'Templo' }] }),
    ).not.toThrow()
  })

  it('pega campo proibido aninhado no fundo da estrutura, indicando o caminho', () => {
    const report = {
      outer: { list: [{ ok: true }, { deep: { location: { lat: 1, lng: 2 } } }] },
    }

    expect(() => assertNoGoogleLeak(report)).toThrow(/\$\.outer\.list\[1\]\.deep\.location/)
  })

  it('pega chave de API do Google escrita numa string', () => {
    const report = { note: 'consulta feita com AIzaFAKEKEYFAKEKEYFAKEKEYFAKEKEYFAKE' }

    expect(() => assertNoGoogleLeak(report)).toThrow()
  })

  it('pega URL do Google Maps API numa string', () => {
    const report = { links: ['https://maps.googleapis.com/maps/api/place/details/json?x=1'] }

    expect(() => assertNoGoogleLeak(report)).toThrow()
  })

  it('pega chave proibida de Google mesmo dentro de bloco Geoapify marcado', () => {
    const geoapifyBlock = { provider: 'geoapify', results: [{ location: { lat: 1 } }] }

    expect(() => assertNoGoogleLeak(geoapifyBlock)).toThrow(/\$\.results\[0\]\.location/)
    expect(() =>
      assertNoGoogleLeak({ provider: 'outro', results: [{ location: { lat: 1 } }] }),
    ).toThrow()
    expect(() =>
      assertNoGoogleLeak({ results: [{ provider: 'geoapify', name: 'ok' }], photos: [] }),
    ).toThrow(/\$\.photos/)
  })

  it('pega string proibida mesmo dentro de bloco Geoapify marcado', () => {
    const geoapifyBlock = {
      provider: 'geoapify',
      results: [{ name: 'AIzaFAKEKEYFAKEKEYFAKEKEYFAKEKEY' }],
    }

    expect(() => assertNoGoogleLeak(geoapifyBlock)).toThrow()
  })
})

describe('sanitização da resposta de geocoding da Geoapify', () => {
  const rawResponse = {
    query: { text: 'Pequim, China', apiKey: FAKE_GEOAPIFY_KEY },
    request: {
      url: `https://api.geoapify.com/v1/geocode/search?apiKey=${FAKE_GEOAPIFY_KEY}&text=Pequim`,
    },
    results: [
      {
        name: 'Templo do Céu',
        formatted: 'Templo do Céu, Pequim, China',
        country: 'China',
        country_code: 'cn',
        city: 'Pequim',
        lat: 39.8822,
        lon: 116.4066,
        result_type: 'amenity',
        rank: { importance: 0.51, confidence: 1, popularity: 9 },
        place_id: 'geoapify-fake-1',
        datasource: { sourcename: 'openstreetmap', attribution: '© OpenStreetMap contributors' },
        apiKey: FAKE_GEOAPIFY_KEY,
        url: `https://api.geoapify.com/v1/geocode/search?apiKey=${FAKE_GEOAPIFY_KEY}`,
      },
    ],
  }

  it('mantém só a allowlist, sem chave de API nem URL da requisição', () => {
    const record = sanitizeGeoapifyGeocoding(rawResponse, { query: 'Pequim, China' })

    expect(record).toEqual({
      provider: 'geoapify',
      query: 'Pequim, China',
      results: [
        {
          name: 'Templo do Céu',
          formatted: 'Templo do Céu, Pequim, China',
          countryCode: 'cn',
          city: 'Pequim',
          lat: 39.8822,
          lon: 116.4066,
          resultType: 'amenity',
          rank: { importance: 0.51, confidence: 1 },
          placeId: 'geoapify-fake-1',
        },
      ],
    })

    const serialized = JSON.stringify(record)
    expect(serialized).not.toContain(FAKE_GEOAPIFY_KEY)
    expect(serialized).not.toContain('apiKey')
    expect(serialized).not.toContain('api.geoapify.com')
    expect(serialized).not.toContain('datasource')
    expect(() => assertNoGoogleLeak(record)).not.toThrow()
  })

  it('limita a 10 resultados, mantendo a ordem original', () => {
    const many = {
      results: Array.from({ length: 12 }, (_, index) => ({
        name: `Lugar ${index}`,
        lat: 1,
        lon: 1,
      })),
    }

    const record = sanitizeGeoapifyGeocoding(many, { query: 'lugares' })

    expect(record.results).toHaveLength(10)
    expect(record.results[0]?.name).toBe('Lugar 0')
    expect(record.results[9]?.name).toBe('Lugar 9')
  })

  it('devolve lista vazia para resposta inválida ou sem resultados', () => {
    expect(sanitizeGeoapifyGeocoding(null, { query: 'nada' })).toEqual({
      provider: 'geoapify',
      query: 'nada',
      results: [],
    })
    expect(
      sanitizeGeoapifyGeocoding({ results: 'não é lista' }, { query: 'nada' }).results,
    ).toEqual([])
  })

  it('descarta coordenadas fora da faixa válida', () => {
    const record = sanitizeGeoapifyGeocoding(
      { results: [{ name: 'Fora do mapa', lat: 120, lon: 10 }] },
      { query: 'x' },
    )

    expect(record.results[0]).not.toHaveProperty('lat')
    expect(record.results[0]).toEqual({ name: 'Fora do mapa', lon: 10 })
  })
})
