import * as Network from 'expo-network'

type NetworkState = Parameters<Parameters<typeof Network.addNetworkStateListener>[0]>[0]
type NetworkStateListener = (state: NetworkState) => void

type PhotoNetworkEventState = {
  listeners: Map<symbol, NetworkStateListener>
  nativeSubscription: ReturnType<typeof Network.addNetworkStateListener> | null
}

const photoNetworkEventStateKey = Symbol.for('trippy.photo-network-event-state')

function createPhotoNetworkEventState(): PhotoNetworkEventState {
  return { listeners: new Map(), nativeSubscription: null }
}

function getSharedPhotoNetworkEventState(): PhotoNetworkEventState {
  const globalWithPhotoNetworkState = globalThis as typeof globalThis &
    Record<symbol, PhotoNetworkEventState | undefined>
  return (globalWithPhotoNetworkState[photoNetworkEventStateKey] ??= createPhotoNetworkEventState())
}

function createPhotoNetworkEventSourceWithState(
  state: PhotoNetworkEventState,
  addNetworkStateListener: typeof Network.addNetworkStateListener,
) {
  const { listeners } = state

  const subscribe = (listener: NetworkStateListener) => {
    const token = Symbol('photo-network-consumer')
    listeners.set(token, listener)
    if (state.nativeSubscription === null) {
      state.nativeSubscription = addNetworkStateListener((networkState) => {
        for (const currentListener of [...listeners.values()]) currentListener(networkState)
      })
    }

    return () => {
      listeners.delete(token)
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

export function createPhotoNetworkEventSource(
  addNetworkStateListener: typeof Network.addNetworkStateListener = Network.addNetworkStateListener,
) {
  return createPhotoNetworkEventSourceWithState(
    createPhotoNetworkEventState(),
    addNetworkStateListener,
  )
}

// Keep Expo's native monitor observed for the JS module lifetime. In expo-network 58.0.3's
// iOS module, OnStopObserving cancels its NWPathMonitor, while a later OnStartObserving calls
// start() on that same instance. Removing the app consumer instead leaves that native observer
// alive and lets a later authenticated session subscribe without restarting a cancelled monitor.
// Metro re-evaluates modules during Fast Refresh while preserving globalThis; keep the native
// subscription there, but drop consumer closures from the previous module generation.
const sharedPhotoNetworkEventState = getSharedPhotoNetworkEventState()
sharedPhotoNetworkEventState.listeners.clear()

export const photoNetworkEventSource = createPhotoNetworkEventSourceWithState(
  sharedPhotoNetworkEventState,
  Network.addNetworkStateListener,
)
