import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { expect, it } from 'vitest'
import { createDevAuthTokens, createJwtAccessTokenVerifier } from './access-tokens.ts'

it('emite access JWT ES256 de 15 minutos e verifica issuer, audience e subject', async () => {
  const { privateKey } = await generateKeyPair('ES256', { extractable: true })
  const privateJwk = await exportJWK(privateKey)
  const tokens = await createDevAuthTokens({
    privateKey: JSON.stringify(privateJwk),
    issuer: 'trippy-dev-auth',
    audience: 'trippy-dev',
    keyId: 'trippy-dev',
  })

  const issued = await tokens.issueAccessToken('2c5a5a80-3b4d-4fbf-88b0-79ebbf7210f8')
  const claims = await tokens.verifyAccessToken(issued.token)
  const { exp } = JSON.parse(Buffer.from(issued.token.split('.')[1]!, 'base64url').toString()) as {
    exp: number
  }

  expect(claims).toEqual({ userId: '2c5a5a80-3b4d-4fbf-88b0-79ebbf7210f8' })
  expect(issued.expiresAt.getTime()).toBe(exp * 1000)
  expect(issued.expiresAt.getTime() - Date.now()).toBeGreaterThan(14 * 60 * 1000)
  expect(issued.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(15 * 60 * 1000)
})

it('verificador de Cognito com issuer, audience e chave de produção rejeita token dev', async () => {
  const devKeys = await generateKeyPair('ES256', { extractable: true })
  const prodKeys = await generateKeyPair('RS256', { extractable: true })
  const devJwk = await exportJWK(devKeys.privateKey)
  const productionVerifier = createJwtAccessTokenVerifier({
    issuer: 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_pool',
    audience: 'trippy-production-client',
    resolveKey: async () => prodKeys.publicKey,
    algorithms: ['RS256'],
  })
  const devTokens = await createDevAuthTokens({
    privateKey: JSON.stringify(devJwk),
    issuer: 'trippy-dev-auth',
    audience: 'trippy-dev',
    keyId: 'trippy-dev',
  })
  const issued = await devTokens.issueAccessToken('a93f0652-8616-4783-aeb5-a7885a8035d7')

  await expect(productionVerifier(issued.token)).rejects.toThrow()
})

it('valida access token Cognito RS256 pela audiência client_id', async () => {
  const productionKeys = await generateKeyPair('RS256', { extractable: true })
  const verifier = createJwtAccessTokenVerifier({
    issuer: 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_pool',
    audience: 'trippy-production-client',
    audienceClaim: 'aud_or_client_id',
    algorithms: ['RS256'],
    resolveKey: async () => productionKeys.publicKey,
  })
  const token = await new SignJWT({ client_id: 'trippy-production-client' })
    .setProtectedHeader({ alg: 'RS256', kid: 'cognito-key', typ: 'JWT' })
    .setIssuer('https://cognito-idp.us-east-1.amazonaws.com/us-east-1_pool')
    .setSubject('3ca4193b-55cd-43a4-a126-380cb7b5aac2')
    .setIssuedAt()
    .setExpirationTime('15 minutes')
    .sign(productionKeys.privateKey)

  await expect(verifier(token)).resolves.toEqual({
    userId: '3ca4193b-55cd-43a4-a126-380cb7b5aac2',
  })
})
