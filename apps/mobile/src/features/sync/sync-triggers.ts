import { AppState } from 'react-native'
import type { SyncClient } from '@trippy/sync'

import { networkGate } from './network-gate-runtime'

export type SyncTriggerPlatform = {
  addAppStateListener(listener: (state: string) => void): () => void
  subscribeToNetworkGate(listener: (offline: boolean) => void): () => void
  setInterval(callback: () => void, milliseconds: number): ReturnType<typeof setInterval>
  clearInterval(handle: ReturnType<typeof setInterval>): void
}

const defaultPlatform: SyncTriggerPlatform = {
  addAppStateListener(listener) {
    const subscription = AppState.addEventListener('change', listener)
    return () => subscription.remove()
  },
  subscribeToNetworkGate(listener) {
    return networkGate.subscribe(listener)
  },
  setInterval(callback, milliseconds) {
    return globalThis.setInterval(callback, milliseconds)
  },
  clearInterval(handle) {
    globalThis.clearInterval(handle)
  },
}

function trySync(syncNow: () => Promise<void>): void {
  try {
    void syncNow().catch(() => undefined)
  } catch {
    // Um sync pode falhar antes de devolver Promise; o próximo gatilho tenta de novo.
  }
}

/** Liga sync na abertura, retorno ao app, retorno do portão online e intervalo. */
export function startSyncTriggers(
  syncNow: () => Promise<void>,
  platform: SyncTriggerPlatform = defaultPlatform,
): () => void {
  trySync(syncNow)
  const removeAppStateListener = platform.addAppStateListener((state) => {
    if (state === 'active') trySync(syncNow)
  })
  const unsubscribeNetwork = platform.subscribeToNetworkGate((offline) => {
    if (!offline) trySync(syncNow)
  })
  const interval = platform.setInterval(() => trySync(syncNow), 30_000)

  return () => {
    removeAppStateListener()
    unsubscribeNetwork()
    platform.clearInterval(interval)
  }
}

/** A escrita local sempre vence; falha de rede deixa a operação pendente no outbox. */
export function withWriteSyncTriggers(
  client: SyncClient,
  requestSync: () => Promise<void>,
): SyncClient {
  async function afterWrite<T>(write: () => Promise<T>): Promise<T> {
    const result = await write()
    try {
      await requestSync()
    } catch {
      // A operação já foi persistida no SQLite; o sync tentará de novo depois.
    }
    return result
  }

  return {
    addPlace: (tripId, name) => afterWrite(() => client.addPlace(tripId, name)),
    addPlaceFromCandidate: (tripId, candidate) =>
      afterWrite(() => client.addPlaceFromCandidate(tripId, candidate)),
    removePlace: (tripId, placeId) => afterWrite(() => client.removePlace(tripId, placeId)),
    linkGooglePlace: (tripId, placeId, googlePlaceId) =>
      afterWrite(() => client.linkGooglePlace(tripId, placeId, googlePlaceId)),
    setLocalDetails: (tripId, placeId, details) =>
      afterWrite(() => client.setLocalDetails(tripId, placeId, details)),
    markVisit: (tripId, placeId) => afterWrite(() => client.markVisit(tripId, placeId)),
    unmarkVisit: (tripId, placeId) => afterWrite(() => client.unmarkVisit(tripId, placeId)),
    wantPlace: (tripId, placeId) => afterWrite(() => client.wantPlace(tripId, placeId)),
    unwantPlace: (tripId, placeId) => afterWrite(() => client.unwantPlace(tripId, placeId)),
    arrangeItinerary: (tripId, days) => afterWrite(() => client.arrangeItinerary(tripId, days)),
    listItineraryDrafts: (tripId) => client.listItineraryDrafts(tripId),
    discardItineraryDraft: (opId) => client.discardItineraryDraft(opId),
    reapplyItineraryDraft: (opId) => afterWrite(() => client.reapplyItineraryDraft(opId)),
    listMembers: (tripId) => client.listMembers(tripId),
    removeMember: (tripId, userId) => afterWrite(() => client.removeMember(tripId, userId)),
    setMemberRole: (tripId, userId, role) =>
      afterWrite(() => client.setMemberRole(tripId, userId, role)),
    endTrip: (tripId) => afterWrite(() => client.endTrip(tripId)),
    listRemovedTrips: () => client.listRemovedTrips(),
    countNotSent: (tripId) => client.countNotSent(tripId),
    syncNow: () => client.syncNow(),
    listPlaces: (tripId, countryCode) => client.listPlaces(tripId, countryCode),
    subscribe: (listener) => client.subscribe(listener),
    getStatus: () => client.getStatus(),
  }
}
