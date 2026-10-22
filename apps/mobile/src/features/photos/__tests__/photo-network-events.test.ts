import * as Network from 'expo-network'

import { createPhotoNetworkEventSource } from '../photo-network-events'

type NetworkStateListener = Parameters<typeof Network.addNetworkStateListener>[0]

describe('photo network event source', () => {
  it('drains on a connected event without requiring internet reachability', () => {
    let emitNetworkState: NetworkStateListener | undefined
    const removeNativeSubscription = jest.fn()
    const addNetworkStateListener = jest.fn((listener: NetworkStateListener) => {
      emitNetworkState = listener
      return { remove: removeNativeSubscription }
    })
    const source = createPhotoNetworkEventSource(addNetworkStateListener)
    const drain = jest.fn()
    const observeState = jest.fn()

    source.subscribeToReconnect(drain, observeState)
    emitNetworkState?.({ isConnected: true, isInternetReachable: false })
    emitNetworkState?.({ isConnected: false, isInternetReachable: false })

    expect(addNetworkStateListener).toHaveBeenCalledTimes(1)
    expect(observeState).toHaveBeenNthCalledWith(1, {
      isConnected: true,
      isInternetReachable: false,
    })
    expect(observeState).toHaveBeenNthCalledWith(2, {
      isConnected: false,
      isInternetReachable: false,
    })
    expect(drain).toHaveBeenCalledTimes(1)
  })

  it('keeps one native observation across consumer unsubscribe and resubscribe', () => {
    let emitNetworkState: NetworkStateListener | undefined
    const removeNativeSubscription = jest.fn()
    const addNetworkStateListener = jest.fn((listener: NetworkStateListener) => {
      emitNetworkState = listener
      return { remove: removeNativeSubscription }
    })
    const source = createPhotoNetworkEventSource(addNetworkStateListener)
    const firstConsumer = jest.fn()
    const secondConsumer = jest.fn()

    const unsubscribeFirst = source.subscribe(firstConsumer)
    unsubscribeFirst()
    const unsubscribeSecond = source.subscribe(secondConsumer)
    emitNetworkState?.({ isConnected: true })

    expect(addNetworkStateListener).toHaveBeenCalledTimes(1)
    expect(removeNativeSubscription).not.toHaveBeenCalled()
    expect(firstConsumer).not.toHaveBeenCalled()
    expect(secondConsumer).toHaveBeenCalledWith({ isConnected: true })

    unsubscribeSecond()
  })
})
