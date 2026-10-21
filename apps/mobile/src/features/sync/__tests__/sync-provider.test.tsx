import { fireEvent, render, waitFor } from '@testing-library/react-native'
import { Text, Pressable } from 'react-native'

import type { SyncClient } from '@trippy/sync'
import { DesignSystemProvider } from '../../../design-system'
import * as sessionProvider from '../../auth/session-provider'
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
  const { client, status, ready } = useSync()
  return (
    <>
      <Text testID="sync-provider-state">
        {`${ready ? 'ready' : 'loading'}:${status.pending}:${status.notSent}`}
      </Text>
      <Pressable
        testID="provider-add-place"
        onPress={() => void client?.addPlace('trip-1', 'Parque')}
      >
        <Text>Adicionar</Text>
      </Pressable>
    </>
  )
}

describe('SyncProvider', () => {
  it('expõe cliente e status, sincroniza na abertura e depois de escrita local', async () => {
    const client: SyncClient = {
      addPlace: jest.fn().mockResolvedValue('place-1'),
      removePlace: jest.fn().mockResolvedValue(undefined),
      markVisit: jest.fn().mockResolvedValue(undefined),
      unmarkVisit: jest.fn().mockResolvedValue(undefined),
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
    await waitFor(() => expect(client.syncNow).toHaveBeenCalledTimes(1))
    await fireEvent.press(screen.getByTestId('provider-add-place'))

    await waitFor(() => {
      expect(client.addPlace).toHaveBeenCalledWith('trip-1', 'Parque')
      expect(client.syncNow).toHaveBeenCalledTimes(2)
    })
  })
})
