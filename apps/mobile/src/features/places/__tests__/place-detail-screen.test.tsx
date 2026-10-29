import { fireEvent, render, waitFor } from '@testing-library/react-native'

import type { LiveMember, LivePlace, PlaceDetail, SyncClient } from '@trippy/sync'
import { DesignSystemProvider } from '../../../design-system'
import * as sessionProvider from '../../auth/session-provider'
import { SyncProvider } from '../../sync/sync-provider'
import { PlaceDetailScreen } from '../place-detail-screen'

jest
  .spyOn(sessionProvider, 'useSession')
  .mockImplementation(
    () =>
      ({ session: { user: { id: 'user-1' } }, request: jest.fn() }) as unknown as ReturnType<
        typeof sessionProvider.useSession
      >,
  )

function place(overrides: Partial<LivePlace> = {}): LivePlace {
  return {
    id: 'place-1',
    tripId: 'trip-1',
    name: 'Mercado Central',
    localName: null,
    userLocalName: null,
    visitedByMe: false,
    favoriteByMe: false,
    wantCount: 0,
    wantedByMe: false,
    deletedAt: null,
    createdAt: '2026-10-20T12:00:00.000Z',
    localNameStatus: 'none',
    ...overrides,
  } as unknown as LivePlace
}

function detail(overrides: Partial<PlaceDetail> = {}): PlaceDetail {
  return {
    place: place(),
    favoriteByMe: false,
    myRating: null,
    myNote: null,
    favoriteCount: 0,
    ratingCount: 0,
    ratingAverage: null,
    notes: [],
    visitors: [],
    ...overrides,
  }
}

function member(userId: string, role: LiveMember['role']): LiveMember {
  return { userId, role, joinedAt: '2026-10-20T12:00:00.000Z', openedAt: null }
}

function createClient(current: PlaceDetail, members: LiveMember[]) {
  const client = {
    getPlaceDetail: jest.fn().mockResolvedValue(current),
    listMembers: jest.fn().mockResolvedValue(members),
    markVisit: jest.fn().mockResolvedValue(undefined),
    unmarkVisit: jest.fn().mockResolvedValue(undefined),
    setFavorite: jest.fn().mockResolvedValue(undefined),
    ratePlace: jest.fn().mockResolvedValue(undefined),
    setPlaceNote: jest.fn().mockResolvedValue(undefined),
    listRemovedTrips: jest.fn().mockResolvedValue([]),
    countNotSent: jest.fn().mockResolvedValue(0),
    syncNow: jest.fn().mockResolvedValue(undefined),
    subscribe: jest.fn().mockReturnValue(() => undefined),
    getStatus: jest.fn().mockReturnValue({ lastSyncedAt: null, pending: 0, notSent: 0 }),
  }
  return client as unknown as SyncClient & typeof client
}

async function renderPlace(client: SyncClient) {
  return await render(
    <DesignSystemProvider>
      <SyncProvider client={client}>
        <PlaceDetailScreen tripId="trip-1" placeId="place-1" />
      </SyncProvider>
    </DesignSystemProvider>,
  )
}

describe('tela do lugar', () => {
  it('esconde a média com menos de duas avaliações', async () => {
    const client = createClient(detail({ ratingCount: 1, myRating: 4 }), [
      member('user-1', 'member'),
    ])
    const screen = await renderPlace(client)

    expect(await screen.findByTestId('lugar-nota-4')).toBeTruthy()
    expect(screen.queryByTestId('lugar-media')).toBeNull()
  })

  it('mostra a média e a contagem com duas ou mais avaliações', async () => {
    const client = createClient(detail({ ratingCount: 2, ratingAverage: 4.5 }), [
      member('user-1', 'member'),
    ])
    const screen = await renderPlace(client)

    expect(await screen.findByTestId('lugar-media')).toHaveTextContent('média 4,5 · 2 avaliações')
  })

  it('membro comum vê os outros na lista de visitas sem botão para marcá-los', async () => {
    const client = createClient(detail(), [member('user-1', 'member'), member('user-2', 'member')])
    const screen = await renderPlace(client)

    expect(await screen.findByTestId('lugar-visita-voce')).toBeTruthy()
    expect(screen.queryByTestId('lugar-visita-pessoa-1')).toBeNull()
  })

  it('organizador marca e desmarca outra pessoa usando o userId dela', async () => {
    const client = createClient(detail({ visitors: [] }), [
      member('user-1', 'organizer'),
      member('user-2', 'member'),
    ])
    const screen = await renderPlace(client)

    await fireEvent.press(await screen.findByTestId('lugar-visita-pessoa-1'))
    await waitFor(() =>
      expect(client.markVisit).toHaveBeenCalledWith('trip-1', 'place-1', 'user-2'),
    )
  })

  it('cada pessoa marca a própria visita sem userId', async () => {
    const client = createClient(detail(), [member('user-1', 'member')])
    const screen = await renderPlace(client)

    await fireEvent.press(await screen.findByTestId('lugar-visita-voce'))
    // A pessoa local não envia userId; o wrapper de escrita repassa o argumento ausente como undefined.
    await waitFor(() =>
      expect(client.markVisit).toHaveBeenCalledWith('trip-1', 'place-1', undefined),
    )
  })

  it('favorito, nota e observação chamam o client', async () => {
    const client = createClient(detail(), [member('user-1', 'member')])
    const screen = await renderPlace(client)

    await fireEvent.press(await screen.findByTestId('lugar-favorito'))
    await waitFor(() => expect(client.setFavorite).toHaveBeenCalledWith('trip-1', 'place-1', true))

    await fireEvent.press(screen.getByTestId('lugar-nota-4'))
    await waitFor(() => expect(client.ratePlace).toHaveBeenCalledWith('trip-1', 'place-1', 4))

    await waitFor(() =>
      expect(screen.getByTestId('lugar-observacao-salvar').props.accessibilityState.disabled).toBe(
        false,
      ),
    )
    await fireEvent.changeText(screen.getByTestId('lugar-observacao-campo'), 'Vale a pena')
    await fireEvent.press(screen.getByTestId('lugar-observacao-salvar'))
    await waitFor(() =>
      expect(client.setPlaceNote).toHaveBeenCalledWith('trip-1', 'place-1', 'Vale a pena'),
    )
  })
})
