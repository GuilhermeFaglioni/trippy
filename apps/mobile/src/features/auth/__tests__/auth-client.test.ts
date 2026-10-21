import { AuthApiError, createAuthClient, getAuthApiBaseUrl } from '../auth-client'

const session = {
  accessToken: 'access-1',
  accessTokenExpiresAt: '2026-10-20T12:15:00.000Z',
  refreshToken: 'refresh-1',
  user: { id: 'user-1', email: 'pessoa@example.com', name: null },
}

function response(status: number, body?: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: jest.fn().mockResolvedValue(body),
  } as unknown as Response
}

describe('cliente de autenticação', () => {
  it('usa EXPO_PUBLIC_API_URL e remove barra final da URL base', async () => {
    const fetcher = jest.fn().mockResolvedValue(response(202, {}))
    const client = createAuthClient({ baseUrl: ' http://api.local:3000/// ', fetcher })

    await client.startEmail('pessoa@example.com')

    expect(fetcher).toHaveBeenCalledWith(
      'http://api.local:3000/auth/email/start',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ email: 'pessoa@example.com' }),
      }),
    )
    expect(getAuthApiBaseUrl()).toBe('http://localhost:3000')
  })

  it('envia e-mail e código e devolve a sessão do contrato', async () => {
    const fetcher = jest
      .fn()
      .mockResolvedValueOnce(response(202, {}))
      .mockResolvedValueOnce(response(200, session))
    const client = createAuthClient({ baseUrl: 'http://localhost:3000', fetcher })

    await expect(client.startEmail('pessoa@example.com')).resolves.toBeUndefined()
    await expect(client.verifyEmail('pessoa@example.com', '012345')).resolves.toEqual(session)
    expect(fetcher.mock.calls[1]?.[0]).toBe('http://localhost:3000/auth/email/verify')
    expect(fetcher.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({
        body: JSON.stringify({ email: 'pessoa@example.com', code: '012345' }),
      }),
    )
  })

  it('preserva código e mensagem em português do erro da API', async () => {
    const fetcher = jest.fn().mockResolvedValue(
      response(429, {
        error: 'too_many_requests',
        message: 'Aguarde antes de solicitar outro código.',
      }),
    )
    const client = createAuthClient({ baseUrl: 'http://localhost:3000', fetcher })

    await expect(client.startEmail('pessoa@example.com')).rejects.toMatchObject({
      name: 'AuthApiError',
      status: 429,
      code: 'too_many_requests',
      message: 'Aguarde antes de solicitar outro código.',
    })
  })

  it('usa mensagem local em português quando erro não contém texto válido', async () => {
    const fetcher = jest.fn().mockResolvedValue(response(401, { error: 'invalid_code' }))
    const client = createAuthClient({ baseUrl: 'http://localhost:3000', fetcher })

    await expect(client.verifyEmail('pessoa@example.com', '000000')).rejects.toMatchObject({
      message: 'Código incorreto ou expirado. Confira e tente novamente.',
    })
  })

  it('implementa refresh, logout e requisição autenticada', async () => {
    const fetcher = jest
      .fn()
      .mockResolvedValueOnce(response(200, session))
      .mockResolvedValueOnce(response(204))
      .mockResolvedValueOnce(response(200, { user: session.user }))
    const client = createAuthClient({ baseUrl: 'http://localhost:3000', fetcher })

    await expect(client.refresh('refresh-1')).resolves.toEqual(session)
    await expect(client.logout('refresh-1')).resolves.toBeUndefined()
    await expect(client.requestWithAccessToken('/me', 'access-1')).resolves.toMatchObject({
      status: 200,
    })

    expect(fetcher.mock.calls[0]?.[0]).toBe('http://localhost:3000/auth/refresh')
    expect(fetcher.mock.calls[1]?.[0]).toBe('http://localhost:3000/auth/logout')
    expect(fetcher.mock.calls[2]?.[0]).toBe('http://localhost:3000/me')
    const requestHeaders = fetcher.mock.calls[2]?.[1]?.headers
    expect(requestHeaders).toBeInstanceOf(Headers)
    expect(new Headers(requestHeaders).get('Authorization')).toBe('Bearer access-1')
  })

  it('rejeita payload de sessão incompleto', async () => {
    const fetcher = jest.fn().mockResolvedValue(response(200, { accessToken: 'missing-fields' }))
    const client = createAuthClient({ baseUrl: 'http://localhost:3000', fetcher })

    await expect(client.verifyEmail('pessoa@example.com', '012345')).rejects.toBeInstanceOf(
      AuthApiError,
    )
    await expect(client.refresh('refresh-1')).rejects.toBeInstanceOf(AuthApiError)
  })
})
