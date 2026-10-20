import { describe, expect, it } from 'vitest'
import { runBenchmark, type BenchmarkSearch } from './runner.ts'
import { sampleCases } from './sample.ts'

const poi = sampleCases[0]!
const address = sampleCases.find((item) => item.kind === 'address')!

function result(
  caseId: string,
  method: 'geocoding' | 'places',
  status: 'success' | 'not-found' | 'error',
  overrides: Partial<Awaited<ReturnType<BenchmarkSearch>>> = {},
): Awaited<ReturnType<BenchmarkSearch>> {
  return {
    caseId,
    method,
    status,
    httpStatus: status === 'error' ? 401 : 200,
    latencyMs: 25,
    candidates: [],
    estimatedCredits: status === 'error' ? null : 1,
    ...(status === 'error' ? { errorKind: 'unauthorized' as const } : {}),
    ...overrides,
  }
}

describe('runBenchmark', () => {
  it('limita chamadas, mantém execução serial e agrega top1/topk, ausência, erro, crédito e latência', async () => {
    const order: string[] = []
    const report = await runBenchmark({
      cases: [poi, address],
      maxRequests: 2,
      delayMs: 200,
      sleep: async () => undefined,
      search: async (request) => {
        order.push(`${request.caseId}:${request.method}`)
        return request.method === 'geocoding'
          ? result(request.caseId, request.method, 'success', {
              candidates: [
                {
                  name: '故宫博物院',
                  coordinates: { lat: 39.9164, lon: 116.3973 },
                  addressParts: ['北京市', '东城区', '景山前街'],
                  placeId: 'geo-1',
                },
              ],
            })
          : result(request.caseId, request.method, 'not-found')
      },
      now: () => new Date('2026-10-19T12:00:00.000Z'),
    })

    expect(order).toEqual([`${poi.id}:geocoding`, `${poi.id}:places`])
    expect(report.plannedRequests).toBe(3)
    expect(report.executedRequests).toBe(2)
    expect(report.requestLimitReached).toBe(true)
    expect(report.dataset.linkFixturesPending).toBe(20)
    expect(report.summary.total.calls).toBe(2)
    expect(report.summary.total.errors).toBe(0)
    expect(report.summary.total.absences).toBe(1)
    expect(report.summary.total.estimatedCredits).toBe(2)
    expect(report.summary.total.top1HitRate).toBe(0.5)
    expect(report.summary.total.topKHitRate).toBe(0.5)
    expect(report.summary.total.medianLatencyMs).toBe(25)
    expect(report.results[0]).toMatchObject({
      expectedNames: ['故宫博物院', 'Palace Museum', 'Forbidden City'],
      expectedAddressTokens: ['北京市', '东城区', '景山前街'],
      referenceCoordinates: { lat: 39.9163, lon: 116.3972 },
      coordinateToleranceMeters: 1000,
      referencePrecision: 'unverified',
      sourceUrls: expect.arrayContaining(['https://en.wikipedia.org/wiki/Forbidden_City']),
    })
  })

  it('separa falha de autenticação de ausência e exclui erros do denominador de acerto', async () => {
    const report = await runBenchmark({
      cases: [poi],
      maxRequests: 2,
      delayMs: 200,
      sleep: async () => undefined,
      search: async (request) =>
        request.method === 'geocoding'
          ? result(request.caseId, request.method, 'error')
          : result(request.caseId, request.method, 'not-found'),
    })
    const summary = report.summary.total

    expect(summary.errors).toBe(1)
    expect(summary.absences).toBe(1)
    expect(summary.validResponses).toBe(1)
    expect(summary.top1Denominator).toBe(1)
    expect(summary.estimatedCredits).toBe(1)
  })

  it('recusa parâmetros acima dos limites seguros definidos pelo spike', async () => {
    await expect(
      runBenchmark({
        cases: [poi],
        maxRequests: 121,
        delayMs: 0,
        search: async (request) => result(request.caseId, request.method, 'not-found'),
      }),
    ).rejects.toThrow('máximo de 120')

    await expect(
      runBenchmark({
        cases: [poi],
        maxRequests: 1,
        delayMs: 199,
        search: async (request) => result(request.caseId, request.method, 'not-found'),
      }),
    ).rejects.toThrow('200 ms')
  })
})
