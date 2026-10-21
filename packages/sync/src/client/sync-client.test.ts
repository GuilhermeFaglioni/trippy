import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { canonicalTripState } from '../canonical-state.ts'
import type {
  PullQuery,
  PullResponse,
  PushRequest,
  PushResponse,
  SyncMember,
  SyncOperation,
  SyncPlace,
  SyncVisit,
  UUID,
} from '../types.ts'
import type { SqlDatabase } from '../database.ts'
import { createSyncClient } from './sync-client.ts'
import { NodeSqlDatabase } from './node-sqlite.ts'

const tripId = '11111111-1111-4111-8111-111111111111'
const userA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const userB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const placeA = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const placeB = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const fixedTime = '2026-10-21T12:00:00.000Z'

const databases: NodeSqlDatabase[] = []
const temporaryDirectories: string[] = []

afterEach(async () => {
  for (const database of databases.splice(0)) database.close()
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true })
  }
})

function createDatabase(path = ':memory:'): NodeSqlDatabase {
  const database = new NodeSqlDatabase(path)
  databases.push(database)
  return database
}

class CrashAfterReconciliationDatabase extends NodeSqlDatabase {
  override transaction<T>(operation: (database: SqlDatabase) => Promise<T>): Promise<T> {
    let closeAfterCommit = false
    return super
      .transaction(async (transaction) => {
        const wrapped: SqlDatabase = {
          exec: (sql) => transaction.exec(sql),
          run: async (sql, parameters) => {
            const result = await transaction.run(sql, parameters)
            if (sql.includes('SET needs_bootstrap = 1')) closeAfterCommit = true
            return result
          },
          all: (sql, parameters) => transaction.all(sql, parameters),
          get: (sql, parameters) => transaction.get(sql, parameters),
          transaction: async () => {
            throw new Error('Transações SQLite aninhadas não são suportadas.')
          },
        }
        return operation(wrapped)
      })
      .then((result) => {
        if (closeAfterCommit) this.close()
        return result
      })
  }
}

function createCrashDatabase(path: string): CrashAfterReconciliationDatabase {
  const database = new CrashAfterReconciliationDatabase(path)
  databases.push(database)
  return database
}

function createClient(
  database: NodeSqlDatabase,
  transport: FakeSyncTransport,
  userId = userA,
  getTripIds: () => readonly UUID[] | Promise<readonly UUID[]> = () => [tripId],
  options: { pageSize?: number; pushBatchSize?: number } = {},
) {
  let id = 0
  return createSyncClient({
    database,
    transport,
    userId,
    getTripIds,
    idGenerator: () => `00000000-0000-4000-8000-${String(++id).padStart(12, '0')}`,
    now: () => fixedTime,
    timeZone: 'UTC',
    pageSize: options.pageSize ?? 2,
    pushBatchSize: options.pushBatchSize ?? 2,
  })
}

async function expectDuplicateReconciliation(
  transport: FakeSyncTransport,
  performOperation: (client: Awaited<ReturnType<typeof createClient>>) => Promise<unknown>,
): Promise<void> {
  const database = createDatabase()
  const client = await createClient(database, transport)
  await client.syncNow()
  const bootstrapCount = transport.pulls.filter((query) => query.mode === 'bootstrap').length

  await performOperation(client)
  await client.syncNow()

  expect(client.getStatus().pending).toBe(0)
  expect(canonicalTripState(await readLocalState(database, tripId))).toEqual(
    canonicalTripState(transport.state()),
  )
  expect(transport.pulls.filter((query) => query.mode === 'bootstrap').length).toBeGreaterThan(
    bootstrapCount,
  )
}

function createPlace(id: UUID, name: string, suggestedBy: UUID, seq: string): SyncPlace {
  return {
    id,
    tripId,
    provider: null,
    providerRef: null,
    name,
    localName: null,
    address: null,
    localAddress: null,
    lat: null,
    lng: null,
    suggestedBy,
    comment: null,
    dayIndex: null,
    position: null,
    seq,
    deletedAt: null,
    createdAt: fixedTime,
  }
}

