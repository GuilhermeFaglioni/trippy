import type * as Network from 'expo-network'

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

  it('reuses the native observation and only notifies the current consumer after module reevaluation', () => {
    let emitNetworkState: NetworkStateListener | undefined
    const removeNativeSubscription = jest.fn()
    const addNetworkStateListener = jest.fn((listener: NetworkStateListener) => {
      emitNetworkState = listener
      return { remove: removeNativeSubscription }
    })
    const stateKey = Symbol.for('trippy.photo-network-event-state')
    const globalWithPhotoNetworkState = globalThis as typeof globalThis & Record<symbol, unknown>
    const previousState = globalWithPhotoNetworkState[stateKey]
    delete globalWithPhotoNetworkState[stateKey]

    const loadReevaluatedModule = () => {
      let loadedModule: typeof import('../photo-network-events') | undefined
      jest.isolateModules(() => {
        loadedModule =
          jest.requireActual<typeof import('../photo-network-events')>('../photo-network-events')
      })
      if (loadedModule === undefined) throw new Error('photo-network-events não foi carregado')
      return loadedModule
    }

    jest.doMock('expo-network', () => ({ addNetworkStateListener }))
    try {
      const firstModule = loadReevaluatedModule()
      const oldDrain = jest.fn()
      const unsubscribeOldConsumer =
        firstModule.photoNetworkEventSource.subscribeToReconnect(oldDrain)

      const currentModule = loadReevaluatedModule()
      const currentDrain = jest.fn()
      const unsubscribeCurrentConsumer =
        currentModule.photoNetworkEventSource.subscribeToReconnect(currentDrain)
      unsubscribeOldConsumer()
      emitNetworkState?.({ isConnected: true })

      expect(addNetworkStateListener).toHaveBeenCalledTimes(1)
      expect(removeNativeSubscription).not.toHaveBeenCalled()
      expect(oldDrain).not.toHaveBeenCalled()
      expect(currentDrain).toHaveBeenCalledTimes(1)

      unsubscribeCurrentConsumer()
    } finally {
      jest.dontMock('expo-network')
      if (previousState === undefined) delete globalWithPhotoNetworkState[stateKey]
      else globalWithPhotoNetworkState[stateKey] = previousState
    }
  })
})
