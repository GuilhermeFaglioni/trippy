import { act, fireEvent, render, waitFor } from '@testing-library/react-native'

import { DesignSystemProvider } from '../../../design-system'
import { ApiDiagnosticsScreen } from '../api-diagnostics-screen'
import { checkApiHealth, getApiBaseUrl } from '../health-client'

jest.mock('../health-client', () => ({
  checkApiHealth: jest.fn(),
  getApiBaseUrl: jest.fn(),
}))

const mockedCheckApiHealth = jest.mocked(checkApiHealth)
const mockedGetApiBaseUrl = jest.mocked(getApiBaseUrl)

async function renderScreen() {
  return render(
    <DesignSystemProvider>
      <ApiDiagnosticsScreen />
    </DesignSystemProvider>,
  )
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })

  return { promise, resolve }
}

describe('tela de diagnóstico da API', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockedGetApiBaseUrl.mockReturnValue('http://localhost:3000')
  })

  it('mostra carregamento e sucesso com componentes acessíveis', async () => {
    const request = deferred<{ status: 'available' | 'unavailable' | 'timeout' | 'aborted' }>()
    mockedCheckApiHealth.mockReturnValue(request.promise)

    const screen = await renderScreen()
    expect(screen.getByTestId('api-health-notice')).toHaveTextContent(/Verificando conexão/)
    expect(screen.getByRole('button', { name: 'Verificando conexão' })).toBeDisabled()
    const apiAddress = screen.getByLabelText('Endereço da API')
    expect(apiAddress).toHaveProp('maxFontSizeMultiplier', 2)
    expect(apiAddress).toBeDisabled()
    expect(mockedCheckApiHealth).toHaveBeenCalledWith(
      'http://localhost:3000',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )

    await act(async () => request.resolve({ status: 'available' }))

    expect(await screen.findByText('API disponível')).toBeOnTheScreen()
    expect(screen.getByText('Conexão confirmada.')).toBeOnTheScreen()
  })

  it('permite editar endereço e tentar novamente depois de uma falha', async () => {
    mockedCheckApiHealth
      .mockResolvedValueOnce({ status: 'unavailable' })
      .mockResolvedValueOnce({ status: 'available' })

    const screen = await renderScreen()
    expect(await screen.findByText('API indisponível')).toBeOnTheScreen()

    await fireEvent.changeText(screen.getByLabelText('Endereço da API'), 'http://127.0.0.1:4000')
    await fireEvent.press(screen.getByRole('button', { name: 'Tentar novamente' }))

    await waitFor(() => {
      expect(mockedCheckApiHealth).toHaveBeenLastCalledWith(
        'http://127.0.0.1:4000',
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      )
    })
    expect(await screen.findByText('API disponível')).toBeOnTheScreen()
  })

  it('impede nova chamada enquanto carregando e aborta ao desmontar', async () => {
    let requestSignal: AbortSignal | undefined
    const request = deferred<{
      status: 'available' | 'unavailable' | 'timeout' | 'aborted'
    }>()
    mockedCheckApiHealth.mockImplementation((_url, options) => {
      requestSignal = options?.signal
      return request.promise
    })

    const screen = await renderScreen()
    await fireEvent.press(screen.getByRole('button', { name: 'Verificando conexão' }))

    expect(mockedCheckApiHealth).toHaveBeenCalledTimes(1)
    await screen.unmount()
    expect(requestSignal?.aborted).toBe(true)
    await act(async () => request.resolve({ status: 'available' }))
  })

  it('explica timeout sem expor detalhes técnicos', async () => {
    mockedCheckApiHealth.mockResolvedValue({ status: 'timeout' })

    const screen = await renderScreen()

    expect(await screen.findByText('A API demorou para responder')).toBeOnTheScreen()
    expect(screen.getByText('Confira a conexão e tente novamente.')).toBeOnTheScreen()
    expect(screen.queryByText(/localhost|\/health|timeout/i)).toBeNull()
  })
})