function createMember(userId: UUID, seq: string): SyncMember {
  return {
    tripId,
    userId,
    role: 'member',
    joinedAt: fixedTime,
    seq,
    deletedAt: null,
  }
}

function createVisit(placeId: UUID, userId: UUID, seq: string, visitedAt = fixedTime): SyncVisit {
  return {
    placeId,
    tripId,
    userId,
    markedBy: userId,
    visitedAt,
    visitedTz: 'UTC',
    seq,
    deletedAt: null,
  }
}

interface FakeServerState {
  applied: Map<UUID, PushResponse['results'][number]>
  places: Map<UUID, SyncPlace>
  visits: Map<string, SyncVisit>
  members: Map<string, SyncMember>
  sequence: bigint
  requireBootstrapOnce: boolean
}

function newFakeServerState(): FakeServerState {
  return {
    applied: new Map(),
    places: new Map(),
    visits: new Map(),
    members: new Map(),
    sequence: 0n,
    requireBootstrapOnce: false,
  }
}

class FakeSyncTransport {
  readonly pushes: SyncOperation[][] = []
  readonly pulls: PullQuery[] = []
  failBeforePushCall: number | null = null
  failBeforePullCall: number | null = null
  losePushResponseCall: number | null = null
  rejectReason: 'not_member' | 'forbidden' | 'invalid' | null = null

  constructor(
    readonly userId = userA,
    readonly limit = 100,
    readonly sharedState = newFakeServerState(),
  ) {}

  get applied(): FakeServerState['applied'] {
    return this.sharedState.applied
  }
  get places(): FakeServerState['places'] {
    return this.sharedState.places
  }
  get visits(): FakeServerState['visits'] {
    return this.sharedState.visits
  }
  get members(): FakeServerState['members'] {
    return this.sharedState.members
  }
  get sequence(): bigint {
    return this.sharedState.sequence
  }
  set sequence(value: bigint) {
    this.sharedState.sequence = value
  }
  get requireBootstrapOnce(): boolean {
    return this.sharedState.requireBootstrapOnce
  }
  set requireBootstrapOnce(value: boolean) {
    this.sharedState.requireBootstrapOnce = value
  }

  seedPlace(place: SyncPlace): void {
    this.places.set(place.id, place)
    this.sequence = this.sequence > BigInt(place.seq) ? this.sequence : BigInt(place.seq)
  }

  seedMember(member: SyncMember): void {
    this.members.set(member.userId, member)
    this.sequence = this.sequence > BigInt(member.seq) ? this.sequence : BigInt(member.seq)
  }

  seedVisit(visit: SyncVisit): void {
    this.visits.set(`${visit.placeId}:${visit.userId}`, visit)
    this.sequence = this.sequence > BigInt(visit.seq) ? this.sequence : BigInt(visit.seq)
  }

  deletePlace(id: UUID): void {
    const place = this.places.get(id)
    if (!place) return
    this.sequence += 1n
    this.places.set(id, { ...place, seq: String(this.sequence), deletedAt: fixedTime })
  }

  deleteMember(userId: UUID): void {
    const member = this.members.get(userId)
    if (!member) return
    this.sequence += 1n
    this.members.set(userId, { ...member, seq: String(this.sequence), deletedAt: fixedTime })
  }

  async push(request: PushRequest): Promise<PushResponse> {
    const callNumber = this.pushes.length + 1
    this.pushes.push(request.operations.map((operation) => ({ ...operation })))
    if (this.failBeforePushCall === callNumber) throw new Error('falha de rede antes do push')

    const results = request.operations.map((operation) => {
      const prior = this.applied.get(operation.opId)
      if (prior) return { opId: operation.opId, status: 'duplicate' as const }

      if (this.rejectReason) {
        const rejected = {
          opId: operation.opId,
          status: 'rejected' as const,
          reason: this.rejectReason,
        }
        this.applied.set(operation.opId, rejected)
        return rejected
      }

      const result = this.apply(operation)
      this.applied.set(operation.opId, result)
      return result
    })

    if (this.losePushResponseCall === callNumber)
      throw new Error('resposta perdida depois do commit')
    return { results }
  }

