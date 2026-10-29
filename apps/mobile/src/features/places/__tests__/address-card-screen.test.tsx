import { fireEvent, render, waitFor } from '@testing-library/react-native'

import type { LivePlace, SyncClient, SyncClientStatus } from '@trippy/sync'
import { DesignSystemProvider } from '../../../design-system'
import * as syncProvider from '../../sync/sync-provider'
import { AddressCardScreen } from '../address-card-screen'

const mockKeepAwake = jest.fn()
jest.mock('expo-keep-awake', () => ({
  useKeepAwake: (...args: unknown[]) => mockKeepAwake(...args),
}))

const status: SyncClientStatus = { lastSyncedAt: null, pending: 0, notSent: 0 }

function createPlace(overrides: Partial<LivePlace> = {}): LivePlace {
  return {
    id: 'place-1',
    tripId: 'trip-1',
    provider: null,
    providerRef: null,
    countryCode: null,
    providerDatasource: null,
    attribution: null,
    license: null,
    name: 'Museu da Cidade',
    localName: null,
    address: null,
    localAddress: null,
    googlePlaceId: null,
    googleMatch: 'none',
    userLocalName: null,
    userLocalAddress: null,
    lat: null,
    lng: null,
    suggestedBy: 'user-1',
    comment: null,
    dayIndex: null,
    position: null,
    seq: '1',
    deletedAt: null,
    createdAt: '2026-10-20T12:00:00.000Z',
    visitedByMe: false,
    wantCount: 0,
    wantedByMe: false,
    localNameStatus: 'missing',
    localAddressStatus: 'missing',
    ...overrides,
  }
}

async function renderCard(
  places: LivePlace[],
  handlers = { onClose: jest.fn(), onComplete: jest.fn() },
) {
  const client = {
    listPlaces: jest.fn().mockResolvedValue(places),
    subscribe: jest.fn(() => () => undefined),
    getStatus: jest.fn(() => status),
  } as unknown as SyncClient
  jest.spyOn(syncProvider, 'useSync').mockImplementation(
    () =>
      ({
        client,
        status,
        ready: true,
        error: null,
      }) as unknown as ReturnType<typeof syncProvider.useSync>,
  )
  const screen = await render(
    <DesignSystemProvider>
      <AddressCardScreen tripId="trip-1" placeId="place-1" {...handlers} />
    </DesignSystemProvider>,
  )
  return { screen, handlers, client }
}

describe('cartão de endereço', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('mostra nome e endereço no idioma local com o aviso de tela acesa', async () => {
    const { screen } = await renderCard([
      createPlace({ localName: '市立博物館', userLocalAddress: '中央路 1 号' }),
    ])

    expect(await screen.findByTestId('address-card-name')).toHaveTextContent('市立博物館')
    expect(screen.getByTestId('address-card-address')).toHaveTextContent('中央路 1 号')
    expect(screen.queryByTestId('address-card-vendor-note')).toBeNull()
    expect(screen.queryByTestId('address-card-complete')).toBeNull()
    expect(mockKeepAwake).toHaveBeenCalled()
  })

  it('mostra endereço do fornecedor com aviso discreto', async () => {
    const { screen } = await renderCard([createPlace({ address: 'City Museum, 1 Main Road' })])

    expect(await screen.findByTestId('address-card-address')).toHaveTextContent(
      'City Museum, 1 Main Road',
    )
    expect(screen.getByTestId('address-card-vendor-note')).toHaveTextContent(
      /não está no idioma local/u,
    )
  })

  it('sem endereço mostra aviso e atalho para completar', async () => {
    const handlers = { onClose: jest.fn(), onComplete: jest.fn() }
    const { screen } = await renderCard([createPlace()], handlers)

    expect(await screen.findByTestId('address-card-empty')).toHaveTextContent(
      /Este lugar ainda não tem endereço/u,
    )
    expect(screen.queryByTestId('address-card-address')).toBeNull()
    await fireEvent.press(screen.getByTestId('address-card-complete'))
    expect(handlers.onComplete).toHaveBeenCalledTimes(1)
  })

  it('o botão Fechar chama onClose', async () => {
    const handlers = { onClose: jest.fn(), onComplete: jest.fn() }
    const { screen } = await renderCard([createPlace({ address: 'Rua A, 1' })], handlers)

    await screen.findByTestId('address-card')
    await fireEvent.press(screen.getByTestId('address-card-close'))
    await waitFor(() => expect(handlers.onClose).toHaveBeenCalledTimes(1))
  })
})
