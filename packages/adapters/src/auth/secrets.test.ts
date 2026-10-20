import { expect, it } from 'vitest'
import {
  compareEmailCodeHmac,
  createOpaqueRefreshToken,
  hashEmailCode,
  hashRefreshToken,
} from './secrets.ts'

it('protege OTP com HMAC-SHA256 e aceita somente o código correspondente', () => {
  const digest = hashEmailCode('029415', 'segredo-do-servidor')

  expect(digest).toMatch(/^[a-f0-9]{64}$/)
  expect(digest).not.toContain('029415')
  expect(compareEmailCodeHmac('029415', 'segredo-do-servidor', digest)).toBe(true)
  expect(compareEmailCodeHmac('123456', 'segredo-do-servidor', digest)).toBe(false)
  expect(compareEmailCodeHmac('029415', 'outro-segredo', digest)).toBe(false)
})

it('gera refresh opaco aleatório de 32 bytes e persiste somente seu SHA-256', () => {
  const refresh = createOpaqueRefreshToken()

  expect(Buffer.from(refresh.token, 'base64url')).toHaveLength(32)
  expect(refresh.hash).toMatch(/^[a-f0-9]{64}$/)
  expect(refresh.hash).toBe(hashRefreshToken(refresh.token))
  expect(refresh.hash).not.toBe(refresh.token)
})
