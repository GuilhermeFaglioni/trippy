import { useEffect, useSyncExternalStore } from 'react'

import { networkGate } from './network-gate-runtime'

export function useNetworkOffline(): boolean {
  const isOffline = useSyncExternalStore(
    (listener) => networkGate.subscribe(() => listener()),
    () => networkGate.getIsOffline(),
    () => false,
  )

  useEffect(() => {
    void networkGate.load()
  }, [])

  return isOffline
}
