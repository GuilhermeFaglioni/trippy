import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type PropsWithChildren,
} from 'react'
import { AppState } from 'react-native'
import * as Network from 'expo-network'

import { createPhotosClient } from './photo-client'
import { createPhotoSyncCoordinator, type PhotoSyncCoordinator } from './photo-sync-coordinator'
import { useSession } from '../auth/session-provider'

type PhotoUploadQueueValue = {
  drainTrip(tripId: string): Promise<void>
}

const PhotoUploadQueueContext = createContext<PhotoUploadQueueValue | null>(null)

type PhotoUploadQueueProviderProps = PropsWithChildren<{
  userId: string
}>

export function PhotoUploadQueueProvider({ children, userId }: PhotoUploadQueueProviderProps) {
  const { request } = useSession()
  const requestRef = useRef(request)
  requestRef.current = request
  const stableRequest = useCallback(
    (path: string, init?: RequestInit) => requestRef.current(path, init),
    [],
  )
  const client = useMemo(() => createPhotosClient(stableRequest), [stableRequest])
  const coordinatorPromise = useRef<Promise<PhotoSyncCoordinator> | null>(null)

  const getCoordinator = useCallback(() => {
    if (coordinatorPromise.current === null) {
      const pending = createPhotoSyncCoordinator(userId, client)
      coordinatorPromise.current = pending
      void pending.catch(() => {
        if (coordinatorPromise.current === pending) coordinatorPromise.current = null
      })
    }
    return coordinatorPromise.current
  }, [client, userId])

  const drainTrip = useCallback(
    async (tripId: string) => {
      const coordinator = await getCoordinator()
      await coordinator.drainTrip(tripId)
    },
    [getCoordinator],
  )

  const drainPendingTrips = useCallback(async () => {
    try {
      const network = await Network.getNetworkStateAsync()
      if (network.isConnected === false || network.isInternetReachable === false) return
      const coordinator = await getCoordinator()
      await coordinator.drainPendingTrips()
    } catch {
      // The durable queue remains available; app resume or the next network event retries it.
    }
  }, [getCoordinator])

  useEffect(() => {
    let active = true
    const appStateSubscription = AppState.addEventListener('change', (state) => {
      if (active && state === 'active') void drainPendingTrips()
    })
    const networkSubscription = Network.addNetworkStateListener((state) => {
      if (active && state.isConnected !== false && state.isInternetReachable !== false) {
        void drainPendingTrips()
      }
    })

    void drainPendingTrips()
    return () => {
      active = false
      appStateSubscription.remove()
      networkSubscription.remove()
    }
  }, [drainPendingTrips])

  const value = useMemo<PhotoUploadQueueValue>(() => ({ drainTrip }), [drainTrip])
  return (
    <PhotoUploadQueueContext.Provider value={value}>{children}</PhotoUploadQueueContext.Provider>
  )
}

export function usePhotoUploadQueue(): PhotoUploadQueueValue {
  const value = useContext(PhotoUploadQueueContext)
  if (value === null) {
    throw new Error('Fila de fotos indisponível fora da sessão autenticada.')
  }
  return value
}
