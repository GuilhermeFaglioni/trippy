import * as SQLite from 'expo-sqlite'
import type { SqlDatabase, SqlParameters, SqlRunResult } from '@trippy/sync'

function bindParameters(parameters?: SqlParameters): SQLite.SQLiteBindParams | undefined {
  if (parameters === undefined) return undefined
  return parameters as SQLite.SQLiteBindParams
}

export function userDatabaseName(userId: string): string {
  const normalizedUserId = userId.trim()
  if (!/^[a-zA-Z0-9_-]+$/.test(normalizedUserId)) {
    throw new Error('O identificador do usuário não pode compor o nome do banco local.')
  }
  return `trippy-${normalizedUserId}.db`
}

// A transação exclusiva abre outra conexão; sem espera, uma escrita concorrente (sync em
// segundo plano x gravação da tela) falha na hora com "database is locked".
const BUSY_TIMEOUT_SQL = 'PRAGMA busy_timeout = 5000;'

export class ExpoSqlDatabase implements SqlDatabase {
  constructor(private readonly database: SQLite.SQLiteDatabase) {}

  async exec(sql: string): Promise<void> {
    await this.database.execAsync(sql)
  }

  async run(sql: string, parameters?: SqlParameters): Promise<SqlRunResult> {
    const bindings = bindParameters(parameters)
    const result =
      bindings === undefined
        ? await this.database.runAsync(sql)
        : await this.database.runAsync(sql, bindings)
    return { changes: result.changes, lastInsertRowId: result.lastInsertRowId }
  }

  async all<Row extends Record<string, unknown>>(
    sql: string,
    parameters?: SqlParameters,
  ): Promise<Row[]> {
    const bindings = bindParameters(parameters)
    return bindings === undefined
      ? this.database.getAllAsync<Row>(sql)
      : this.database.getAllAsync<Row>(sql, bindings)
  }

  async get<Row extends Record<string, unknown>>(
    sql: string,
    parameters?: SqlParameters,
  ): Promise<Row | undefined> {
    const bindings = bindParameters(parameters)
    const row =
      bindings === undefined
        ? await this.database.getFirstAsync<Row>(sql)
        : await this.database.getFirstAsync<Row>(sql, bindings)
    return row ?? undefined
  }

  async transaction<T>(operation: (database: SqlDatabase) => Promise<T>): Promise<T> {
    let result: T
    await this.database.withExclusiveTransactionAsync(async (transactionDatabase) => {
      await transactionDatabase.execAsync(BUSY_TIMEOUT_SQL)
      result = await operation(new ExpoSqlDatabase(transactionDatabase))
    })
    return result!
  }
}

export async function openUserSqlDatabase(userId: string): Promise<SqlDatabase> {
  const database = await SQLite.openDatabaseAsync(userDatabaseName(userId))
  await database.execAsync(`PRAGMA journal_mode = WAL; ${BUSY_TIMEOUT_SQL}`)
  return new ExpoSqlDatabase(database)
}