  async pull(query: PullQuery): Promise<PullResponse> {
    const callNumber = this.pulls.length + 1
    this.pulls.push(query)
    if (this.failBeforePullCall === callNumber) throw new Error('falha de rede durante o pull')
    if (this.requireBootstrapOnce && query.mode === 'incremental') {
      this.requireBootstrapOnce = false
      return { error: 'bootstrap_required' }
    }

    const snapshotSeq =
      query.mode === 'bootstrap'
        ? 'snapshotSeq' in query
          ? BigInt(query.snapshotSeq)
          : this.sequence
        : undefined
    const cursor =
      query.mode === 'bootstrap'
        ? 'cursor' in query
          ? BigInt(query.cursor)
          : 0n
        : BigInt(query.cursor)

    const events: Array<{
      seq: bigint
      kind: 'place' | 'visit' | 'member'
      value: SyncPlace | SyncVisit | SyncMember
    }> = []
    for (const value of this.places.values()) {
      const seq = BigInt(value.seq)
      if (
        seq > cursor &&
        (snapshotSeq === undefined || seq <= snapshotSeq) &&
        (query.mode !== 'bootstrap' || value.deletedAt === null)
      ) {
        events.push({ seq, kind: 'place', value })
      }
    }
    for (const value of this.visits.values()) {
      const seq = BigInt(value.seq)
      if (
        seq > cursor &&
        (snapshotSeq === undefined || seq <= snapshotSeq) &&
        (query.mode !== 'bootstrap' || value.deletedAt === null)
      ) {
        events.push({ seq, kind: 'visit', value })
      }
    }
    for (const value of this.members.values()) {
      const seq = BigInt(value.seq)
      if (
        seq > cursor &&
        (snapshotSeq === undefined || seq <= snapshotSeq) &&
        (query.mode !== 'bootstrap' || value.deletedAt === null)
      ) {
        events.push({ seq, kind: 'member', value })
      }
    }
    events.sort((left, right) =>
      left.seq < right.seq ? -1 : left.seq > right.seq ? 1 : left.kind.localeCompare(right.kind),
    )

    const page = events.slice(0, Math.min(query.limit, this.limit))
    const nextCursor = page.length > 0 ? String(page[page.length - 1]!.seq) : String(cursor)
    const pageData = {
      places: page
        .filter((event) => event.kind === 'place')
        .map((event) => event.value as SyncPlace),
      visits: page
        .filter((event) => event.kind === 'visit')
        .map((event) => event.value as SyncVisit),
      members: page
        .filter((event) => event.kind === 'member')
        .map((event) => event.value as SyncMember),
      nextCursor,
      hasMore: events.length > page.length,
    }

    if (query.mode === 'bootstrap') {
      const snapshot = snapshotSeq ?? 0n
      return {
        ...pageData,
        mode: 'bootstrap',
        snapshotSeq: String(snapshot),
        nextCursor: page.length > 0 ? nextCursor : String(snapshot),
      }
    }
    return { ...pageData, mode: 'incremental' }
  }

  state(): { places: SyncPlace[]; visits: SyncVisit[]; members: SyncMember[] } {
    return {
      places: [...this.places.values()],
      visits: [...this.visits.values()],
      members: [...this.members.values()],
    }
  }

  private apply(operation: SyncOperation): PushResponse['results'][number] {
    if (operation.type === 'place.add' && this.places.has(operation.placeId)) {
      return { opId: operation.opId, status: 'duplicate' }
    }

    if (operation.type === 'place.remove') {
      const place = this.places.get(operation.placeId)
      if (!place || place.deletedAt !== null) {
        return { opId: operation.opId, status: 'duplicate' }
      }
    }

    if (operation.type === 'visit.mark' || operation.type === 'visit.unmark') {
      const visit = this.visits.get(`${operation.placeId}:${this.userId}`)
      if (operation.type === 'visit.mark' && visit?.deletedAt === null) {
        return { opId: operation.opId, status: 'duplicate' }
      }
      if (operation.type === 'visit.unmark' && (!visit || visit.deletedAt !== null)) {
        return { opId: operation.opId, status: 'duplicate' }
      }
    }

    this.sequence += 1n
    const seq = String(this.sequence)
    if (operation.type === 'place.add') {
      this.places.set(
        operation.placeId,
        createPlace(operation.placeId, operation.name, this.userId, seq),
      )
    } else if (operation.type === 'place.remove') {
      const place = this.places.get(operation.placeId)
      if (place) this.places.set(place.id, { ...place, seq, deletedAt: fixedTime })
    } else {
      const key = `${operation.placeId}:${this.userId}`
      const previous = this.visits.get(key)
      this.visits.set(key, {
        placeId: operation.placeId,
        tripId: operation.tripId,
        userId: this.userId,
        markedBy: this.userId,
        visitedAt: previous?.visitedAt ?? fixedTime,
        visitedTz: previous?.visitedTz ?? 'UTC',
        seq,
        deletedAt: operation.type === 'visit.mark' ? null : fixedTime,
      })
    }
    return { opId: operation.opId, status: 'applied' }
  }
}

