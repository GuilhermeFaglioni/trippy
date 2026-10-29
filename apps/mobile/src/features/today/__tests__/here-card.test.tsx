import { act, fireEvent, render, waitFor } from '@testing-library/react-native'

type Screen = Awaited<ReturnType<typeof render>>
import type { PlaceSearchCandidate } from '@trippy/domain'
import type { SyncClientStatus } from '@trippy/sync'

import { DesignSystemProvider } from '../../../design-system'
import * as placesClient from '../../places/places-client'
import * as syncProvider from '../../sync/sync-provider'
import { HereCard } from '../here-card'
import type { HereLocationResult } from '../here-location'

let mockOffline = false

jest.mock('../../sync/use-network-gate', () => ({ useNetworkOffline: () => mockOffline }))

const status: SyncClientStatus = { lastSyncedAt: null, pending: 0, notSent: 0 }

function createSyncClient() {
  return {
    addPlace: jest.fn().mockResolvedValue('typed-place'),
    addPlaceFromCandidate: jest.fn().mockResolvedValue('candidate-place'),
    markVisit: jest.fn().mockResolvedValue(undefined),
    removePlace: jest.fn(),
    linkGooglePlace: jest.fn(),
    setLocalDetails: jest.fn(),
    unmarkVisit: jest.fn(),
    syncNow: jest.fn(),
    listPlaces: jest.fn().mockResolvedValue([]),
    subscribe: jest.fn(() => () => undefined),
    getStatus: jest.fn(() => status),
  }
}

type FakeSyncClient = ReturnType<typeof createSyncClient>

const candidate: PlaceSearchCandidate = {
  provider: 'geoapify',
  providerRef: 'geo-1',
  name: 'Mirante da Praça',
  localName: null,
  address: 'Praça da Sé, 1',
  localAddress: null,
  lat: -23.55,
  lng: -46.63,
  countryCode: 'BR',
  datasource: 'openstreetmap',
  attribution: '© OpenStreetMap contributors',
  license: 'ODbL',
  method: 'geocoding',
  token: 'token-geo-1',
}

const granted: HereLocationResult = { status: 'granted', lat: -23.55, lng: -46.63 }

async function setup({
  client = createSyncClient(),
  nearby = jest.fn().mockResolvedValue({ candidates: [candidate] }),
  locate = jest.fn<Promise<HereLocationResult>, []>().mockResolvedValue(granted),
}: {
  client?: FakeSyncClient
  nearby?: jest.Mock
  locate?: jest.Mock
} = {}) {
  jest.spyOn(syncProvider, 'useSync').mockImplementation(
    () =>
      ({
        client,
        status,
        ready: true,
        error: null,
        removedTrips: [],
        rememberTripId: jest.fn(),
        rememberTripIds: jest.fn(),
      }) as unknown as ReturnType<typeof syncProvider.useSync>,
  )
  jest.spyOn(placesClient, 'usePlacesClient').mockReturnValue({
    search: jest.fn(),
    nearby,
    googleDetails: jest.fn(),
  } as unknown as ReturnType<typeof placesClient.usePlacesClient>)

  const onRegistered = jest.fn()
  const screen = await render(
    <DesignSystemProvider>
      <HereCard tripId="trip-1" dayIndex={1} onRegistered={onRegistered} locate={locate} />
    </DesignSystemProvider>,
  )
  return { screen, client, nearby, locate, onRegistered }
}

async function openPanel(screen: Screen) {
  await fireEvent.press(screen.getByTestId('hoje-estamos-aqui'))
}

async function typeAndSave(screen: Screen, name: string) {
  await fireEvent.changeText(screen.getByTestId('hoje-aqui-nome'), name)
  await fireEvent.press(screen.getByTestId('hoje-aqui-salvar-nome'))
}

