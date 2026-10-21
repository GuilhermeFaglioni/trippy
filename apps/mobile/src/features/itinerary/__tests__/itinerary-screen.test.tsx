import { fireEvent, render, waitFor } from '@testing-library/react-native'

import type { ItineraryDraft, LivePlace, SyncClient } from '@trippy/sync'
import { DesignSystemProvider } from '../../../design-system'
import * as sessionProvider from '../../auth/session-provider'
import * as syncProvider from '../../sync/sync-provider'
import { ItineraryScreen } from '../itinerary-screen'

const userId = 'user-1'

jest
  .spyOn(sessionProvider, 'useSession')
  .mockImplementation(
    () =>
      ({ session: { user: { id: userId } } }) as unknown as ReturnType<
        typeof sessionProvider.useSession
      >,
  )

function place(overrides: Partial<LivePlace> = {}): LivePlace {
  return {
    id: 'place-1',
    tripId: 'trip-1',
    provider: null,
    providerRef: null,
    name: 'Café do Porto',
    localName: null,
    address: null,
    localAddress: null,
    lat: null,
    lng: null,
    suggestedBy: userId,
    comment: null,
    dayIndex: 0,
    position: 0,
    seq: '1',
    deletedAt: null,
    createdAt: '2026-10-21T10:00:00.000Z',
    visitedByMe: false,
    ...overrides,
  }
}

function createClient({
  role = 'organizer',
  places = [
    place(),
    place({ id: 'place-2', name: 'Museu do Mar', position: 1 }),
    place({ id: 'place-3', name: 'Parque da Cidade', dayIndex: null, position: null }),
  ],
  drafts = [],
}: {
  role?: 'organizer' | 'coorganizer' | 'member'
  places?: LivePlace[]
  drafts?: ItineraryDraft[]
} = {}) {
  const client = {
    addPlace: jest.fn().mockResolvedValue('place-new'),
    removePlace: jest.fn().mockResolvedValue(undefined),
    markVisit: jest.fn().mockResolvedValue(undefined),
    unmarkVisit: jest.fn().mockResolvedValue(undefined),
    arrangeItinerary: jest.fn().mockResolvedValue(undefined),
    listItineraryDrafts: jest.fn().mockResolvedValue(drafts),
    discardItineraryDraft: jest.fn().mockResolvedValue(undefined),
    reapplyItineraryDraft: jest.fn().mockResolvedValue(undefined),
    listMembers: jest.fn().mockResolvedValue([{ userId, role, joinedAt: '2026-10-20T10:00:00Z' }]),
    removeMember: jest.fn().mockResolvedValue(undefined),
    setMemberRole: jest.fn().mockResolvedValue(undefined),
    listRemovedTrips: jest.fn().mockResolvedValue([]),
    countNotSent: jest.fn().mockResolvedValue(0),
    syncNow: jest.fn().mockResolvedValue(undefined),
    listPlaces: jest.fn().mockResolvedValue(places),
    subscribe: jest.fn().mockReturnValue(() => undefined),
    getStatus: jest.fn().mockReturnValue({ lastSyncedAt: null, pending: 0, notSent: 0 }),
  }
  return client as unknown as SyncClient & typeof client
}

async function renderScreen(client: SyncClient) {
  jest.spyOn(syncProvider, 'useSync').mockImplementation(
    () =>
      ({
        client,
        status: { lastSyncedAt: null, pending: 0, notSent: 0 },
        ready: true,
        error: null,
        removedTrips: [],
        rememberTripId: jest.fn(),
        rememberTripIds: jest.fn(),
      }) as unknown as ReturnType<typeof syncProvider.useSync>,
  )
  return await render(
    <DesignSystemProvider>
      <ItineraryScreen tripId="trip-1" startDate="2027-03-14" endDate="2027-03-15" />
    </DesignSystemProvider>,
  )
}

