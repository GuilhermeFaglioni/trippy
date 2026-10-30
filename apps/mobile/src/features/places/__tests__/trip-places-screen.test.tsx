import { act, fireEvent, render, waitFor } from '@testing-library/react-native'

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
    wantCount: 0,
    wantedByMe: false,
    favoriteByMe: false,
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
    wantPlace: jest.fn().mockResolvedValue(undefined),
    unwantPlace: jest.fn().mockResolvedValue(undefined),
    setFavorite: jest.fn().mockResolvedValue(undefined),
    ratePlace: jest.fn().mockResolvedValue(undefined),
    setPlaceNote: jest.fn().mockResolvedValue(undefined),
    getPlaceDetail: jest.fn().mockResolvedValue(null),
    arrangeItinerary: jest.fn().mockResolvedValue(undefined),
    listItineraryDrafts: jest.fn().mockResolvedValue([]),
    discardItineraryDraft: jest.fn().mockResolvedValue(undefined),
    reapplyItineraryDraft: jest.fn().mockResolvedValue(undefined),
    listMembers: jest.fn().mockResolvedValue([]),
    removeMember: jest.fn().mockResolvedValue(undefined),
    setMemberRole: jest.fn().mockResolvedValue(undefined),
    endTrip: jest.fn().mockResolvedValue(undefined),
    openTrip: jest.fn().mockResolvedValue(undefined),
    listRemovedTrips: jest.fn().mockResolvedValue([]),
    countNotSent: jest.fn().mockResolvedValue(0),
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
      <TripPlacesScreen
        tripId="trip-1"
        tripName="Fim de semana"
        role={role}
        startDate="2026-11-01"
        endDate="2026-11-03"
      />
    </DesignSystemProvider>,
  )
}

describe('tela Lugares', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockRequest.mockResolvedValue(
      new Response(JSON.stringify({ token: 'convite-abc' }), { status: 201 }),
    )
  })

  it('lista compacta ordenada por quero ir, filtros com contagem e toque abre o lugar', async () => {
    const fake = createClient([
      createPlace({ id: 'p1', name: 'Praça da Sé', wantCount: 1, suggestedBy: 'outra' }),
      createPlace({ id: 'p2', name: 'Café do Porto', wantCount: 3, dayIndex: 1 }),
      createPlace({ id: 'p3', name: 'Museu', wantCount: 2 }),
    ])
    const screen = await renderScreen(fake.client, 'organizer')

    expect(await screen.findByTestId('place-cafe-do-porto')).toBeOnTheScreen()
    const order = screen
      .getAllByTestId(/^place-[a-z-]+$/)
      .map((node) => String(node.props.testID))
      .filter((id) => !/-(status|want)$/.test(id))
    expect(order).toEqual(['place-cafe-do-porto', 'place-museu', 'place-praca-da-se'])
    expect(screen.getByText('No dia 2 · trocar')).toBeOnTheScreen()
    expect(screen.getByText('Sem dia · escolher dia')).toBeOnTheScreen()
    expect(screen.getByText('Sugerido · escolher dia')).toBeOnTheScreen()
    expect(screen.getByText('Todos 3')).toBeOnTheScreen()

    await fireEvent.press(screen.getByTestId('places-filter-suggested'))
    expect(screen.queryByTestId('place-museu')).toBeNull()
    expect(screen.getByTestId('place-praca-da-se')).toBeOnTheScreen()

    await fireEvent.press(screen.getByLabelText('Praça da Sé. Sugerido por outra pessoa'))
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/trips/[id]/places/[placeId]',
      params: { id: 'trip-1', placeId: 'p1' },
    })
  })

  it('alterna o quero ir e abre Adicionar lugar pelo botão flutuante', async () => {
    const fake = createClient([createPlace({ wantCount: 2 })])
    const screen = await renderScreen(fake.client)

    await fireEvent.press(await screen.findByTestId('place-cafe-do-porto-want'))
    await waitFor(() => expect(fake.client.wantPlace).toHaveBeenCalledWith('trip-1', 'place-1'))

    await fireEvent.press(screen.getByTestId('add-place-button'))
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/trips/[id]/add-place',
      params: { id: 'trip-1', tripName: 'Fim de semana', role: 'member' },
    })
  })

  it('sync em segundo plano atualiza a lista no lugar, sem voltar a carregamento', async () => {
    const fake = createClient()
    const screen = await renderScreen(fake.client)
    expect(await screen.findByTestId('place-cafe-do-porto')).toBeOnTheScreen()

    let release: (places: LivePlace[]) => void = () => undefined
    jest
      .mocked(fake.client.listPlaces)
      .mockImplementationOnce(() => new Promise<LivePlace[]>((resolve) => (release = resolve)))
    const subscribed = jest.mocked(fake.client.subscribe).mock.calls.at(-1)?.[0]
    await act(async () => subscribed?.())

    expect(screen.queryByTestId('trip-places-loading')).not.toBeOnTheScreen()
    expect(screen.getByTestId('place-cafe-do-porto')).toBeOnTheScreen()

    await act(async () => release([createPlace(), createPlace({ id: 'place-9', name: 'Museu' })]))
    expect(await screen.findByTestId('place-museu')).toBeOnTheScreen()
  })

  it('vazio: convida organizador a adicionar e convidar, e mostra o código', async () => {
    const fake = createClient([])
    const screen = await renderScreen(fake.client, 'organizer')

    expect(await screen.findByText('Nenhum lugar ainda')).toBeOnTheScreen()
    await fireEvent.press(screen.getByTestId('create-trip-invite'))
    expect(await screen.findByTestId('invite-code-value')).toHaveTextContent('convite-abc')
    expect(mockRequest).toHaveBeenCalledWith('/trips/trip-1/invites', { method: 'POST' })
  })

  it('vazio: membro não vê Convidar pessoas', async () => {
    const fake = createClient([])
    const screen = await renderScreen(fake.client, 'member')

    expect(await screen.findByText('Nenhum lugar ainda')).toBeOnTheScreen()
    expect(screen.getByTestId('add-place-button')).toBeOnTheScreen()
    expect(screen.queryByTestId('create-trip-invite')).toBeNull()
  })

  it('organizador escolhe o dia pela folha; membro só vê o status', async () => {
    const fake = createClient([createPlace()])
    const organizer = await renderScreen(fake.client, 'organizer')
    await fireEvent.press(await organizer.findByTestId('place-cafe-do-porto-status'))
    await fireEvent.press(await organizer.findByLabelText('Dia 2 · 02/11/2026'))
    await waitFor(() =>
      expect(fake.client.arrangeItinerary).toHaveBeenCalledWith('trip-1', [
        { dayIndex: 1, placeIds: ['place-1'] },
      ]),
    )
    organizer.unmount()

    const member = await renderScreen(fake.client, 'member')
    expect(await member.findByText('Sem dia')).toBeOnTheScreen()
    expect(member.queryByText(/escolher dia/)).toBeNull()
  })
})
