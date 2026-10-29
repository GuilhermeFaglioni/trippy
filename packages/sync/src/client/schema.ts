import type { SqlDatabase } from '../database.ts'

interface Migration {
  version: number
  statements: readonly string[]
}

const migrations: readonly Migration[] = [
  {
    version: 1,
    statements: [
      `CREATE TABLE places (
        id TEXT PRIMARY KEY NOT NULL,
        trip_id TEXT NOT NULL,
        provider TEXT,
        provider_ref TEXT,
        name TEXT NOT NULL,
        local_name TEXT,
        address TEXT,
        local_address TEXT,
        lat REAL,
        lng REAL,
        suggested_by TEXT NOT NULL,
        comment TEXT,
        day_index INTEGER,
        position INTEGER,
        seq TEXT NOT NULL,
        deleted_at TEXT,
        created_at TEXT NOT NULL
      )`,
      'CREATE INDEX places_trip_id_idx ON places (trip_id)',
      `CREATE TABLE visits (
        place_id TEXT NOT NULL,
        trip_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        marked_by TEXT NOT NULL,
        visited_at TEXT NOT NULL,
        visited_tz TEXT NOT NULL,
        seq TEXT NOT NULL,
        deleted_at TEXT,
        PRIMARY KEY (place_id, user_id)
      )`,
      'CREATE INDEX visits_trip_id_idx ON visits (trip_id)',
      `CREATE TABLE members (
        trip_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        role TEXT NOT NULL,
        joined_at TEXT NOT NULL,
        seq TEXT NOT NULL,
        deleted_at TEXT,
        PRIMARY KEY (trip_id, user_id)
      )`,
      `CREATE TABLE outbox (
        position INTEGER PRIMARY KEY AUTOINCREMENT,
        op_id TEXT NOT NULL UNIQUE,
        trip_id TEXT NOT NULL,
        type TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending', 'not_sent')),
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT
      )`,
      'CREATE INDEX outbox_status_position_idx ON outbox (status, position)',
      `CREATE TABLE sync_state (
        trip_id TEXT PRIMARY KEY NOT NULL,
        cursor TEXT,
        snapshot_seq TEXT,
        last_synced_at TEXT
      )`,
    ],
  },
  {
    version: 2,
    statements: ['ALTER TABLE sync_state ADD COLUMN needs_bootstrap INTEGER NOT NULL DEFAULT 0'],
  },
  {
    version: 3,
    statements: [
      'ALTER TABLE places ADD COLUMN country_code TEXT',
      'ALTER TABLE places ADD COLUMN provider_datasource TEXT',
      'ALTER TABLE places ADD COLUMN attribution TEXT',
      'ALTER TABLE places ADD COLUMN license TEXT',
      'ALTER TABLE places ADD COLUMN google_place_id TEXT',
      "ALTER TABLE places ADD COLUMN google_match TEXT NOT NULL DEFAULT 'none' CHECK (google_match IN ('none', 'matched', 'no_match'))",
      'ALTER TABLE places ADD COLUMN user_local_name TEXT',
      'ALTER TABLE places ADD COLUMN user_local_address TEXT',
    ],
  },
  {
    version: 4,
    statements: [
      'ALTER TABLE sync_state ADD COLUMN itinerary_version INTEGER',
      'ALTER TABLE sync_state ADD COLUMN removed_at TEXT',
      `CREATE TABLE itinerary_drafts (
        op_id TEXT PRIMARY KEY NOT NULL,
        trip_id TEXT NOT NULL,
        base_version INTEGER NOT NULL,
        current_version INTEGER NOT NULL,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`,
      'CREATE INDEX itinerary_drafts_trip_id_idx ON itinerary_drafts (trip_id, created_at)',
    ],
  },
  {
    version: 5,
    statements: [
      `CREATE TABLE wants (
        place_id TEXT NOT NULL,
        trip_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        seq TEXT NOT NULL,
        deleted_at TEXT,
        PRIMARY KEY (place_id, user_id)
      )`,
      'CREATE INDEX wants_trip_id_idx ON wants (trip_id)',
    ],
  },
]

export async function migrateSyncDatabase(
  database: SqlDatabase,
  now: () => string = () => new Date().toISOString(),
): Promise<void> {
  await database.transaction(async (transaction) => {
    await transaction.exec(`CREATE TABLE IF NOT EXISTS sync_schema_migrations (
      version INTEGER PRIMARY KEY NOT NULL,
      applied_at TEXT NOT NULL
    )`)

    const applied = await transaction.all<{ version: number } & Record<string, unknown>>(
      'SELECT version FROM sync_schema_migrations ORDER BY version',
    )
    const currentVersion = applied.at(-1)?.version ?? 0
    const latestVersion = migrations.at(-1)?.version ?? 0
    if (currentVersion > latestVersion) {
      throw new Error(
        `Banco local em versão ${currentVersion}, maior que a suportada ${latestVersion}.`,
      )
    }

    for (const migration of migrations) {
      if (migration.version <= currentVersion) continue
      for (const statement of migration.statements) await transaction.exec(statement)
      await transaction.run(
        'INSERT INTO sync_schema_migrations (version, applied_at) VALUES (?, ?)',
        [migration.version, now()],
      )
    }
  })
}
