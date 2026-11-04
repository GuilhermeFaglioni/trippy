import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ProviderSearchResult } from './client.ts'
import type { PlaceCandidate } from './evaluation.ts'
import type { PlannedRequest } from './plan.ts'
import { runSample25 } from './sample-25-executor.ts'
import { assertNoGoogleLeak } from './sample-25-sanitize.ts'
import type { Sample25, Sample25Case } from './sample-25.ts'

const verifiedCase: Sample25Case = {
  id: 'cn-hotel-01',
  segment: 'china-hotel',
  city: 'Pequim',
  countryCode: 'CN',
  queries: {
    pt: 'Hotel Peninsula Pequim',
    en: 'Peninsula Hotel Beijing',
    local: '北京半岛酒店',
  },
  acceptedNames: ['Peninsula Hotel Beijing', '北京半岛酒店'],
  expectedLocalAddressTokens: ['金鱼胡同', 'Pequim'],
  referenceCoordinate: {
    lat: 39.9,
    lon: 116.4,
    datum: 'WGS-84',
    wgs84: { lat: 39.9, lon: 116.4 },
    conversion: null,
  },
  toleranceMeters: 100,
  toleranceReason: 'teste',
  references: [],
  verification: {
    status: 'verified',
    verifiedAt: '2026-01-01',
    criterion: 'teste',
  },
}

const unverifiedCase: Sample25Case = {
  ...verifiedCase,
  id: 'cn-hotel-02',
  verification: { status: 'unverified', verifiedAt: '2026-01-01', criterion: 'teste' },
}

function sampleOf(cases: Sample25Case[]): Sample25 {
  return { cases } as unknown as Sample25
}

const hitCandidate: PlaceCandidate = {
  name: 'Peninsula Hotel Beijing',
  addressParts: ['金鱼胡同', 'Pequim'],
  coordinates: { lat: 39.9, lon: 116.4 },
}

