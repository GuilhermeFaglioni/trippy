import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react'

import { createAuthClient, type AuthSession } from './auth-client'
import { createSecureSessionStorage } from './session-storage'
import { SessionManager } from './session-manager'

const defaultSessionManager = new SessionManager(createAuthClient(), createSecureSessionStorage())

export type SessionStatus = 'loading' | 'authenticated' | 'unauthenticated'

export type SessionContextValue = {
  status: SessionStatus
  session: AuthSession | null
  startEmail(email: string): Promise<void>
  verifyEmail(email: string, code: string): Promise<AuthSession>
  request(path: string, init?: RequestInit): Promise<Response>
  logout(): Promise<void>
}

const SessionContext = createContext<SessionContextValue | null>(null)

type SessionProviderProps = PropsWithChildren<{
  manager?: SessionManager
}>

function isSameSession(left: AuthSession | null, right: AuthSession | null): boolean {
  if (left === right) return true
  if (left === null || right === null) return false

  return (
    left.accessToken === right.accessToken &&
    left.refreshToken === right.refreshToken &&
    left.user.id === right.user.id
  )
}

export function SessionProvider({
  children,
  manager = defaultSessionManager,
}: SessionProviderProps) {
  const [session, setSession] = useState<AuthSession | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const sessionGeneration = useRef(0)

  useEffect(() => {
    let active = true
    const restoreGeneration = sessionGeneration.current

    void manager
      .restore()
      .then((storedSession) => {
        if (active && sessionGeneration.current === restoreGeneration) {
          sessionGeneration.current += 1
          setSession(storedSession)
        }
      })
      .catch(() => {
        if (active && sessionGeneration.current === restoreGeneration) {
          sessionGeneration.current += 1
          setSession(null)
        }
      })
      .finally(() => {
        if (active) setIsLoading(false)
      })

    return () => {
      active = false
    }
  }, [manager])

  const startEmail = useCallback((email: string) => manager.startEmail(email), [manager])

  const verifyEmail = useCallback(
    async (email: string, code: string) => {
      const loginGeneration = (sessionGeneration.current += 1)
      const verifiedSession = await manager.verifyEmail(email, code)
      if (sessionGeneration.current === loginGeneration) {
        sessionGeneration.current += 1
        setSession(verifiedSession)
      }
      return verifiedSession
    },
    [manager],
  )

  const request = useCallback(
    async (path: string, init?: RequestInit) => {
      if (session === null) throw new Error('Não há uma sessão ativa.')

      const requestGeneration = sessionGeneration.current
      const result = await manager.request(session, path, init)
      if (
        sessionGeneration.current === requestGeneration &&
        !isSameSession(result.session, session)
      ) {
        sessionGeneration.current += 1
        setSession(result.session)
      }
      return result.response
    },
    [manager, session],
  )

  const logout = useCallback(async () => {
    const logoutGeneration = (sessionGeneration.current += 1)
    setSession(null)
    await manager.logout(session)
    if (sessionGeneration.current === logoutGeneration) {
      sessionGeneration.current += 1
    }
  }, [manager, session])

  const value = useMemo<SessionContextValue>(
    () => ({
      status: isLoading ? 'loading' : session === null ? 'unauthenticated' : 'authenticated',
      session,
      startEmail,
      verifyEmail,
      request,
      logout,
    }),
    [isLoading, logout, request, session, startEmail, verifyEmail],
  )

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession(): SessionContextValue {
  const session = useContext(SessionContext)
  if (session === null) throw new Error('useSession deve ser usado dentro de SessionProvider')
  return session
}
