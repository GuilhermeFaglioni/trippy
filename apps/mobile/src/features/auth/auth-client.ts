import { getApiBaseUrl as getConfiguredApiBaseUrl } from '../../features/diagnostics/health-client'
import { fetchThroughNetworkGate } from '../sync/network-gate-runtime'

export const DEFAULT_AUTH_API_BASE_URL = 'http://localhost:3000'

export type AuthSession = {
  accessToken: string
  accessTokenExpiresAt: string
  refreshToken: string
  user: {
    id: string
    email: string
    name: string | null
  }
}

export type AuthErrorCode =
  | 'invalid_email'
  | 'too_many_requests'
  | 'invalid_code'
  | 'too_many_attempts'
  | 'invalid_refresh_token'
  | 'unauthorized'
  | 'unexpected_error'

const ERROR_MESSAGES: Record<AuthErrorCode, string> = {
  invalid_email: 'Informe um e-mail válido.',
  too_many_requests: 'Aguarde 60 segundos antes de solicitar outro código.',
  invalid_code: 'Código incorreto ou expirado. Confira e tente novamente.',
  too_many_attempts: 'Muitas tentativas. Solicite um novo código.',
  invalid_refresh_token: 'Sua sessão expirou. Entre novamente.',
  unauthorized: 'Sua sessão expirou. Entre novamente.',
  unexpected_error: 'Não foi possível concluir a solicitação. Tente novamente.',
}

export class AuthApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: AuthErrorCode | string,
    message: string,
  ) {
    super(message)
    this.name = 'AuthApiError'
  }
}

export type AuthFetcher = (url: string, init?: RequestInit) => Promise<Response>

export type AuthClient = {
  startEmail(email: string): Promise<void>
  verifyEmail(email: string, code: string): Promise<AuthSession>
  refresh(refreshToken: string): Promise<AuthSession>
  logout(refreshToken: string): Promise<void>
  requestWithAccessToken(path: string, accessToken: string, init?: RequestInit): Promise<Response>
}

type CreateAuthClientOptions = {
  baseUrl?: string
  fetcher?: AuthFetcher
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function isAuthSession(value: unknown): value is AuthSession {
  if (!isRecord(value) || !isRecord(value.user)) return false
  const { user } = value

  return (
    typeof value.accessToken === 'string' &&
    value.accessToken.length > 0 &&
    typeof value.accessTokenExpiresAt === 'string' &&
    Number.isFinite(Date.parse(value.accessTokenExpiresAt)) &&
    typeof value.refreshToken === 'string' &&
    value.refreshToken.length > 0 &&
    typeof user.id === 'string' &&
    typeof user.email === 'string' &&
    (typeof user.name === 'string' || user.name === null)
  )
}

export function getAuthApiBaseUrl(): string {
  return getConfiguredApiBaseUrl().trim() || DEFAULT_AUTH_API_BASE_URL
}

function errorCode(value: unknown, status: number): AuthErrorCode | string {
  if (isRecord(value) && typeof value.error === 'string') return value.error
  return status === 401 ? 'unauthorized' : 'unexpected_error'
}

function errorMessage(value: unknown, code: string): string {
  if (isRecord(value) && typeof value.message === 'string' && value.message.trim()) {
    return value.message.trim()
  }

  return ERROR_MESSAGES[code as AuthErrorCode] ?? ERROR_MESSAGES.unexpected_error
}

export function getAuthErrorMessage(error: unknown): string {
  if (error instanceof AuthApiError) return error.message
  return 'Não foi possível conectar. Confira sua internet e tente novamente.'
}

export function createAuthClient({
  baseUrl = getAuthApiBaseUrl(),
  fetcher = fetchThroughNetworkGate,
}: CreateAuthClientOptions = {}): AuthClient {
  const normalizedBaseUrl = baseUrl.trim().replace(/\/+$/, '')

  async function sendJson(
    path: string,
    body: unknown,
  ): Promise<{ response: Response; payload: unknown }> {
    const response = await fetcher(`${normalizedBaseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    let payload: unknown

    if (response.status !== 204) {
      try {
        payload = await response.json()
      } catch {
        payload = undefined
      }
    }

    if (!response.ok) {
      const code = errorCode(payload, response.status)
      throw new AuthApiError(response.status, code, errorMessage(payload, code))
    }

    return { response, payload }
  }

  function readSession(payload: unknown): AuthSession {
    if (isAuthSession(payload)) return payload
    throw new AuthApiError(502, 'unexpected_error', ERROR_MESSAGES.unexpected_error)
  }

  return {
    async startEmail(email) {
      await sendJson('/auth/email/start', { email })
    },
    async verifyEmail(email, code) {
      const { payload } = await sendJson('/auth/email/verify', { email, code })
      return readSession(payload)
    },
    async refresh(refreshToken) {
      const { payload } = await sendJson('/auth/refresh', { refreshToken })
      return readSession(payload)
    },
    async logout(refreshToken) {
      await sendJson('/auth/logout', { refreshToken })
    },
    async requestWithAccessToken(path, accessToken, init = {}) {
      const headers = new Headers(init.headers)
      headers.set('Authorization', `Bearer ${accessToken}`)
      return fetcher(`${normalizedBaseUrl}${path.startsWith('/') ? path : `/${path}`}`, {
        ...init,
        headers,
      })
    },
  }
}
