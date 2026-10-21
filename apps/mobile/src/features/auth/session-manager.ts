import { AuthApiError, type AuthClient, type AuthSession } from './auth-client'
import type { SessionStorage } from './session-storage'

export type { SessionStorage } from './session-storage'

export type SessionRequestResult = {
  response: Response
  session: AuthSession | null
}

export class SessionManager {
  private readonly inFlightRefreshesByToken = new Map<string, Promise<AuthSession | null>>()
  private storageMutationQueue: Promise<void> = Promise.resolve()

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
    await this.withStorageMutation(() => this.storage.set(session))
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
        const currentSession = await this.clearIfCurrent(session.refreshToken)
        return { response, session: currentSession }
      }

      throw error
    }

    if (refreshedSession === null) return { response, session: null }
    if (refreshedSession.user.id !== session.user.id) {
      // Uma troca de conta aconteceu enquanto a requisição antiga aguardava o 401.
      return { response, session: refreshedSession }
    }

    const retriedResponse = await this.client.requestWithAccessToken(
      path,
      refreshedSession.accessToken,
      init,
    )
    return { response: retriedResponse, session: refreshedSession }
  }

  async logout(session: AuthSession | null): Promise<void> {
    if (session === null) {
      await this.withStorageMutation(() => this.storage.clear())
      return
    }

    const sessionToRevoke = (await this.clearSessionForUser(session.user.id)) ?? session

    try {
      await this.client.logout(sessionToRevoke.refreshToken)
    } catch {
      // O logout local não depende de rede.
    }
  }

  private async rotate(session: AuthSession): Promise<AuthSession | null> {
    const inFlightForSession = this.inFlightRefreshesByToken.get(session.refreshToken)
    if (inFlightForSession) return inFlightForSession

    const storedSession = await this.storage.get()
    if (storedSession === null) return null

    const hasNewerCredentials =
      storedSession.accessToken !== session.accessToken ||
      storedSession.refreshToken !== session.refreshToken
    if (hasNewerCredentials && Date.parse(storedSession.accessTokenExpiresAt) > this.now()) {
      return storedSession
    }

    const currentSession = storedSession
    const inFlightForCurrentSession = this.inFlightRefreshesByToken.get(currentSession.refreshToken)
    if (inFlightForCurrentSession) return inFlightForCurrentSession

    const refreshPromise = Promise.resolve().then(() => this.refreshAndStore(currentSession))
    this.inFlightRefreshesByToken.set(currentSession.refreshToken, refreshPromise)

    try {
      return await refreshPromise
    } finally {
      if (this.inFlightRefreshesByToken.get(currentSession.refreshToken) === refreshPromise) {
        this.inFlightRefreshesByToken.delete(currentSession.refreshToken)
      }
    }
  }

  private async refreshAndStore(session: AuthSession): Promise<AuthSession | null> {
    let refreshedSession: AuthSession
    try {
      refreshedSession = await this.client.refresh(session.refreshToken)
    } catch (error) {
      if (error instanceof AuthApiError && error.status === 401) {
        return this.clearIfCurrent(session.refreshToken)
      }

      throw error
    }

    return this.withStorageMutation(async () => {
      const storedSession = await this.storage.get()
      if (storedSession === null) return null
      if (storedSession.refreshToken !== session.refreshToken) return storedSession

      await this.storage.set(refreshedSession)
      return refreshedSession
    })
  }

  private async clearIfCurrent(refreshToken: string): Promise<AuthSession | null> {
    return this.withStorageMutation(async () => {
      const storedSession = await this.storage.get()
      if (storedSession === null) return null
      if (storedSession.refreshToken !== refreshToken) return storedSession

      await this.storage.clear()
      return null
    })
  }

  private async clearSessionForUser(userId: string): Promise<AuthSession | null> {
    return this.withStorageMutation(async () => {
      const storedSession = await this.storage.get()
      if (storedSession === null || storedSession.user.id !== userId) return null

      await this.storage.clear()
      return storedSession
    })
  }

  private withStorageMutation<T>(mutation: () => Promise<T>): Promise<T> {
    const result = this.storageMutationQueue.then(mutation, mutation)
    this.storageMutationQueue = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }
}
