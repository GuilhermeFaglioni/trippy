import { AuthApiError, createAuthClient, type AuthClient, type AuthSession } from '../auth-client'
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

function httpResponse(status: number, payload: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: jest.fn().mockResolvedValue(payload),
  } as unknown as Response
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

  it('compartilha refresh concorrente e preserva sessão rotacionada', async () => {
    let storedSession: AuthSession | null = session
    let currentRefreshToken = session.refreshToken
    let unauthorizedRequests = 0
    let releaseUnauthorizedRequests: (() => void) | undefined
    let releaseDelayedUnauthorizedRequest: (() => void) | undefined
    const bothUnauthorizedRequests = new Promise<void>((resolve) => {
      releaseUnauthorizedRequests = resolve
    })
    const delayedUnauthorizedRequest = new Promise<void>((resolve) => {
      releaseDelayedUnauthorizedRequest = resolve
    })
    const storage: SessionStorage = {
      get: jest.fn(async () => storedSession),
      set: jest.fn(async (value) => {
        storedSession = value
      }),
      clear: jest.fn(async () => {
        storedSession = null
      }),
    }
    const fetcher = jest.fn<Promise<Response>, [url: string, init?: RequestInit]>(
      async (url, init) => {
        if (url.endsWith('/me')) {
          const authorization = new Headers(init?.headers).get('Authorization')
          if (authorization === 'Bearer access-2') return httpResponse(200, { user: session.user })

          unauthorizedRequests += 1
          if (unauthorizedRequests === 2) releaseUnauthorizedRequests?.()
          if (unauthorizedRequests === 3) {
            await delayedUnauthorizedRequest
            return httpResponse(401, { error: 'unauthorized', message: 'Sessão expirada.' })
          }

          await bothUnauthorizedRequests
          return httpResponse(401, { error: 'unauthorized', message: 'Sessão expirada.' })
        }

        if (url.endsWith('/auth/refresh')) {
          const body = JSON.parse(String(init?.body)) as { refreshToken: string }
          if (body.refreshToken !== currentRefreshToken) {
            return httpResponse(401, {
              error: 'invalid_refresh_token',
              message: 'Refresh reutilizado.',
            })
          }

          currentRefreshToken = renewedSession.refreshToken
          return httpResponse(200, renewedSession)
        }

        throw new Error(`Rota inesperada no teste: ${url}`)
      },
    )
    const manager = new SessionManager(
      createAuthClient({ baseUrl: 'http://localhost:3000', fetcher }),
      storage,
      () => Date.parse('2026-10-20T12:00:00.000Z'),
    )

    const firstPair = Promise.all([
      manager.request(session, '/me'),
      manager.request(session, '/me'),
    ])
    const delayedRequest = manager.request(session, '/me')
    const concurrentResults = await firstPair
    releaseDelayedUnauthorizedRequest?.()
    const delayedResult = await delayedRequest
    const results = [...concurrentResults, delayedResult]

    expect(fetcher.mock.calls.filter(([url]) => url.endsWith('/auth/refresh'))).toHaveLength(1)
    expect(results).toEqual([
      { response: expect.objectContaining({ status: 200 }), session: renewedSession },
      { response: expect.objectContaining({ status: 200 }), session: renewedSession },
      { response: expect.objectContaining({ status: 200 }), session: renewedSession },
    ])
    expect(storedSession).toEqual(renewedSession)
    expect(storage.clear).not.toHaveBeenCalled()
  })

  it('não repete requisição antiga com sessão de outra conta', async () => {
    const otherAccountSession = {
      ...renewedSession,
      user: { id: 'user-2', email: 'outra@example.com', name: null },
    }
    const { manager, client, storage } = setup()
    await storage.set(otherAccountSession)
    client.requestWithAccessToken.mockResolvedValue({ status: 401 } as Response)

    const result = await manager.request(session, '/me')

    expect(client.requestWithAccessToken).toHaveBeenCalledTimes(1)
    expect(client.requestWithAccessToken).toHaveBeenCalledWith('/me', 'access-1', undefined)
    expect(client.refresh).not.toHaveBeenCalled()
    expect(result).toEqual({
      response: expect.objectContaining({ status: 401 }),
      session: otherAccountSession,
    })
  })

  it('não sobrescreve nova conta quando refresh antigo termina depois', async () => {
    const otherAccountSession = {
      ...renewedSession,
      user: { id: 'user-2', email: 'outra@example.com', name: null },
    }
    const { manager, client, storage, getStoredSession } = setup()
    let completeRefresh: ((value: AuthSession) => void) | undefined
    let announceRefreshStarted: (() => void) | undefined
    const refreshStarted = new Promise<void>((resolve) => {
      announceRefreshStarted = resolve
    })
    client.requestWithAccessToken.mockResolvedValue({ status: 401 } as Response)
    client.refresh.mockImplementation(() => {
      announceRefreshStarted?.()
      return new Promise((resolve) => {
        completeRefresh = resolve
      })
    })
    client.verifyEmail.mockResolvedValue(otherAccountSession)

    const pendingRequest = manager.request(session, '/me')
    await refreshStarted
    await manager.verifyEmail(otherAccountSession.user.email, '123456')
    completeRefresh?.(renewedSession)
    const result = await pendingRequest

    expect(client.refresh).toHaveBeenCalledTimes(1)
    expect(storage.set).toHaveBeenCalledTimes(1)
    expect(storage.set).toHaveBeenCalledWith(otherAccountSession)
    expect(storage.clear).not.toHaveBeenCalled()
    expect(getStoredSession()).toEqual(otherAccountSession)
    expect(client.requestWithAccessToken).toHaveBeenCalledTimes(1)
    expect(result).toEqual({
      response: expect.objectContaining({ status: 401 }),
      session: otherAccountSession,
    })
  })

  it('preserva nova conta quando refresh antigo termina com 401', async () => {
    const otherAccountSession = {
      ...renewedSession,
      user: { id: 'user-2', email: 'outra@example.com', name: null },
    }
    const { manager, client, storage, getStoredSession } = setup()
    let rejectRefresh: ((reason: AuthApiError) => void) | undefined
    let announceRefreshStarted: (() => void) | undefined
    const refreshStarted = new Promise<void>((resolve) => {
      announceRefreshStarted = resolve
    })
    client.requestWithAccessToken.mockResolvedValue({ status: 401 } as Response)
    client.refresh.mockImplementation(() => {
      announceRefreshStarted?.()
      return new Promise((_, reject) => {
        rejectRefresh = reject
      })
    })
    client.verifyEmail.mockResolvedValue(otherAccountSession)

    const pendingRequest = manager.request(session, '/me')
    await refreshStarted
    await manager.verifyEmail(otherAccountSession.user.email, '123456')
    rejectRefresh?.(new AuthApiError(401, 'invalid_refresh_token', 'Sessão expirada.'))
    const result = await pendingRequest

    expect(client.refresh).toHaveBeenCalledTimes(1)
    expect(client.requestWithAccessToken).toHaveBeenCalledTimes(1)
    expect(storage.clear).not.toHaveBeenCalled()
    expect(getStoredSession()).toEqual(otherAccountSession)
    expect(result).toEqual({
      response: expect.objectContaining({ status: 401 }),
      session: otherAccountSession,
    })
  })

  it('não limpa nova conta em logout atrasado de sessão anterior', async () => {
    const otherAccountSession = {
      ...renewedSession,
      user: { id: 'user-2', email: 'outra@example.com', name: null },
    }
    const { manager, client, storage, getStoredSession } = setup()
    await storage.set(otherAccountSession)

    await manager.logout(session)

    expect(storage.clear).not.toHaveBeenCalled()
    expect(getStoredSession()).toEqual(otherAccountSession)
    expect(client.logout).toHaveBeenCalledWith(session.refreshToken)
  })

  it('limpa sessão renovada da mesma conta em logout atrasado', async () => {
    const { manager, client, storage, getStoredSession } = setup()
    await storage.set(renewedSession)

    await manager.logout(session)

    expect(storage.clear).toHaveBeenCalledTimes(1)
    expect(getStoredSession()).toBeNull()
    expect(client.logout).toHaveBeenCalledWith(renewedSession.refreshToken)
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
