import { EventEmitter } from 'node:events'
import type { IncomingMessage } from 'node:http'
import type { RequestOptions } from 'node:https'
import { lookup } from 'node:dns/promises'
import { request } from 'node:https'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { expandGoogleMapsUrl } from './expand.js'

vi.mock('node:dns/promises', () => ({ lookup: vi.fn() }))
vi.mock('node:https', () => ({ request: vi.fn() }))

interface MockResponse {
  statusCode: number
  location?: string
}

interface FakeRequest extends EventEmitter {
  end(): this
  destroy(): this
  setTimeout(milliseconds: number, callback: () => void): this
}

const mockedLookup = vi.mocked(lookup)
const mockedRequest = vi.mocked(request)
const observedConnections: Array<{ hostname: string; address: string }> = []
let responses: MockResponse[]
let timeoutRequest = false

describe('expandGoogleMapsUrl', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    observedConnections.length = 0
    responses = [{ statusCode: 200 }]
    timeoutRequest = false
    mockedLookup.mockImplementation((async () => [
      { address: '8.8.8.8', family: 4 },
    ]) as unknown as typeof lookup)
    mockedRequest.mockImplementation(((
      options: RequestOptions,
      callback?: (response: IncomingMessage) => void,
    ) => {
      let timeoutCallback: (() => void) | undefined
      const fakeRequest = new EventEmitter() as FakeRequest
      fakeRequest.setTimeout = vi.fn((_milliseconds, onTimeout) => {
        timeoutCallback = onTimeout
        return fakeRequest
      })
      fakeRequest.destroy = vi.fn(() => fakeRequest)
      fakeRequest.end = vi.fn(() => {
        if (timeoutRequest) {
          queueMicrotask(() => timeoutCallback?.())
          return fakeRequest
        }

        const hostname = options.hostname ?? options.host ?? ''
        const pinnedLookup = options.lookup as unknown as (
          hostname: string,
          options: { family?: number; hints?: number; all?: boolean },
          callback: (
            error: NodeJS.ErrnoException | null,
            address: string | Array<{ address: string; family: number }>,
            family?: number,
          ) => void,
        ) => void
        pinnedLookup(hostname, { family: 0, hints: 0, all: false }, (error, address, family) => {
          if (error) {
            fakeRequest.emit('error', error)
            return
          }
          if (typeof address !== 'string')
            throw new Error('Esperava lookup fixado em endereço único')
          observedConnections.push({ hostname, address })
          const nextResponse = responses.shift() ?? { statusCode: 200 }
          const response = Object.assign(new EventEmitter(), {
            statusCode: nextResponse.statusCode,
            headers: nextResponse.location ? { location: nextResponse.location } : {},
            destroy: vi.fn(),
          })
          callback?.(response as unknown as IncomingMessage)
          void family
        })
        return fakeRequest
      })
      return fakeRequest as unknown as ReturnType<typeof request>
    }) as unknown as typeof request)
  })

  it('fixa conexão no IP público validado e retorna URL final', async () => {
    await expect(expandGoogleMapsUrl('https://maps.app.goo.gl/short')).resolves.toBe(
      'https://maps.app.goo.gl/short',
    )
    expect(observedConnections).toEqual([{ hostname: 'maps.app.goo.gl', address: '8.8.8.8' }])
    expect(mockedLookup).toHaveBeenCalledTimes(1)
  })

  it('aceita IPv6 global e fixa socket no endereço validado', async () => {
    mockedLookup.mockImplementation((async () => [
      { address: '2607:f8b0:400a:804::200e', family: 6 },
    ]) as unknown as typeof lookup)

    await expandGoogleMapsUrl('https://maps.app.goo.gl/short')
    expect(observedConnections).toEqual([
      { hostname: 'maps.app.goo.gl', address: '2607:f8b0:400a:804::200e' },
    ])
  })

  it('resolve redirect relativo e revalida DNS em cada salto', async () => {
    responses = [{ statusCode: 302, location: '/maps/place/Cafe' }, { statusCode: 200 }]

    await expect(expandGoogleMapsUrl('https://maps.app.goo.gl/short')).resolves.toBe(
      'https://maps.app.goo.gl/maps/place/Cafe',
    )
    expect(mockedLookup).toHaveBeenCalledTimes(2)
    expect(observedConnections).toHaveLength(2)
  })

  it('recusa host fora da allowlist antes de resolver ou conectar', async () => {
    await expect(
      expandGoogleMapsUrl('https://google.com.attacker.example/maps'),
    ).rejects.toMatchObject({
      code: 'host_not_allowed',
    })
    expect(mockedLookup).not.toHaveBeenCalled()
    expect(mockedRequest).not.toHaveBeenCalled()
  })

  it('recusa redirecionamento externo sem fazer requisição ao destino', async () => {
    responses = [{ statusCode: 302, location: 'https://attacker.example/collect' }]

    await expect(expandGoogleMapsUrl('https://maps.app.goo.gl/short')).rejects.toMatchObject({
      code: 'host_not_allowed',
    })
    expect(mockedRequest).toHaveBeenCalledTimes(1)
    expect(mockedLookup).toHaveBeenCalledTimes(1)
  })

  it('recusa loop de redirecionamento', async () => {
    responses = [{ statusCode: 302, location: 'https://maps.app.goo.gl/short' }]

    await expect(expandGoogleMapsUrl('https://maps.app.goo.gl/short')).rejects.toMatchObject({
      code: 'redirect_loop',
    })
    expect(mockedRequest).toHaveBeenCalledTimes(1)
  })

  it('respeita o limite de redirects configurado', async () => {
    responses = [{ statusCode: 302, location: '/maps/next' }]

    await expect(
      expandGoogleMapsUrl('https://maps.app.goo.gl/short', { maxRedirects: 0 }),
    ).rejects.toMatchObject({ code: 'too_many_redirects' })
    expect(mockedRequest).toHaveBeenCalledTimes(1)
  })

  it.each([
    '0.0.0.0',
    '10.0.0.1',
    '100.64.0.1',
    '127.0.0.1',
    '169.254.1.1',
    '172.16.0.1',
    '192.0.2.1',
    '192.168.1.1',
    '198.18.0.1',
    '198.51.100.1',
    '203.0.113.1',
    '224.0.0.1',
    '240.0.0.1',
  ])('bloqueia endereço IPv4 privado ou reservado %s', async (address) => {
    mockedLookup.mockImplementation((async () => [
      { address, family: 4 },
    ]) as unknown as typeof lookup)

    await expect(expandGoogleMapsUrl('https://maps.app.goo.gl/short')).rejects.toMatchObject({
      code: 'unsafe_address',
    })
    expect(mockedRequest).not.toHaveBeenCalled()
  })

  it.each([
    '::',
    '::1',
    '::ffff:127.0.0.1',
    '64:ff9b::a00:1',
    '100::1',
    '100:0:0:1::1',
    '2001:db8::1',
    '2002:7f00:1::',
    '3fff::1',
    '5f00::1',
    'fc00::1',
    'fe80::1',
    'ff02::1',
  ])('bloqueia endereço IPv6 privado ou reservado %s', async (address) => {
    mockedLookup.mockImplementation((async () => [
      { address, family: 6 },
    ]) as unknown as typeof lookup)

    await expect(expandGoogleMapsUrl('https://maps.app.goo.gl/short')).rejects.toMatchObject({
      code: 'unsafe_address',
    })
    expect(mockedRequest).not.toHaveBeenCalled()
  })

  it('recusa DNS misto mesmo quando também retorna IP público', async () => {
    mockedLookup.mockImplementation((async () => [
      { address: '8.8.8.8', family: 4 },
      { address: '10.0.0.5', family: 4 },
    ]) as unknown as typeof lookup)

    await expect(expandGoogleMapsUrl('https://maps.app.goo.gl/short')).rejects.toMatchObject({
      code: 'unsafe_address',
    })
    expect(mockedRequest).not.toHaveBeenCalled()
  })

  it('recusa credenciais, HTTP e porta fora do padrão', async () => {
    await expect(
      expandGoogleMapsUrl('https://user:pass@www.google.com/maps'),
    ).rejects.toMatchObject({
      code: 'credentials_not_allowed',
    })
    await expect(expandGoogleMapsUrl('http://www.google.com/maps')).rejects.toMatchObject({
      code: 'unsupported_protocol',
    })
    await expect(expandGoogleMapsUrl('https://www.google.com:8443/maps')).rejects.toMatchObject({
      code: 'port_not_allowed',
    })
    expect(mockedRequest).not.toHaveBeenCalled()
  })

  it('recusa falha de DNS e opções fora dos limites', async () => {
    mockedLookup.mockRejectedValue(new Error('DNS indisponível'))
    await expect(expandGoogleMapsUrl('https://maps.app.goo.gl/short')).rejects.toMatchObject({
      code: 'dns_failed',
    })
    await expect(
      expandGoogleMapsUrl('https://maps.app.goo.gl/short', { maxRedirects: 6 }),
    ).rejects.toMatchObject({ code: 'invalid_options' })
    expect(mockedRequest).not.toHaveBeenCalled()
  })

  it('aplica timeout configurável', async () => {
    timeoutRequest = true

    await expect(
      expandGoogleMapsUrl('https://maps.app.goo.gl/short', { timeoutMs: 5 }),
    ).rejects.toMatchObject({ code: 'timeout' })
  })

  it('não considera resposta HTTP 4xx como expansão resolvida', async () => {
    responses = [{ statusCode: 404 }]

    await expect(expandGoogleMapsUrl('https://maps.app.goo.gl/short')).rejects.toMatchObject({
      code: 'http_status',
    })
  })
})
