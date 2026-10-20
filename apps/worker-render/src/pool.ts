import pg from 'pg'

// Loops contínuos mantêm lock global e guarda por job enquanto fazem I/O persistente.
// Terceira conexão cobre registro da execução ou leitura do job em reconciliação.
const workerDatabasePoolMax = 3

export function createWorkerPool(databaseUrl: string): InstanceType<typeof pg.Pool> {
  return new pg.Pool({
    connectionString: databaseUrl,
    max: workerDatabasePoolMax,
    connectionTimeoutMillis: 5_000,
  })
}
