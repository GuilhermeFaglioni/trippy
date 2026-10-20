export const DEFAULT_API_BASE_URL = 'http://localhost:3000'
export const API_HEALTH_TIMEOUT_MS = 5000

export type HealthCheckStatus = 'available' | 'unavailable' | 'timeout' | 'aborted'

export type HealthCheckResult = {
  status: HealthCheckStatus
}

type HealthResponse = Pick<Response, 'ok' | 'json'>
type HealthFetcher = (url: string, init: RequestInit) => Promise<HealthResponse>

type CheckApiHealthOptions = {
  fetcher?: HealthFetcher
  signal?: AbortSignal
  timeoutMs?: number
}

export function getApiBaseUrl(): string {
  return process.env.EXPO_PUBLIC_API_URL?.trim() || DEFAULT_API_BASE_URL
}

export function checkApiHealth(
  baseUrl: string,
  { fetcher = fetch, signal, timeoutMs = API_HEALTH_TIMEOUT_MS }: CheckApiHealthOptions = {},
): Promise<HealthCheckResult> {
  const normalizedBaseUrl = baseUrl.trim().replace(/\/+$/, '')

  if (!normalizedBaseUrl) {
    return Promise.resolve({ status: 'unavailable' })
  }
  if (signal?.aborted) {
    return Promise.resolve({ status: 'aborted' })
  }

  const controller = new AbortController()

  return new Promise((resolve) => {
    let settled = false

    const finish = (status: HealthCheckStatus) => {
      if (settled) return
      settled = true
      clearTimeout(timeoutId)
      signal?.removeEventListener('abort', abortRequest)
      resolve({ status })
    }

    const abortRequest = () => {
      controller.abort()
      finish('aborted')
    }

    const timeoutId = setTimeout(() => {
      controller.abort()
      finish('timeout')
    }, timeoutMs)
    signal?.addEventListener('abort', abortRequest, { once: true })

    void Promise.resolve()
      .then(() =>
        fetcher(`${normalizedBaseUrl}/health`, { method: 'GET', signal: controller.signal }),
      )
      .then(async (response) => {
        if (!response.ok) {
          finish('unavailable')
          return
        }

        const payload: unknown = await response.json()
        const isHealthy =
          typeof payload === 'object' &&
          payload !== null &&
          'status' in payload &&
          payload.status === 'ok'

        finish(isHealthy ? 'available' : 'unavailable')
      })
      .catch(() => {
        finish(signal?.aborted ? 'aborted' : 'unavailable')
      })
  })
}
