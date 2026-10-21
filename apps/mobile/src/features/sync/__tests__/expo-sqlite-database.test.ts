import * as SQLite from 'expo-sqlite'

import { ExpoSqlDatabase, openUserSqlDatabase, userDatabaseName } from '../expo-sqlite-database'

jest.mock('expo-sqlite', () => ({ openDatabaseAsync: jest.fn() }))

function createDatabase(overrides: Record<string, unknown> = {}) {
  const database = {
    execAsync: jest.fn().mockResolvedValue(undefined),
    runAsync: jest.fn().mockResolvedValue({ changes: 2, lastInsertRowId: 9 }),
    getAllAsync: jest.fn().mockResolvedValue([{ id: 'place-1' }]),
    getFirstAsync: jest.fn().mockResolvedValue(null),
    withExclusiveTransactionAsync: jest.fn(),
    ...overrides,
  }
  return database
}

describe('adaptador expo-sqlite', () => {
  it('usa um arquivo próprio para cada usuário autenticado', async () => {
    const database = createDatabase()
    jest.mocked(SQLite.openDatabaseAsync).mockResolvedValue(database as never)

    expect(userDatabaseName('user-123')).toBe('trippy-user-123.db')
    await openUserSqlDatabase('user-123')

    expect(SQLite.openDatabaseAsync).toHaveBeenCalledWith('trippy-user-123.db')
  })

  it('adapta binds, resultados e transações exclusivas para SqlDatabase', async () => {
    const transactionDatabase = createDatabase()
    const database = createDatabase({
      withExclusiveTransactionAsync: jest.fn(async (operation: (database: unknown) => Promise<void>) => {
        await operation(transactionDatabase)
      }),
    })
    const sql = new ExpoSqlDatabase(database as never)

    await expect(sql.run('UPDATE places SET name = ?', ['Bistrô'])).resolves.toEqual({
      changes: 2,
      lastInsertRowId: 9,
    })
    expect(database.runAsync).toHaveBeenCalledWith('UPDATE places SET name = ?', ['Bistrô'])
    await expect(sql.get<{ id: string }>('SELECT id FROM places')).resolves.toBeUndefined()
    await expect(sql.all<{ id: string }>('SELECT id FROM places')).resolves.toEqual([
      { id: 'place-1' },
    ])
    await expect(
      sql.transaction(async (transaction) => {
        await transaction.exec('UPDATE places SET name = name')
        return 'committed'
      }),
    ).resolves.toBe('committed')
    expect(transactionDatabase.execAsync).toHaveBeenCalledWith('UPDATE places SET name = name')
  })
})
