import { act, fireEvent, render, waitFor } from '@testing-library/react-native'
import type { PlaceSearchCandidate } from '@trippy/domain'
import type { SyncClient, SyncClientStatus } from '@trippy/sync'

import { DesignSystemProvider } from '../../../design-system'
import * as sessionProvider from '../../auth/session-provider'
import * as syncProvider from '../../sync/sync-provider'
import { AddPlaceScreen } from '../add-place-screen'

const mockRequest = jest.fn<Promise<Response>, [string, RequestInit?]>()
const mockBack = jest.fn()
let mockOffline = false

jest.mock('expo-router', () => ({ useRouter: () => ({ back: mockBack }) }))
jest.mock('../../sync/use-network-gate', () => ({ useNetworkOffline: () => mockOffline }))

const status: SyncClientStatus = { lastSyncedAt: null, pending: 0, notSent: 0 }
const client = {
  setPlaceNote: jest.fn().mockResolvedValue(undefined),
  addPlace: jest.fn().mockResolvedValue('manual-place'),
  addPlaceFromCandidate: jest.fn().mockResolvedValue('candidate-place'),
  removePlace: jest.fn(),
  linkGooglePlace: jest.fn(),
  setLocalDetails: jest.fn(),
  markVisit: jest.fn(),
  unmarkVisit: jest.fn(),
  syncNow: jest.fn(),
  listPlaces: jest.fn().mockResolvedValue([]),
  subscribe: jest.fn(() => () => undefined),
  getStatus: jest.fn(() => status),
} as unknown as SyncClient

const candidate = (name: string, providerRef: string): PlaceSearchCandidate => ({
  provider: 'geoapify',
  providerRef,
  name,
  localName: null,
  address: 'Rua da Sé, 1',
  localAddress: null,
  lat: -23.55,
  lng: -46.63,
  countryCode: 'BR',
  datasource: 'openstreetmap',
  attribution: '© OpenStreetMap contributors',
  license: 'ODbL',
  method: 'geocoding',
  token: `token-${providerRef}`,
})

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status: 200 })
}

async function renderScreen() {
  jest
    .spyOn(sessionProvider, 'useSession')
    .mockImplementation(
      () =>
        ({ session: { user: { id: 'user-1' } }, request: mockRequest }) as unknown as ReturnType<
          typeof sessionProvider.useSession
        >,
    )
  jest.spyOn(syncProvider, 'useSync').mockImplementation(
    () =>
      ({
        client,
        status,
        ready: true,
        error: null,
        rememberTripId: jest.fn(),
        rememberTripIds: jest.fn(),
      }) as unknown as ReturnType<typeof syncProvider.useSync>,
  )

  return render(
    <DesignSystemProvider>
      <AddPlaceScreen tripId="trip-1" tripName="Fim de semana" role="member" />
    </DesignSystemProvider>,
  )
}

