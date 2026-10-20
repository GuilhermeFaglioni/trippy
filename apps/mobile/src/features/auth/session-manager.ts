import { AuthApiError, type AuthClient, type AuthSession } from './auth-client'
import type { SessionStorage } from './session-storage'

export type { SessionStorage } from './session-storage'

export type SessionRequestResult = {
  response: Response
  session: AuthSession | null
}

export class SessionManager {
  constructor(
    private readonly client: AuthClient,
    private readonly storage: SessionStorage,
    private readonly now: () => number = Date.now,
  ) {}

  async startEmail(email: string): Promise<void> {
    await this.client.startEmail(email)
  }

  async verifyEmail(email: string, code: string): Promise<AuthSession> {
    const session = await this.client.verifyEmail(email, code)
    await this.storage.set(session)
    return session
  }

  async restore(): Promise<AuthSession | null> {
    const session = await this.storage.get()
    if (session === null) return null
    if (Date.parse(session.accessTokenExpiresAt) > this.now()) return session

    try {
      return await this.rotate(session)
    } catch {
      // Sem rede, o app continua usando os dados locais e tenta renovar na próxima chamada.
      return session
    }
  }

  async request(
    session: AuthSession,
    path: string,
    init?: RequestInit,
  ): Promise<SessionRequestResult> {
    const response = await this.client.requestWithAccessToken(path, session.accessToken, init)
    if (response.status !== 401) return { response, session }

    let refreshedSession: AuthSession | null
    try {
      refreshedSession = await this.rotate(session)
    } catch (error) {
      if (error instanceof AuthApiError && error.status === 401) {
        await this.storage.clear()
        return { response, session: null }
      }

      throw error
    }

    if (refreshedSession === null) return { response, session: null }

    const retriedResponse = await this.client.requestWithAccessToken(
      path,
      refreshedSession.accessToken,
      init,
    )
    return { response: retriedResponse, session: refreshedSession }
  }

  async logout(session: AuthSession | null): Promise<void> {
    await this.storage.clear()
    if (session === null) return

    try {
      await this.client.logout(session.refreshToken)
    } catch {
      // O logout local não depende de rede.
    }
  }

  private async rotate(session: AuthSession): Promise<AuthSession | null> {
    try {
      const refreshedSession = await this.client.refresh(session.refreshToken)
      await this.storage.set(refreshedSession)
      return refreshedSession
    } catch (error) {
      if (error instanceof AuthApiError && error.status === 401) {
        await this.storage.clear()
        return null
      }

      throw error
    }
  }
}
