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

import { createPhotosClient } from './photo-client'
import { createPhotoSyncCoordinator, type PhotoSyncCoordinator } from './photo-sync-coordinator'
import { photoNetworkEventSource } from './photo-network-events'
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
  const sessionActive = useRef(true)

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
      if (!sessionActive.current) return
      const coordinator = await getCoordinator()
      if (!sessionActive.current) {
        coordinator.deactivate()
        return
      }
      await coordinator.drainTrip(tripId)
    },
    [getCoordinator],
  )

  const drainPendingTrips = useCallback(
    async (source: 'startup' | 'foreground' | 'network') => {
      console.info(`[photo-sync] drain requested source=${source}`)
      try {
        if (!sessionActive.current) {
          console.info(`[photo-sync] drain skipped source=${source} reason=session-inactive`)
          return
        }
        const coordinator = await getCoordinator()
        if (!sessionActive.current) {
          coordinator.deactivate()
          console.info(`[photo-sync] drain skipped source=${source} reason=session-inactive`)
          return
        }
        console.info(`[photo-sync] drain started source=${source}`)
        await coordinator.drainPendingTrips()
        console.info(`[photo-sync] drain completed source=${source}`)
      } catch {
        // Avoid logging errors that may include signed URLs; the durable queue remains available.
        console.info(`[photo-sync] drain failed source=${source}`)
      }
    },
    [getCoordinator],
  )

  useEffect(() => {
    sessionActive.current = true
    const appStateSubscription = AppState.addEventListener('change', (state) => {
      if (sessionActive.current && state === 'active') void drainPendingTrips('foreground')
    })
    const unsubscribeFromNetwork = photoNetworkEventSource.subscribeToReconnect(
      () => {
        if (sessionActive.current) void drainPendingTrips('network')
      },
      (state) => {
        console.info(
          `[photo-sync] network event connected=${state.isConnected ?? 'unknown'} internetReachable=${state.isInternetReachable ?? 'unknown'}`,
        )
      },
    )

    void drainPendingTrips('startup')
    return () => {
      sessionActive.current = false
      appStateSubscription.remove()
      unsubscribeFromNetwork()
      const pendingCoordinator = coordinatorPromise.current
      if (pendingCoordinator !== null) {
        void pendingCoordinator.then(
          (coordinator) => coordinator.deactivate(),
          () => undefined,
        )
      }
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
