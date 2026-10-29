import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pg from 'pg'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { migrate } from '../src/migrate.js'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  throw new Error('DATABASE_URL não definido: configure o Postgres local')
}

const testDatabaseName = `trippy_migrations_test_${process.pid}_${randomUUID().replaceAll('-', '')}`
const adminUrl = new URL(databaseUrl)
adminUrl.pathname = '/postgres'
const testUrl = new URL(databaseUrl)
testUrl.pathname = `/${testDatabaseName}`

let databaseCreated = false

beforeAll(async () => {
  const admin = new pg.Client({ connectionString: adminUrl.toString() })
  await admin.connect()
  try {
    await admin.query(`CREATE DATABASE "${testDatabaseName}"`)
    databaseCreated = true
  } finally {
    await admin.end()
  }
})

afterAll(async () => {
  if (!databaseCreated) return

  const admin = new pg.Client({ connectionString: adminUrl.toString() })
  await admin.connect()
  try {
    await admin.query(`DROP DATABASE "${testDatabaseName}"`)
  } finally {
    await admin.end()
  }
})

it('aplica esquema idempotente, valida restrições e detecta migration editada', async () => {
  const concurrentRuns = await Promise.all([
    migrate({ databaseUrl: testUrl.toString() }),
    migrate({ databaseUrl: testUrl.toString() }),
  ])
  expect(concurrentRuns.flat()).toEqual([
    '0001',
    '0002',
    '0003',
    '0004',
    '0005',
    '0006',
    '0007',
    '0008',
  ])

  const client = new pg.Client({ connectionString: testUrl.toString() })
  await client.connect()
  try {
    const tables = await client.query<{ table_name: string }>(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name IN (
           'users', 'identities', 'trips', 'trip_members', 'schema_migrations',
           'recaps', 'render_jobs', 'render_outbox', 'email_login_codes', 'refresh_tokens',
           'invites', 'places', 'places_provider_usage', 'places_provider_calls',
           'place_wants', 'visits', 'applied_ops', 'photos', 'photo_outbox'
         )`,
    )
    expect(tables.rows.map(({ table_name }) => table_name).sort()).toEqual([
      'applied_ops',
      'email_login_codes',
      'identities',
      'invites',
      'photo_outbox',
      'photos',
      'place_wants',
      'places',
      'places_provider_calls',
      'places_provider_usage',
      'recaps',
      'refresh_tokens',
      'render_jobs',
      'render_outbox',
      'schema_migrations',
      'trip_members',
      'trips',
      'users',
      'visits',
    ])

    const placeColumns = await client.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'places' AND column_name = 'country_code'`,
    )
    expect(placeColumns.rows.map(({ column_name }) => column_name)).toEqual(['country_code'])

    const migrationBefore = await client.query<{
      version: string
      checksum: string
      applied_at: Date
    }>('SELECT version, checksum, applied_at FROM schema_migrations')
    expect(migrationBefore.rows.map(({ version }) => version)).toEqual([
      '0001',
      '0002',
      '0003',
      '0004',
      '0005',
      '0006',
      '0007',
      '0008',
    ])

    await migrate({ databaseUrl: testUrl.toString() })

    const migrationAfter = await client.query<{
      version: string
      checksum: string
      applied_at: Date
    }>('SELECT version, checksum, applied_at FROM schema_migrations')
    expect(migrationAfter.rows).toEqual(migrationBefore.rows)

    const user = async (email: string) => {
      const result = await client.query<{ id: string }>(
        'INSERT INTO users (name, email) VALUES ($1, $2) RETURNING id',
        [email, email],
      )
      return result.rows[0]!.id
    }

    const organizerId = await user('organizer@example.test')
    const secondOrganizerId = await user('second-organizer@example.test')

    await expect(
      client.query('INSERT INTO users (name, email) VALUES ($1, $2)', [
        'Duplicado',
        'ORGANIZER@example.test',
      ]),
    ).rejects.toMatchObject({ code: '23505' })
    await client.query(
      `INSERT INTO identities (user_id, provider, provider_subject)
       VALUES ($1, 'google', 'subject-1')`,
      [organizerId],
    )
    await expect(
      client.query(
        `INSERT INTO identities (user_id, provider, provider_subject)
         VALUES ($1, 'google', 'subject-1')`,
        [secondOrganizerId],
      ),
    ).rejects.toMatchObject({ code: '23505' })

    const tripResult = await client.query<{ id: string }>(
      `INSERT INTO trips (name, destination, start_date, end_date, timezone, organizer_id, seq, seq_counter)
       VALUES ('Viagem', 'Lisboa', '2026-11-01', '2026-11-05', 'Europe/Lisbon', $1, 1, 1)
       RETURNING id`,
      [organizerId],
    )
    const tripId = tripResult.rows[0]!.id

    const syncFloor = await client.query<{ sync_floor_seq: string }>(
      'SELECT sync_floor_seq FROM trips WHERE id = $1',
      [tripId],
    )
    expect(syncFloor.rows[0]?.sync_floor_seq).toBe('0')

    await client.query(
      `INSERT INTO trip_members (trip_id, user_id, role, seq)
       VALUES ($1, $2, 'organizer', 2)`,
      [tripId, organizerId],
    )
    await client.query(
      `INSERT INTO trip_members (trip_id, user_id, role, left_at, seq)
       VALUES ($1, $2, 'organizer', now(), 3)`,
      [tripId, secondOrganizerId],
    )
    await client.query('UPDATE trips SET seq_counter = 3 WHERE id = $1', [tripId])

    const placeId = randomUUID()
    await client.query(
      `INSERT INTO places (id, trip_id, name, suggested_by, seq)
       VALUES ($1, $2, 'Museu', $3, 4)`,
      [placeId, tripId, organizerId],
    )
    await client.query('UPDATE trips SET seq_counter = 4 WHERE id = $1', [tripId])
    await expect(
      client.query(
        `INSERT INTO visits (place_id, trip_id, user_id, marked_by, visited_at, visited_tz, seq)
         VALUES ($1, $2, $3, $3, now(), 'America/Sao_Paulo', 5)`,
        [placeId, '00000000-0000-4000-8000-000000000001', organizerId],
      ),
    ).rejects.toMatchObject({ code: '23503' })
    await client.query(
      `INSERT INTO invites (trip_id, token_hash, created_by)
       VALUES ($1, 'hash-1', $2)`,
      [tripId, organizerId],
    )
    await expect(
      client.query(
        `INSERT INTO invites (trip_id, token_hash, created_by)
         VALUES ($1, 'hash-1', $2)`,
        [tripId, organizerId],
      ),
    ).rejects.toMatchObject({ code: '23505' })
    const activeOrganizerId = await user('active-organizer@example.test')
    await expect(
      client.query(
        `INSERT INTO trip_members (trip_id, user_id, role, seq)
         VALUES ($1, $2, 'organizer', 5)`,
        [tripId, activeOrganizerId],
      ),
    ).rejects.toMatchObject({ code: '23505' })
    await expect(
      client.query(
        `INSERT INTO trip_members (trip_id, user_id, role, seq)
         VALUES ($1, $2, 'guest', 5)`,
        [tripId, activeOrganizerId],
      ),
    ).rejects.toMatchObject({ code: '23514' })
    await expect(
      client.query(
        `INSERT INTO trips (name, start_date, end_date, timezone, organizer_id)
         VALUES ('Datas inválidas', '2026-11-05', '2026-11-01', 'Europe/Lisbon', $1)`,
        [organizerId],
      ),
    ).rejects.toMatchObject({ code: '23514' })
  } finally {
    await client.end()
  }

  const migrationPath = new URL('../migrations/0001_usuarios_viagens.sql', import.meta.url)
  const migration = await readFile(migrationPath, 'utf8')
  const recapMigrationPath = new URL('../migrations/0002_recaps_render_jobs.sql', import.meta.url)
  const recapMigration = await readFile(recapMigrationPath, 'utf8')
  const authMigrationPath = new URL('../migrations/0003_auth_email.sql', import.meta.url)
  const authMigration = await readFile(authMigrationPath, 'utf8')
  const tripMembersIndexMigrationPath = new URL(
    '../migrations/0004_trip_members_user_idx.sql',
    import.meta.url,
  )
  const tripMembersIndexMigration = await readFile(tripMembersIndexMigrationPath, 'utf8')
  const syncMigrationPath = new URL('../migrations/0005_sync_lugares_convites.sql', import.meta.url)
  const syncMigration = await readFile(syncMigrationPath, 'utf8')
  const placesProviderMigrationPath = new URL(
    '../migrations/0007_lugares_fornecedor_google.sql',
    import.meta.url,
  )
  const placesProviderMigration = await readFile(placesProviderMigrationPath, 'utf8')
  const photosMigrationPath = new URL('../migrations/0006_photos.sql', import.meta.url)
  const photosMigration = await readFile(photosMigrationPath, 'utf8')
  const placeWantsMigrationPath = new URL('../migrations/0008_place_wants.sql', import.meta.url)
  const placeWantsMigration = await readFile(placeWantsMigrationPath, 'utf8')
  const modifiedMigrations = await mkdtemp(join(tmpdir(), 'trippy-db-migrations-'))
  try {
    await writeFile(
      join(modifiedMigrations, '0001_usuarios_viagens.sql'),
      `${migration}\n-- edição`,
    )
    await writeFile(join(modifiedMigrations, '0002_recaps_render_jobs.sql'), recapMigration)
    await writeFile(join(modifiedMigrations, '0003_auth_email.sql'), authMigration)
    await writeFile(
      join(modifiedMigrations, '0004_trip_members_user_idx.sql'),
      tripMembersIndexMigration,
    )
    await writeFile(join(modifiedMigrations, '0005_sync_lugares_convites.sql'), syncMigration)
    await writeFile(
      join(modifiedMigrations, '0007_lugares_fornecedor_google.sql'),
      placesProviderMigration,
    )
    await writeFile(join(modifiedMigrations, '0006_photos.sql'), photosMigration)
    await writeFile(join(modifiedMigrations, '0008_place_wants.sql'), placeWantsMigration)
    await expect(
      migrate({
        databaseUrl: testUrl.toString(),
        migrationsDirectory: modifiedMigrations,
      }),
    ).rejects.toThrow(/checksum/i)
  } finally {
    await rm(modifiedMigrations, { recursive: true, force: true })
  }

  const failedMigrations = await mkdtemp(join(tmpdir(), 'trippy-db-migrations-'))
  try {
    await writeFile(join(failedMigrations, '0001_usuarios_viagens.sql'), migration)
    await writeFile(join(failedMigrations, '0002_recaps_render_jobs.sql'), recapMigration)
    await writeFile(join(failedMigrations, '0003_auth_email.sql'), authMigration)
    await writeFile(
      join(failedMigrations, '0004_trip_members_user_idx.sql'),
      tripMembersIndexMigration,
    )
    await writeFile(join(failedMigrations, '0005_sync_lugares_convites.sql'), syncMigration)
    await writeFile(join(failedMigrations, '0006_photos.sql'), photosMigration)
    await writeFile(
      join(failedMigrations, '0007_lugares_fornecedor_google.sql'),
      placesProviderMigration,
    )
    await writeFile(join(failedMigrations, '0008_place_wants.sql'), placeWantsMigration)
    await writeFile(
      join(failedMigrations, '0009_teste_transacao.sql'),
      'CREATE TABLE migration_rollback_probe (id integer);\nINVALID SQL;\n',
    )
    await expect(
      migrate({
        databaseUrl: testUrl.toString(),
        migrationsDirectory: failedMigrations,
      }),
    ).rejects.toThrow()

    const client = new pg.Client({ connectionString: testUrl.toString() })
    await client.connect()
    try {
      const result = await client.query<{ relation: string | null }>(
        "SELECT to_regclass('public.migration_rollback_probe') AS relation",
      )
      expect(result.rows[0]?.relation).toBeNull()
      const applied = await client.query<{ version: string }>(
        'SELECT version FROM schema_migrations ORDER BY version',
      )
      expect(applied.rows.map(({ version }) => version)).toEqual([
        '0001',
        '0002',
        '0003',
        '0004',
        '0005',
        '0006',
        '0007',
        '0008',
      ])
    } finally {
      await client.end()
    }
  } finally {
    await rm(failedMigrations, { recursive: true, force: true })
  }
})

