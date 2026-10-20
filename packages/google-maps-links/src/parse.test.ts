import { describe, expect, it } from 'vitest'
import { parseGoogleMapsUrl } from './parse.js'

describe('parseGoogleMapsUrl', () => {
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
