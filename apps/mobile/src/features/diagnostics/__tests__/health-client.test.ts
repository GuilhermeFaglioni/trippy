import { checkApiHealth, getApiBaseUrl } from '../health-client'

describe('cliente de saúde da API', () => {
  it('prefere EXPO_PUBLIC_API_URL quando configurada', () => {
    const originalUrl = process.env.EXPO_PUBLIC_API_URL
    process.env.EXPO_PUBLIC_API_URL = 'http://192.168.1.20:4000'

    try {
      expect(getApiBaseUrl()).toBe('http://192.168.1.20:4000')
    } finally {
      if (originalUrl === undefined) {
        delete process.env.EXPO_PUBLIC_API_URL
      } else {
        process.env.EXPO_PUBLIC_API_URL = originalUrl
      }
    }
  })

  it('usa URL local padrão e consulta GET /health validando status ok', async () => {
    const fetcher = jest.fn(async () => ({
      ok: true,
      json: async () => ({ status: 'ok' }),
    }))

    await expect(checkApiHealth(getApiBaseUrl(), { fetcher })).resolves.toEqual({
      status: 'available',
    })
    expect(fetcher).toHaveBeenCalledWith(
      'http://localhost:3000/health',
      expect.objectContaining({ method: 'GET', signal: expect.any(AbortSignal) }),
    )
  })

  it('remove barra final e rejeita resposta HTTP ou payload fora do contrato', async () => {
    const fetcher = jest.fn(async () => ({
      ok: true,
      json: async () => ({ status: 'degraded' }),
    }))

    await expect(checkApiHealth('http://localhost:3000/', { fetcher })).resolves.toEqual({
      status: 'unavailable',
    })
    expect(fetcher).toHaveBeenCalledWith('http://localhost:3000/health', expect.any(Object))

    fetcher.mockResolvedValueOnce({ ok: false, json: async () => ({ status: 'ok' }) })
    await expect(checkApiHealth('http://localhost:3000', { fetcher })).resolves.toEqual({
      status: 'unavailable',
    })
  })

  it('recusa endereço vazio sem iniciar requisição', async () => {
    const fetcher = jest.fn()

    await expect(checkApiHealth('   ', { fetcher })).resolves.toEqual({ status: 'unavailable' })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('classifica falha de rede e encerra requisição no timeout', async () => {
    const rejectedFetch = jest.fn(async () => {
      throw new Error('offline')
    })
    await expect(
      checkApiHealth('http://localhost:3000', { fetcher: rejectedFetch }),
    ).resolves.toEqual({ status: 'unavailable' })

    jest.useFakeTimers()
    try {
      const fetcher = jest.fn(
        (_url: string, { signal }: RequestInit) =>
          new Promise<never>((_resolve, reject) => {
            signal?.addEventListener('abort', () => reject(new Error('aborted')))
          }),
      )
      const check = checkApiHealth('http://localhost:3000', { fetcher, timeoutMs: 1000 })

      await jest.advanceTimersByTimeAsync(1000)
      await expect(check).resolves.toEqual({ status: 'timeout' })
      expect(fetcher.mock.calls[0]?.[1].signal?.aborted).toBe(true)
    } finally {
      jest.useRealTimers()
    }
  })

  it('cancela a chamada quando sinal externo é abortado', async () => {
    const fetcher = jest.fn(
      (_url: string, { signal }: RequestInit) =>
        new Promise<never>((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(new Error('aborted')))
        }),
    )
    const controller = new AbortController()
    const check = checkApiHealth('http://localhost:3000', {
      fetcher,
      signal: controller.signal,
    })

    controller.abort()

    await expect(check).resolves.toEqual({ status: 'aborted' })
    expect(fetcher.mock.calls[0]?.[1].signal?.aborted).toBe(true)
  })
})