describe('tela Adicionar lugar', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockOffline = false
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('aguarda o debounce e descarta resultados de uma consulta anterior', async () => {
    jest.useFakeTimers()
    let resolveOld!: (value: Response) => void
    let resolveNew!: (value: Response) => void
    mockRequest
      .mockImplementationOnce(() => new Promise((resolve) => (resolveOld = resolve)))
      .mockImplementationOnce(() => new Promise((resolve) => (resolveNew = resolve)))
    const screen = await renderScreen()

    await fireEvent.changeText(screen.getByTestId('place-search-query'), 'Museu antigo')
    await act(async () => {
      jest.advanceTimersByTime(349)
    })
    expect(mockRequest).not.toHaveBeenCalled()
    await act(async () => {
      jest.advanceTimersByTime(1)
    })
    expect(mockRequest).toHaveBeenCalledTimes(1)

    await fireEvent.changeText(screen.getByTestId('place-search-query'), 'Museu novo')
    await act(async () => {
      jest.advanceTimersByTime(350)
    })
    expect(mockRequest).toHaveBeenCalledTimes(2)

    await act(async () => {
      resolveNew(jsonResponse({ candidates: [candidate('Museu novo', 'new')] }))
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(screen.getByText('Museu novo')).toBeOnTheScreen()

    await act(async () => {
      resolveOld(jsonResponse({ candidates: [candidate('Museu antigo', 'old')] }))
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(screen.queryByText('Museu antigo')).toBeNull()
  })

  it('não busca consultas menores que dois caracteres', async () => {
    jest.useFakeTimers()
    const rendered = await renderScreen()

    await fireEvent.changeText(rendered.getByTestId('place-search-query'), 'A')
    await act(async () => {
      jest.advanceTimersByTime(500)
    })

    expect(rendered.getByText('Digite pelo menos 2 caracteres para buscar.')).toBeOnTheScreen()
    expect(mockRequest).not.toHaveBeenCalled()
  })

  it('faz a segunda tentativa e salva candidato obtido pela busca', async () => {
    const second = candidate('Museu Histórico · Places', 'history-places')
    mockRequest
      .mockResolvedValueOnce(jsonResponse({ candidates: [] }))
      .mockResolvedValueOnce(jsonResponse({ candidates: [second] }))
    const rendered = await renderScreen()

    await fireEvent.changeText(rendered.getByTestId('place-search-query'), 'Museu Histórico')
    expect(await rendered.findByTestId('place-search-empty')).toBeOnTheScreen()
    await fireEvent.press(rendered.getByTestId('place-search-secondary'))
    expect(await rendered.findByText('Museu Histórico · Places')).toBeOnTheScreen()
    expect(mockRequest).toHaveBeenNthCalledWith(
      2,
      '/trips/trip-1/places/search?q=Museu%20Hist%C3%B3rico&attempt=secondary',
    )

    await fireEvent.press(rendered.getByTestId('place-candidate-0'))
    await fireEvent.press(rendered.getByTestId('place-submit'))
    await waitFor(() => expect(client.addPlaceFromCandidate).toHaveBeenCalledWith('trip-1', second))
    expect(mockBack).toHaveBeenCalledTimes(1)
    expect(rendered.getByTestId('place-search-attribution')).toHaveTextContent(
      /© OpenStreetMap contributors/,
    )
    expect(rendered.getByTestId('place-search-attribution')).toHaveTextContent(
      /Powered by Geoapify/,
    )
  })

  it('mostra nome e endereço locais do candidato com os valores principais', async () => {
    mockRequest.mockResolvedValue(
      jsonResponse({
        candidates: [
          {
            ...candidate('Tokyo Museum', 'tokyo'),
            localName: '東京博物館',
            localAddress: '東京都千代田区',
          },
        ],
      }),
    )
    const rendered = await renderScreen()

    await fireEvent.changeText(rendered.getByTestId('place-search-query'), 'Tokyo Museum')

    expect(await rendered.findByTestId('place-candidate-0')).toHaveTextContent(
      /Tokyo Museum.*東京博物館/,
    )
    expect(rendered.getByText('Rua da Sé, 1')).toBeOnTheScreen()
    expect(rendered.getByTestId('place-candidate-0')).toHaveTextContent(/東京都千代田区/)
  })

  it('offline mantiene o salvamento do nome digitado', async () => {
    mockOffline = true
    const rendered = await renderScreen()

    await fireEvent.changeText(rendered.getByTestId('place-search-query'), 'Restaurante')
    expect(await rendered.findByTestId('place-search-offline')).toHaveTextContent(
      /A busca precisa de internet\./,
    )
    await fireEvent.press(rendered.getByTestId('place-submit'))

    await waitFor(() => expect(client.addPlace).toHaveBeenCalledWith('trip-1', 'Restaurante'))
    expect(mockRequest).not.toHaveBeenCalled()
    expect(mockBack).toHaveBeenCalledTimes(1)
  })

  it('mantém candidato já obtido para salvar pela fila offline', async () => {
    const found = candidate('Café da Praça', 'cafe')
    mockRequest.mockResolvedValue(jsonResponse({ candidates: [found] }))
    const rendered = await renderScreen()

    await fireEvent.changeText(rendered.getByTestId('place-search-query'), 'Café da Praça')
    expect(await rendered.findByText('Café da Praça')).toBeOnTheScreen()

    mockOffline = true
    await rendered.rerender(
      <DesignSystemProvider>
        <AddPlaceScreen tripId="trip-1" tripName="Fim de semana" role="member" />
      </DesignSystemProvider>,
    )

    expect(await rendered.findByTestId('place-search-offline')).toBeOnTheScreen()
    expect(rendered.getByTestId('place-candidate-0')).toBeOnTheScreen()
    await fireEvent.press(rendered.getByTestId('place-candidate-0'))
    await fireEvent.press(rendered.getByTestId('place-submit'))

    await waitFor(() => expect(client.addPlaceFromCandidate).toHaveBeenCalledWith('trip-1', found))
    expect(mockBack).toHaveBeenCalledTimes(1)
  })

  it.each([
    [503, 'provider_unavailable', 'Busca Geoapify indisponível.'],
    [429, 'rate_limited', 'Limite de buscas atingido.'],
  ])('mostra erro HTTP %i e mantém o plano manual', async (httpStatus, code, message) => {
    mockRequest.mockResolvedValue(
      new Response(JSON.stringify({ error: code, message }), { status: httpStatus }),
    )
    const rendered = await renderScreen()

    await fireEvent.changeText(rendered.getByTestId('place-search-query'), 'Museu')
    expect(await rendered.findByTestId('place-search-error')).toHaveTextContent(message)
    expect(rendered.queryByTestId('place-search-secondary')).toBeNull()
    await fireEvent.press(rendered.getByTestId('place-submit'))

    await waitFor(() => expect(client.addPlace).toHaveBeenCalledWith('trip-1', 'Museu'))
    expect(mockBack).toHaveBeenCalledTimes(1)
  })

  it('o botão só habilita depois de tocar no resultado e salva com nome e endereço, sem pedir de novo', async () => {
    const found = {
      ...candidate('Yu Garden', 'yu'),
      localName: '豫园',
      address: '218 Anren St, Huangpu',
    }
    mockRequest.mockResolvedValue(jsonResponse({ candidates: [found] }))
    const rendered = await renderScreen()

    await fireEvent.changeText(rendered.getByTestId('place-search-query'), 'yu garden')
    await rendered.findByTestId('place-candidate-0')
    expect(rendered.getByTestId('place-submit')).toBeDisabled()

    await fireEvent.press(rendered.getByTestId('place-candidate-0'))
    expect(rendered.getByTestId('place-submit')).toBeEnabled()
    await fireEvent.press(rendered.getByTestId('place-submit'))

    await waitFor(() => expect(client.addPlaceFromCandidate).toHaveBeenCalledWith('trip-1', found))
    expect(client.addPlace).not.toHaveBeenCalled()
    expect(client.setPlaceNote).not.toHaveBeenCalled()
    expect(mockBack).toHaveBeenCalledTimes(1)
  })

  it('salva o comentário opcional como nota do lugar', async () => {
    const found = candidate('Yu Garden', 'yu')
    mockRequest.mockResolvedValue(jsonResponse({ candidates: [found] }))
    const rendered = await renderScreen()

    await fireEvent.changeText(rendered.getByTestId('place-search-query'), 'yu garden')
    await fireEvent.press(await rendered.findByTestId('place-candidate-0'))
    await fireEvent.changeText(rendered.getByTestId('place-comment'), '  Vale muito a pena  ')
    await fireEvent.press(rendered.getByTestId('place-submit'))

    await waitFor(() =>
      expect(client.setPlaceNote).toHaveBeenCalledWith(
        'trip-1',
        'candidate-place',
        'Vale muito a pena',
      ),
    )
  })

  it('Cancelar volta sem salvar', async () => {
    const rendered = await renderScreen()
    await fireEvent.press(rendered.getByTestId('add-place-cancel'))
    expect(mockBack).toHaveBeenCalledTimes(1)
    expect(client.addPlace).not.toHaveBeenCalled()
  })
})
