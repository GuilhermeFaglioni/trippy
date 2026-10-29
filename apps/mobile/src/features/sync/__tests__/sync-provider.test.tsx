import { act, fireEvent, render, waitFor } from '@testing-library/react-native'
import { Text, Pressable } from 'react-native'

import type { SyncClient } from '@trippy/sync'
import { DesignSystemProvider } from '../../../design-system'
import * as sessionProvider from '../../auth/session-provider'
import * as sqliteDatabase from '../expo-sqlite-database'
import type { SyncClientFactory } from '../sync-client-factory'
import { SyncProvider, useSync } from '../sync-provider'

const mockSession = {
  user: { id: 'user-1', email: 'person@example.test', name: null },
  accessToken: 'access',
  accessTokenExpiresAt: '2027-01-01T00:00:00.000Z',
  refreshToken: 'refresh',
}

jest.spyOn(sessionProvider, 'useSession').mockImplementation(
  () =>
    ({
      status: 'authenticated',
      session: mockSession,
      request: jest.fn(),
    }) as unknown as ReturnType<typeof sessionProvider.useSession>,
)

function Probe() {
  const { client, status, ready, removedTrips, rememberTripId } = useSync()
  return (
    <>
      <Text testID="sync-provider-state">
        {`${ready ? 'ready' : 'loading'}:${status.pending}:${status.notSent}`}
      </Text>
      <Text testID="sync-provider-removed">{removedTrips.join(',')}</Text>
      <Pressable
        testID="provider-add-place"
        onPress={() => void client?.addPlace('trip-1', 'Parque')}
      >
        <Text>Adicionar</Text>
      </Pressable>
      <Pressable testID="provider-remember-trip" onPress={() => rememberTripId('trip-invite')}>
        <Text>Lembrar viagem</Text>
      </Pressable>
    </>
  )
}

describe('SyncProvider', () => {
  it('expõe cliente e status, sincroniza na abertura e depois de escrita local', async () => {
    const client: SyncClient = {
      addPlace: jest.fn().mockResolvedValue('place-1'),
      addPlaceFromCandidate: jest.fn().mockResolvedValue('place-1'),
      removePlace: jest.fn().mockResolvedValue(undefined),
      linkGooglePlace: jest.fn().mockResolvedValue(undefined),
      setLocalDetails: jest.fn().mockResolvedValue(undefined),
      markVisit: jest.fn().mockResolvedValue(undefined),
      unmarkVisit: jest.fn().mockResolvedValue(undefined),
      wantPlace: jest.fn().mockResolvedValue(undefined),
      unwantPlace: jest.fn().mockResolvedValue(undefined),
      arrangeItinerary: jest.fn().mockResolvedValue(undefined),
      listItineraryDrafts: jest.fn().mockResolvedValue([]),
      discardItineraryDraft: jest.fn().mockResolvedValue(undefined),
      reapplyItineraryDraft: jest.fn().mockResolvedValue(undefined),
      listMembers: jest.fn().mockResolvedValue([]),
      removeMember: jest.fn().mockResolvedValue(undefined),
      setMemberRole: jest.fn().mockResolvedValue(undefined),
      endTrip: jest.fn().mockResolvedValue(undefined),
      listRemovedTrips: jest.fn().mockResolvedValue(['trip-removed']),
      countNotSent: jest.fn().mockResolvedValue(1),
      syncNow: jest.fn().mockResolvedValue(undefined),
      listPlaces: jest.fn().mockResolvedValue([]),
      subscribe: jest.fn().mockReturnValue(() => undefined),
      getStatus: jest.fn().mockReturnValue({ lastSyncedAt: null, pending: 2, notSent: 1 }),
    }
    const screen = await render(
      <DesignSystemProvider>
        <SyncProvider client={client}>
          <Probe />
        </SyncProvider>
      </DesignSystemProvider>,
    )

    expect(screen.getByTestId('sync-provider-state')).toHaveTextContent('ready:2:1')
    expect(await screen.findByTestId('sync-provider-removed')).toHaveTextContent('trip-removed')
    await waitFor(() => expect(client.syncNow).toHaveBeenCalledTimes(1))
    await fireEvent.press(screen.getByTestId('provider-add-place'))

    await waitFor(() => {
      expect(client.addPlace).toHaveBeenCalledWith('trip-1', 'Parque')
      expect(client.syncNow).toHaveBeenCalledTimes(2)
    })
  })

  it('remove IDs de viagens removidas sem apagar outras viagens lembradas', async () => {
    let removedTripIds: string[] = []
    let notify: (() => void) | undefined
    let getTripIds: (() => readonly string[] | Promise<readonly string[]>) | undefined
    const client = {
      getStatus: jest.fn().mockReturnValue({ lastSyncedAt: null, pending: 0, notSent: 0 }),
      listRemovedTrips: jest.fn(async () => removedTripIds),
      subscribe: jest.fn((listener: () => void) => {
        notify = listener
        return () => {
          notify = undefined
        }
      }),
      syncNow: jest.fn().mockResolvedValue(undefined),
    } as unknown as SyncClient
    const factory: SyncClientFactory = async (input) => {
      getTripIds = input.getTripIds
      return client
    }
    jest
      .spyOn(sqliteDatabase, 'openUserSqlDatabase')
      .mockResolvedValue({} as Awaited<ReturnType<typeof sqliteDatabase.openUserSqlDatabase>>)

    const screen = await render(
      <DesignSystemProvider>
        <SyncProvider factory={factory}>
          <Probe />
        </SyncProvider>
      </DesignSystemProvider>,
    )

    await waitFor(() => expect(getTripIds).toBeDefined())
    await fireEvent.press(screen.getByTestId('provider-remember-trip'))
    expect(await getTripIds?.()).toEqual(['trip-invite'])

    removedTripIds = ['trip-removed']
    await act(async () => {
      notify?.()
    })
    await waitFor(() =>
      expect(screen.getByTestId('sync-provider-removed')).toHaveTextContent('trip-removed'),
    )
    expect(await getTripIds?.()).toEqual(['trip-invite'])
  })
})
