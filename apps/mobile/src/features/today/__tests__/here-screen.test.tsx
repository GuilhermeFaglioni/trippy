import { fireEvent, render, waitFor } from '@testing-library/react-native'

import type { PlaceSearchCandidate } from '@trippy/domain'
import type { SyncClientStatus } from '@trippy/sync'
import { DesignSystemProvider } from '../../../design-system'
import * as placesClient from '../../places/places-client'
import * as syncProvider from '../../sync/sync-provider'
import { HereScreen } from '../here-screen'
import type { HereLocationResult } from '../here-location'

jest.mock('../../sync/use-network-gate', () => ({ useNetworkOffline: () => false }))

const status: SyncClientStatus = { lastSyncedAt: null, pending: 0, notSent: 0 }

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

function createClient() {
  return {
    addPlace: jest.fn().mockResolvedValue('typed-place'),
    addPlaceFromCandidate: jest.fn().mockResolvedValue('candidate-place'),
    markVisit: jest.fn().mockResolvedValue(undefined),
    subscribe: jest.fn(() => () => undefined),
    getStatus: jest.fn(() => status),
  }
}

async function setup(locate: () => Promise<HereLocationResult>, nearby = jest.fn()) {
  const client = createClient()
  const onClose = jest.fn()
  jest.spyOn(syncProvider, 'useSync').mockReturnValue({
    client,
    status,
    ready: true,
    error: null,
    removedTrips: [],
  } as unknown as ReturnType<typeof syncProvider.useSync>)
  jest.spyOn(placesClient, 'usePlacesClient').mockReturnValue({
    nearby,
  } as unknown as ReturnType<typeof placesClient.usePlacesClient>)
  const screen = await render(
    <DesignSystemProvider>
      <HereScreen tripId="trip-1" dayIndex={2} onClose={onClose} locate={locate} />
    </DesignSystemProvider>,
  )
  return { client, onClose, screen }
}

describe('Estamos aqui', () => {
  it('registra o candidato selecionado no dia e marca presença', async () => {
    const nearby = jest.fn().mockResolvedValue({ candidates: [candidate] })
    const { client, onClose, screen } = await setup(
      jest.fn().mockResolvedValue({ status: 'granted', lat: -23.55, lng: -46.63 }),
      nearby,
    )

    await fireEvent.press(await screen.findByTestId('hoje-aqui-registrar'))
    await waitFor(() =>
      expect(client.addPlaceFromCandidate).toHaveBeenCalledWith('trip-1', candidate, {
        dayIndex: 2,
      }),
    )
    expect(client.markVisit).toHaveBeenCalledWith('trip-1', 'candidate-place')
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('sem permissão de localização, registra o nome digitado', async () => {
    const { client, onClose, screen } = await setup(
      jest.fn().mockResolvedValue({ status: 'denied' }),
    )

    expect(await screen.findByTestId('hoje-aqui-sem-localizacao')).toBeOnTheScreen()
    await fireEvent.changeText(screen.getByTestId('hoje-aqui-nome'), 'Barraca do bolinho')
    await fireEvent.press(screen.getByTestId('hoje-aqui-registrar'))

    await waitFor(() =>
      expect(client.addPlace).toHaveBeenCalledWith('trip-1', 'Barraca do bolinho', { dayIndex: 2 }),
    )
    expect(client.markVisit).toHaveBeenCalledWith('trip-1', 'typed-place')
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('não permite registrar sem candidato nem nome', async () => {
    const { client, screen } = await setup(jest.fn().mockResolvedValue({ status: 'denied' }))
    await screen.findByTestId('hoje-aqui-sem-localizacao')
    await fireEvent.press(screen.getByTestId('hoje-aqui-registrar'))
    expect(client.addPlace).not.toHaveBeenCalled()
  })
})