it('atribui sequências únicas a membros legados na migration 0005', async () => {
  const legacyDatabaseName = `trippy_legacy_backfill_${process.pid}_${randomUUID().replaceAll('-', '').slice(0, 12)}`
  const legacyAdminUrl = new URL(databaseUrl)
  legacyAdminUrl.pathname = '/postgres'
  const legacyDatabaseUrl = new URL(databaseUrl)
  legacyDatabaseUrl.pathname = `/${legacyDatabaseName}`
  const migrationsDirectory = await mkdtemp(join(tmpdir(), 'trippy-db-legacy-backfill-'))
  let legacyDatabaseCreated = false

  try {
    const admin = new pg.Client({ connectionString: legacyAdminUrl.toString() })
    await admin.connect()
    try {
      await admin.query(`CREATE DATABASE "${legacyDatabaseName}"`)
      legacyDatabaseCreated = true
    } finally {
      await admin.end()
    }

    const migrationNames = [
      '0001_usuarios_viagens.sql',
      '0002_recaps_render_jobs.sql',
      '0003_auth_email.sql',
      '0004_trip_members_user_idx.sql',
      '0005_sync_lugares_convites.sql',
    ]
    for (const migrationName of migrationNames.slice(0, 4)) {
      const contents = await readFile(new URL(`../migrations/${migrationName}`, import.meta.url))
      await writeFile(join(migrationsDirectory, migrationName), contents)
    }
    await migrate({
      databaseUrl: legacyDatabaseUrl.toString(),
      migrationsDirectory,
    })

    const legacyClient = new pg.Client({ connectionString: legacyDatabaseUrl.toString() })
    await legacyClient.connect()
    try {
      const users = await legacyClient.query<{ id: string }>(
        `INSERT INTO users (email)
         VALUES ('legacy-organizer@example.test'),
                ('legacy-member-a@example.test'),
                ('legacy-member-b@example.test')
         RETURNING id`,
      )
      const trip = await legacyClient.query<{ id: string }>(
        `INSERT INTO trips (name, destination, start_date, end_date, timezone, organizer_id)
         VALUES ('Viagem legada', 'Lisboa', '2026-11-01', '2026-11-05', 'Europe/Lisbon', $1)
         RETURNING id`,
        [users.rows[0]!.id],
      )
      const tripId = trip.rows[0]!.id
      await legacyClient.query(
        `INSERT INTO trip_members (trip_id, user_id, role, joined_at)
         VALUES ($1, $2, 'organizer', '2026-01-01T00:00:00Z'),
                ($1, $3, 'member', '2026-01-02T00:00:00Z'),
                ($1, $4, 'member', '2026-01-02T00:00:00Z')`,
        [tripId, users.rows[0]!.id, users.rows[1]!.id, users.rows[2]!.id],
      )
      const legacyRows = await legacyClient.query<{ seq: string }>(
        'SELECT seq::text AS seq FROM trip_members WHERE trip_id = $1',
        [tripId],
      )
      expect(legacyRows.rows.map(({ seq }) => seq)).toEqual(['0', '0', '0'])

      const syncMigration = await readFile(
        new URL(`../migrations/${migrationNames[4]}`, import.meta.url),
      )
      await writeFile(join(migrationsDirectory, migrationNames[4]!), syncMigration)
      await migrate({
        databaseUrl: legacyDatabaseUrl.toString(),
        migrationsDirectory,
      })

      const backfilledRows = await legacyClient.query<{ user_id: string; seq: string }>(
        `SELECT user_id, seq::text AS seq
         FROM trip_members
         WHERE trip_id = $1
         ORDER BY joined_at, user_id`,
        [tripId],
      )
      const sequences = backfilledRows.rows.map(({ seq }) => seq)
      expect(sequences).toEqual(['1', '2', '3'])
      expect(new Set(sequences).size).toBe(3)
      expect(sequences.every((seq) => BigInt(seq) > 0n)).toBe(true)

      const counter = await legacyClient.query<{ seq_counter: string }>(
        'SELECT seq_counter::text AS seq_counter FROM trips WHERE id = $1',
        [tripId],
      )
      expect(counter.rows[0]?.seq_counter).toBe('3')
    } finally {
      await legacyClient.end()
    }
  } finally {
    if (legacyDatabaseCreated) {
      const admin = new pg.Client({ connectionString: legacyAdminUrl.toString() })
      await admin.connect()
      try {
        await admin.query(`DROP DATABASE "${legacyDatabaseName}"`)
      } finally {
        await admin.end()
      }
    }
    await rm(migrationsDirectory, { recursive: true, force: true })
  }
})
