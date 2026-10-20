import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

interface Migration {
  version: string
  filename: string
  checksum: string
  sql: string
}

interface AppliedMigration {
  version: string
  checksum: string
}

interface MigrateOptions {
  databaseUrl?: string
  migrationsDirectory?: string
}

const defaultMigrationsDirectory = fileURLToPath(new URL('../migrations/', import.meta.url))

async function loadMigrations(directory: string): Promise<Migration[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const migrations: Migration[] = []

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.sql')) continue

    const match = /^(\d{4,})_[a-z0-9_]+\.sql$/.exec(entry.name)
    if (!match) {
      throw new Error(`Nome de migration inválido: ${entry.name}; esperado NNNN_nome.sql`)
    }

    const sql = await readFile(join(directory, entry.name), 'utf8')
    migrations.push({
      version: match[1]!,
      filename: entry.name,
      checksum: createHash('sha256').update(sql).digest('hex'),
      sql,
    })
  }

  migrations.sort((left, right) => left.version.localeCompare(right.version))

  for (let index = 1; index < migrations.length; index += 1) {
    if (migrations[index - 1]!.version === migrations[index]!.version) {
      throw new Error(`Versão de migration duplicada: ${migrations[index]!.version}`)
    }
  }

  return migrations
}

export async function migrate({
  databaseUrl = process.env.DATABASE_URL,
  migrationsDirectory = defaultMigrationsDirectory,
}: MigrateOptions = {}): Promise<string[]> {
  if (!databaseUrl) throw new Error('DATABASE_URL não definido')

  const migrations = await loadMigrations(migrationsDirectory)
  const client = new pg.Client({ connectionString: databaseUrl })
  await client.connect()

  let lockAcquired = false
  try {
    await client.query(
      "SELECT pg_advisory_lock(hashtextextended(current_database() || ':trippy:db:migrate', 0))",
    )
    lockAcquired = true

    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version text PRIMARY KEY,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `)

    const appliedResult = await client.query<AppliedMigration>(
      'SELECT version, checksum FROM schema_migrations',
    )
    const appliedByVersion = new Map(
      appliedResult.rows.map((migration) => [migration.version, migration.checksum]),
    )
    const currentVersions = new Set(migrations.map((migration) => migration.version))

    for (const version of appliedByVersion.keys()) {
      if (!currentVersions.has(version)) {
        throw new Error(`Migration aplicada ${version} não existe mais nos arquivos`)
      }
    }

    const appliedNow: string[] = []
    for (const migration of migrations) {
      const appliedChecksum = appliedByVersion.get(migration.version)
      if (appliedChecksum !== undefined) {
        if (appliedChecksum !== migration.checksum) {
          throw new Error(
            `Checksum divergente na migration ${migration.version} (${migration.filename}); migration aplicada foi editada`,
          )
        }
        continue
      }

      await client.query('BEGIN')
      try {
        await client.query(migration.sql)
        await client.query('INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)', [
          migration.version,
          migration.checksum,
        ])
        await client.query('COMMIT')
        appliedNow.push(migration.version)
      } catch (error) {
        await client.query('ROLLBACK')
        throw error
      }
    }

    return appliedNow
  } finally {
    try {
      if (lockAcquired) {
        await client.query(
          "SELECT pg_advisory_unlock(hashtextextended(current_database() || ':trippy:db:migrate', 0))",
        )
      }
    } finally {
      await client.end()
    }
  }
}
