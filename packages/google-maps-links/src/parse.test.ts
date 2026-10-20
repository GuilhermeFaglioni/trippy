import { describe, expect, it } from 'vitest'
import { parseGoogleMapsUrl } from './parse.ts'

describe('parseGoogleMapsUrl', () => {
  // Exemplos da documentação oficial: Overview e Error codes, incluindo variação de tamanho.
  const officialPlaceIdExamples = [
    { family: 'ChIJ', variant: 'padrão', value: 'ChIJgUbEo8cfqokR5lP9_Wh_DaM' },
    { family: 'GhIJ', variant: 'padrão', value: 'GhIJQWDl0CIeQUARxks3icF8U8A' },
    {
      family: 'Eic',
      variant: 'estendido',
      value:
        'EicxMyBNYXJrZXQgU3QsIFdpbG1pbmd0b24sIE5DIDI4NDAxLCBVU0EiGhIYChQKEgnRTo6ixx-qiRHo_bbmkCm7ZRAN',
    },
    {
      family: 'Eic',
      variant: 'curto',
      value: 'EicxMyBNYXJrZXQgU3QsIFdpbG1pbmd0b24sIE5DIDI4NDAxLCBVU0E',
    },
    {
      family: 'IhoS',
      variant: 'padrão',
      value: 'IhoSGAoUChIJ0U6OoscfqokR6P225pApu2UQDQ',
    },
    {
      family: 'EpID',
      variant: 'longo',
      value:
        'EpID4LC14LC_4LCo4LCv4LGN4LCo4LCX4LCw4LGNIC0g4LC44LGI4LCm4LGN4LCs4LC-4LCm4LGNIOCwsOCxi-CwoeCxjeCwoeCxgSAmIOCwteCwv-CwqOCwr-CxjSDgsKjgsJfgsLDgsY0g4LCu4LGG4LCv4LC_4LCo4LGNIOCwsOCxi-CwoeCxjeCwoeCxgSwg4LC14LC_4LCo4LCv4LGNIOCwqOCwl-CwsOCxjSDgsJXgsL7gsLLgsKjgsYAsIOCwsuCwleCxjeCwt-CxjeCwruCwv-CwqOCwl-CwsOCxjSDgsJXgsL7gsLLgsKjgsYAsIOCwuOCwsOCxguCwsOCxjSDgsKjgsJfgsLDgsY0g4LC14LGG4LC44LGN4LCf4LGNLCDgsLjgsK_gsYDgsKbgsL7gsKzgsL7gsKbgsY0sIOCwueCxiOCwpuCwsOCwvuCwrOCwvuCwpuCxjSwg4LCk4LGG4LCy4LCC4LCX4LC-4LCjIDUwMDA1OSwg4LCt4LC-4LCw4LCk4LCm4LGH4LC24LCCImYiZAoUChIJ31l5uGWYyzsR9zY2qk9lDiASFAoSCd9ZebhlmMs7Efc2NqpPZQ4gGhQKEglDz61OZpjLOxHgDJCFY-o1qBoUChIJi37TW2-YyzsRr_uv50r7tdEiCg1MwFcKFS_dyy4',
    },
  ]

  describe.each(['q', 'query', 'path'] as const)('Place IDs oficiais em %s', (location) => {
    it.each(officialPlaceIdExamples)(
      'retorna fallback para $family ($variant) sem usar token como nome',
      ({ value }) => {
        const url =
          location === 'path'
            ? `https://www.google.com/maps/place/${encodeURIComponent(value)}`
            : `https://www.google.com/maps/search/?${location}=${encodeURIComponent(value)}`

        expect(parseGoogleMapsUrl(url)).toEqual({ kind: 'fallback', reason: 'opaque_id' })
      },
    )
  })

  it('usa coordenadas do lugar em vez de coordenadas de câmera', () => {
    expect(
      parseGoogleMapsUrl(
        'https://www.google.com/maps/place/Caf%C3%A9+Central/@47.6,-122.3,17z/data=!4m2!3m1!1sopaque!3d47.6205!4d-122.3493',
      ),
    ).toEqual({
      kind: 'coordinates',
      coordinates: { latitude: 47.6205, longitude: -122.3493 },
      source: 'place',
      query: 'Café Central',
    })
  })

  it('lê coordenadas de destino no parâmetro q', () => {
    expect(parseGoogleMapsUrl('https://www.google.com/maps/search/?q=40.7128%2C-74.006')).toEqual({
      kind: 'coordinates',
      coordinates: { latitude: 40.7128, longitude: -74.006 },
      source: 'query',
    })
  })

  it('retorna busca por texto de q', () => {
    expect(parseGoogleMapsUrl('https://www.google.com/maps/search/?api=1&q=Central+Park')).toEqual({
      kind: 'query',
      query: 'Central Park',
      reason: 'query',
    })
  })

  it.each([
    'https://www.google.com/maps?q=place_id:ChIJN1t_tDeuEmsRUsoyG83frY4',
    'https://www.google.com/maps/search/?api=1&query=ChIJN1t_tDeuEmsRUsoyG83frY4',
    'https://www.google.com/maps?q=0x47e66e2964e34e2d:0x8ddca9ee380ef7e0',
  ])('envia ID opaco em q/query para fallback: %s', (url) => {
    expect(parseGoogleMapsUrl(url)).toEqual({ kind: 'fallback', reason: 'opaque_id' })
  })

  it('preserva busca nominal acompanhada de um ID opaco', () => {
    expect(
      parseGoogleMapsUrl(
        'https://www.google.com/maps/search/?query=Casa+Batll%C3%B3+place_id%3AChIJN1t_tDeuEmsRUsoyG83frY4',
      ),
    ).toEqual({
      kind: 'query',
      query: 'Casa Batlló place_id:ChIJN1t_tDeuEmsRUsoyG83frY4',
      reason: 'query',
    })
  })

  it.each([
    'https://www.google.com/maps?q=PLACE_ID%3A%20VendorX%2Fnew-format',
    'https://www.google.com/maps/search/?query=place_id%3A%20%20VendorX%2Fnew-format%20',
    'https://www.google.com/maps/place/place_id%3AVendorX%2Fnew-format',
  ])('trata identificador explicitamente marcado sem exigir prefixo conhecido: %s', (url) => {
    expect(parseGoogleMapsUrl(url)).toEqual({ kind: 'fallback', reason: 'opaque_id' })
  })

  it('usa query quando q está vazio', () => {
    expect(
      parseGoogleMapsUrl(
        'https://www.google.com/maps/search/?q=&query=place_id%3AVendorX%2Fnew-format',
      ),
    ).toEqual({ kind: 'fallback', reason: 'opaque_id' })
  })

  it('mantém nome pesquisável quando acompanhado de ID com prefixo desconhecido', () => {
    expect(
      parseGoogleMapsUrl(
        'https://www.google.com/maps/search/?query=Casa%20Batll%C3%B3%20place_id%3AVendorX%2Fnew-format',
      ),
    ).toEqual({
      kind: 'query',
      query: 'Casa Batlló place_id:VendorX/new-format',
      reason: 'query',
    })
  })

  it('reconhece família oficial com capitalização variável sem alterar o identificador', () => {
    expect(
      parseGoogleMapsUrl('https://www.google.com/maps/search/?query=gHiJQWDl0CIeQUARxks3icF8U8A'),
    ).toEqual({ kind: 'fallback', reason: 'opaque_id' })
  })

  describe.each(['q', 'query', 'path'] as const)(
    'nome humano concatenado com prefixo de ID em %s',
    (location) => {
      it('preserva nome longo em TitleCase sem marcador opaco', () => {
        const name = 'ChIJunctionCafeAndBookshop'
        const url =
          location === 'path'
            ? `https://www.google.com/maps/place/${name}`
            : `https://www.google.com/maps/search/?${location}=${name}`
        const reason = location === 'path' ? 'place_name' : 'query'

        expect(parseGoogleMapsUrl(url)).toEqual({ kind: 'query', query: name, reason })
      })
    },
  )

  describe.each(['q', 'query', 'path'] as const)(
    'token opaco plausível sem nome em %s',
    (location) => {
      it('prioriza fallback para payload alfabético sem forma clara de nome', () => {
        const placeId = `ChIJ${'a'.repeat(16)}`
        const url =
          location === 'path'
            ? `https://www.google.com/maps/place/${placeId}`
            : `https://www.google.com/maps/search/?${location}=${placeId}`

        expect(parseGoogleMapsUrl(url)).toEqual({ kind: 'fallback', reason: 'opaque_id' })
      })
    },
  )

  describe.each(['q', 'query', 'path'] as const)(
    'tamanho variável de ID opaco em %s',
    (location) => {
      it('não impõe limite máximo ao token de família conhecida', () => {
        const placeId = `GhIJ${'aB9-_'.repeat(512)}`
        const url =
          location === 'path'
            ? `https://www.google.com/maps/place/${placeId}`
            : `https://www.google.com/maps/search/?${location}=${placeId}`

        expect(parseGoogleMapsUrl(url)).toEqual({ kind: 'fallback', reason: 'opaque_id' })
      })
    },
  )

  it.each([
    {
      url: 'https://www.google.com/maps/place/ChIJunctionCafe%20And%20Bookshop',
      expected: { kind: 'query', query: 'ChIJunctionCafe And Bookshop', reason: 'place_name' },
    },
    {
      url: 'https://www.google.com/maps/place/ChIJunction%20Cafe%202',
      expected: { kind: 'query', query: 'ChIJunction Cafe 2', reason: 'place_name' },
    },
    {
      url: 'https://www.google.com/maps/search/?query=The%20International%20Botanical%20Research%20Center%20and%20Gardens',
      expected: {
        kind: 'query',
        query: 'The International Botanical Research Center and Gardens',
        reason: 'query',
      },
    },
    {
      url: 'https://www.google.com/maps/search/?query=Eichenwald%20International%20Cultural%20Center',
      expected: {
        kind: 'query',
        query: 'Eichenwald International Cultural Center',
        reason: 'query',
      },
    },
  ])('mantém nome humano como busca nominal: $url', ({ url, expected }) => {
    expect(parseGoogleMapsUrl(url)).toEqual(expected)
  })

  it('usa !3d e !4d quando coordenadas de lugar estão presentes', () => {
    expect(
      parseGoogleMapsUrl('https://www.google.com/maps/place/Colosseum/data=!3d41.8902!4d12.4922'),
    ).toEqual({
      kind: 'coordinates',
      coordinates: { latitude: 41.8902, longitude: 12.4922 },
      source: 'place',
      query: 'Colosseum',
    })
  })

  it('não trata coordenadas @ como localização do lugar', () => {
    expect(parseGoogleMapsUrl('https://www.google.com/maps/place/Café/@-22.91,-43.17,15z')).toEqual(
      {
        kind: 'query',
        query: 'Café',
        reason: 'viewport',
      },
    )
  })

  it('usa nome do lugar como busca quando há ID opaco', () => {
    expect(
      parseGoogleMapsUrl('https://www.google.com/maps/place/Casa+Batll%C3%B3/data=!1s0xopaque'),
    ).toEqual({
      kind: 'query',
      query: 'Casa Batlló',
      reason: 'opaque_id',
    })
  })

  it('envia IDs opacos sem nome para fallback de busca', () => {
    expect(parseGoogleMapsUrl('https://www.google.com/maps?cid=123456789')).toEqual({
      kind: 'fallback',
      reason: 'opaque_id',
    })
  })

  it('envia ID de lugar no caminho sem nome para fallback de busca', () => {
    expect(
      parseGoogleMapsUrl('https://www.google.com/maps/place/ChIJN1t_tDeuEmsRUsoyG83frY4'),
    ).toEqual({ kind: 'fallback', reason: 'opaque_id' })
  })

  it('preserva nome curto que começa com ChIJ como busca por lugar', () => {
    expect(parseGoogleMapsUrl('https://www.google.com/maps/place/ChIJunctionCafe')).toEqual({
      kind: 'query',
      query: 'ChIJunctionCafe',
      reason: 'place_name',
    })
  })

  it('envia links de lista e rota para fallback', () => {
    expect(
      parseGoogleMapsUrl('https://www.google.com/maps/dir/?api=1&origin=A&destination=B'),
    ).toEqual({
      kind: 'fallback',
      reason: 'list',
    })
    expect(parseGoogleMapsUrl('https://www.google.com/maps/placelists/list/abc123')).toEqual({
      kind: 'fallback',
      reason: 'list',
    })
  })

  it('retorna fallback seguro para URL não reconhecida', () => {
    expect(parseGoogleMapsUrl('not a URL')).toEqual({ kind: 'fallback', reason: 'unsupported' })
  })
})