describe('cartão Estamos aqui', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockOffline = false
  })

  it('não pede localização antes do toque em Usar minha localização', async () => {
    const { screen, locate } = await setup()

    await openPanel(screen)
    expect(screen.getByText(/Usamos sua localização só agora/u)).toBeOnTheScreen()
    expect(locate).not.toHaveBeenCalled()

    await fireEvent.press(screen.getByTestId('hoje-aqui-gps'))
    await waitFor(() => expect(locate).toHaveBeenCalledTimes(1))
  })

  it('sem permissão mostra aviso e o nome digitado ainda é salvo com dia e presença', async () => {
    const locate = jest.fn().mockResolvedValue({ status: 'denied' })
    const { screen, client, nearby } = await setup({ locate })

    await openPanel(screen)
    await fireEvent.press(screen.getByTestId('hoje-aqui-gps'))

    expect(await screen.findByTestId('hoje-aqui-sem-permissao')).toHaveTextContent(
      'Sem acesso à localização. Digite o nome do lugar.',
    )
    expect(nearby).not.toHaveBeenCalled()

    await typeAndSave(screen, 'Museu da Cidade')

    await waitFor(() =>
      expect(client.addPlace).toHaveBeenCalledWith('trip-1', 'Museu da Cidade', { dayIndex: 1 }),
    )
    await waitFor(() => expect(client.markVisit).toHaveBeenCalledWith('trip-1', 'typed-place'))
  })

  it('GPS indisponível mostra aviso e permite digitar o nome', async () => {
    const locate = jest.fn().mockResolvedValue({ status: 'unavailable' })
    const { screen } = await setup({ locate })

    await openPanel(screen)
    await fireEvent.press(screen.getByTestId('hoje-aqui-gps'))

    expect(await screen.findByTestId('hoje-aqui-gps-indisponivel')).toBeOnTheScreen()
    expect(screen.getByTestId('hoje-aqui-nome')).toBeOnTheScreen()
  })

  it('falha na busca por perto mostra aviso e o nome digitado segue disponível', async () => {
    const nearby = jest.fn().mockRejectedValue(new TypeError('Network request failed'))
    const { screen, client } = await setup({ nearby })

    await openPanel(screen)
    await fireEvent.press(screen.getByTestId('hoje-aqui-gps'))

    expect(await screen.findByTestId('hoje-aqui-busca-falhou')).toHaveTextContent(
      'Não conseguimos buscar lugares perto de você. Digite o nome do lugar.',
    )
    await typeAndSave(screen, 'Feira Livre')

    await waitFor(() =>
      expect(client.addPlace).toHaveBeenCalledWith('trip-1', 'Feira Livre', { dayIndex: 1 }),
    )
  })

  it('offline não chama a busca por perto e mantém o nome disponível', async () => {
    mockOffline = true
    const nearby = jest.fn()
    const { screen, client } = await setup({ nearby })

    await openPanel(screen)
    await fireEvent.press(screen.getByTestId('hoje-aqui-gps'))

    expect(await screen.findByTestId('hoje-aqui-busca-falhou')).toBeOnTheScreen()
    expect(nearby).not.toHaveBeenCalled()

    await typeAndSave(screen, 'Padaria')
    await waitFor(() =>
      expect(client.addPlace).toHaveBeenCalledWith('trip-1', 'Padaria', { dayIndex: 1 }),
    )
  })

  it('nome só com espaços mostra a validação e não salva', async () => {
    const { screen, client } = await setup()

    await openPanel(screen)
    await typeAndSave(screen, '   ')

    expect(await screen.findByTestId('hoje-aqui-nome-invalido')).toBeOnTheScreen()
    expect(client.addPlace).not.toHaveBeenCalled()
  })

  it('escolher um candidato registra com dia e marca presença', async () => {
    const { screen, client, onRegistered } = await setup()

    await openPanel(screen)
    await fireEvent.press(screen.getByTestId('hoje-aqui-gps'))
    await fireEvent.press(await screen.findByTestId('hoje-aqui-candidato-0'))

    await waitFor(() =>
      expect(client.addPlaceFromCandidate).toHaveBeenCalledWith('trip-1', candidate, {
        dayIndex: 1,
      }),
    )
    await waitFor(() => expect(client.markVisit).toHaveBeenCalledWith('trip-1', 'candidate-place'))
    await waitFor(() => expect(onRegistered).toHaveBeenCalledTimes(1))
    expect(screen.getByTestId('hoje-estamos-aqui')).toBeOnTheScreen()
  })

  it('falha ao salvar mostra erro e mantém o texto digitado', async () => {
    const client = createSyncClient()
    client.addPlace.mockRejectedValue(new Error('Não foi possível salvar agora.'))
    const { screen, onRegistered } = await setup({ client })

    await openPanel(screen)
    await typeAndSave(screen, 'Mercado Novo')

    expect(await screen.findByTestId('hoje-aqui-erro')).toHaveTextContent(
      'Não foi possível salvar agora.',
    )
    expect(screen.getByTestId('hoje-aqui-nome')).toHaveProp('value', 'Mercado Novo')
    expect(client.markVisit).not.toHaveBeenCalled()
    expect(onRegistered).not.toHaveBeenCalled()
  })

  it('se marcar presença falha depois de salvar, não duplica o lugar ao tentar de novo', async () => {
    const client = createSyncClient()
    client.markVisit
      .mockRejectedValueOnce(new Error('Sem conexão.'))
      .mockResolvedValueOnce(undefined)
    const { screen, onRegistered } = await setup({ client })

    await openPanel(screen)
    await typeAndSave(screen, 'Parque Azul')

    expect(await screen.findByTestId('hoje-aqui-erro')).toHaveTextContent(/foi salvo/u)
    expect(client.addPlace).toHaveBeenCalledTimes(1)

    await act(async () => {
      await fireEvent.press(screen.getByTestId('hoje-aqui-salvar-nome'))
    })

    await waitFor(() => expect(client.markVisit).toHaveBeenCalledTimes(2))
    expect(client.addPlace).toHaveBeenCalledTimes(1)
    expect(client.markVisit).toHaveBeenLastCalledWith('trip-1', 'typed-place')
    await waitFor(() => expect(onRegistered).toHaveBeenCalledTimes(1))
  })
})
