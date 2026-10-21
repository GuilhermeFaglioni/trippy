import { createNetworkGate } from '../network-gate'

function createStorage(initialValue: string | null = null) {
  let value = initialValue
  return {
    getItem: jest.fn(async () => value),
    setItem: jest.fn(async (_key: string, nextValue: string) => {
      value = nextValue
    }),
  }
}

describe('portão de rede', () => {
  it('restaura estado offline persistido e falha como uma rede indisponível', async () => {
    const storage = createStorage('true')
    const fetcher = jest.fn<Promise<Response>, [RequestInfo | URL, RequestInit?]>()
    const gate = createNetworkGate({ enabled: true, storage, fetcher })

    await expect(gate.fetch('https://api.example.test/trips')).rejects.toThrow(
      'Network request failed',
    )
    expect(fetcher).not.toHaveBeenCalled()
    expect(gate.getIsOffline()).toBe(true)
  })

  it('persiste alternâncias e avisa quando a rede volta a ficar online', async () => {
    const storage = createStorage()
    const fetcher = jest
      .fn<Promise<Response>, [RequestInfo | URL, RequestInit?]>()
      .mockResolvedValue(new Response(null, { status: 200 }))
    const gate = createNetworkGate({ enabled: true, storage, fetcher })
    const listener = jest.fn()
    gate.subscribe(listener)

    await gate.setOffline(true)
    await gate.setOffline(false)
    await gate.fetch('https://api.example.test/trips')

    expect(storage.setItem).toHaveBeenNthCalledWith(1, 'trippy.dev.network.offline', 'true')
    expect(storage.setItem).toHaveBeenNthCalledWith(2, 'trippy.dev.network.offline', 'false')
    expect(listener).toHaveBeenNthCalledWith(1, true)
    expect(listener).toHaveBeenNthCalledWith(2, false)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('ignora o interruptor fora de builds de desenvolvimento', async () => {
    const storage = createStorage('true')
    const fetcher = jest
      .fn<Promise<Response>, [RequestInfo | URL, RequestInit?]>()
      .mockResolvedValue(new Response(null, { status: 200 }))
    const gate = createNetworkGate({ enabled: false, storage, fetcher })

    await gate.setOffline(true)
    await expect(gate.fetch('https://api.example.test/health')).resolves.toHaveProperty(
      'status',
      200,
    )

    expect(storage.getItem).not.toHaveBeenCalled()
    expect(storage.setItem).not.toHaveBeenCalled()
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(gate.getIsOffline()).toBe(false)
  })
})
