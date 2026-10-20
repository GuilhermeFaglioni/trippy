import { expect, it } from 'vitest'
import {
  evaluateEmailCodeAttempt,
  isEmailCodeRequestThrottled,
  isValidEmail,
  normalizeEmail,
} from './email-code.ts'
import { evaluateRefreshTokenRotation } from './session.ts'

it('normaliza e valida endereços de e-mail antes de usá-los como identidade', () => {
  expect(normalizeEmail('  Ana.Silva@Example.COM  ')).toBe('ana.silva@example.com')
  expect(isValidEmail('ana.silva@example.com')).toBe(true)
  expect(isValidEmail('ana@')).toBe(false)
  expect(isValidEmail('not-an-email')).toBe(false)
})

it('considera o código expirado no instante de expiração', () => {
  const now = new Date('2026-10-20T12:10:00.000Z')

  expect(
    evaluateEmailCodeAttempt({
      expiresAt: now,
      attempts: 0,
      codeMatches: true,
      now,
    }),
  ).toEqual({ status: 'expired', attempts: 0 })
})

it('avalia tentativas de código e intervalo de reenvio com relógio injetado', () => {
  const now = new Date('2026-10-20T12:00:00.000Z')
  const expiresAt = new Date('2026-10-20T12:10:00.000Z')

  expect(isEmailCodeRequestThrottled(new Date(now.getTime() - 59_999), now)).toBe(true)
  expect(isEmailCodeRequestThrottled(new Date(now.getTime() - 60_000), now)).toBe(false)
  expect(evaluateEmailCodeAttempt({ expiresAt, attempts: 3, codeMatches: false, now })).toEqual({
    status: 'invalid',
    attempts: 4,
  })
  expect(evaluateEmailCodeAttempt({ expiresAt, attempts: 4, codeMatches: false, now })).toEqual({
    status: 'too_many_attempts',
    attempts: 5,
  })
  expect(
    evaluateEmailCodeAttempt({
      expiresAt: new Date(now.getTime()),
      attempts: 0,
      codeMatches: true,
      now,
    }),
  ).toEqual({ status: 'expired', attempts: 0 })
})

it('avalia validade, rotação e reuso de refresh com relógio injetado', () => {
  const now = new Date('2026-10-20T12:00:00.000Z')
  const expiresAt = new Date('2027-10-20T12:00:00.000Z')

  expect(evaluateRefreshTokenRotation({ usedAt: null, revokedAt: null, expiresAt, now })).toBe(
    'rotatable',
  )
  expect(evaluateRefreshTokenRotation({ usedAt: now, revokedAt: null, expiresAt, now })).toBe(
    'reused',
  )
  expect(evaluateRefreshTokenRotation({ usedAt: null, revokedAt: now, expiresAt, now })).toBe(
    'invalid',
  )
  expect(evaluateRefreshTokenRotation({ usedAt: null, revokedAt: null, expiresAt: now, now })).toBe(
    'invalid',
  )
})
