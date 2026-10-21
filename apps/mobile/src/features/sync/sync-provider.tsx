import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react'
import type { SyncClient, SyncClientStatus } from '@trippy/sync'

import { useSession } from '../auth/session-provider'
import { openUserSqlDatabase } from './expo-sqlite-database'
import { createSyncTransport } from './sync-transport'
import { createAppSyncClient, type SyncClientFactory } from './sync-client-factory'
import { startSyncTriggers, withWriteSyncTriggers } from './sync-triggers'

const EMPTY_STATUS: SyncClientStatus = { lastSyncedAt: null, pending: 0, notSent: 0 }

export type SyncContextValue = {
  client: SyncClient | null
  status: SyncClientStatus
  ready: boolean
  error: string | null
  removedTrips: readonly string[]
  rememberTripId(tripId: string): void
  rememberTripIds(tripIds: readonly string[]): void
}

const SyncContext = createContext<SyncContextValue | null>(null)

type SyncProviderProps = PropsWithChildren<{
  /** Injeção útil para testes de telas na fronteira pública SyncClient. */
  client?: SyncClient
  factory?: SyncClientFactory
}>

export function SyncProvider({
  children,
  client: injectedClient,
  factory = createAppSyncClient,
}: SyncProviderProps) {
  const { status: sessionStatus, session, request } = useSession()
  const requestRef = useRef(request)
  requestRef.current = request
  const tripIdsRef = useRef(new Set<string>())
  const removedTripIdsRef = useRef(new Set<string>())
  const [createdClient, setCreatedClient] = useState<SyncClient | null>(injectedClient ?? null)
  const [ready, setReady] = useState(injectedClient !== undefined)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<SyncClientStatus>(EMPTY_STATUS)
  const [removedTrips, setRemovedTrips] = useState<readonly string[]>([])

  const rememberTripId = useCallback((tripId: string) => {
    if (!removedTripIdsRef.current.has(tripId)) tripIdsRef.current.add(tripId)
  }, [])
  const rememberTripIds = useCallback((tripIds: readonly string[]) => {
    tripIdsRef.current = new Set(tripIds.filter((tripId) => !removedTripIdsRef.current.has(tripId)))
  }, [])

  useEffect(() => {
    if (injectedClient !== undefined) {
      setCreatedClient(injectedClient)
      setReady(true)
      setError(null)
      return
    }

    if (sessionStatus === 'loading') {
      setReady(false)
      return
    }

    if (sessionStatus !== 'authenticated' || session === null) {
      setCreatedClient(null)
      setReady(true)
      setError(null)
      return
    }

    let active = true
    setReady(false)
    setCreatedClient(null)
    setError(null)

    void (async () => {
      const database = await openUserSqlDatabase(session.user.id)
      const transport = createSyncTransport((path, init) => requestRef.current(path, init))
      const nextClient = await factory({
        database,
        transport,
        userId: session.user.id,
        getTripIds: () => [...tripIdsRef.current],
      })
      if (active) setCreatedClient(nextClient)
    })()
      .catch((initializationError: unknown) => {
        if (!active) return
        setError(
          initializationError instanceof Error
            ? initializationError.message
            : 'Não foi possível preparar a sincronização local.',
        )
      })
      .finally(() => {
        if (active) setReady(true)
      })

    return () => {
      active = false
    }
  }, [factory, injectedClient, session?.user.id, sessionStatus])

  const requestSync = useCallback(async () => {
    if (createdClient === null) return
    await createdClient.syncNow()
  }, [createdClient])

  const exposedClient = useMemo(
    () => (createdClient === null ? null : withWriteSyncTriggers(createdClient, requestSync)),
    [createdClient, requestSync],
  )

  useEffect(() => {
    if (exposedClient === null) {
      setStatus(EMPTY_STATUS)
      removedTripIdsRef.current = new Set()
      setRemovedTrips([])
      return
    }

    let active = true
    const refresh = () => {
      setStatus(exposedClient.getStatus())
      void exposedClient
        .listRemovedTrips()
        .then((tripIds) => {
          if (!active) return
          const normalizedIds = [...tripIds].sort()
          removedTripIdsRef.current = new Set(normalizedIds)
          for (const tripId of normalizedIds) tripIdsRef.current.delete(tripId)
          setRemovedTrips((current) =>
            current.length === normalizedIds.length &&
            current.every((tripId, index) => tripId === normalizedIds[index])
              ? current
              : normalizedIds,
          )
        })
        .catch(() => undefined)
    }
    refresh()
    const unsubscribe = exposedClient.subscribe(refresh)
    return () => {
      active = false
      unsubscribe()
    }
  }, [exposedClient])

  useEffect(() => {
    if (exposedClient === null) return
    return startSyncTriggers(() => exposedClient.syncNow())
  }, [exposedClient])

  const value = useMemo<SyncContextValue>(
    () => ({
      client: exposedClient,
      status,
      ready,
      error,
      removedTrips,
      rememberTripId,
      rememberTripIds,
    }),
    [error, exposedClient, ready, rememberTripId, rememberTripIds, removedTrips, status],
  )

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>
}

export function useSync(): SyncContextValue {
  const context = useContext(SyncContext)
  if (context === null) throw new Error('useSync deve ser usado dentro de SyncProvider')
  return context
}
