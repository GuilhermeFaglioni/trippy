import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { PostgresTripStore } from '@trippy/adapters/trips'
import { migrate } from '../../../packages/db/src/migrate.ts'
import { createApp } from '../src/app.ts'
import { createSyncRouter } from '../src/sync/router.ts'
import { createTripsRouter } from '../src/trips/router.ts'
import type { HealthChecks } from '../src/health.ts'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL não definido: configure o Postgres local')

const testDatabaseName = `trippy_api_nome_membro_${process.pid}_${randomUUID().replaceAll('-', '').slice(0, 12)}`
const adminUrl = new URL(databaseUrl)
adminUrl.pathname = '/postgres'
const testDatabaseUrl = new URL(databaseUrl)
testDatabaseUrl.pathname = `/${testDatabaseName}`

const tokenUsers = new Map<string, string>()
let databaseCreated = false
const candidateSecret = 'segredo-de-candidato-integração-com-entropia-suficiente'
type Pool = InstanceType<typeof pg.Pool>
let pool: Pool
let app: ReturnType<typeof createApp>
let organizerId: string
let anaId: string
let closeSync: () => Promise<void> = async () => {}

const healthyChecks: HealthChecks = {
  postgres: async () => {},
  storage: async () => {},
  queue: async () => {},
  mail: async () => {},
}

interface PulledMember {
  userId: string
  name: string | null
  seq: string
}

interface PullBody {
  snapshotSeq?: string
  nextCursor: string
  members: PulledMember[]
}

async function get(path: string, token = 'organizer-token') {
  return app.request(path, { headers: { authorization: `Bearer ${token}` } })
}

async function post(path: string, body: unknown, token = 'organizer-token') {
  return app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
}

async function createTrip(): Promise<string> {
  const response = await post('/trips', {
    name: `Viagem ${randomUUID()}`,
    destination: 'Lisboa',
    startDate: '2026-11-01',
    endDate: '2026-11-05',
    timezone: 'Europe/Lisbon',
  })
  expect(response.status).toBe(201)
  return ((await response.json()) as { trip: { id: string } }).trip.id
}

async function addMember(tripId: string, userId: string, role: 'coorganizer' | 'member') {
  const sequence = await pool.query<{ seq_counter: string }>(
    'UPDATE trips SET seq_counter = seq_counter + 1 WHERE id = $1 RETURNING seq_counter',
    [tripId],
  )
  await pool.query(
    `INSERT INTO trip_members (trip_id, user_id, role, seq)
     VALUES ($1, $2, $3, $4)`,
    [tripId, userId, role, sequence.rows[0]!.seq_counter],
  )
}

function memberOf(body: PullBody, userId: string): PulledMember {
  const member = body.members.find((row) => row.userId === userId)
  if (!member) throw new Error(`membro ${userId} ausente do pull`)
  return member
}

beforeAll(async () => {
  const admin = new pg.Client({ connectionString: adminUrl.toString() })
  await admin.connect()
  try {
    await admin.query(`CREATE DATABASE "${testDatabaseName}"`)
    databaseCreated = true
  } finally {
    await admin.end()
  }

  await migrate({ databaseUrl: testDatabaseUrl.toString() })
  pool = new pg.Pool({ connectionString: testDatabaseUrl.toString() })
  const organizer = await pool.query<{ id: string }>(
    'INSERT INTO users (name, email) VALUES ($1, $2) RETURNING id',
    ['Guilherme Faglioni', 'guilherme.faglioni@x.test'],
  )
  // Sem nome cadastrado: o fallback deriva o nome do e-mail.
  const ana = await pool.query<{ id: string }>(
    'INSERT INTO users (name, email) VALUES ($1, $2) RETURNING id',
    [null, 'ana.lima@x.test'],
  )
  organizerId = organizer.rows[0]!.id
  anaId = ana.rows[0]!.id
  tokenUsers.set('organizer-token', organizerId)
  tokenUsers.set('ana-token', anaId)

  const trips = createTripsRouter(
    { databaseUrl: testDatabaseUrl.toString() },
    {
      tripStore: new PostgresTripStore(pool),
      accessTokenVerifier: async (token) => {
        const userId = tokenUsers.get(token)
        if (!userId) throw new Error('Token inválido')
        return { userId }
      },
    },
  )
  const sync = createSyncRouter(
    { databaseUrl: testDatabaseUrl.toString(), placesCandidateSecret: candidateSecret },
    {
      accessTokenVerifier: async (token) => {
        const userId = tokenUsers.get(token)
        if (!userId) throw new Error('Token inválido')
        return { userId }
      },
    },
  )
  closeSync = sync.close
  app = createApp(healthyChecks, 1_000, undefined, trips.router, sync.router)
})

afterAll(async () => {
  await closeSync()
  if (pool) await pool.end()
  if (databaseCreated) {
    const admin = new pg.Client({ connectionString: adminUrl.toString() })
    await admin.connect()
    try {
      await admin.query(`DROP DATABASE "${testDatabaseName}"`)
    } finally {
      await admin.end()
    }
  }
})

it('bootstrap devolve o nome do membro, com fallback derivado do e-mail', async () => {
  const tripId = await createTrip()
  await addMember(tripId, anaId, 'member')

  const pull = await get(`/sync/pull?trip=${tripId}&limit=100`)
  expect(pull.status).toBe(200)
  const body = (await pull.json()) as PullBody

  expect(memberOf(body, organizerId).name).toBe('Guilherme Faglioni')
  expect(memberOf(body, anaId).name).toBe('Ana Lima')
})

it('renomear o usuário gera seq novo e o pull incremental reenvia o membro com o nome novo', async () => {
  const tripId = await createTrip()
  await addMember(tripId, anaId, 'member')

  const bootstrap = await get(`/sync/pull?trip=${tripId}&limit=100`)
  const first = (await bootstrap.json()) as PullBody
  const cursor = first.nextCursor
  const previousSeq = memberOf(first, organizerId).seq

  await pool.query('UPDATE users SET name = $2 WHERE id = $1', [organizerId, 'Gui Faglioni'])

  const incremental = await get(`/sync/pull?trip=${tripId}&limit=100&cursor=${cursor}`)
  expect(incremental.status).toBe(200)
  const changes = (await incremental.json()) as PullBody
  const renamed = memberOf(changes, organizerId)
  expect(renamed.name).toBe('Gui Faglioni')
  expect(BigInt(renamed.seq)).toBeGreaterThan(BigInt(previousSeq))
  // Ana não mudou: não volta no incremental.
  expect(changes.members.map((row) => row.userId)).not.toContain(anaId)
})

it('gravar o mesmo nome ou mudar só o e-mail não gera seq novo', async () => {
  const tripId = await createTrip()
  const before = await pool.query<{ seq_counter: string }>(
    'SELECT seq_counter::text AS seq_counter FROM trips WHERE id = $1',
    [tripId],
  )

  await pool.query('UPDATE users SET name = name WHERE id = $1', [organizerId])
  await pool.query('UPDATE users SET email = $2 WHERE id = $1', [
    organizerId,
    'guilherme.novo@x.test',
  ])
  await pool.query('UPDATE users SET email = $2 WHERE id = $1', [
    organizerId,
    'guilherme.faglioni@x.test',
  ])

  const after = await pool.query<{ seq_counter: string }>(
    'SELECT seq_counter::text AS seq_counter FROM trips WHERE id = $1',
    [tripId],
  )
  expect(after.rows[0]!.seq_counter).toBe(before.rows[0]!.seq_counter)
})
