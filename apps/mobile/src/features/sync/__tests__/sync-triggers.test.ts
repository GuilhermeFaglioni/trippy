import { startSyncTriggers, withWriteSyncTriggers } from '../sync-triggers'
import type { SyncClient } from '@trippy/sync'

function createClient(): jest.Mocked<SyncClient> {
  return {
    addPlace: jest.fn().mockResolvedValue('place-1'),
    removePlace: jest.fn().mockResolvedValue(undefined),
    markVisit: jest.fn().mockResolvedValue(undefined),
    unmarkVisit: jest.fn().mockResolvedValue(undefined),
    arrangeItinerary: jest.fn().mockResolvedValue(undefined),
    listItineraryDrafts: jest.fn().mockResolvedValue([]),
    discardItineraryDraft: jest.fn().mockResolvedValue(undefined),
    reapplyItineraryDraft: jest.fn().mockResolvedValue(undefined),
    listMembers: jest.fn().mockResolvedValue([]),
    removeMember: jest.fn().mockResolvedValue(undefined),
    setMemberRole: jest.fn().mockResolvedValue(undefined),
    listRemovedTrips: jest.fn().mockResolvedValue([]),
    countNotSent: jest.fn().mockResolvedValue(0),
    syncNow: jest.fn().mockResolvedValue(undefined),
    listPlaces: jest.fn().mockResolvedValue([]),
    subscribe: jest.fn().mockReturnValue(() => undefined),
    getStatus: jest.fn().mockReturnValue({ lastSyncedAt: null, pending: 0, notSent: 0 }),
  }
}

describe('gatilhos de sincronização', () => {
  it('sincroniza ao abrir, ao voltar ao primeiro plano, ao ficar online e a cada 30 s', () => {
    const syncNow = jest.fn().mockResolvedValue(undefined)
    let appStateListener: ((state: string) => void) | undefined
    let networkListener: ((offline: boolean) => void) | undefined
    let intervalCallback: (() => void) | undefined
    const removeAppStateListener = jest.fn()
    const clearInterval = jest.fn()
    const stop = startSyncTriggers(syncNow, {
      addAppStateListener: (listener) => {
        appStateListener = listener
        return removeAppStateListener
      },
      subscribeToNetworkGate: (listener) => {
        networkListener = listener
        return () => undefined
      },
      setInterval: (callback, milliseconds) => {
        intervalCallback = callback
        expect(milliseconds).toBe(30_000)
        return 7
      },
      clearInterval: (handle) => {
        expect(handle).toBe(7)
        clearInterval()
      },
    })

    expect(syncNow).toHaveBeenCalledTimes(1)
    appStateListener?.('background')
    networkListener?.(true)
    expect(syncNow).toHaveBeenCalledTimes(1)
    appStateListener?.('active')
    networkListener?.(false)
    intervalCallback?.()
    expect(syncNow).toHaveBeenCalledTimes(4)

    stop()
    expect(removeAppStateListener).toHaveBeenCalledTimes(1)
    expect(clearInterval).toHaveBeenCalledTimes(1)
  })

  it('tenta sincronizar depois de cada escrita, preservando resultado local se a rede falhar', async () => {
    const client = createClient()
    const wrapped = withWriteSyncTriggers(client, () => client.syncNow())
    client.syncNow.mockRejectedValueOnce(new Error('Network request failed'))

    await expect(wrapped.addPlace('trip-1', 'Parque')).resolves.toBe('place-1')
    expect(client.addPlace).toHaveBeenCalledWith('trip-1', 'Parque')
    expect(client.syncNow).toHaveBeenCalledTimes(1)
  })

  it('encaminha a contagem de pendências não enviadas por viagem', async () => {
    const client = createClient()
    client.countNotSent.mockResolvedValue(3)
    const wrapped = withWriteSyncTriggers(client, () => client.syncNow())

    await expect(wrapped.countNotSent('trip-1')).resolves.toBe(3)
    expect(client.countNotSent).toHaveBeenCalledWith('trip-1')
  })
})