function resultFor(request: PlannedRequest, candidates: PlaceCandidate[]): ProviderSearchResult {
  return {
    caseId: request.caseId,
    method: request.method,
    status: candidates.length > 0 ? 'success' : 'not-found',
    httpStatus: 200,
    latencyMs: 1,
    candidates,
    estimatedCredits: 1,
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('runSample25 em dry-run', () => {
  it('não chama provedor nem fetch e devolve o plano offline', async () => {
    const fetchSpy = vi.fn(() => {
      throw new Error('fetch não deve ser chamado no dry-run')
    })
    vi.stubGlobal('fetch', fetchSpy)
    const search = vi.fn(() => {
      throw new Error('provedor não deve ser chamado no dry-run')
    })

    const report = await runSample25({
      mode: 'dry-run',
      sample: sampleOf([verifiedCase, unverifiedCase]),
      search,
    })

    expect(search).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(report.mode).toBe('dry-run')
    expect(report.providerCalls).toBe(0)
    expect(report.metrics).toBeNull()
    expect(report.plan).not.toBeNull()
    expect(report.plan?.primaryRequests).toHaveLength(3)
  })
})

describe('runSample25 em modo real', () => {
  it('exige orçamento explícito', async () => {
    await expect(
      runSample25({
        mode: 'real',
        sample: sampleOf([verifiedCase]),
        search: async (request) => resultFor(request, []),
      }),
    ).rejects.toThrow(/orçamento/)
  })

  it('exige função de busca', async () => {
    await expect(
      runSample25({
        mode: 'real',
        sample: sampleOf([verifiedCase]),
        budget: { maxRequests: 10 },
      }),
    ).rejects.toThrow(/busca/)
  })

  it('calcula acertos, ausências e custo por toque, e passa pela sanitização', async () => {
    const search = vi.fn(async (request: PlannedRequest) => {
      if (request.benchmarkCase.language === 'pt') {
        return resultFor(request, [hitCandidate])
      }
      if (request.benchmarkCase.language === 'en' && request.method === 'places') {
        return resultFor(request, [hitCandidate])
      }
      return resultFor(request, [])
    })

    const report = await runSample25({
      mode: 'real',
      sample: sampleOf([verifiedCase]),
      search,
      budget: { maxRequests: 10 },
    })

    expect(report.providerCalls).toBe(5)
    expect(report.estimatedCredits).toBe(5)
    expect(report.costPerTouch).toBe(1)
    expect(report.stoppedByBudget).toBe(false)
    expect(report.plan).toBeNull()
    expect(report.metrics?.rows).toBe(3)
    expect(report.metrics?.top1HitRate).toBe(0.667)
    expect(report.metrics?.absences).toBe(1)
    expect(report.bySegment?.['china-hotel']?.rows).toBe(3)
    expect(() => assertNoGoogleLeak(report)).not.toThrow()
  })

  it('para ao estourar o orçamento e marca stoppedByBudget', async () => {
    const search = vi.fn(async (request: PlannedRequest) => resultFor(request, []))

    const report = await runSample25({
      mode: 'real',
      sample: sampleOf([verifiedCase]),
      search,
      budget: { maxRequests: 2 },
    })

    expect(report.stoppedByBudget).toBe(true)
    expect(report.providerCalls).toBe(2)
    expect(search).toHaveBeenCalledTimes(2)
  })
})

describe('runSample25 com destinos e toques ao Google', () => {
  it('guarda a geocodificação do destino sem chave de API nem URL', async () => {
    const destinationSearch = vi.fn(async (query: string) => ({
      url: `https://api.geoapify.com/v1/geocode/search?text=${encodeURIComponent(query)}&apiKey=SEGREDO-123`,
      results: [
        {
          name: 'Pequim',
          formatted: 'Pequim, China',
          country_code: 'cn',
          city: 'Pequim',
          lat: 39.9,
          lon: 116.4,
          result_type: 'city',
          rank: { importance: 0.8, confidence: 0.9 },
          place_id: 'geo-1',
        },
      ],
    }))

    const report = await runSample25({
      mode: 'real',
      sample: sampleOf([verifiedCase]),
      search: async (request) => resultFor(request, [hitCandidate]),
      budget: { maxRequests: 10 },
      destinations: [{ query: 'Pequim, China', search: destinationSearch }],
    })

    expect(destinationSearch).toHaveBeenCalledWith('Pequim, China')
    expect(report.destinationGeocoding).toEqual([
      {
        provider: 'geoapify',
        query: 'Pequim, China',
        results: [
          {
            name: 'Pequim',
            formatted: 'Pequim, China',
            countryCode: 'cn',
            city: 'Pequim',
            lat: 39.9,
            lon: 116.4,
            resultType: 'city',
            rank: { importance: 0.8, confidence: 0.9 },
            placeId: 'geo-1',
          },
        ],
      },
    ])
    const serialized = JSON.stringify(report)
    expect(serialized).not.toContain('SEGREDO-123')
    expect(serialized).not.toContain('api.geoapify.com')
  })

  it('conta cada destino como uma chamada do orçamento', async () => {
    const search = vi.fn(async (request: PlannedRequest) => resultFor(request, [hitCandidate]))

    const report = await runSample25({
      mode: 'real',
      sample: sampleOf([verifiedCase]),
      search,
      budget: { maxRequests: 1 },
      destinations: [{ query: 'Pequim, China', search: async () => ({ results: [] }) }],
    })

    expect(search).not.toHaveBeenCalled()
    expect(report.providerCalls).toBe(1)
    expect(report.stoppedByBudget).toBe(true)
    expect(report.rows).toEqual([])
  })

  it('faz um toque ao Google por linha medida e guarda só o place_id', async () => {
    const google = vi.fn(async () => ({
      id: 'ChIJ-abc',
      displayName: { text: 'Peninsula Hotel' },
      location: { latitude: 39.9, longitude: 116.4 },
      photos: [{ name: 'places/ChIJ-abc/photos/1' }],
      formattedAddress: 'Rua X, Pequim',
    }))

    const report = await runSample25({
      mode: 'real',
      sample: sampleOf([verifiedCase]),
      search: async (request) => resultFor(request, [hitCandidate]),
      budget: { maxRequests: 10, maxGoogleTouches: 10 },
      google,
    })

    expect(google).toHaveBeenCalledTimes(3)
    expect(google).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Peninsula Hotel Beijing' }),
    )
    expect(report.googleTouchCount).toBe(3)
    expect(report.googleTouches).toEqual([
      { caseId: 'cn-hotel-01', language: 'pt', placeId: 'ChIJ-abc' },
      { caseId: 'cn-hotel-01', language: 'en', placeId: 'ChIJ-abc' },
      { caseId: 'cn-hotel-01', language: 'local', placeId: 'ChIJ-abc' },
    ])
    const serialized = JSON.stringify(report)
    expect(serialized).not.toContain('displayName')
    expect(serialized).not.toContain('Rua X')
    expect(serialized).not.toContain('places/ChIJ-abc/photos')
    expect(() => assertNoGoogleLeak(report)).not.toThrow()
  })

  it('para de tocar o Google ao estourar maxGoogleTouches', async () => {
    const google = vi.fn(async () => ({ id: 'ChIJ-abc' }))

    const report = await runSample25({
      mode: 'real',
      sample: sampleOf([verifiedCase]),
      search: async (request) => resultFor(request, [hitCandidate]),
      budget: { maxRequests: 10, maxGoogleTouches: 1 },
      google,
    })

    expect(google).toHaveBeenCalledTimes(1)
    expect(report.googleTouchCount).toBe(1)
    expect(report.stoppedByBudget).toBe(true)
  })

  it('exige orçamento explícito para o Google', async () => {
    await expect(
      runSample25({
        mode: 'real',
        sample: sampleOf([verifiedCase]),
        search: async (request) => resultFor(request, [hitCandidate]),
        budget: { maxRequests: 10 },
        google: async () => ({ id: 'ChIJ-abc' }),
      }),
    ).rejects.toThrow(/Google/)
  })

  it('em dry-run não toca destinos nem o Google', async () => {
    const destinationSearch = vi.fn(async () => ({ results: [] }))
    const google = vi.fn(async () => ({ id: 'ChIJ-abc' }))

    const report = await runSample25({
      mode: 'dry-run',
      sample: sampleOf([verifiedCase]),
      destinations: [{ query: 'Pequim, China', search: destinationSearch }],
      google,
    })

    expect(destinationSearch).not.toHaveBeenCalled()
    expect(google).not.toHaveBeenCalled()
    expect(report.destinationGeocoding).toEqual([])
    expect(report.googleTouchCount).toBe(0)
    expect(report.googleTouches).toEqual([])
  })
})
