import Storage from 'expo-sqlite/kv-store'

import { createNetworkGate } from './network-gate'

const isDevelopmentBuild = typeof __DEV__ !== 'undefined' && __DEV__

export const networkGate = createNetworkGate({
  enabled: isDevelopmentBuild,
  storage: {
    getItem: (key) => Storage.getItemAsync(key),
    setItem: (key, value) => Storage.setItemAsync(key, value),
  },
})

export function fetchThroughNetworkGate(
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
): Promise<Response> {
  return networkGate.fetch(input, init)
}
