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
  SyncReview,
  SyncVisit,
  SyncWant,
  UUID,
} from '../types.ts'
import type { PlaceSearchCandidate } from '@trippy/domain'
import type { SqlDatabase } from '../database.ts'
import { createSyncClient } from './sync-client.ts'
import { NodeSqlDatabase } from './node-sqlite.ts'

const tripId = '11111111-1111-4111-8111-111111111111'
const otherTripId = '88888888-8888-4888-8888-888888888888'
const userA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const userB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const placeA = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const placeB = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const placeC = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
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
  options: { pageSize?: number; pushBatchSize?: number; idGenerator?: () => UUID } = {},
) {
  let id = 0
  return createSyncClient({
    database,
    transport,
    userId,
    getTripIds,
    idGenerator:
      options.idGenerator ?? (() => `00000000-0000-4000-8000-${String(++id).padStart(12, '0')}`),
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

const signedCandidate: PlaceSearchCandidate = {
  provider: 'geoapify',
  providerRef: 'geo-123',
  name: 'Museu do Amanhã',
  localName: '故宮博物院',
  address: 'Praça Mauá, 1',
  localAddress: '北京市东城区景山前街4号',
  lat: -22.894,
  lng: -43.179,
  countryCode: 'cn',
  datasource: 'openstreetmap',
  attribution: '© OpenStreetMap contributors',
  license: 'ODbL',
  method: 'geocoding',
  token: 'assinatura-de-teste',
}

function createPlace(
  id: UUID,
  name: string,
  suggestedBy: UUID,
  seq: string,
  candidate?: PlaceSearchCandidate,
): SyncPlace {
  return {
    id,
    tripId,
    provider: candidate?.provider ?? null,
    providerRef: candidate?.providerRef ?? null,
    countryCode: candidate?.countryCode ?? null,
    providerDatasource: candidate?.datasource ?? null,
    attribution: candidate?.attribution ?? null,
    license: candidate?.license ?? null,
    name,
    localName: candidate?.localName ?? null,
    address: candidate?.address ?? null,
    localAddress: candidate?.localAddress ?? null,
    googlePlaceId: null,
    googleMatch: 'none',
    userLocalName: null,
    userLocalAddress: null,
    lat: candidate?.lat ?? null,
    lng: candidate?.lng ?? null,
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
    openedAt: null,
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

function createWant(placeId: UUID, userId: UUID, seq: string): SyncWant {
  return { placeId, tripId, userId, createdAt: fixedTime, seq, deletedAt: null }
}

function createReview(
  placeId: UUID,
  userId: UUID,
  seq: string,
  overrides: Partial<Pick<SyncReview, 'favorite' | 'rating' | 'note'>> = {},
): SyncReview {
  return {
    placeId,
    tripId,
    userId,
    favorite: false,
    rating: null,
    note: null,
    updatedAt: fixedTime,
    seq,
    deletedAt: null,
    ...overrides,
  }
}

interface FakeServerState {
  applied: Map<UUID, PushResponse['results'][number]>
  places: Map<UUID, SyncPlace>
  visits: Map<string, SyncVisit>
  wants: Map<string, SyncWant>
  reviews: Map<string, SyncReview>
  members: Map<string, SyncMember>
  sequence: bigint
  itineraryVersion: number
  requireBootstrapOnce: boolean
}

function newFakeServerState(): FakeServerState {
  return {
    applied: new Map(),
    places: new Map(),
    visits: new Map(),
    wants: new Map(),
    reviews: new Map(),
    members: new Map(),
    sequence: 0n,
    itineraryVersion: 0,
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
  notMemberOnPull = false

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
  get wants(): FakeServerState['wants'] {
    return this.sharedState.wants
  }
  get reviews(): FakeServerState['reviews'] {
    return this.sharedState.reviews
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
  get itineraryVersion(): number {
    return this.sharedState.itineraryVersion
  }
  set itineraryVersion(value: number) {
    this.sharedState.itineraryVersion = value
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

  seedWant(want: SyncWant): void {
    this.wants.set(`${want.placeId}:${want.userId}`, want)
    this.sequence = this.sequence > BigInt(want.seq) ? this.sequence : BigInt(want.seq)
  }

  seedReview(review: SyncReview): void {
    this.reviews.set(`${review.placeId}:${review.userId}`, review)
    this.sequence = this.sequence > BigInt(review.seq) ? this.sequence : BigInt(review.seq)
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

  arrangeOnServer(days: Array<{ dayIndex: number; placeIds: UUID[] }>): void {
    const dayIndexes = new Set(days.map((day) => day.dayIndex))
    const placements = new Map<UUID, { dayIndex: number; position: number }>()
    for (const day of days) {
      day.placeIds.forEach((placeId, position) => {
        placements.set(placeId, { dayIndex: day.dayIndex, position })
      })
    }

    for (const place of this.places.values()) {
      const placement = placements.get(place.id)
      const leavesListedDay =
        place.dayIndex !== null && dayIndexes.has(place.dayIndex) && !placement
      if (!placement && !leavesListedDay) continue
      const dayIndex = placement?.dayIndex ?? null
      const position = placement?.position ?? null
      if (place.dayIndex === dayIndex && place.position === position) continue
      this.sequence += 1n
      this.places.set(place.id, { ...place, dayIndex, position, seq: String(this.sequence) })
    }
    this.itineraryVersion += 1
  }

  async push(request: PushRequest): Promise<PushResponse> {
    const callNumber = this.pushes.length + 1
    this.pushes.push(request.operations.map((operation) => ({ ...operation })))
    if (this.failBeforePushCall === callNumber) throw new Error('falha de rede antes do push')

    const results = request.operations.map((operation) => {
      const prior = this.applied.get(operation.opId)
      if (prior) {
        return prior.status === 'conflict'
          ? prior
          : { opId: operation.opId, status: 'duplicate' as const }
      }

      if (this.rejectReason) {
        const rejected = {
          opId: operation.opId,
          status: 'rejected' as const,
          reason: this.rejectReason,
        }
        if (this.rejectReason !== 'invalid') this.applied.set(operation.opId, rejected)
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
    if (this.notMemberOnPull) return { error: 'not_member' }
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
      kind: 'place' | 'visit' | 'want' | 'review' | 'member'
      value: SyncPlace | SyncVisit | SyncWant | SyncReview | SyncMember
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
    for (const value of this.wants.values()) {
      const seq = BigInt(value.seq)
      if (
        seq > cursor &&
        (snapshotSeq === undefined || seq <= snapshotSeq) &&
        (query.mode !== 'bootstrap' || value.deletedAt === null)
      ) {
        events.push({ seq, kind: 'want', value })
      }
    }
    for (const value of this.reviews.values()) {
      const seq = BigInt(value.seq)
      if (
        seq > cursor &&
        (snapshotSeq === undefined || seq <= snapshotSeq) &&
        (query.mode !== 'bootstrap' || value.deletedAt === null)
      ) {
        events.push({ seq, kind: 'review', value })
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
      wants: page.filter((event) => event.kind === 'want').map((event) => event.value as SyncWant),
      reviews: page
        .filter((event) => event.kind === 'review')
        .map((event) => event.value as SyncReview),
      members: page
        .filter((event) => event.kind === 'member')
        .map((event) => event.value as SyncMember),
      itinerary: {
        version: this.itineraryVersion,
        atSeq: String(snapshotSeq ?? this.sequence),
      },
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

  state(): {
    places: SyncPlace[]
    visits: SyncVisit[]
    wants: SyncWant[]
    reviews: SyncReview[]
    members: SyncMember[]
  } {
    return {
      places: [...this.places.values()],
      visits: [...this.visits.values()],
      wants: [...this.wants.values()],
      reviews: [...this.reviews.values()],
      members: [...this.members.values()],
    }
  }

  private visitTarget(operation: SyncOperation): UUID {
    return 'userId' in operation && operation.userId !== undefined ? operation.userId : this.userId
  }

  private apply(operation: SyncOperation): PushResponse['results'][number] {
    if (operation.type === 'itinerary.arrange' && operation.baseVersion !== this.itineraryVersion) {
      return {
        opId: operation.opId,
        status: 'conflict',
        currentVersion: this.itineraryVersion,
      }
    }

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
      const visit = this.visits.get(`${operation.placeId}:${this.visitTarget(operation)}`)
      if (operation.type === 'visit.mark' && visit?.deletedAt === null) {
        return { opId: operation.opId, status: 'duplicate' }
      }
      if (operation.type === 'visit.unmark' && (!visit || visit.deletedAt !== null)) {
        return { opId: operation.opId, status: 'duplicate' }
      }
    }

    if (operation.type === 'place.want' || operation.type === 'place.unwant') {
      const key = `${operation.placeId}:${this.userId}`
      const previous = this.wants.get(key)
      if (operation.type === 'place.want' && previous?.deletedAt === null) {
        return { opId: operation.opId, status: 'duplicate' }
      }
      if (operation.type === 'place.unwant' && (!previous || previous.deletedAt !== null)) {
        return { opId: operation.opId, status: 'duplicate' }
      }
      this.sequence += 1n
      this.wants.set(key, {
        placeId: operation.placeId,
        tripId: operation.tripId,
        userId: this.userId,
        createdAt: fixedTime,
        seq: String(this.sequence),
        deletedAt: operation.type === 'place.want' ? null : fixedTime,
      })
      return { opId: operation.opId, status: 'applied' }
    }

    if (
      operation.type === 'place.favorite' ||
      operation.type === 'place.rate' ||
      operation.type === 'place.note'
    ) {
      const place = this.places.get(operation.placeId)
      if (!place || place.tripId !== operation.tripId || place.deletedAt !== null) {
        return { opId: operation.opId, status: 'rejected', reason: 'invalid' }
      }
      const key = `${operation.placeId}:${this.userId}`
      const previous = this.reviews.get(key) ?? createReview(operation.placeId, this.userId, '0')
      const next = {
        ...previous,
        favorite: operation.type === 'place.favorite' ? operation.favorite : previous.favorite,
        rating: operation.type === 'place.rate' ? operation.rating : previous.rating,
        note: operation.type === 'place.note' ? operation.note : previous.note,
      }
      if (
        next.favorite === previous.favorite &&
        next.rating === previous.rating &&
        next.note === previous.note
      ) {
        return { opId: operation.opId, status: 'duplicate' }
      }
      this.sequence += 1n
      this.reviews.set(key, { ...next, updatedAt: fixedTime, seq: String(this.sequence) })
      return { opId: operation.opId, status: 'applied' }
    }

    if (operation.type === 'itinerary.arrange') {
      this.arrangeOnServer(operation.days)
      return { opId: operation.opId, status: 'applied' }
    }

    if (operation.type === 'member.remove') {
      const member = this.members.get(operation.userId)
      if (member && member.deletedAt === null) {
        this.sequence += 1n
        this.members.set(member.userId, {
          ...member,
          seq: String(this.sequence),
          deletedAt: fixedTime,
        })
      }
      return { opId: operation.opId, status: 'applied' }
    }

    if (operation.type === 'member.set_role') {
      const member = this.members.get(operation.userId)
      if (member && member.deletedAt === null) {
        this.sequence += 1n
        this.members.set(member.userId, {
          ...member,
          role: operation.role,
          seq: String(this.sequence),
        })
      }
      return { opId: operation.opId, status: 'applied' }
    }

    if (operation.type === 'trip.end' || operation.type === 'trip.open') {
      return { opId: operation.opId, status: 'applied' }
    }

    if (operation.type === 'place.google_link' || operation.type === 'place.set_local') {
      const place = this.places.get(operation.placeId)
      if (!place || place.tripId !== operation.tripId || place.deletedAt !== null) {
        return { opId: operation.opId, status: 'rejected', reason: 'invalid' }
      }
    }

    this.sequence += 1n
    const seq = String(this.sequence)
    if (operation.type === 'place.add') {
      this.places.set(
        operation.placeId,
        createPlace(operation.placeId, operation.name, this.userId, seq, operation.candidate),
      )
    } else if (operation.type === 'place.remove') {
      const place = this.places.get(operation.placeId)
      if (place) this.places.set(place.id, { ...place, seq, deletedAt: fixedTime })
      for (const [key, review] of this.reviews) {
        if (review.placeId === operation.placeId && review.deletedAt === null) {
          this.reviews.set(key, { ...review, seq, deletedAt: fixedTime })
        }
      }
    } else if (operation.type === 'place.google_link') {
      const place = this.places.get(operation.placeId)!
      this.places.set(operation.placeId, {
        ...place,
        googlePlaceId: operation.googlePlaceId,
        googleMatch: operation.googlePlaceId === null ? 'no_match' : 'matched',
        seq,
      })
    } else if (operation.type === 'place.set_local') {
      const place = this.places.get(operation.placeId)!
      this.places.set(operation.placeId, {
        ...place,
        ...(Object.hasOwn(operation, 'localName')
          ? { userLocalName: operation.localName ?? null }
          : {}),
        ...(Object.hasOwn(operation, 'localAddress')
          ? { userLocalAddress: operation.localAddress ?? null }
          : {}),
        seq,
      })
    } else {
      const key = `${operation.placeId}:${this.visitTarget(operation)}`
      const previous = this.visits.get(key)
      this.visits.set(key, {
        placeId: operation.placeId,
        tripId: operation.tripId,
        userId: this.visitTarget(operation),
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

class PausedPullSyncTransport extends FakeSyncTransport {
  private pullPause:
    | {
        started: () => void
        startedPromise: Promise<void>
        releasedPromise: Promise<void>
        release: () => void
      }
    | undefined

  pauseNextPull(): { started: Promise<void>; release: () => void } {
    let started!: () => void
    let release!: () => void
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve
    })
    const releasedPromise = new Promise<void>((resolve) => {
      release = resolve
    })
    this.pullPause = { started, startedPromise, releasedPromise, release }
    return { started: startedPromise, release }
  }

  override async pull(query: PullQuery): Promise<PullResponse> {
    const pause = this.pullPause
    if (pause) {
      this.pullPause = undefined
      pause.started()
      await pause.releasedPromise
    }
    return super.pull(query)
  }
}

describe('SyncClient', () => {
  it('preserva rascunho de conflito após reabrir e mostra o roteiro do servidor', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'trippy-sync-'))
    temporaryDirectories.push(directory)
    const path = join(directory, 'client.sqlite')
    let database = createDatabase(path)
    const transport = new FakeSyncTransport()
    transport.itineraryVersion = 4
    transport.seedMember(createMember(userA, '1'))
    transport.seedPlace({ ...createPlace(placeA, 'Praça', userA, '2'), dayIndex: 0, position: 0 })
    transport.seedPlace({ ...createPlace(placeB, 'Museu', userA, '3'), dayIndex: 0, position: 1 })
    let client = await createClient(database, transport)
    await client.syncNow()

    await client.arrangeItinerary(tripId, [{ dayIndex: 0, placeIds: [placeB, placeA] }])
    transport.arrangeOnServer([{ dayIndex: 0, placeIds: [placeA, placeB] }])
    await client.syncNow()

    const draft = (await client.listItineraryDrafts(tripId))[0]
    expect(draft).toMatchObject({
      opId: '00000000-0000-4000-8000-000000000001',
      tripId,
      baseVersion: 4,
      currentVersion: 5,
      days: [{ dayIndex: 0, placeIds: [placeB, placeA] }],
      createdAt: fixedTime,
    })
    expect(
      (await client.listPlaces(tripId))
        .map(({ id, dayIndex, position }) => ({ id, dayIndex, position }))
        .sort((left, right) => left.id.localeCompare(right.id)),
    ).toEqual([
      { id: placeA, dayIndex: 0, position: 0 },
      { id: placeB, dayIndex: 0, position: 1 },
    ])

    database.close()
    databases.splice(databases.indexOf(database), 1)
    database = createDatabase(path)
    client = await createClient(database, transport)
    expect(await client.listItineraryDrafts(tripId)).toEqual([draft])
    expect(
      (await client.listPlaces(tripId))
        .map(({ id, dayIndex, position }) => ({ id, dayIndex, position }))
        .sort((left, right) => left.id.localeCompare(right.id)),
    ).toEqual([
      { id: placeA, dayIndex: 0, position: 0 },
      { id: placeB, dayIndex: 0, position: 1 },
    ])
  })

  it('reaplica rascunho com novo op_id e versão atual conhecida', async () => {
    const database = createDatabase()
    const transport = new FakeSyncTransport()
    transport.itineraryVersion = 2
    transport.seedMember(createMember(userA, '1'))
    transport.seedPlace({ ...createPlace(placeA, 'Praça', userA, '2'), dayIndex: 0, position: 0 })
    transport.seedPlace({ ...createPlace(placeB, 'Museu', userA, '3'), dayIndex: 0, position: 1 })
    let id = 0
    const idGenerator = () => `00000000-0000-4000-8000-${String(++id).padStart(12, '0')}`
    const client = await createClient(database, transport, userA, undefined, { idGenerator })
    await client.syncNow()
    await client.arrangeItinerary(tripId, [{ dayIndex: 0, placeIds: [placeB, placeA] }])
    transport.arrangeOnServer([{ dayIndex: 0, placeIds: [placeA, placeB] }])
    await client.syncNow()

    const [draft] = await client.listItineraryDrafts(tripId)
    expect(draft).toBeDefined()
    await client.reapplyItineraryDraft(draft!.opId)
    expect(await client.listItineraryDrafts(tripId)).toEqual([])
    await client.syncNow()

    const reapplied = transport.pushes.at(-1)?.[0]
    expect(reapplied).toMatchObject({
      type: 'itinerary.arrange',
      opId: '00000000-0000-4000-8000-000000000002',
      baseVersion: 3,
      days: [{ dayIndex: 0, placeIds: [placeB, placeA] }],
    })
  })

  it('projeta arranjos por dia e encadeia versões dos arranjos pendentes', async () => {
    const database = createDatabase()
    const transport = new FakeSyncTransport()
    transport.itineraryVersion = 7
    transport.seedMember(createMember(userA, '1'))
    transport.seedPlace({ ...createPlace(placeA, 'Praça', userA, '2'), dayIndex: 0, position: 0 })
    transport.seedPlace({ ...createPlace(placeB, 'Museu', userA, '3'), dayIndex: 0, position: 1 })
    transport.seedPlace({ ...createPlace(placeC, 'Café', userA, '4'), dayIndex: 1, position: 0 })
    const client = await createClient(database, transport)
    await client.syncNow()

    await client.arrangeItinerary(tripId, [
      { dayIndex: 0, placeIds: [placeB] },
      { dayIndex: 1, placeIds: [] },
    ])
    expect(
      (await client.listPlaces(tripId))
        .map(({ id, dayIndex, position }) => ({ id, dayIndex, position }))
        .sort((left, right) => left.id.localeCompare(right.id)),
    ).toEqual([
      { id: placeA, dayIndex: null, position: null },
      { id: placeB, dayIndex: 0, position: 0 },
      { id: placeC, dayIndex: null, position: null },
    ])

    await client.arrangeItinerary(tripId, [
      { dayIndex: 0, placeIds: [] },
      { dayIndex: 1, placeIds: [placeA] },
    ])
    transport.failBeforePushCall = 1
    await expect(client.syncNow()).rejects.toThrow('falha de rede antes do push')

    expect(
      transport.pushes[0]?.map((operation) =>
        operation.type === 'itinerary.arrange' ? operation.baseVersion : null,
      ),
    ).toEqual([7, 8])
    expect(
      (await client.listPlaces(tripId))
        .map(({ id, dayIndex, position }) => ({ id, dayIndex, position }))
        .sort((left, right) => left.id.localeCompare(right.id)),
    ).toEqual([
      { id: placeA, dayIndex: 1, position: 0 },
      { id: placeB, dayIndex: null, position: null },
      { id: placeC, dayIndex: null, position: null },
    ])
  })

  it('usa versão do arrange aplicado quando outro toque chega antes do pull', async () => {
    const database = createDatabase()
    const transport = new PausedPullSyncTransport()
    transport.seedMember(createMember(userA, '1'))
    transport.seedPlace({ ...createPlace(placeA, 'Praça', userA, '2'), dayIndex: 0, position: 0 })
    transport.seedPlace({ ...createPlace(placeB, 'Museu', userA, '3'), dayIndex: 0, position: 1 })
    const client = await createClient(database, transport)
    await client.syncNow()

    await client.arrangeItinerary(tripId, [{ dayIndex: 0, placeIds: [placeB, placeA] }])
    const pause = transport.pauseNextPull()
    const firstSync = client.syncNow()
    await pause.started

    expect(transport.itineraryVersion).toBe(1)
    expect(
      await database.get<{ count: number } & Record<string, unknown>>(
        'SELECT COUNT(*) AS count FROM outbox WHERE trip_id = ?',
        [tripId],
      ),
    ).toMatchObject({ count: 0 })
    await client.arrangeItinerary(tripId, [{ dayIndex: 0, placeIds: [placeA, placeB] }])
    const pending = await database.get<{ payload: string } & Record<string, unknown>>(
      `SELECT payload FROM outbox WHERE trip_id = ? AND type = 'itinerary.arrange'`,
      [tripId],
    )
    expect(JSON.parse(pending!.payload)).toMatchObject({ baseVersion: 1 })

    pause.release()
    await firstSync
    await client.syncNow()

    expect(await client.listItineraryDrafts(tripId)).toEqual([])
    expect(transport.itineraryVersion).toBe(2)
    expect(canonicalTripState(await readLocalState(database, tripId))).toEqual(
      canonicalTripState(transport.state()),
    )
  })

  it('projeta papel e remoção de membro e reaplica as pendências após pull', async () => {
    const database = createDatabase()
    const transport = new FakeSyncTransport()
    transport.seedMember({ ...createMember(userA, '1'), role: 'organizer' })
    transport.seedMember(createMember(userB, '2'))
    const client = await createClient(database, transport)
    await client.syncNow()

    await client.setMemberRole(tripId, userB, 'coorganizer')
    expect(await client.listMembers(tripId)).toContainEqual({
      userId: userB,
      role: 'coorganizer',
      joinedAt: fixedTime,
      openedAt: null,
    })

    transport.rejectReason = 'invalid'
    await client.syncNow()
    expect(await client.listMembers(tripId)).toContainEqual({
      userId: userB,
      role: 'coorganizer',
      joinedAt: fixedTime,
      openedAt: null,
    })

    await client.removeMember(tripId, userB)
    expect(await client.listMembers(tripId)).toEqual([
      { userId: userA, role: 'organizer', joinedAt: fixedTime, openedAt: null },
    ])
    await client.syncNow()
    expect(await client.listMembers(tripId)).toEqual([
      { userId: userA, role: 'organizer', joinedAt: fixedTime, openedAt: null },
    ])
    expect(client.getStatus()).toMatchObject({ pending: 2, notSent: 0 })
  })

  it('sincroniza candidato, confirmação do Google e detalhes locais sem token no registro', async () => {
    const database = createDatabase()
    const transport = new FakeSyncTransport()
    const client = await createClient(database, transport)

    const placeId = await client.addPlaceFromCandidate(tripId, signedCandidate)
    expect(await client.listPlaces(tripId)).toEqual([
      expect.objectContaining({
        id: placeId,
        provider: 'geoapify',
        providerRef: 'geo-123',
        countryCode: 'cn',
        providerDatasource: 'openstreetmap',
        attribution: '© OpenStreetMap contributors',
        license: 'ODbL',
        googleMatch: 'none',
        localNameStatus: 'ok',
        localAddressStatus: 'ok',
      }),
    ])
    const storedColumns = await database.all<{ name: string } & Record<string, unknown>>(
      'PRAGMA table_info(places)',
    )
    expect(storedColumns.map(({ name }) => name)).not.toContain('token')
    expect(storedColumns.map(({ name }) => name)).toContain('country_code')
    expect(
      await database.get<{ country_code: string | null } & Record<string, unknown>>(
        'SELECT country_code FROM places WHERE id = ?',
        [placeId],
      ),
    ).toEqual({ country_code: 'cn' })

    await client.syncNow()
    await client.linkGooglePlace(tripId, placeId, 'ChIJgUbEo8cfqokR5lP9_Wh_DaM')
    await client.setLocalDetails(tripId, placeId, {
      localName: 'Forbidden City',
      localAddress: '4 Jingshan Front St',
    })
    expect(await client.listPlaces(tripId)).toEqual([
      expect.objectContaining({
        countryCode: 'cn',
        googlePlaceId: 'ChIJgUbEo8cfqokR5lP9_Wh_DaM',
        googleMatch: 'matched',
        userLocalName: 'Forbidden City',
        userLocalAddress: '4 Jingshan Front St',
        localNameStatus: 'not_local_language',
        localAddressStatus: 'not_local_language',
      }),
    ])
    await client.syncNow()
    expect(transport.state().places[0]).toMatchObject({
      provider: 'geoapify',
      providerRef: 'geo-123',
      userLocalName: 'Forbidden City',
      userLocalAddress: '4 Jingshan Front St',
      googlePlaceId: 'ChIJgUbEo8cfqokR5lP9_Wh_DaM',
      googleMatch: 'matched',
    })

    await client.linkGooglePlace(tripId, placeId, null)
    await client.syncNow()
    expect(await client.listPlaces(tripId)).toEqual([
      expect.objectContaining({ googlePlaceId: null, googleMatch: 'no_match' }),
    ])

    const manualPlaceId = await client.addPlace(tripId, 'Lugar manual')
    expect(await client.listPlaces(tripId)).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: manualPlaceId, countryCode: null })]),
    )
  })

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
    transport.itineraryVersion = 2
    await client.markVisit(tripId, placeA)
    transport.failBeforePullCall = transport.pulls.length + 2

    await expect(client.syncNow()).rejects.toThrow('falha de rede durante o pull')
    expect(
      await database.get<
        { needs_bootstrap: number; snapshot_seq: string | null } & Record<string, unknown>
      >('SELECT needs_bootstrap, snapshot_seq FROM sync_state WHERE trip_id = ?', [tripId]),
    ).toMatchObject({ needs_bootstrap: 1, snapshot_seq: '3' })
    expect(
      await database.get<{ itinerary_version: number | null } & Record<string, unknown>>(
        'SELECT itinerary_version FROM sync_state WHERE trip_id = ?',
        [tripId],
      ),
    ).toMatchObject({ itinerary_version: 0 })

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
    expect(
      await database.get<{ itinerary_version: number | null } & Record<string, unknown>>(
        'SELECT itinerary_version FROM sync_state WHERE trip_id = ?',
        [tripId],
      ),
    ).toMatchObject({ itinerary_version: 2 })
  })

  it('refaz o bootstrap do zero quando duplicate chega com snapshot parcial', async () => {
    const database = createDatabase()
    const transport = new FakeSyncTransport()
    transport.seedMember(createMember(userA, '1'))
    transport.seedPlace(createPlace(placeA, 'Jardim', userA, '2'))
    transport.seedVisit(createVisit(placeA, userA, '3', '2026-10-20T09:30:00.000Z'))
    transport.seedPlace(createPlace(placeB, 'Museu', userA, '4'))
    const client = await createClient(database, transport, userA, undefined, { pageSize: 1 })
    transport.failBeforePullCall = 4

    await expect(client.syncNow()).rejects.toThrow('falha de rede durante o pull')
    expect(
      await database.get<{ snapshot_seq: string | null } & Record<string, unknown>>(
        'SELECT snapshot_seq FROM sync_state WHERE trip_id = ?',
        [tripId],
      ),
    ).toMatchObject({ snapshot_seq: '4' })

    transport.failBeforePullCall = null
    await client.markVisit(tripId, placeA)
    await client.syncNow()

    expect(client.getStatus().pending).toBe(0)
    expect(canonicalTripState(await readLocalState(database, tripId))).toEqual(
      canonicalTripState(transport.state()),
    )
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

  it('projeta quero ir offline, conta só reações vivas e mantém want/unwant idempotentes', async () => {
    const database = createDatabase()
    const transport = new FakeSyncTransport()
    transport.seedMember(createMember(userA, '1'))
    transport.seedMember(createMember(userB, '2'))
    transport.seedPlace(createPlace(placeA, 'Jardim', userA, '3'))
    transport.seedWant(createWant(placeA, userB, '4'))
    const client = await createClient(database, transport)
    await client.syncNow()
    expect(await client.listPlaces(tripId)).toMatchObject([
      { id: placeA, wantCount: 1, wantedByMe: false },
    ])

    await client.wantPlace(tripId, placeA)
    await client.wantPlace(tripId, placeA)
    expect(await client.listPlaces(tripId)).toMatchObject([{ wantCount: 2, wantedByMe: true }])

    await client.unwantPlace(tripId, placeA)
    await client.unwantPlace(tripId, placeA)
    expect(await client.listPlaces(tripId)).toMatchObject([{ wantCount: 1, wantedByMe: false }])

    await client.syncNow()
    expect(canonicalTripState(await readLocalState(database, tripId))).toEqual(
      canonicalTripState(transport.state()),
    )
    expect(await client.listPlaces(tripId)).toMatchObject([{ wantCount: 1, wantedByMe: false }])
  })

  it('projeta favorito, nota e observação offline e calcula a média só com duas avaliações', async () => {
    const database = createDatabase()
    const transport = new FakeSyncTransport()
    transport.seedMember(createMember(userA, '1'))
    transport.seedMember(createMember(userB, '2'))
    transport.seedPlace(createPlace(placeA, 'Jardim', userA, '3'))
    transport.seedReview(
      createReview(placeA, userB, '4', { favorite: true, rating: 5, note: 'Lindo' }),
    )
    const client = await createClient(database, transport)
    await client.syncNow()

    expect(await client.getPlaceDetail(tripId, placeA)).toEqual({
      place: expect.objectContaining({ id: placeA, favoriteByMe: false }),
      favoriteByMe: false,
      myRating: null,
      myNote: null,
      favoriteCount: 1,
      ratingCount: 1,
      ratingAverage: null,
      notes: [{ userId: userB, note: 'Lindo' }],
      visitors: [],
    })

    await client.setFavorite(tripId, placeA, true)
    await client.ratePlace(tripId, placeA, 4)
    await client.setPlaceNote(tripId, placeA, '  Mirante  ')
    expect(await client.getPlaceDetail(tripId, placeA)).toMatchObject({
      favoriteByMe: true,
      myRating: 4,
      myNote: 'Mirante',
      favoriteCount: 2,
      ratingCount: 2,
      ratingAverage: 4.5,
      notes: [{ userId: userB, note: 'Lindo' }],
    })
    expect(await client.listPlaces(tripId)).toMatchObject([{ id: placeA, favoriteByMe: true }])

    await client.ratePlace(tripId, placeA, null)
    await client.setPlaceNote(tripId, placeA, '   ')
    expect(await client.getPlaceDetail(tripId, placeA)).toMatchObject({
      myRating: null,
      myNote: null,
      ratingCount: 1,
      ratingAverage: null,
    })

    await client.setFavorite(tripId, placeA, false)
    await client.ratePlace(tripId, placeA, 3)
    await client.syncNow()
    expect(canonicalTripState(await readLocalState(database, tripId))).toEqual(
      canonicalTripState(transport.state()),
    )
    expect(await client.getPlaceDetail(tripId, placeA)).toMatchObject({
      favoriteByMe: false,
      myRating: 3,
      ratingAverage: 4,
    })
    expect(await client.getPlaceDetail(tripId, placeB)).toBeNull()
  })

  it('marca visita de outra pessoa guardando quem marcou e converge após desmarcar', async () => {
    const database = createDatabase()
    const transport = new FakeSyncTransport()
    transport.seedMember(createMember(userA, '1'))
    transport.seedMember(createMember(userB, '2'))
    transport.seedPlace(createPlace(placeA, 'Jardim', userA, '3'))
    const client = await createClient(database, transport)
    await client.syncNow()

    await client.markVisit(tripId, placeA, userB)
    expect(await client.listPlaces(tripId)).toMatchObject([{ visitedByMe: false }])
    expect(await client.getPlaceDetail(tripId, placeA)).toMatchObject({
      visitors: [{ userId: userB, markedBy: userA }],
    })
    await client.syncNow()
    expect(transport.visits.get(`${placeA}:${userB}`)).toMatchObject({
      userId: userB,
      markedBy: userA,
      deletedAt: null,
    })

    await client.unmarkVisit(tripId, placeA, userB)
    await client.syncNow()
    expect(transport.visits.get(`${placeA}:${userB}`)?.deletedAt).not.toBeNull()
    expect(canonicalTripState(await readLocalState(database, tripId))).toEqual(
      canonicalTripState(transport.state()),
    )
  })

  it('converge notas, favoritos e avaliações de dois clientes contra o mesmo servidor', async () => {
    const databaseA = createDatabase()
    const databaseB = createDatabase()
    const server = new FakeSyncTransport()
    server.seedMember(createMember(userA, '1'))
    server.seedMember(createMember(userB, '2'))
    server.seedPlace(createPlace(placeA, 'Jardim', userA, '3'))
    // Op ids aleatórios: o servidor compartilhado não pode ver ids repetidos entre clientes.
    const randomIds = { idGenerator: () => globalThis.crypto.randomUUID() }
    const clientA = await createClient(databaseA, server, userA, () => [tripId], randomIds)
    const transportB = new FakeSyncTransport(userB, 100, server.sharedState)
    const clientB = await createClient(databaseB, transportB, userB, () => [tripId], randomIds)
    await clientA.syncNow()
    await clientB.syncNow()

    await clientA.setFavorite(tripId, placeA, true)
    await clientA.ratePlace(tripId, placeA, 5)
    await clientB.ratePlace(tripId, placeA, 3)
    await clientB.setPlaceNote(tripId, placeA, 'Chegue cedo')
    await clientA.syncNow()
    await clientB.syncNow()
    await clientA.syncNow()

    expect(canonicalTripState(await readLocalState(databaseA, tripId))).toEqual(
      canonicalTripState(server.state()),
    )
    expect(canonicalTripState(await readLocalState(databaseB, tripId))).toEqual(
      canonicalTripState(server.state()),
    )
    expect(await clientA.getPlaceDetail(tripId, placeA)).toMatchObject({
      favoriteCount: 1,
      ratingCount: 2,
      ratingAverage: 4,
      notes: [{ userId: userB, note: 'Chegue cedo' }],
    })
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

  it('marca viagem removida, retém pendências não enviadas e espera redescoberta', async () => {
    const database = createDatabase()
    const transport = new FakeSyncTransport()
    transport.seedMember(createMember(userA, '1'))
    transport.seedMember(createMember(userB, '2'))
    transport.seedPlace(createPlace(placeA, 'Roteiro', userB, '3'))
    let discoveredTrips: readonly UUID[] = [tripId]
    const client = await createClient(database, transport, userA, () => discoveredTrips)
    await client.syncNow()

    await client.addPlace(tripId, 'Pendente')
    await client.markVisit(tripId, placeA)
    transport.rejectReason = 'not_member'
    transport.notMemberOnPull = true
    await client.syncNow()

    expect(client.getStatus()).toMatchObject({ pending: 0, notSent: 2 })
    expect(await client.listPlaces(tripId)).toEqual([])
    expect(await client.listMembers(tripId)).toEqual([])
    expect(await client.listRemovedTrips()).toEqual([tripId])
    const clientWithNotSentCount = client as typeof client & {
      countNotSent: (requestedTripId: UUID) => Promise<number>
    }
    expect(await clientWithNotSentCount.countNotSent(tripId)).toBe(2)
    expect(await clientWithNotSentCount.countNotSent(otherTripId)).toBe(0)
    expect(
      await database.all<{ status: string } & Record<string, unknown>>(
        'SELECT status FROM outbox ORDER BY position',
      ),
    ).toEqual([{ status: 'not_sent' }, { status: 'not_sent' }])

    discoveredTrips = []
    transport.notMemberOnPull = false
    const previousPullCount = transport.pulls.length
    await client.syncNow()
    expect(transport.pulls).toHaveLength(previousPullCount)
    expect(transport.pushes).toHaveLength(1)

    discoveredTrips = [tripId]
    await client.syncNow()
    expect(
      transport.pulls.slice(previousPullCount).some((query) => query.mode === 'bootstrap'),
    ).toBe(true)
    expect(await client.listRemovedTrips()).toEqual([])
    expect(await client.listPlaces(tripId)).toEqual([
      expect.objectContaining({ id: placeA, name: 'Roteiro' }),
    ])
    expect(client.getStatus()).toMatchObject({ pending: 0, notSent: 2 })
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
  const [places, visits, wants, reviews, members] = await Promise.all([
    database.all<
      Record<string, unknown> & {
        id: UUID
        trip_id: UUID
        provider: string | null
        provider_ref: string | null
        country_code: string | null
        provider_datasource: string | null
        attribution: string | null
        license: string | null
        name: string
        local_name: string | null
        address: string | null
        local_address: string | null
        google_place_id: string | null
        google_match: SyncPlace['googleMatch']
        user_local_name: string | null
        user_local_address: string | null
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
        place_id: UUID
        trip_id: UUID
        user_id: UUID
        created_at: string
        seq: string
        deleted_at: string | null
      }
    >('SELECT * FROM wants WHERE trip_id = ?', [requestedTripId]),
    database.all<
      Record<string, unknown> & {
        place_id: UUID
        trip_id: UUID
        user_id: UUID
        favorite: number
        rating: number | null
        note: string | null
        updated_at: string
        seq: string
        deleted_at: string | null
      }
    >('SELECT * FROM reviews WHERE trip_id = ?', [requestedTripId]),
    database.all<
      Record<string, unknown> & {
        trip_id: UUID
        user_id: UUID
        role: SyncMember['role']
        joined_at: string
        opened_at: string | null
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
      countryCode: row.country_code,
      providerDatasource: row.provider_datasource,
      attribution: row.attribution,
      license: row.license,
      name: row.name,
      localName: row.local_name,
      address: row.address,
      localAddress: row.local_address,
      googlePlaceId: row.google_place_id,
      googleMatch: row.google_match,
      userLocalName: row.user_local_name,
      userLocalAddress: row.user_local_address,
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
    wants: wants.map((row) => ({
      placeId: row.place_id,
      tripId: row.trip_id,
      userId: row.user_id,
      createdAt: row.created_at,
      seq: String(row.seq),
      deletedAt: row.deleted_at,
    })),
    reviews: reviews.map((row) => ({
      placeId: row.place_id,
      tripId: row.trip_id,
      userId: row.user_id,
      favorite: row.favorite === 1,
      rating: row.rating,
      note: row.note,
      updatedAt: row.updated_at,
      seq: String(row.seq),
      deletedAt: row.deleted_at,
    })),
    members: members.map((row) => ({
      tripId: row.trip_id,
      userId: row.user_id,
      role: row.role,
      joinedAt: row.joined_at,
      openedAt: row.opened_at,
      seq: String(row.seq),
      deletedAt: row.deleted_at,
    })),
  }
}
