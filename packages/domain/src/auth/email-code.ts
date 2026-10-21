import { isExpired } from './time.ts'

export const EMAIL_CODE_DIGITS = 6
export const EMAIL_CODE_TTL_MS = 10 * 60 * 1000
export const EMAIL_CODE_MAX_ATTEMPTS = 5
export const EMAIL_CODE_RESEND_INTERVAL_MS = 60 * 1000

export type EmailCodeAttemptDecision =
  | { status: 'expired' | 'valid'; attempts: number }
  | { status: 'invalid' | 'too_many_attempts'; attempts: number }

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)
}

export function isEmailCodeRequestThrottled(lastRequestAt: Date | null, now: Date): boolean {
  return (
    lastRequestAt !== null &&
    now.getTime() - lastRequestAt.getTime() < EMAIL_CODE_RESEND_INTERVAL_MS
  )
}

export function evaluateEmailCodeAttempt(input: {
  expiresAt: Date
  attempts: number
  codeMatches: boolean
  now: Date
}): EmailCodeAttemptDecision {
  if (isExpired(input.expiresAt, input.now)) {
    return { status: 'expired', attempts: input.attempts }
  }
  if (input.codeMatches) return { status: 'valid', attempts: input.attempts }

  const attempts = input.attempts + 1
  return {
    status: attempts >= EMAIL_CODE_MAX_ATTEMPTS ? 'too_many_attempts' : 'invalid',
    attempts,
  }
}
