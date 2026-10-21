import { createSecureSessionStorage, type SecureStorePort } from '../session-storage'

const session = {
  accessToken: 'access-1',
  accessTokenExpiresAt: '2026-10-20T12:15:00.000Z',
  refreshToken: 'refresh-1',
  user: { id: 'user-1', email: 'pessoa@example.com', name: null },
}

describe('armazenamento seguro de sessão', () => {
  it('serializa, lê e remove sessão usando interface injetável', async () => {
    const values = new Map<string, string>()
    const secureStore: SecureStorePort = {
      getItemAsync: jest.fn(async (key) => values.get(key) ?? null),
      setItemAsync: jest.fn(async (key, value) => void values.set(key, value)),
      deleteItemAsync: jest.fn(async (key) => void values.delete(key)),
    }
    const storage = createSecureSessionStorage(secureStore)

    await storage.set(session)
    await expect(storage.get()).resolves.toEqual(session)
    await storage.clear()
    await expect(storage.get()).resolves.toBeNull()
    expect(secureStore.setItemAsync).toHaveBeenCalledWith(
      'trippy.auth.session',
      JSON.stringify(session),
    )
    expect(secureStore.deleteItemAsync).toHaveBeenCalledWith('trippy.auth.session')
  })

  it('descarta JSON corrompido do armazenamento', async () => {
    const secureStore: SecureStorePort = {
      getItemAsync: jest.fn().mockResolvedValue('{'),
      setItemAsync: jest.fn(),
      deleteItemAsync: jest.fn(),
    }
    const storage = createSecureSessionStorage(secureStore)

    await expect(storage.get()).resolves.toBeNull()
    expect(secureStore.deleteItemAsync).toHaveBeenCalledWith('trippy.auth.session')
  })
})
