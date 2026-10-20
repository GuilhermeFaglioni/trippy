import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

export interface OpaqueRefreshToken {
  token: string
  hash: string
}

export function hashEmailCode(code: string, secret: string): string {
  return createHmac('sha256', secret).update(code, 'utf8').digest('hex')
}

export function compareEmailCodeHmac(code: string, secret: string, expectedHmac: string): boolean {
  const expected = Buffer.from(expectedHmac, 'hex')
  const actual = Buffer.from(hashEmailCode(code, secret), 'hex')
  return expected.length === actual.length && timingSafeEqual(actual, expected)
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

export function createOpaqueRefreshToken(): OpaqueRefreshToken {
  const token = randomBytes(32).toString('base64url')
  return { token, hash: hashRefreshToken(token) }
}
