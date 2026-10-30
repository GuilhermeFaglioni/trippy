import { fireEvent, render, waitFor } from '@testing-library/react-native'

import type { LiveMember, SyncClient } from '@trippy/sync'
import { DesignSystemProvider } from '../../../design-system'
import * as sessionProvider from '../../auth/session-provider'
import * as syncProvider from '../../sync/sync-provider'
import { MembersScreen } from '../members-screen'

let currentUserId = 'organizer-1'

jest
  .spyOn(sessionProvider, 'useSession')
  .mockImplementation(
    () =>
      ({ session: { user: { id: currentUserId } } }) as unknown as ReturnType<
        typeof sessionProvider.useSession
      >,
  )

const allMembers: LiveMember[] = [
  { userId: currentUserId, role: 'organizer', joinedAt: '2026-10-20T10:00:00Z', openedAt: null },
  {
    userId: 'coorganizer-1',
    role: 'coorganizer',
    joinedAt: '2026-10-20T10:01:00Z',
    openedAt: null,
  },
  { userId: 'member-1', role: 'member', joinedAt: '2026-10-20T10:02:00Z', openedAt: null },
]

function createClient(members: LiveMember[] = allMembers) {
  const client = {
    addPlace: jest.fn().mockResolvedValue('place-1'),
    removePlace: jest.fn().mockResolvedValue(undefined),
    markVisit: jest.fn().mockResolvedValue(undefined),
    unmarkVisit: jest.fn().mockResolvedValue(undefined),
    arrangeItinerary: jest.fn().mockResolvedValue(undefined),
    listItineraryDrafts: jest.fn().mockResolvedValue([]),
    discardItineraryDraft: jest.fn().mockResolvedValue(undefined),
    reapplyItineraryDraft: jest.fn().mockResolvedValue(undefined),
    listMembers: jest.fn().mockResolvedValue(members),
    removeMember: jest.fn().mockResolvedValue(undefined),
    setMemberRole: jest.fn().mockResolvedValue(undefined),
    listRemovedTrips: jest.fn().mockResolvedValue([]),
    countNotSent: jest.fn().mockResolvedValue(0),
    syncNow: jest.fn().mockResolvedValue(undefined),
    listPlaces: jest.fn().mockResolvedValue([]),
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
      <MembersScreen tripId="trip-1" />
    </DesignSystemProvider>,
  )
}

describe('tela Grupo', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    currentUserId = 'organizer-1'
  })

  it('organizador altera papéis e remove membros permitidos', async () => {
    const client = createClient()
    const screen = await renderScreen(client)

    expect(await screen.findByTestId('grupo-membro-member-1-papel')).toHaveTextContent(
      'Membro · ainda não abriu',
    )
    expect(screen.getByTestId('grupo-convite')).toBeOnTheScreen()
    expect(screen.getByTestId('grupo-membro-organizer-1-papel')).toHaveTextContent(
      'Organizador · ainda não abriu',
    )
    expect(screen.queryByTestId('grupo-membro-organizer-1-remover')).toBeNull()

    await fireEvent.press(screen.getByTestId('grupo-membro-member-1-opcoes'))
    await fireEvent.press(screen.getByTestId('grupo-membro-member-1-promover'))
    await waitFor(() =>
      expect(client.setMemberRole).toHaveBeenCalledWith('trip-1', 'member-1', 'coorganizer'),
    )
    await fireEvent.press(screen.getByTestId('grupo-membro-coorganizer-1-opcoes'))
    await fireEvent.press(screen.getByTestId('grupo-membro-coorganizer-1-rebaixar'))
    await waitFor(() =>
      expect(client.setMemberRole).toHaveBeenCalledWith('trip-1', 'coorganizer-1', 'member'),
    )
    await fireEvent.press(screen.getByTestId('grupo-membro-coorganizer-1-opcoes'))
    await fireEvent.press(screen.getByTestId('grupo-membro-coorganizer-1-remover'))
    await waitFor(() => expect(client.removeMember).toHaveBeenCalledWith('trip-1', 'coorganizer-1'))
  })

  it('coorganizador remove membro comum, sem trocar papel nem remover outro coorganizador', async () => {
    currentUserId = 'coorganizer-1'
    const client = createClient([
      {
        userId: 'coorganizer-1',
        role: 'coorganizer',
        joinedAt: '2026-10-20T10:00:00Z',
        openedAt: null,
      },
      {
        userId: 'coorganizer-2',
        role: 'coorganizer',
        joinedAt: '2026-10-20T10:01:00Z',
        openedAt: null,
      },
      { userId: 'member-1', role: 'member', joinedAt: '2026-10-20T10:02:00Z', openedAt: null },
    ])
    const screen = await renderScreen(client)

    await fireEvent.press(await screen.findByTestId('grupo-membro-member-1-opcoes'))
    expect(await screen.findByTestId('grupo-membro-member-1-remover')).toBeOnTheScreen()
    expect(screen.queryByTestId('grupo-membro-member-1-promover')).toBeNull()
    expect(screen.queryByTestId('grupo-membro-coorganizer-2-opcoes')).toBeNull()
    await fireEvent.press(screen.getByTestId('grupo-membro-member-1-remover'))
    await waitFor(() => expect(client.removeMember).toHaveBeenCalledWith('trip-1', 'member-1'))
    expect(client.setMemberRole).not.toHaveBeenCalled()
  })

  it('membro comum só consulta nomes e papéis', async () => {
    const client = createClient([
      { userId: currentUserId, role: 'member', joinedAt: '2026-10-20T10:00:00Z', openedAt: null },
      { userId: 'member-2', role: 'member', joinedAt: '2026-10-20T10:01:00Z', openedAt: null },
    ])
    const screen = await renderScreen(client)

    expect(await screen.findByTestId('grupo-somente-leitura')).toBeOnTheScreen()
    expect(screen.queryByTestId('grupo-membro-member-2-opcoes')).toBeNull()
    expect(screen.queryByTestId('grupo-convite')).toBeNull()
  })
})