describe('SyncClient', () => {
  it('persiste reconciliação após duplicate no primeiro lote e falha no segundo, mesmo após reabrir', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'trippy-sync-'))
    temporaryDirectories.push(directory)
    const path = join(directory, 'client.sqlite')
    let database = createDatabase(path)
    const transport = new FakeSyncTransport()
    transport.seedMember(createMember(userA, '1'))
    transport.seedPlace(createPlace(placeA, 'Jardim', userA, '2'))
    transport.seedVisit(createVisit(placeA, userA, '3', '2026-10-20T09:30:00.000Z'))
    let client = await createClient(database, transport, userA, undefined, { pushBatchSize: 1 })
    await client.syncNow()

    await client.markVisit(tripId, placeA)
    await client.addPlace(tripId, 'Lugar novo')
    transport.failBeforePushCall = transport.pushes.length + 2
    await expect(client.syncNow()).rejects.toThrow('falha de rede antes do push')
    expect(client.getStatus().pending).toBe(1)
    expect(
      await database.get<{ needs_bootstrap: number } & Record<string, unknown>>(
        'SELECT needs_bootstrap FROM sync_state WHERE trip_id = ?',
        [tripId],
      ),
    ).toMatchObject({ needs_bootstrap: 1 })

    database.close()
    databases.splice(databases.indexOf(database), 1)
    transport.failBeforePushCall = null
    database = createDatabase(path)
    client = await createClient(database, transport, userA, undefined, { pushBatchSize: 1 })
    await client.syncNow()

    expect(client.getStatus().pending).toBe(0)
    expect(canonicalTripState(await readLocalState(database, tripId))).toEqual(
      canonicalTripState(transport.state()),
    )
  })

  it('retoma após fechar o app depois de duplicate confirmado e antes do bootstrap', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'trippy-sync-'))
    temporaryDirectories.push(directory)
    const path = join(directory, 'client.sqlite')
    let database: NodeSqlDatabase = createCrashDatabase(path)
    const transport = new FakeSyncTransport()
    transport.seedMember(createMember(userA, '1'))
    transport.seedPlace(createPlace(placeA, 'Jardim', userA, '2'))
    transport.seedVisit(createVisit(placeA, userA, '3', '2026-10-20T09:30:00.000Z'))
    let client = await createClient(database, transport)
    await client.syncNow()
    const previousPullCount = transport.pulls.length
    await client.markVisit(tripId, placeA)

    await expect(client.syncNow()).rejects.toThrow()
    expect(transport.pulls).toHaveLength(previousPullCount)
    databases.splice(databases.indexOf(database), 1)
    database = createDatabase(path)
    client = await createClient(database, transport)
    expect(client.getStatus().pending).toBe(0)
    expect(
      await database.get<{ needs_bootstrap: number } & Record<string, unknown>>(
        'SELECT needs_bootstrap FROM sync_state WHERE trip_id = ?',
        [tripId],
      ),
    ).toMatchObject({ needs_bootstrap: 1 })
    await client.syncNow()

    expect(canonicalTripState(await readLocalState(database, tripId))).toEqual(
      canonicalTripState(transport.state()),
    )
  })

  it('retoma snapshot parcial após falha de pull durante bootstrap persistido', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'trippy-sync-'))
    temporaryDirectories.push(directory)
    const path = join(directory, 'client.sqlite')
    let database = createDatabase(path)
    const transport = new FakeSyncTransport()
    transport.seedMember(createMember(userA, '1'))
    transport.seedPlace(createPlace(placeA, 'Jardim', userA, '2'))
    transport.seedVisit(createVisit(placeA, userA, '3', '2026-10-20T09:30:00.000Z'))
    let client = await createClient(database, transport, userA, undefined, { pageSize: 1 })
    await client.syncNow()
    await client.markVisit(tripId, placeA)
    transport.failBeforePullCall = transport.pulls.length + 2

    await expect(client.syncNow()).rejects.toThrow('falha de rede durante o pull')
    expect(
      await database.get<
        { needs_bootstrap: number; snapshot_seq: string | null } & Record<string, unknown>
      >('SELECT needs_bootstrap, snapshot_seq FROM sync_state WHERE trip_id = ?', [tripId]),
    ).toMatchObject({ needs_bootstrap: 1, snapshot_seq: '3' })

    database.close()
    databases.splice(databases.indexOf(database), 1)
    transport.failBeforePullCall = null
    database = createDatabase(path)
    client = await createClient(database, transport, userA, undefined, { pageSize: 1 })
    await client.syncNow()

    expect(canonicalTripState(await readLocalState(database, tripId))).toEqual(
      canonicalTripState(transport.state()),
    )
    expect(
      await database.get<
        { needs_bootstrap: number; snapshot_seq: string | null } & Record<string, unknown>
      >('SELECT needs_bootstrap, snapshot_seq FROM sync_state WHERE trip_id = ?', [tripId]),
    ).toMatchObject({ needs_bootstrap: 0, snapshot_seq: null })
  })

  it('retoma reconciliação persistida após not_sent e falha do pull', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'trippy-sync-'))
    temporaryDirectories.push(directory)
    const path = join(directory, 'client.sqlite')
    let database = createDatabase(path)
    const transport = new FakeSyncTransport()
    transport.rejectReason = 'not_member'
    let client = await createClient(database, transport)
    await client.addPlace(tripId, 'Otimista')
    transport.failBeforePullCall = 1

    await expect(client.syncNow()).rejects.toThrow('falha de rede durante o pull')
    expect(client.getStatus()).toMatchObject({ pending: 0, notSent: 1 })
    expect(
      await database.get<{ needs_bootstrap: number } & Record<string, unknown>>(
        'SELECT needs_bootstrap FROM sync_state WHERE trip_id = ?',
        [tripId],
      ),
    ).toMatchObject({ needs_bootstrap: 1 })

    database.close()
    databases.splice(databases.indexOf(database), 1)
    transport.failBeforePullCall = null
    transport.rejectReason = null
    database = createDatabase(path)
    client = await createClient(database, transport)
    await client.syncNow()

    expect(client.getStatus()).toMatchObject({ pending: 0, notSent: 1 })
    expect(canonicalTripState(await readLocalState(database, tripId))).toEqual(
      canonicalTripState(transport.state()),
    )
    expect(transport.pushes).toHaveLength(1)
  })

  it('persiste escrita offline e outbox ao fechar e reabrir o arquivo', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'trippy-sync-'))
    temporaryDirectories.push(directory)
    const path = join(directory, 'client.sqlite')
    const firstDatabase = createDatabase(path)
    const firstClient = await createClient(firstDatabase, new FakeSyncTransport())

    const placeId = await firstClient.addPlace(tripId, '  Café da Praça  ')
    expect(await firstClient.listPlaces(tripId)).toEqual([
      expect.objectContaining({ id: placeId, name: 'Café da Praça', visitedByMe: false }),
    ])
    expect(firstClient.getStatus().pending).toBe(1)

    firstDatabase.close()
    databases.splice(databases.indexOf(firstDatabase), 1)
    const reopenedDatabase = createDatabase(path)
    const reopenedClient = await createClient(reopenedDatabase, new FakeSyncTransport())

    expect(reopenedClient.getStatus().pending).toBe(1)
    expect(await reopenedClient.listPlaces(tripId)).toEqual([
      expect.objectContaining({ id: placeId, name: 'Café da Praça' }),
    ])
  })

  it('mantém pendências após falha no meio do push e retoma em lotes', async () => {
    const database = createDatabase()
    const transport = new FakeSyncTransport()
    transport.failBeforePushCall = 2
    const client = await createClient(database, transport)
    await client.addPlace(tripId, 'A')
    await client.addPlace(tripId, 'B')
    await client.addPlace(tripId, 'C')

    await expect(client.syncNow()).rejects.toThrow('falha de rede antes do push')
    expect(client.getStatus().pending).toBe(1)
    expect(client.getStatus().lastSyncedAt).toBeNull()
    const failedOperationId = transport.pushes[1]![0]!.opId
    expect(transport.pushes[0]).toHaveLength(2)

    transport.failBeforePushCall = null
    await client.syncNow()

    expect(transport.pushes[2]![0]!.opId).toBe(failedOperationId)
    expect(client.getStatus().pending).toBe(0)
    expect(client.getStatus().lastSyncedAt).toBe(fixedTime)
    expect(transport.state().places).toHaveLength(3)
  })

  it('reenvia o mesmo opId após resposta perdida sem duplicar no servidor', async () => {
    const database = createDatabase()
    const transport = new FakeSyncTransport()
    transport.losePushResponseCall = 1
    const client = await createClient(database, transport)
    await client.addPlace(tripId, 'Ponte Velha')

    await expect(client.syncNow()).rejects.toThrow('resposta perdida depois do commit')
    expect(client.getStatus().pending).toBe(1)
    const failedRow = await database.get<{ op_id: UUID } & Record<string, unknown>>(
      'SELECT op_id FROM outbox',
    )
    const originalOperationId = failedRow?.op_id
    transport.losePushResponseCall = null
    await client.syncNow()

    expect(transport.pushes[1]?.[0]?.opId).toBe(originalOperationId)
    expect(transport.state().places).toHaveLength(1)
    expect(client.getStatus().pending).toBe(0)
  })

  it('reconcilia visita otimista quando o servidor reconhece marcação sem mudança', async () => {
    const database = createDatabase()
    const transport = new FakeSyncTransport()
    const authoritativeVisit = createVisit(placeA, userA, '3', '2026-10-20T09:30:00.000Z')
    transport.seedMember(createMember(userA, '1'))
    transport.seedPlace(createPlace(placeA, 'Jardim', userA, '2'))
    transport.seedVisit(authoritativeVisit)
    const client = await createClient(database, transport)

    await client.syncNow()
    const bootstrapCount = transport.pulls.filter((query) => query.mode === 'bootstrap').length
    await client.markVisit(tripId, placeA)
    await client.syncNow()

    expect(client.getStatus().pending).toBe(0)
    expect(canonicalTripState(await readLocalState(database, tripId))).toEqual(
      canonicalTripState(transport.state()),
    )
    expect(transport.pulls.filter((query) => query.mode === 'bootstrap').length).toBeGreaterThan(
      bootstrapCount,
    )
  })

  it('reconcilia unmark quando não existe visita no servidor', async () => {
    const transport = new FakeSyncTransport()
    transport.seedMember(createMember(userA, '1'))
    transport.seedPlace(createPlace(placeA, 'Jardim', userA, '2'))

    await expectDuplicateReconciliation(transport, (client) => client.unmarkVisit(tripId, placeA))
  })

  it('reconcilia remoção de lugar já removido no servidor', async () => {
    const transport = new FakeSyncTransport()
    transport.seedMember(createMember(userA, '1'))
    transport.seedPlace({ ...createPlace(placeA, 'Removido', userA, '2'), deletedAt: fixedTime })

    await expectDuplicateReconciliation(transport, (client) => client.removePlace(tripId, placeA))
  })

  it('reconcilia place.add repetido com placeId existente', async () => {
    const transport = new FakeSyncTransport()
    const generatedPlaceId = '00000000-0000-4000-8000-000000000001'
    transport.seedMember(createMember(userA, '1'))
    transport.seedPlace(createPlace(generatedPlaceId, 'Nome confirmado', userA, '2'))

    await expectDuplicateReconciliation(transport, (client) =>
      client.addPlace(tripId, 'Nome otimista'),
    )
  })

  it('reconcilia resposta duplicate para opId já aplicado', async () => {
    const transport = new FakeSyncTransport()
    const repeatedOpId = '00000000-0000-4000-8000-000000000001'
    transport.seedMember(createMember(userA, '1'))
    transport.seedPlace(createPlace(placeA, 'Jardim', userA, '2'))
    transport.seedVisit(createVisit(placeA, userA, '3', '2026-10-20T09:30:00.000Z'))
    transport.applied.set(repeatedOpId, { opId: repeatedOpId, status: 'applied' })

    await expectDuplicateReconciliation(transport, (client) => client.markVisit(tripId, placeA))
  })

  it('faz bootstrap paginado e recebe remoções pelo pull incremental', async () => {
    const database = createDatabase()
    const transport = new FakeSyncTransport(userA, 2)
    transport.seedPlace(createPlace(placeA, 'Praça', userA, '1'))
    transport.seedPlace(createPlace(placeB, 'Museu', userA, '2'))
    transport.seedMember(createMember(userA, '3'))
    const client = await createClient(database, transport)

    await client.syncNow()
    expect(transport.pulls.filter((query) => query.mode === 'bootstrap')).toHaveLength(2)
    expect(await client.listPlaces(tripId)).toHaveLength(2)

    transport.deletePlace(placeA)
    await client.syncNow()
    expect(await client.listPlaces(tripId)).toEqual([
      expect.objectContaining({ id: placeB, name: 'Museu' }),
    ])
    const stored = await database.get<{ deleted_at: string | null } & Record<string, unknown>>(
      'SELECT deleted_at FROM places WHERE id = ?',
      [placeA],
    )
    expect(stored?.deleted_at).toBe(fixedTime)
  })

  it('limpa o snapshot antigo e refaz bootstrap quando cursor expira', async () => {
    const database = createDatabase()
    const transport = new FakeSyncTransport()
    transport.seedPlace(createPlace(placeA, 'Antigo', userA, '1'))
    const client = await createClient(database, transport)
    await client.syncNow()

    transport.deletePlace(placeA)
    transport.seedPlace(createPlace(placeB, 'Novo', userA, String(transport.sequence + 1n)))
    transport.requireBootstrapOnce = true
    await client.syncNow()

    expect(await client.listPlaces(tripId)).toEqual([
      expect.objectContaining({ id: placeB, name: 'Novo' }),
    ])
    expect(transport.pulls.some((query) => query.mode === 'bootstrap')).toBe(true)
  })

  it('converge dois clientes contra o mesmo servidor e notifica assinantes', async () => {
    const databaseA = createDatabase()
    const databaseB = createDatabase()
    const server = new FakeSyncTransport()
    server.seedMember(createMember(userA, '1'))
    server.seedMember(createMember(userB, '2'))
    const clientA = await createClient(databaseA, server, userA)
    const transportB = new FakeSyncTransport(userB, 100, server.sharedState)
    const clientB = await createClient(databaseB, transportB, userB)

    let notifications = 0
    const unsubscribe = clientA.subscribe(() => {
      notifications += 1
    })
    const createdPlaceId = await clientA.addPlace(tripId, 'Jardim')
    expect(notifications).toBeGreaterThan(0)
    await clientA.syncNow()
    await clientB.syncNow()
    await clientB.markVisit(tripId, createdPlaceId)
    await clientB.syncNow()
    await clientA.syncNow()

    const stateA = await readLocalState(databaseA, tripId)
    const stateB = await readLocalState(databaseB, tripId)
    expect(canonicalTripState(stateA)).toEqual(canonicalTripState(server.state()))
    expect(canonicalTripState(stateB)).toEqual(canonicalTripState(server.state()))
    expect(notifications).toBeGreaterThan(1)
    unsubscribe()
  })

  it.each(['not_member', 'forbidden'] as const)(
    'mantém rejeição %s em not_sent e não reenvia automaticamente',
    async (reason) => {
      const database = createDatabase()
      const transport = new FakeSyncTransport()
      transport.rejectReason = reason
      const client = await createClient(database, transport)
      await client.addPlace(tripId, 'Roteiro')

      await client.syncNow()
      expect(client.getStatus().notSent).toBe(1)
      expect(client.getStatus().pending).toBe(0)
      expect(await client.listPlaces(tripId)).toHaveLength(0)
      await client.syncNow()
      expect(transport.pushes).toHaveLength(1)
      expect(
        await database.get<{ status: string } & Record<string, unknown>>(
          'SELECT status FROM outbox',
        ),
      ).toMatchObject({ status: 'not_sent' })
    },
  )

  it('remove viagem do acesso local quando pull informa remoção do membro', async () => {
    const database = createDatabase()
    const transport = new FakeSyncTransport()
    transport.seedMember(createMember(userA, '1'))
    transport.seedPlace(createPlace(placeA, 'Roteiro', userB, '2'))
    const client = await createClient(database, transport)
    await client.syncNow()
    expect(await client.listPlaces(tripId)).toHaveLength(1)

    transport.deleteMember(userA)
    await client.syncNow()

    expect(await client.listPlaces(tripId)).toEqual([])
  })

  it('continua sync de viagens locais quando getTripIds falha', async () => {
    const database = createDatabase()
    const transport = new FakeSyncTransport()
    const client = await createClient(database, transport, userA, async () => {
      throw new Error('lista de viagens offline')
    })
    await client.addPlace(tripId, 'Offline')

    await client.syncNow()

    expect(transport.state().places).toHaveLength(1)
    expect(client.getStatus()).toMatchObject({
      pending: 0,
      lastError: 'lista de viagens offline',
      syncing: false,
    })
  })
})

