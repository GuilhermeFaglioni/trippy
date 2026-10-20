import { AuthApiError, type AuthClient, type AuthSession } from '../auth-client'
import { SessionManager, type SessionStorage } from '../session-manager'

const session = {
  accessToken: 'access-1',
  accessTokenExpiresAt: '2026-10-20T12:15:00.000Z',
  refreshToken: 'refresh-1',
  user: { id: 'user-1', email: 'pessoa@example.com', name: null },
}

const renewedSession = {
  ...session,
  accessToken: 'access-2',
  accessTokenExpiresAt: '2026-10-20T12:30:00.000Z',
  refreshToken: 'refresh-2',
}

function setup(initialSession: typeof session | null = session) {
  let storedSession: AuthSession | null = initialSession
  const storage: SessionStorage = {
    get: jest.fn(async () => storedSession),
    set: jest.fn(async (value) => {
      storedSession = value
    }),
    clear: jest.fn(async () => {
      storedSession = null
    }),
  }
  const client: jest.Mocked<AuthClient> = {
    startEmail: jest.fn(),
    verifyEmail: jest.fn(),
    refresh: jest.fn(),
    logout: jest.fn(),
    requestWithAccessToken: jest.fn(),
  }
  const manager = new SessionManager(client, storage, () => Date.parse('2026-10-20T12:00:00.000Z'))

  return { manager, storage, client, getStoredSession: () => storedSession }
}

describe('gerenciador de sessão', () => {
  it('abre com sessão persistida enquanto access token ainda vale', async () => {
    const { manager, client } = setup()

    await expect(manager.restore()).resolves.toEqual(session)
    expect(client.refresh).not.toHaveBeenCalled()
  })

  it('renova access expirado e persiste tokens rotacionados', async () => {
    const expiredSession = { ...session, accessTokenExpiresAt: '2026-10-19T12:00:00.000Z' }
    const { manager, client, storage, getStoredSession } = setup(expiredSession)
    client.refresh.mockResolvedValue(renewedSession)

    await expect(manager.restore()).resolves.toEqual(renewedSession)
    expect(client.refresh).toHaveBeenCalledWith('refresh-1')
    expect(storage.set).toHaveBeenCalledWith(renewedSession)
    expect(getStoredSession()).toEqual(renewedSession)
  })

  it('mantém sessão persistida quando refresh falha por falta de rede', async () => {
    const expiredSession = { ...session, accessTokenExpiresAt: '2026-10-19T12:00:00.000Z' }
    const { manager, client, storage } = setup(expiredSession)
    client.refresh.mockRejectedValue(new TypeError('Network request failed'))

    await expect(manager.restore()).resolves.toEqual(expiredSession)
    expect(storage.clear).not.toHaveBeenCalled()
  })

  it('apaga sessão quando refresh recusado com 401', async () => {
    const expiredSession = { ...session, accessTokenExpiresAt: '2026-10-19T12:00:00.000Z' }
    const { manager, client, storage, getStoredSession } = setup(expiredSession)
    client.refresh.mockRejectedValue(
      new AuthApiError(401, 'invalid_refresh_token', 'Sessão expirada.'),
    )

    await expect(manager.restore()).resolves.toBeNull()
    expect(storage.clear).toHaveBeenCalledTimes(1)
    expect(getStoredSession()).toBeNull()
  })

  it('renova em 401 e repete requisição uma única vez com access novo', async () => {
    const { manager, client, storage } = setup()
    client.requestWithAccessToken
      .mockResolvedValueOnce({ status: 401 } as Response)
      .mockResolvedValueOnce({ status: 200 } as Response)
    client.refresh.mockResolvedValue(renewedSession)

    const result = await manager.request(session, '/me')

    expect(client.requestWithAccessToken).toHaveBeenNthCalledWith(1, '/me', 'access-1', undefined)
    expect(client.requestWithAccessToken).toHaveBeenNthCalledWith(2, '/me', 'access-2', undefined)
    expect(client.requestWithAccessToken).toHaveBeenCalledTimes(2)
    expect(result).toEqual({
      response: expect.objectContaining({ status: 200 }),
      session: renewedSession,
    })
    expect(storage.set).toHaveBeenCalledWith(renewedSession)
  })

  it('limpa sessão quando refresh disparado por 401 é recusado', async () => {
    const { manager, client, storage } = setup()
    client.requestWithAccessToken.mockResolvedValue({ status: 401 } as Response)
    client.refresh.mockRejectedValue(
      new AuthApiError(401, 'invalid_refresh_token', 'Sessão expirada.'),
    )

    const result = await manager.request(session, '/me')

    expect(result).toEqual({ response: expect.objectContaining({ status: 401 }), session: null })
    expect(client.requestWithAccessToken).toHaveBeenCalledTimes(1)
    expect(storage.clear).toHaveBeenCalledTimes(1)
  })
})
