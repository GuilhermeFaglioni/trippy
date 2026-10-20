import { lookup } from 'node:dns/promises'
import type { LookupAddress } from 'node:dns'
import { isIP } from 'node:net'
import { request as httpsRequest } from 'node:https'
import type { RequestOptions } from 'node:https'
import { googleMapsAllowedHosts } from './hosts.ts'

const defaultTimeoutMs = 5_000
const defaultMaxRedirects = 5
const hardMaxRedirects = 5
const hardMaxTimeoutMs = 30_000

// Prefixos especiais conferidos no registro oficial IANA de IPv4 e IPv6.
// https://www.iana.org/assignments/iana-ipv4-special-registry
// https://www.iana.org/assignments/iana-ipv6-special-registry

/** Códigos estáveis de falha da expansão HTTP segura. */
export type GoogleMapsUrlExpansionErrorCode =
  | 'invalid_url'
  | 'unsupported_protocol'
  | 'host_not_allowed'
  | 'credentials_not_allowed'
  | 'port_not_allowed'
  | 'unsafe_address'
  | 'dns_failed'
  | 'timeout'
  | 'redirect_loop'
  | 'too_many_redirects'
  | 'request_failed'
  | 'http_status'
  | 'invalid_redirect'
  | 'invalid_options'

/** Erro tipado que permite ao chamador decidir como tratar uma expansão recusada. */
export class GoogleMapsUrlExpansionError extends Error {
  constructor(
    readonly code: GoogleMapsUrlExpansionErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause })
    this.name = 'GoogleMapsUrlExpansionError'
  }
}

/** Limites operacionais opcionais; allowlist e validações de destino não podem ser alteradas. */
export interface GoogleMapsUrlExpansionOptions {
  /** Timeout por requisição em milissegundos; máximo aceito: 30 segundos. */
  timeoutMs?: number
  /** Saltos HTTP máximos; o teto de segurança continua sendo cinco. */
  maxRedirects?: number
}

/**
 * Segue somente redirects HTTPS do Google Maps, validando DNS e IP a cada salto.
 * Retorna a URL final sem ler o corpo da página.
 */
export async function expandGoogleMapsUrl(
  value: string,
  options: GoogleMapsUrlExpansionOptions = {},
): Promise<string> {
  const timeoutMs = getTimeout(options.timeoutMs)
  const maxRedirects = getMaxRedirects(options.maxRedirects)
  let current = parseAllowedUrl(value)
  const visited = new Set<string>()
  let redirectCount = 0

  while (true) {
    const loopKey = new URL(current.href)
    loopKey.hash = ''
    if (visited.has(loopKey.href)) {
      throw new GoogleMapsUrlExpansionError('redirect_loop', 'Loop de redirecionamento detectado')
    }
    visited.add(loopKey.href)

    const addresses = await resolvePublicAddresses(current.hostname, timeoutMs)
    const address = addresses[0]
    if (!address) {
      throw new GoogleMapsUrlExpansionError('dns_failed', 'DNS não retornou endereços')
    }

    const hop = await requestHop(current, address.address, address.family, timeoutMs)
    if (hop.kind === 'final') return current.href
    if (redirectCount >= maxRedirects) {
      throw new GoogleMapsUrlExpansionError(
        'too_many_redirects',
        `Limite de ${maxRedirects} redirects excedido`,
      )
    }

    try {
      current = parseAllowedUrl(new URL(hop.location, current).href)
    } catch (error) {
      if (error instanceof GoogleMapsUrlExpansionError) throw error
      throw new GoogleMapsUrlExpansionError(
        'invalid_redirect',
        'Destino de redirect inválido',
        error,
      )
    }
    redirectCount += 1
  }
}

function getTimeout(timeoutMs: number | undefined): number {
  if (
    timeoutMs !== undefined &&
    (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > hardMaxTimeoutMs)
  ) {
    throw new GoogleMapsUrlExpansionError(
      'invalid_options',
      `timeoutMs deve ser inteiro entre 1 e ${hardMaxTimeoutMs}`,
    )
  }
  return timeoutMs ?? defaultTimeoutMs
}

function getMaxRedirects(maxRedirects: number | undefined): number {
  if (
    maxRedirects !== undefined &&
    (!Number.isInteger(maxRedirects) || maxRedirects < 0 || maxRedirects > hardMaxRedirects)
  ) {
    throw new GoogleMapsUrlExpansionError(
      'invalid_options',
      `maxRedirects deve ser inteiro entre 0 e ${hardMaxRedirects}`,
    )
  }
  return maxRedirects ?? defaultMaxRedirects
}