describe('tela Roteiro', () => {
  beforeEach(() => jest.clearAllMocks())

  it('ordena os lugares por dia e envia a lista completa ao subir um lugar', async () => {
    const client = createClient()
    const screen = await renderScreen(client)

    expect(await screen.findByTestId('roteiro-dia-0')).toBeOnTheScreen()
    expect(screen.getByTestId('roteiro-dia-1')).toHaveTextContent(/Dia 2 · 15\/03\/2027/u)
    await fireEvent.press(screen.getByTestId('roteiro-lugar-museu-do-mar-subir'))

    await waitFor(() =>
      expect(client.arrangeItinerary).toHaveBeenCalledWith('trip-1', [
        { dayIndex: 0, placeIds: ['place-2', 'place-1'] },
      ]),
    )
  })

  it('coloca lugar sem dia no dia escolhido com a lista completa do dia', async () => {
    const client = createClient()
    const screen = await renderScreen(client)
    await screen.findByTestId('roteiro-lugar-parque-da-cidade-dia')

    await fireEvent.changeText(screen.getByTestId('roteiro-lugar-parque-da-cidade-dia'), '2')
    await fireEvent.press(screen.getByTestId('roteiro-lugar-parque-da-cidade-por-no-dia'))

    await waitFor(() =>
      expect(client.arrangeItinerary).toHaveBeenCalledWith('trip-1', [
        { dayIndex: 1, placeIds: ['place-3'] },
      ]),
    )
  })

  it('tira lugar do dia enviando a lista restante completa', async () => {
    const client = createClient()
    const screen = await renderScreen(client)
    await screen.findByTestId('roteiro-lugar-cafe-do-porto-tirar-do-dia')

    await fireEvent.press(screen.getByTestId('roteiro-lugar-cafe-do-porto-tirar-do-dia'))

    await waitFor(() =>
      expect(client.arrangeItinerary).toHaveBeenCalledWith('trip-1', [
        { dayIndex: 0, placeIds: ['place-2'] },
      ]),
    )
  })

  it('move lugar entre dias em uma operação com as duas listas completas', async () => {
    const client = createClient({
      places: [
        place(),
        place({ id: 'place-2', name: 'Museu do Mar', position: 1 }),
        place({ id: 'place-4', name: 'Jardim Botânico', dayIndex: 1, position: 0 }),
      ],
    })
    const screen = await renderScreen(client)
    await screen.findByTestId('roteiro-lugar-cafe-do-porto-mover-dia')

    await fireEvent.press(screen.getByTestId('roteiro-lugar-cafe-do-porto-mover-dia'))

    await waitFor(() =>
      expect(client.arrangeItinerary).toHaveBeenCalledWith('trip-1', [
        { dayIndex: 0, placeIds: ['place-2'] },
        { dayIndex: 1, placeIds: ['place-4', 'place-1'] },
      ]),
    )
  })

  it('membro comum consulta o roteiro sem controles de edição', async () => {
    const screen = await renderScreen(createClient({ role: 'member' }))

    expect(await screen.findByTestId('roteiro-somente-leitura')).toBeOnTheScreen()
    expect(screen.queryByTestId('roteiro-lugar-museu-do-mar-subir')).toBeNull()
    expect(screen.queryByTestId('roteiro-lugar-parque-da-cidade-por-no-dia')).toBeNull()
  })

  it('mostra a diferença do rascunho e permite descartar ou reaplicar', async () => {
    const draft: ItineraryDraft = {
      opId: 'draft-1',
      tripId: 'trip-1',
      baseVersion: 1,
      currentVersion: 2,
      days: [{ dayIndex: 0, placeIds: ['place-2', 'place-1'] }],
      createdAt: '2026-10-21T10:00:00.000Z',
    }
    const client = createClient({ drafts: [draft] })
    const screen = await renderScreen(client)

    expect(await screen.findByTestId('conflito-roteiro')).toHaveTextContent(
      /Seu rascunho do roteiro não foi aplicado: outra pessoa mudou o roteiro antes\./u,
    )
    expect(screen.getAllByText(/alterado/)).toHaveLength(4)
    await fireEvent.press(screen.getByTestId('conflito-roteiro-descartar-draft-1'))
    await waitFor(() => expect(client.discardItineraryDraft).toHaveBeenCalledWith('draft-1'))
    await fireEvent.press(screen.getByTestId('conflito-roteiro-reaplicar-draft-1'))

    await waitFor(() => expect(client.reapplyItineraryDraft).toHaveBeenCalledWith('draft-1'))
  })

  it('membro comum consulta o conflito sem controles de resolução', async () => {
    const draft: ItineraryDraft = {
      opId: 'draft-member',
      tripId: 'trip-1',
      baseVersion: 1,
      currentVersion: 2,
      days: [{ dayIndex: 0, placeIds: ['place-1'] }],
      createdAt: '2026-10-21T10:00:00.000Z',
    }
    const screen = await renderScreen(createClient({ role: 'member', drafts: [draft] }))

    expect(await screen.findByTestId('conflito-roteiro')).toBeOnTheScreen()
    expect(screen.queryByTestId('conflito-roteiro-descartar-draft-member')).toBeNull()
    expect(screen.queryByTestId('conflito-roteiro-reaplicar-draft-member')).toBeNull()
  })
})
