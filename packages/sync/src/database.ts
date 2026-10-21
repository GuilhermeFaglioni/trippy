export type SqlValue = null | string | number | bigint | Uint8Array
export type SqlParameters = readonly SqlValue[] | Readonly<Record<string, SqlValue>>

export interface SqlRunResult {
  changes: number | bigint
  lastInsertRowId: number | bigint
}

/**
 * Fachada assíncrona compatível com a API assíncrona do Expo SQLite e com
 * adaptadores sobre a API síncrona `node:sqlite`.
 */
export interface SqlDatabase {
  exec(sql: string): Promise<void>
  run(sql: string, parameters?: SqlParameters): Promise<SqlRunResult>
  all<Row extends Record<string, unknown>>(sql: string, parameters?: SqlParameters): Promise<Row[]>
  get<Row extends Record<string, unknown>>(
    sql: string,
    parameters?: SqlParameters,
  ): Promise<Row | undefined>
  transaction<T>(operation: (database: SqlDatabase) => Promise<T>): Promise<T>
}
