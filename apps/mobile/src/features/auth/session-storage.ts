import * as SecureStore from 'expo-secure-store'

import { isAuthSession, type AuthSession } from './auth-client'

export const SESSION_STORAGE_KEY = 'trippy.auth.session'

export type SessionStorage = {
  get(): Promise<AuthSession | null>
  set(session: AuthSession): Promise<void>
  clear(): Promise<void>
}

export type SecureStorePort = Pick<
  typeof SecureStore,
  'getItemAsync' | 'setItemAsync' | 'deleteItemAsync'
>

export function createSecureSessionStorage(
  secureStore: SecureStorePort = SecureStore,
): SessionStorage {
  return {
    async get() {
      const storedValue = await secureStore.getItemAsync(SESSION_STORAGE_KEY)
      if (storedValue === null) return null

      try {
        const session: unknown = JSON.parse(storedValue)
        if (isAuthSession(session)) return session
      } catch {
        // Conteúdo inválido é removido para evitar um loop de inicialização.
      }

      await secureStore.deleteItemAsync(SESSION_STORAGE_KEY)
      return null
    },
    async set(session) {
      await secureStore.setItemAsync(SESSION_STORAGE_KEY, JSON.stringify(session))
    },
    async clear() {
      await secureStore.deleteItemAsync(SESSION_STORAGE_KEY)
    },
  }
}
