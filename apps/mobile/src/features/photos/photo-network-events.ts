import * as Network from 'expo-network'

type NetworkState = Parameters<Parameters<typeof Network.addNetworkStateListener>[0]>[0]
type NetworkStateListener = (state: NetworkState) => void

export function createPhotoNetworkEventSource(
  addNetworkStateListener: typeof Network.addNetworkStateListener = Network.addNetworkStateListener,
) {
  const listeners = new Set<NetworkStateListener>()
  let nativeSubscription: ReturnType<typeof Network.addNetworkStateListener> | null = null

  const subscribe = (listener: NetworkStateListener) => {
    listeners.add(listener)
    if (nativeSubscription === null) {
      nativeSubscription = addNetworkStateListener((state) => {
        for (const currentListener of [...listeners]) currentListener(state)
      })
    }

    return () => {
      listeners.delete(listener)
    }
  }

  return {
    subscribe,
    subscribeToReconnect(onReconnect: () => void, onNetworkState?: NetworkStateListener) {
      return subscribe((state) => {
        onNetworkState?.(state)
        // Reachability is not required for local development endpoints, and an unknown
        // connectivity value should be allowed to attempt the durable queue.
        if (state.isConnected !== false) onReconnect()
      })
    },
  }
}

// Keep Expo's native monitor observed for the JS module lifetime. In expo-network 58.0.3's
// iOS module, OnStopObserving cancels its NWPathMonitor, while a later OnStartObserving calls
// start() on that same instance. Removing the app consumer instead leaves that native observer
// alive and lets a later authenticated session subscribe without restarting a cancelled monitor.
export const photoNetworkEventSource = createPhotoNetworkEventSource()
