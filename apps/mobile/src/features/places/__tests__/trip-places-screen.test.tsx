import { fireEvent, render, waitFor } from '@testing-library/react-native'

import type { LivePlace, SyncClient, SyncClientStatus } from '@trippy/sync'
import { DesignSystemProvider } from '../../../design-system'
import * as sessionProvider from '../../auth/session-provider'
import * as syncProvider from '../../sync/sync-provider'
import { TripPlacesScreen } from '../trip-places-screen'

const currentUserId = 'user-1'
const mockRequest = jest.fn<Promise<Response>, [string, RequestInit?]>()
const mockPush = jest.fn()

jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }))
jest.mock('expo-image', () => ({ Image: 'Image' }))
jest.mock('../../sync/use-network-gate', () => ({ useNetworkOffline: () => false }))

jest.spyOn(sessionProvider, 'useSession').mockImplementation(
  () =>
    ({
      session: { user: { id: currentUserId } },
      request: mockRequest,
    }) as unknown as ReturnType<typeof sessionProvider.useSession>,
)

const status: SyncClientStatus = {
  lastSyncedAt: '2026-10-21T10:15:00.000Z',
  pending: 1,
  notSent: 1,
}

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
    name: 'Café do Porto',
    localName: null,
    address: null,
    localAddress: null,
    googlePlaceId: null,
    googleMatch: 'none',
    userLocalName: null,
    userLocalAddress: null,
    lat: null,
    lng: null,
    suggestedBy: currentUserId,
    comment: null,
    dayIndex: null,
    position: null,
    seq: '1',
    deletedAt: null,
    createdAt: '2026-10-20T12:00:00.000Z',
    visitedByMe: false,
    localNameStatus: 'missing',
    localAddressStatus: 'missing',
    ...overrides,
  }
}

function createClient(initialPlaces: LivePlace[] = [createPlace()]) {
  let places = [...initialPlaces]
  const listeners = new Set<() => void>()
  const notify = () => listeners.forEach((listener) => listener())
  const client: SyncClient = {
    addPlace: jest.fn(async (tripId, name) => {
      const added = createPlace({ id: 'place-2', tripId, name })
      places = [...places, added]
      notify()
      return added.id
    }),
    addPlaceFromCandidate: jest.fn(async () => 'place-2'),
    removePlace: jest.fn(async (_tripId, placeId) => {
      places = places.filter((place) => place.id !== placeId)
      notify()
    }),
    linkGooglePlace: jest.fn().mockResolvedValue(undefined),
    setLocalDetails: jest.fn().mockResolvedValue(undefined),
    markVisit: jest.fn(async (_tripId, placeId) => {
      places = places.map((place) =>
        place.id === placeId ? { ...place, visitedByMe: true } : place,
      )
      notify()
    }),
    unmarkVisit: jest.fn(async (_tripId, placeId) => {
      places = places.map((place) =>
        place.id === placeId ? { ...place, visitedByMe: false } : place,
      )
      notify()
    }),
    syncNow: jest.fn().mockResolvedValue(undefined),
    listPlaces: jest.fn(async () => places),
    subscribe: jest.fn((listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    }),
    getStatus: jest.fn(() => status),
  }
  return { client, getPlaces: () => places }
}

function renderScreen(client: SyncClient, role: 'organizer' | 'coorganizer' | 'member' = 'member') {
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
      <TripPlacesScreen tripId="trip-1" tripName="Fim de semana" role={role} />
    </DesignSystemProvider>,
  )
}

describe('tela da viagem e lugares locais', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockRequest.mockResolvedValue(
      new Response(JSON.stringify({ token: 'convite-abc' }), { status: 201 }),
    )
  })

  it('lista SQLite, abre Adicionar lugar, alterna Eu fui e mostra status honesto', async () => {
    const fake = createClient()
    const screen = await renderScreen(fake.client)

    expect(await screen.findByTestId('place-cafe-do-porto')).toBeOnTheScreen()
    expect(screen.getByTestId('trip-sync-status')).toHaveTextContent(/Sincronizado às/)
    expect(screen.getByTestId('trip-sync-status')).toHaveTextContent(/1 pendentes/)
    expect(screen.getByTestId('trip-sync-not-sent')).toHaveTextContent(/1 operações não enviadas/)

    await fireEvent.press(screen.getByTestId('add-place-button'))
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/trips/[id]/add-place',
      params: { id: 'trip-1', tripName: 'Fim de semana', role: 'member' },
    })

    await fireEvent.press(screen.getByTestId('place-visit-cafe-do-porto'))
    await waitFor(() => expect(fake.client.markVisit).toHaveBeenCalledWith('trip-1', 'place-1'))
    await waitFor(() =>
      expect(screen.getByTestId('place-visit-cafe-do-porto')).toHaveTextContent('Eu fui ✓'),
    )
    await fireEvent.press(screen.getByTestId('place-visit-cafe-do-porto'))
    await waitFor(() => expect(fake.client.unmarkVisit).toHaveBeenCalledWith('trip-1', 'place-1'))
    await waitFor(() =>
      expect(screen.getByTestId('place-visit-cafe-do-porto')).toHaveTextContent('Eu fui'),
    )
  })

  it('permite remover para quem sugeriu e convidar organizadores, mostrando código', async () => {
    const fake = createClient([createPlace({ suggestedBy: 'member-2', name: 'Praça da Sé' })])
    const screen = await renderScreen(fake.client, 'organizer')

    expect(await screen.findByTestId('place-praca-da-se')).toBeOnTheScreen()
    expect(screen.getByTestId('place-remove-praca-da-se')).toBeOnTheScreen()
    await fireEvent.press(screen.getByTestId('create-trip-invite'))

    expect(await screen.findByTestId('invite-code')).toHaveTextContent('convite-abc')
    expect(screen.getByTestId('invite-code-value').props.selectable).toBe(true)
    expect(screen.getByTestId('share-trip-invite')).toBeOnTheScreen()
    expect(mockRequest).toHaveBeenCalledWith('/trips/trip-1/invites', { method: 'POST' })
  })

  it('não oferece remoção de lugar sugerido por outra pessoa a um membro', async () => {
    const fake = createClient([createPlace({ suggestedBy: 'member-2', name: 'Praça da Sé' })])
    const screen = await renderScreen(fake.client, 'member')

    expect(await screen.findByTestId('place-praca-da-se')).toBeOnTheScreen()
    expect(screen.queryByTestId('place-remove-praca-da-se')).toBeNull()
  })
})
