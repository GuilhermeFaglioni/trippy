import { createHmac, timingSafeEqual } from 'node:crypto'
import type { PlaceSearchCandidate, PlaceSearchCandidateFields } from '@trippy/domain/places'

function requireSecret(secret: string): void {
  if (!secret) throw new Error('PLACES_CANDIDATE_SECRET não pode ser vazio.')
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
      left < right ? -1 : left > right ? 1 : 0,
    )
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function signature(fields: PlaceSearchCandidateFields, secret: string): string {
  return createHmac('sha256', secret).update(canonicalJson(fields), 'utf8').digest('base64url')
}

/** Assina os campos do candidato com HMAC-SHA256 e retorna o DTO pronto para HTTP/sync. */
export function signPlaceSearchCandidate(
  fields: PlaceSearchCandidateFields,
  secret: string,
): PlaceSearchCandidate {
  requireSecret(secret)
  return { ...fields, token: signature(fields, secret) }
}

/** Confere assinatura em tempo constante, ignorando somente o próprio campo token. */
export function verifyPlaceSearchCandidate(
  candidate: PlaceSearchCandidate,
  secret: string,
): boolean {
  requireSecret(secret)
  if (!/^[A-Za-z0-9_-]{43}$/u.test(candidate.token)) return false

  const { token, ...fields } = candidate
  const expected = Buffer.from(signature(fields, secret), 'base64url')
  const received = Buffer.from(token, 'base64url')
  return expected.length === received.length && timingSafeEqual(expected, received)
}