async function readLocalState(database: NodeSqlDatabase, requestedTripId: UUID) {
  const [places, visits, members] = await Promise.all([
    database.all<
      Record<string, unknown> & {
        id: UUID
        trip_id: UUID
        provider: string | null
        provider_ref: string | null
        name: string
        local_name: string | null
        address: string | null
        local_address: string | null
        lat: number | null
        lng: number | null
        suggested_by: UUID
        comment: string | null
        day_index: number | null
        position: number | null
        seq: string
        deleted_at: string | null
        created_at: string
      }
    >('SELECT * FROM places WHERE trip_id = ?', [requestedTripId]),
    database.all<
      Record<string, unknown> & {
        place_id: UUID
        trip_id: UUID
        user_id: UUID
        marked_by: UUID
        visited_at: string
        visited_tz: string
        seq: string
        deleted_at: string | null
      }
    >('SELECT * FROM visits WHERE trip_id = ?', [requestedTripId]),
    database.all<
      Record<string, unknown> & {
        trip_id: UUID
        user_id: UUID
        role: SyncMember['role']
        joined_at: string
        seq: string
        deleted_at: string | null
      }
    >('SELECT * FROM members WHERE trip_id = ?', [requestedTripId]),
  ])
  return {
    places: places.map((row) => ({
      id: row.id,
      tripId: row.trip_id,
      provider: row.provider,
      providerRef: row.provider_ref,
      name: row.name,
      localName: row.local_name,
      address: row.address,
      localAddress: row.local_address,
      lat: row.lat,
      lng: row.lng,
      suggestedBy: row.suggested_by,
      comment: row.comment,
      dayIndex: row.day_index,
      position: row.position,
      seq: String(row.seq),
      deletedAt: row.deleted_at,
      createdAt: row.created_at,
    })),
    visits: visits.map((row) => ({
      placeId: row.place_id,
      tripId: row.trip_id,
      userId: row.user_id,
      markedBy: row.marked_by,
      visitedAt: row.visited_at,
      visitedTz: row.visited_tz,
      seq: String(row.seq),
      deletedAt: row.deleted_at,
    })),
    members: members.map((row) => ({
      tripId: row.trip_id,
      userId: row.user_id,
      role: row.role,
      joinedAt: row.joined_at,
      seq: String(row.seq),
      deletedAt: row.deleted_at,
    })),
  }
}
