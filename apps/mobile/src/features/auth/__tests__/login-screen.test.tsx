import { fireEvent, render, waitFor } from '@testing-library/react-native'
import { router } from 'expo-router'

import { DesignSystemProvider } from '../../../design-system'
import { LoginScreen } from '../login-screen'
import { createAuthClient, type AuthFetcher } from '../auth-client'
import { SessionProvider } from '../session-provider'
import { SessionManager, type SessionStorage } from '../session-manager'

const session = {
  accessToken: 'access-1',
  accessTokenExpiresAt: '2026-10-20T12:15:00.000Z',
  refreshToken: 'refresh-1',
  user: { id: 'user-1', email: 'pessoa@example.com', name: null },
}

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn() },
}))

function response(status: number, body?: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: jest.fn().mockResolvedValue(body),
  } as unknown as Response
}

async function renderLogin(fetcher: AuthFetcher) {
  const storage: SessionStorage = {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
    clear: jest.fn().mockResolvedValue(undefined),
  }
  const manager = new SessionManager(
    createAuthClient({ baseUrl: 'http://localhost:3000', fetcher }),
    storage,
  )

  return await render(
    <DesignSystemProvider>
      <SessionProvider manager={manager}>
        <LoginScreen />
      </SessionProvider>
    </DesignSystemProvider>,
  )
}

describe('tela de login', () => {
  beforeEach(() => jest.clearAllMocks())

  it('envia e-mail, verifica código de seis dígitos, persiste sessão e abre home', async () => {
    const fetcher = jest
      .fn<Promise<Response>, [url: string, init?: RequestInit]>()
      .mockResolvedValueOnce(response(202, {}))
      .mockResolvedValueOnce(response(200, session))
    const screen = await renderLogin(fetcher)

    expect(screen.getByTestId('login-brand-symbol')).toBeOnTheScreen()
    expect(screen.getByText('Continuar com Apple')).toBeOnTheScreen()
    expect(screen.getByText('Continuar com Google')).toBeOnTheScreen()
    await fireEvent.press(screen.getByTestId('login-use-email'))
    await fireEvent.changeText(screen.getByTestId('login-email-input'), 'pessoa@example.com')
    await fireEvent.press(screen.getByTestId('login-email-submit'))

    expect(await screen.findByText('Código enviado')).toBeOnTheScreen()
    await fireEvent.changeText(screen.getByTestId('login-code-input'), '012345')
    await fireEvent.press(screen.getByTestId('login-code-submit'))

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/'))
    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      'http://localhost:3000/auth/email/start',
      expect.objectContaining({ body: JSON.stringify({ email: 'pessoa@example.com' }) }),
    )
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      'http://localhost:3000/auth/email/verify',
      expect.objectContaining({
        body: JSON.stringify({ email: 'pessoa@example.com', code: '012345' }),
      }),
    )
  })

  it('mostra erro da API em português e permite reenviar código', async () => {
    const fetcher = jest
      .fn<Promise<Response>, [url: string, init?: RequestInit]>()
      .mockResolvedValueOnce(response(202, {}))
      .mockResolvedValueOnce(
        response(429, {
          error: 'too_many_requests',
          message: 'Aguarde 60 segundos para pedir outro código.',
        }),
      )
    const screen = await renderLogin(fetcher)

    await fireEvent.press(screen.getByTestId('login-use-email'))
    await fireEvent.changeText(screen.getByTestId('login-email-input'), 'pessoa@example.com')
    await fireEvent.press(screen.getByTestId('login-email-submit'))
    await screen.findByTestId('login-code-input')
    await fireEvent.press(screen.getByTestId('login-code-resend'))

    await waitFor(() =>
      expect(screen.getByTestId('login-notice')).toHaveAccessibleName(
        /Aguarde 60 segundos para pedir outro código\./,
      ),
    )
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('avisa que Apple e Google ainda não estão disponíveis', async () => {
    const screen = await renderLogin(
      jest.fn<Promise<Response>, [url: string, init?: RequestInit]>(),
    )

    await fireEvent.press(screen.getByTestId('login-apple'))
    expect(screen.getByTestId('login-notice')).toHaveAccessibleName(
      /Apple ainda não está disponível/,
    )
    await fireEvent.press(screen.getByTestId('login-google'))
    expect(screen.getByTestId('login-notice')).toHaveAccessibleName(
      /Google ainda não está disponível/,
    )
  })

  it('oferece acesso ao diagnóstico da API', async () => {
    const screen = await renderLogin(
      jest.fn<Promise<Response>, [url: string, init?: RequestInit]>(),
    )

    expect(await screen.findByTestId('login-diagnostics')).toHaveTextContent('Diagnóstico da API')
  })
})
