import { act, render, waitFor } from '@testing-library/react-native'
import { Text } from 'react-native'

import type { AuthClient, AuthSession } from '../auth-client'
import { SessionProvider, useSession, type SessionContextValue } from '../session-provider'
import { SessionManager, type SessionStorage } from '../session-manager'

const session: AuthSession = {
  accessToken: 'access-1',
  accessTokenExpiresAt: '2099-10-20T12:15:00.000Z',
  refreshToken: 'refresh-1',
  user: { id: 'user-1', email: 'pessoa@example.com', name: null },
}

const otherSession: AuthSession = {
  accessToken: 'access-2',
  accessTokenExpiresAt: '2099-10-20T12:15:00.000Z',
  refreshToken: 'refresh-2',
  user: { id: 'user-2', email: 'outra@example.com', name: null },
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })

  return { promise, resolve }
}

function httpResponse(status: number): Response {
  return { ok: status >= 200 && status < 300, status } as Response
}

async function setupProvider() {
  let storedSession: AuthSession | null = session
  let contextValue: SessionContextValue | null = null
  const pendingResponse = deferred<Response>()
  const storage: SessionStorage = {
    get: jest.fn(async () => storedSession),
    set: jest.fn(async (nextSession) => {
      storedSession = nextSession
    }),
    clear: jest.fn(async () => {
      storedSession = null
    }),
  }
  const client: jest.Mocked<AuthClient> = {
    startEmail: jest.fn(),
    verifyEmail: jest.fn().mockResolvedValue(otherSession),
    refresh: jest.fn(),
    logout: jest.fn(),
    requestWithAccessToken: jest
      .fn<Promise<Response>, [path: string, accessToken: string, init?: RequestInit]>()
      .mockImplementation(() => pendingResponse.promise),
  }
  const manager = new SessionManager(client, storage)

  function SessionProbe() {
    contextValue = useSession()
    return (
      <>
        <Text testID="session-status">{contextValue.status}</Text>
        <Text testID="session-user">{contextValue.session?.user.id ?? 'none'}</Text>
      </>
    )
  }

  const screen = await render(
    <SessionProvider manager={manager}>
      <SessionProbe />
    </SessionProvider>,
  )
  const currentContext = () => {
    if (contextValue === null) throw new Error('SessionProvider ainda não renderizou.')
    return contextValue
  }

  return { screen, client, storage, pendingResponse, currentContext }
}

describe('provider de sessão', () => {
  it('ignora resposta antiga que chega depois do logout', async () => {
    const { screen, client, storage, pendingResponse, currentContext } = await setupProvider()
    await waitFor(() =>
      expect(screen.getByTestId('session-status')).toHaveTextContent('authenticated'),
    )

    let pendingRequest!: Promise<Response>
    await act(async () => {
      pendingRequest = currentContext().request('/me')
    })
    await waitFor(() => expect(client.requestWithAccessToken).toHaveBeenCalledTimes(1))

    await act(async () => {
      await currentContext().logout()
    })
    expect(screen.getByTestId('session-status')).toHaveTextContent('unauthenticated')

    await act(async () => {
      pendingResponse.resolve(httpResponse(200))
      await pendingRequest
    })

    expect(storage.clear).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('session-status')).toHaveTextContent('unauthenticated')
    expect(screen.getByTestId('session-user')).toHaveTextContent('none')
  })

  it('ignora resposta antiga que chega depois da troca de conta', async () => {
    const { screen, client, pendingResponse, currentContext } = await setupProvider()
    await waitFor(() =>
      expect(screen.getByTestId('session-status')).toHaveTextContent('authenticated'),
    )

    let pendingRequest!: Promise<Response>
    await act(async () => {
      pendingRequest = currentContext().request('/me')
    })
    await waitFor(() => expect(client.requestWithAccessToken).toHaveBeenCalledTimes(1))

    await act(async () => {
      await currentContext().verifyEmail(otherSession.user.email, '123456')
    })
    expect(screen.getByTestId('session-user')).toHaveTextContent(otherSession.user.id)

    await act(async () => {
      pendingResponse.resolve(httpResponse(200))
      await pendingRequest
    })

    expect(screen.getByTestId('session-status')).toHaveTextContent('authenticated')
    expect(screen.getByTestId('session-user')).toHaveTextContent(otherSession.user.id)
  })
})
