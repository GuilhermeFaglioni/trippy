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
  expect(concurrentRuns.flat()).toEqual(['0001', '0002', '0003', '0004'])

  const client = new pg.Client({ connectionString: testUrl.toString() })
  await client.connect()
  try {
    const tables = await client.query<{ table_name: string }>(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name IN (
           'users', 'identities', 'trips', 'trip_members', 'schema_migrations',
           'recaps', 'render_jobs', 'render_outbox', 'email_login_codes', 'refresh_tokens'
         )`,
    )
    expect(tables.rows.map(({ table_name }) => table_name).sort()).toEqual([
      'email_login_codes',
      'identities',
      'recaps',
      'refresh_tokens',
      'render_jobs',
      'render_outbox',
      'schema_migrations',
      'trip_members',
      'trips',
      'users',
    ])

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
      `INSERT INTO trips (name, destination, start_date, end_date, timezone, organizer_id)
       VALUES ('Viagem', 'Lisboa', '2026-11-01', '2026-11-05', 'Europe/Lisbon', $1)
       RETURNING id`,
      [organizerId],
    )
    const tripId = tripResult.rows[0]!.id

    await client.query('INSERT INTO trip_members (trip_id, user_id, role) VALUES ($1, $2, $3)', [
      tripId,
      organizerId,
      'organizer',
    ])
    await client.query(
      `INSERT INTO trip_members (trip_id, user_id, role, left_at)
       VALUES ($1, $2, 'organizer', now())`,
      [tripId, secondOrganizerId],
    )
    const activeOrganizerId = await user('active-organizer@example.test')
    await expect(
      client.query('INSERT INTO trip_members (trip_id, user_id, role) VALUES ($1, $2, $3)', [
        tripId,
        activeOrganizerId,
        'organizer',
      ]),
    ).rejects.toMatchObject({ code: '23505' })
    await expect(
      client.query('INSERT INTO trip_members (trip_id, user_id, role) VALUES ($1, $2, $3)', [
        tripId,
        activeOrganizerId,
        'guest',
      ]),
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
    await writeFile(
      join(failedMigrations, '0005_teste_transacao.sql'),
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
      expect(applied.rows.map(({ version }) => version)).toEqual(['0001', '0002', '0003', '0004'])
    } finally {
      await client.end()
    }
  } finally {
    await rm(failedMigrations, { recursive: true, force: true })
  }
})
