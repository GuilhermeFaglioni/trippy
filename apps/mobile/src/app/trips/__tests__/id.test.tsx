import { fireEvent, render } from '@testing-library/react-native'

import type { SyncClient } from '@trippy/sync'
import { DesignSystemProvider } from '../../../design-system'
import * as sessionProvider from '../../../features/auth/session-provider'
import { SyncProvider } from '../../../features/sync/sync-provider'
import TripRoute from '../[id]'

const mockParams = {
  id: 'trip-1',
  tripName: 'Fim de semana',
  role: 'organizer',
  startDate: '2027-03-14',
  endDate: '2027-03-15',
}
const mockRequest = jest.fn<Promise<Response>, [string, RequestInit?]>()
const TRAVELING_TRIP_ID = '6f1c2b3a-4d5e-4f60-8a7b-9c0d1e2f3a4b'

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => mockParams,
  useRouter: () => ({ push: jest.fn() }),
}))

jest
  .spyOn(sessionProvider, 'useSession')
  .mockImplementation(
    () =>
      ({ session: { user: { id: 'user-1' } }, request: mockRequest }) as unknown as ReturnType<
        typeof sessionProvider.useSession
      >,
  )

function createClient(removedTrips: string[] = []) {
  const client = {
    addPlace: jest.fn().mockResolvedValue('place-1'),
    removePlace: jest.fn().mockResolvedValue(undefined),
    markVisit: jest.fn().mockResolvedValue(undefined),
    unmarkVisit: jest.fn().mockResolvedValue(undefined),
    arrangeItinerary: jest.fn().mockResolvedValue(undefined),
    listItineraryDrafts: jest.fn().mockResolvedValue([]),
    discardItineraryDraft: jest.fn().mockResolvedValue(undefined),
    reapplyItineraryDraft: jest.fn().mockResolvedValue(undefined),
    listMembers: jest
      .fn()
      .mockResolvedValue([
        { userId: 'user-1', role: 'organizer', joinedAt: '2026-10-20T10:00:00Z' },
      ]),
    removeMember: jest.fn().mockResolvedValue(undefined),
    setMemberRole: jest.fn().mockResolvedValue(undefined),
    listRemovedTrips: jest.fn().mockResolvedValue(removedTrips),
    countNotSent: jest.fn().mockResolvedValue(2),
    syncNow: jest.fn().mockResolvedValue(undefined),
    listPlaces: jest.fn().mockResolvedValue([]),
    subscribe: jest.fn().mockReturnValue(() => undefined),
    getStatus: jest.fn().mockReturnValue({ lastSyncedAt: null, pending: 0, notSent: 2 }),
  }
  return client as unknown as SyncClient
}

async function renderRoute(client: SyncClient) {
  return await render(
    <DesignSystemProvider>
      <SyncProvider client={client}>
        <TripRoute />
      </SyncProvider>
    </DesignSystemProvider>,
  )
}

describe('rota da viagem', () => {
  afterEach(() => {
    mockParams.id = 'trip-1'
  })

  beforeEach(() => {
    jest.clearAllMocks()
    mockRequest.mockResolvedValue(
      new Response(
        JSON.stringify({
          trips: [
            {
              id: 'trip-1',
              name: 'Fim de semana',
              destination: 'Paraty',
              startDate: '2027-03-14',
              endDate: '2027-03-15',
              timezone: 'America/Sao_Paulo',
              role: 'organizer',
              phase: 'planning',
              createdAt: '2026-10-20T10:00:00Z',
            },
          ],
        }),
        { status: 200 },
      ),
    )
  })

  it('oculta os dados da viagem removida e informa as alterações não enviadas', async () => {
    const client = createClient(['trip-1'])
    const screen = await renderRoute(client)

    expect(await screen.findByTestId('viagem-removida')).toHaveTextContent(
      /Você não faz mais parte desta viagem\./u,
    )
    expect(screen.getByTestId('viagem-removida')).toHaveTextContent(/2 alterações não enviadas\./u)
    expect(client.countNotSent).toHaveBeenCalledWith('trip-1')
    expect(screen.queryByTestId('trip-route')).toBeNull()
    expect(screen.queryByText('Fim de semana')).toBeNull()
    expect(mockRequest).not.toHaveBeenCalled()
  })

  it('abre roteiro e grupo pelas abas da viagem', async () => {
    const screen = await renderRoute(createClient())

    await screen.findByTestId('trip-tab-roteiro')
    await fireEvent.press(screen.getByTestId('trip-tab-roteiro'))
    expect(await screen.findByTestId('tela-roteiro')).toBeOnTheScreen()
    expect(await screen.findByTestId('roteiro-dia-0')).toBeOnTheScreen()

    await fireEvent.press(screen.getByTestId('trip-tab-grupo'))
    expect(await screen.findByTestId('tela-grupo')).toBeOnTheScreen()
    expect(await screen.findByTestId('grupo-membro-user-1-papel')).toHaveTextContent('Organizador')
  })

  it('viagem em andamento abre direto na aba Hoje', async () => {
    // O cliente de viagens exige UUID no id; o caso usa um id válido só aqui.
    mockParams.id = TRAVELING_TRIP_ID
    mockRequest.mockResolvedValue(
      new Response(
        JSON.stringify({
          trips: [
            {
              id: TRAVELING_TRIP_ID,
              name: 'Fim de semana',
              destination: 'Paraty',
              startDate: '2027-03-14',
              endDate: '2027-03-15',
              timezone: 'America/Sao_Paulo',
              role: 'organizer',
              phase: 'traveling',
              createdAt: '2026-10-20T10:00:00Z',
            },
          ],
        }),
        { status: 200 },
      ),
    )
    const screen = await renderRoute(createClient())

    expect(await screen.findByTestId('tela-hoje')).toBeOnTheScreen()
    expect(screen.queryByTestId('tela-roteiro')).toBeNull()
  })
})