function parseAllowedUrl(value: string): URL {
  let url: URL
  try {
    url = new URL(value)
  } catch (error) {
    throw new GoogleMapsUrlExpansionError('invalid_url', 'URL inválida', error)
  }

  if (url.protocol !== 'https:') {
    throw new GoogleMapsUrlExpansionError('unsupported_protocol', 'Somente URLs HTTPS são aceitas')
  }
  if (url.username !== '' || url.password !== '') {
    throw new GoogleMapsUrlExpansionError(
      'credentials_not_allowed',
      'Credenciais na URL não são aceitas',
    )
  }
  if (url.port !== '' && url.port !== '443') {
    throw new GoogleMapsUrlExpansionError(
      'port_not_allowed',
      'Somente a porta HTTPS padrão é aceita',
    )
  }
  if (!googleMapsAllowedHosts.has(url.hostname.toLowerCase())) {
    throw new GoogleMapsUrlExpansionError(
      'host_not_allowed',
      'Host não está na allowlist do Google Maps',
    )
  }
  return url
}

async function resolvePublicAddresses(
  hostname: string,
  timeoutMs: number,
): Promise<Array<{ address: string; family: 4 | 6 }>> {
  let records: LookupAddress[]
  try {
    records = await withTimeout(lookup(hostname, { all: true, verbatim: true }), timeoutMs)
  } catch (error) {
    if (error instanceof GoogleMapsUrlExpansionError && error.code === 'timeout') throw error
    throw new GoogleMapsUrlExpansionError('dns_failed', 'Falha ao resolver host', error)
  }

  if (records.length === 0) {
    throw new GoogleMapsUrlExpansionError('dns_failed', 'DNS não retornou endereços')
  }

  const addresses: Array<{ address: string; family: 4 | 6 }> = []
  for (const record of records) {
    const family = isIP(record.address)
    if (
      (family !== 4 && family !== 6) ||
      family !== record.family ||
      !isPublicAddress(record.address)
    ) {
      throw new GoogleMapsUrlExpansionError(
        'unsafe_address',
        `DNS retornou endereço privado, reservado ou inválido: ${record.address}`,
      )
    }
    addresses.push({ address: record.address, family })
  }
  return addresses
}

function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  return Promise.race([
    operation,
    new Promise<T>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new GoogleMapsUrlExpansionError('timeout', `Timeout após ${timeoutMs} ms`)),
        timeoutMs,
      )
    }),
  ]).finally(() => clearTimeout(timer!))
}

function isPublicAddress(address: string): boolean {
  const family = isIP(address)
  if (family === 4) return isPublicIPv4(address)
  if (family === 6) return isPublicIPv6(address)
  return false
}

function isPublicIPv4(address: string): boolean {
  const octets = address.split('.').map(Number)
  if (
    octets.length !== 4 ||
    octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
  ) {
    return false
  }
  const value = octets.reduce((result, octet) => result * 256 + octet, 0)
  const deniedRanges: Array<[base: number, prefix: number]> = [
    [0x00000000, 8], // rede atual
    [0x0a000000, 8], // privadas
    [0x64400000, 10], // carrier-grade NAT
    [0x7f000000, 8], // loopback
    [0xa9fe0000, 16], // link-local
    [0xac100000, 12], // privadas
    [0xc0000000, 24], // atribuições especiais IETF
    [0xc0000200, 24], // documentação
    [0xc0586300, 24], // relay 6to4 legado
    [0xc0a80000, 16], // privadas
    [0xc6120000, 15], // benchmark
    [0xc6336400, 24], // documentação
    [0xcb007100, 24], // documentação
    [0xe0000000, 4], // multicast
    [0xf0000000, 4], // reservado e broadcast
  ]

  return !deniedRanges.some(([base, prefix]) => {
    const blockSize = 2 ** (32 - prefix)
    return Math.floor(value / blockSize) === Math.floor(base / blockSize)
  })
}

function isPublicIPv6(address: string): boolean {
  const value = parseIPv6(address)
  if (value === undefined) return false
  if (value >> 125n !== 1n) return false // Somente unicast global 2000::/3.

  const reservedRanges: Array<[base: bigint, prefix: number]> = [
    [parseIPv6('::ffff:0:0')!, 96], // IPv4 mapeado
    [parseIPv6('64:ff9b::')!, 96], // tradução NAT64
    [parseIPv6('64:ff9b:1::')!, 48], // tradução NAT64 de uso local
    [parseIPv6('100::')!, 64], // discard-only
    [parseIPv6('100:0:0:1::')!, 64], // dummy IPv6 prefix
    [parseIPv6('2001::')!, 23], // atribuições especiais IETF
    [parseIPv6('2001:db8::')!, 32], // documentação
    [parseIPv6('2002::')!, 16], // túnel 6to4
    [parseIPv6('3fff::')!, 20], // documentação
    [parseIPv6('5f00::')!, 16], // identificadores SRv6 não roteáveis globalmente
  ]

  return !reservedRanges.some(([base, prefix]) => inIPv6Prefix(value, base, prefix))
}

