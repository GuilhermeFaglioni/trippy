import { describe, expect, it } from 'vitest'
import { measuredSample25, sample25, validateSample25 } from './sample-25.ts'

describe('amostra independente do spike 25', () => {
  it('valida o schema e cobre cidades, segmentos e atrações essenciais', () => {
    const validated = validateSample25(sample25)
    const cases = validated.cases
    const count = (segment: string) => cases.filter((item) => item.segment === segment).length

    expect(cases).toHaveLength(60)
    expect(new Set(cases.map((item) => item.id)).size).toBe(60)
    expect(cases.filter((item) => item.segment.startsWith('china-'))).toHaveLength(30)
    expect(cases.filter((item) => item.segment.startsWith('global-'))).toHaveLength(20)
    expect(count('endereco')).toBe(10)
    expect(cases.filter((item) => item.city === 'Pequim')).toHaveLength(15)
    expect(cases.filter((item) => item.city === 'Xangai')).toHaveLength(15)
    expect(count('china-atracao')).toBeGreaterThanOrEqual(10)
    expect(count('china-hotel')).toBeGreaterThan(0)
    expect(count('china-restaurante')).toBeGreaterThan(0)
    expect(count('global-atracao')).toBeGreaterThan(0)
    expect(count('global-restaurante')).toBeGreaterThan(0)
    expect(count('global-hotel')).toBeGreaterThan(0)
    expect(cases.filter((item) => item.essential === true).length).toBeGreaterThanOrEqual(10)
  })

  it('exige consultas em português, inglês e idioma local', () => {
    for (const item of sample25.cases) {
      expect(item.queries.pt.trim()).not.toBe('')
      expect(item.queries.en.trim()).not.toBe('')
      expect(item.queries.local.trim()).not.toBe('')
      if (item.segment.startsWith('china-')) expect(item.queries.local).toMatch(/[\u3400-\u9fff]/u)
    }
  })

  it('inclui referências independentes e datum em cada caso medido', () => {
    expect(measuredSample25).toHaveLength(47)
    expect(sample25.cases.filter((item) => item.verification.status === 'unverified')).toHaveLength(13)
    for (const item of measuredSample25) {
      expect(item.references.length).toBeGreaterThan(0)
      expect(item.references.every((source) => /^https:\/\//.test(source.url))).toBe(true)
      expect(item.references.some((source) => ['site-oficial', 'autoridade-turismo', 'wikidata', 'wikipedia', 'mapa-oficial'].includes(source.type))).toBe(true)
      expect(item.references.some((source) => /openstreetmap|nominatim|geoapify/i.test(source.url))).toBe(false)
      expect(['WGS-84', 'GCJ-02', 'BD-09']).toContain(item.referenceCoordinate.datum)
      expect(item.toleranceMeters).toBeGreaterThan(0)
      expect(item.toleranceReason.trim()).not.toBe('')
      expect(item.verification.verifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(item.verification.criterion.trim()).not.toBe('')
    }
  })

  it('rejeita registros incompletos e duplicados', () => {
    expect(() => validateSample25({ ...sample25, cases: [] })).toThrow(/cobertura/i)

    const duplicate = structuredClone(sample25)
    duplicate.cases[1]!.id = duplicate.cases[0]!.id
    expect(() => validateSample25(duplicate)).toThrow(/id duplicado/i)

    const missingLanguage = structuredClone(sample25) as unknown as {
      cases: Array<{ queries: Record<string, string | null> }>
    }
    missingLanguage.cases[0]!.queries.pt = ''
    expect(() => validateSample25(missingLanguage)).toThrow(/consultas/i)

    const missingReferences = structuredClone(sample25)
    missingReferences.cases[0]!.references = []
    expect(() => validateSample25(missingReferences)).toThrow(/fonte independente/i)

    const postalOnlySource = structuredClone(sample25)
    postalOnlySource.cases[0]!.references = [{
      url: 'https://postal.example/address',
      type: 'registro-postal',
    }]
    expect(() => validateSample25(postalOnlySource)).toThrow(/fonte independente/i)

    const missingLocalQuery = structuredClone(sample25)
    ;(missingLocalQuery.cases[0]!.queries as { local: string | null }).local = null
    expect(() => validateSample25(missingLocalQuery)).toThrow(/consultas\.local/i)

    const inconsistentWgs84 = structuredClone(sample25)
    inconsistentWgs84.cases[0]!.referenceCoordinate.wgs84.lat += 0.01
    expect(() => validateSample25(inconsistentWgs84)).toThrow(/coordenada WGS-84/i)
  })
})
