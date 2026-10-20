import { createPrivateKey, createPublicKey, type KeyObject } from 'node:crypto'
import {
  importJWK,
  createRemoteJWKSet,
  jwtVerify,
  SignJWT,
  type JWK,
  type JWTVerifyGetKey,
  type JWTVerifyOptions,
} from 'jose'
import { ACCESS_TOKEN_TTL_MS } from '@trippy/domain'

export const ACCESS_TOKEN_TTL_SECONDS = ACCESS_TOKEN_TTL_MS / 1000
type JwtKey = KeyObject | CryptoKey

export interface AuthTokens {
  issueAccessToken(userId: string): Promise<{ token: string; expiresAt: Date }>
  verifyAccessToken(token: string): Promise<{ userId: string }>
}

export type AccessTokenVerifier = AuthTokens['verifyAccessToken']

interface JwtVerifierConfig {
  issuer: string
  audience: string
  resolveKey: JWTVerifyGetKey
  algorithms?: JWTVerifyOptions['algorithms']
  audienceClaim?: 'aud' | 'client_id' | 'aud_or_client_id'
}

export function createJwtAccessTokenVerifier({
  issuer,
  audience,
  resolveKey,
  algorithms = ['ES256'],
  audienceClaim = 'aud',
}: JwtVerifierConfig): AuthTokens['verifyAccessToken'] {
  return async (token) => {
    const { payload } = await jwtVerify(token, resolveKey, {
      issuer,
      algorithms,
    })
    const standardAudience =
      typeof payload.aud === 'string'
        ? payload.aud === audience
        : Array.isArray(payload.aud) && payload.aud.includes(audience)
    const cognitoClientId = payload.client_id === audience
    const audienceMatches =
      audienceClaim === 'aud'
        ? standardAudience
        : audienceClaim === 'client_id'
          ? cognitoClientId
          : standardAudience || cognitoClientId
    if (
      typeof payload.sub !== 'string' ||
      payload.sub.length === 0 ||
      typeof payload.exp !== 'number' ||
      !audienceMatches
    ) {
      throw new Error('JWT sem subject, audiência ou expiração válida.')
    }
    return { userId: payload.sub }
  }
}

export function createJwksAccessTokenVerifier(config: {
  issuer: string
  audience: string
  jwksUrl: string
}): AccessTokenVerifier {
  const resolveKey = createRemoteJWKSet(new URL(config.jwksUrl))
  return createJwtAccessTokenVerifier({
    issuer: config.issuer,
    audience: config.audience,
    resolveKey,
    algorithms: ['RS256'],
    audienceClaim: 'aud_or_client_id',
  })
}

async function loadDevKeyPair(
  privateKey: string,
): Promise<{ privateKey: JwtKey; publicKey: JwtKey }> {
  if (privateKey.trimStart().startsWith('{')) {
    const jwk = JSON.parse(privateKey) as JWK
    if (jwk.kty !== 'EC' || jwk.crv !== 'P-256' || !jwk.d || !jwk.x || !jwk.y) {
      throw new Error('AUTH_DEV_JWT_PRIVATE_KEY precisa ser uma chave privada EC P-256.')
    }
    const publicJwk: JWK = { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y }
    const [signingKey, verificationKey] = await Promise.all([
      importJWK(jwk, 'ES256'),
      importJWK(publicJwk, 'ES256'),
    ])
    return { privateKey: signingKey as JwtKey, publicKey: verificationKey as JwtKey }
  }

  const pem = privateKey.replaceAll('\\n', '\n')
  const privateKeyObject = createPrivateKey(pem)
  const publicKeyObject = createPublicKey(privateKeyObject)
  return { privateKey: privateKeyObject, publicKey: publicKeyObject }
}

export async function createDevAuthTokens(config: {
  privateKey: string
  issuer: string
  audience: string
  keyId: string
  now?: () => Date
}): Promise<AuthTokens> {
  const keys = await loadDevKeyPair(config.privateKey)
  const verifyAccessToken = createJwtAccessTokenVerifier({
    issuer: config.issuer,
    audience: config.audience,
    resolveKey: async (header) => {
      if (header.kid !== config.keyId) throw new Error('kid de JWT de desenvolvimento inválido.')
      return keys.publicKey
    },
  })

  return {
    async issueAccessToken(userId) {
      const issuedAt = Math.floor((config.now?.() ?? new Date()).getTime() / 1000)
      const expiresAt = new Date((issuedAt + ACCESS_TOKEN_TTL_SECONDS) * 1000)
      const token = await new SignJWT({})
        .setProtectedHeader({ alg: 'ES256', kid: config.keyId, typ: 'JWT' })
        .setIssuer(config.issuer)
        .setAudience(config.audience)
        .setSubject(userId)
        .setIssuedAt(issuedAt)
        .setExpirationTime(issuedAt + ACCESS_TOKEN_TTL_SECONDS)
        .sign(keys.privateKey)
      return { token, expiresAt }
    },
    verifyAccessToken,
  }
}
