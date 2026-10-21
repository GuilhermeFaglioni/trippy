import { DatabaseSync } from 'node:sqlite'
import type { SqlDatabase, SqlParameters, SqlRunResult, SqlValue } from '../database.ts'

type SqlOperation<T> = () => T | Promise<T>

/** Adaptador Node para testes e verificações ponta a ponta. O app usa seu adaptador Expo. */
export class NodeSqlDatabase implements SqlDatabase {
  private readonly database: DatabaseSync
  private queue: Promise<void> = Promise.resolve()

  constructor(pathOrDatabase: string | DatabaseSync) {
    this.database =
      typeof pathOrDatabase === 'string' ? new DatabaseSync(pathOrDatabase) : pathOrDatabase
    this.database.exec('PRAGMA foreign_keys = ON')
  }

  exec(sql: string): Promise<void> {
    return this.enqueue(() => this.database.exec(sql))
  }

  run(sql: string, parameters?: SqlParameters): Promise<SqlRunResult> {
    return this.enqueue(() => this.runDirect(sql, parameters))
  }

  all<Row extends Record<string, unknown>>(
    sql: string,
    parameters?: SqlParameters,
  ): Promise<Row[]> {
    return this.enqueue(() => this.allDirect<Row>(sql, parameters))
  }

  get<Row extends Record<string, unknown>>(
    sql: string,
    parameters?: SqlParameters,
  ): Promise<Row | undefined> {
    return this.enqueue(() => this.getDirect<Row>(sql, parameters))
  }

  transaction<T>(operation: (database: SqlDatabase) => Promise<T>): Promise<T> {
    return this.enqueue(async () => {
      this.database.exec('BEGIN IMMEDIATE')
      const transactionDatabase: SqlDatabase = {
        exec: async (sql) => this.database.exec(sql),
        run: async (sql, parameters) => this.runDirect(sql, parameters),
        all: async <Row extends Record<string, unknown>>(sql: string, parameters?: SqlParameters) =>
          this.allDirect<Row>(sql, parameters),
        get: async <Row extends Record<string, unknown>>(sql: string, parameters?: SqlParameters) =>
          this.getDirect<Row>(sql, parameters),
        transaction: async () => {
          throw new Error('Transações SQLite aninhadas não são suportadas.')
        },
      }

      try {
        const result = await operation(transactionDatabase)
        this.database.exec('COMMIT')
        return result
      } catch (error) {
        try {
          this.database.exec('ROLLBACK')
        } catch {
          // Preserva o erro que causou o rollback.
        }
        throw error
      }
    })
  }

  close(): void {
    this.database.close()
  }

  private enqueue<T>(operation: SqlOperation<T>): Promise<T> {
    const result = this.queue.then(operation)
    this.queue = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  private runDirect(sql: string, parameters?: SqlParameters): SqlRunResult {
    const statement = this.database.prepare(sql)
    const result = statement.run(...this.argumentsFor(parameters))
    return { changes: result.changes, lastInsertRowId: result.lastInsertRowid }
  }

  private allDirect<Row extends Record<string, unknown>>(
    sql: string,
    parameters?: SqlParameters,
  ): Row[] {
    return this.database.prepare(sql).all(...this.argumentsFor(parameters)) as Row[]
  }

  private getDirect<Row extends Record<string, unknown>>(
    sql: string,
    parameters?: SqlParameters,
  ): Row | undefined {
    return this.database.prepare(sql).get(...this.argumentsFor(parameters)) as Row | undefined
  }

  private argumentsFor(parameters?: SqlParameters): never[] {
    const values: readonly SqlValue[] | readonly [Readonly<Record<string, SqlValue>>] =
      parameters === undefined ? [] : Array.isArray(parameters) ? parameters : [parameters]
    return values as never[]
  }
}
