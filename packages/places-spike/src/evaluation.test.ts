import { describe, expect, it } from 'vitest'
import { evaluateCase, type BenchmarkCase, type PlaceCandidate } from './evaluation.ts'

const sampleCase: BenchmarkCase = {
  id: 'beijing-forbidden-city',
  group: 'china',
  kind: 'poi',
  query: '故宫博物院',
  language: 'zh',
  city: 'Beijing',
  countryCode: 'cn',
  expectedNames: ['Palace Museum', '故宫博物院'],
  expectedAddressTokens: ['北京市', '东城区'],
  coordinates: { lat: 39.9163, lon: 116.3972 },
  coordinateToleranceMeters: 1000,
  referencePrecision: 'unverified',
  sourceUrls: ['https://en.wikipedia.org/wiki/Forbidden_City'],
}

function candidate(
  name: string,
  lat: number,
  lon: number,
  addressParts: string[],
  placeId: string,
): PlaceCandidate {
  return { name, coordinates: { lat, lon }, addressParts, placeId }
}

describe('evaluateCase', () => {
  it('recognizes a localized alias in first place and measures complete local address', () => {
    const result = evaluateCase(sampleCase, [
      candidate('故宫博物院', 39.9165, 116.3974, ['北京市', '东城区', '景山前街4号'], 'p1'),
    ])

    expect(result.top1NameMatch).toBe(true)
    expect(result.top1Hit).toBe(true)
    expect(result.topKHit).toBe(true)
    expect(result.matchedRank).toBe(1)
    expect(result.localAddressComplete).toBe(true)
    expect(result.matchedDistanceMeters).toBeLessThan(50)
    expect(result.coordinateQuality).toBe('within-tolerance')
  })

  it('does not count a nearby wrong branch as a hit', () => {
    const result = evaluateCase(sampleCase, [
      candidate('Forbidden City Hotel', 39.9163, 116.3972, ['北京市', '东城区'], 'p1'),
      candidate('Palace Museum', 39.9163, 116.3972, ['北京市', '东城区'], 'p2'),
    ])

    expect(result.top1NameMatch).toBe(false)
    expect(result.top1Hit).toBe(false)
    expect(result.topKHit).toBe(true)
    expect(result.matchedRank).toBe(2)
  })

  it('finds a top-5 match within tolerance after an out-of-tolerance name match', () => {
    const result = evaluateCase(sampleCase, [
      candidate('Palace Museum', 39.94, 116.42, ['北京市', '东城区'], 'p1'),
      candidate('故宫博物院', 39.9165, 116.3974, ['北京市', '东城区'], 'p2'),
    ])

    expect(result.top1Hit).toBe(false)
    expect(result.topKHit).toBe(true)
    expect(result.matchedRank).toBe(2)
    expect(result.matchedDistanceMeters).toBeLessThan(50)
    expect(result.coordinateQuality).toBe('within-tolerance')
  })

  it('reports an address match outside tolerance separately from name match', () => {
    const addressCase: BenchmarkCase = {
      ...sampleCase,
      id: 'beijing-address-1',
      kind: 'address',
      expectedNames: [],
      expectedAddressTokens: ['北京市', '东城区', '王府井大街'],
      coordinateToleranceMeters: 100,
    }
    const result = evaluateCase(addressCase, [
      candidate('王府井大街', 39.92, 116.41, ['北京市', '东城区', '王府井大街'], 'p3'),
    ])

    expect(result.top1NameMatch).toBe(null)
    expect(result.localAddressComplete).toBe(true)
    expect(result.top1Hit).toBe(false)
    expect(result.topKHit).toBe(false)
    expect(result.coordinateQuality).toBe('outside-tolerance')
  })

  it('counts duplicate results by provider ID and normalized name-position', () => {
    const result = evaluateCase(sampleCase, [
      candidate('Palace Museum', 39.9163, 116.3972, ['北京市'], 'same-id'),
      candidate('Palace Museum', 39.9163, 116.3972, ['北京市'], 'same-id'),
      candidate('Palace Museum', 39.9163, 116.3972, ['北京市'], 'another-id'),
    ])

    expect(result.duplicateCount).toBe(2)
  })

  it('treats missing candidate coordinates as unmeasurable, not zero distance', () => {
    const result = evaluateCase(sampleCase, [{ name: 'Palace Museum', addressParts: ['北京市'] }])

    expect(result.top1NameMatch).toBe(true)
    expect(result.top1Hit).toBe(false)
    expect(result.matchedDistanceMeters).toBe(null)
    expect(result.coordinateQuality).toBe('missing-coordinate')
  })
})