function parseIPv6(address: string): bigint | undefined {
  if (address.includes('%')) return undefined
  const halves = address.toLowerCase().split('::')
  if (halves.length > 2) return undefined
  const leftGroups = parseIPv6Groups(halves[0] ?? '')
  const rightGroups = parseIPv6Groups(halves[1] ?? '')
  if (!leftGroups || !rightGroups) return undefined

  const compressed = halves.length === 2
  const missingGroups = 8 - leftGroups.length - rightGroups.length
  if ((compressed && missingGroups < 1) || (!compressed && missingGroups !== 0)) return undefined
  const groups = compressed
    ? [...leftGroups, ...Array.from({ length: missingGroups }, () => 0), ...rightGroups]
    : leftGroups
  if (groups.length !== 8) return undefined

  return groups.reduce((result, group) => (result << 16n) | BigInt(group), 0n)
}

function parseIPv6Groups(part: string): number[] | undefined {
  if (part === '') return []
  const groups: number[] = []
  const segments = part.split(':')
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index]
    if (segment === undefined) return undefined
    if (segment.includes('.')) {
      if (index !== segments.length - 1) return undefined
      const octets = segment.split('.').map(Number)
      if (
        octets.length !== 4 ||
        octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
      ) {
        return undefined
      }
      groups.push((octets[0]! << 8) | octets[1]!, (octets[2]! << 8) | octets[3]!)
      continue
    }
    if (!/^[\da-f]{1,4}$/i.test(segment)) return undefined
    groups.push(Number.parseInt(segment, 16))
  }
  return groups
}

function inIPv6Prefix(value: bigint, base: bigint, prefix: number): boolean {
  const shift = BigInt(128 - prefix)
  return value >> shift === base >> shift
}

type HopResult = { kind: 'redirect'; location: string } | { kind: 'final' }

function requestHop(
  url: URL,
  address: string,
  family: 4 | 6,
  timeoutMs: number,
): Promise<HopResult> {
  return new Promise((resolve, reject) => {
    let settled = false
    let requestHandle: ReturnType<typeof httpsRequest> | undefined
    const timer = setTimeout(() => {
      fail(new GoogleMapsUrlExpansionError('timeout', `Timeout após ${timeoutMs} ms`))
      requestHandle?.destroy()
    }, timeoutMs)
    const finish = (result: HopResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }
    const fail = (error: GoogleMapsUrlExpansionError) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(error)
    }

    const pinnedLookup: NonNullable<RequestOptions['lookup']> = (_hostname, options, callback) => {
      if (options.all) callback(null, [{ address, family }])
      else callback(null, address, family)
    }

    try {
      requestHandle = httpsRequest(
        {
          protocol: 'https:',
          hostname: url.hostname,
          port: 443,
          path: `${url.pathname}${url.search}`,
          method: 'GET',
          headers: { accept: '*/*', 'user-agent': 'TrippyGoogleMapsLink/1.0' },
          agent: false,
          servername: url.hostname,
          lookup: pinnedLookup,
        },
        (response) => {
          const statusCode = response.statusCode ?? 0
          const isRedirect = [301, 302, 303, 307, 308].includes(statusCode)
          const location = response.headers.location
          response.on('error', () => {})

          if (statusCode >= 400 || statusCode < 200 || (statusCode >= 300 && !isRedirect)) {
            fail(
              new GoogleMapsUrlExpansionError(
                'http_status',
                `Resposta HTTP ${statusCode} não concluiu a expansão`,
              ),
            )
          } else if (!isRedirect) {
            finish({ kind: 'final' })
          } else if (typeof location === 'string' && location !== '') {
            finish({ kind: 'redirect', location })
          } else {
            fail(
              new GoogleMapsUrlExpansionError(
                'invalid_redirect',
                'Redirect sem cabeçalho Location',
              ),
            )
          }
          response.destroy()
        },
      )
    } catch (error) {
      fail(
        new GoogleMapsUrlExpansionError(
          'request_failed',
          'Falha ao iniciar requisição HTTPS',
          error,
        ),
      )
      return
    }

    requestHandle.on('error', (error) => {
      fail(new GoogleMapsUrlExpansionError('request_failed', 'Falha na requisição HTTPS', error))
    })
    requestHandle.setTimeout(timeoutMs, () => {
      fail(new GoogleMapsUrlExpansionError('timeout', `Timeout após ${timeoutMs} ms`))
      requestHandle?.destroy()
    })
    requestHandle.end()
  })
}
