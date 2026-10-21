import { canConfirmGooglePlace, canRemovePlace } from '@trippy/domain/places'
import { verifyPlaceSearchCandidate } from '../places/candidate-token.ts'
import type {
  PullQuery,
  PullResponse,
  PushOperationResult,
  SyncMember,
  SyncOperation,
  SyncPlace,
  SyncSequence,
  SyncVisit,
} from '@trippy/sync'
import type { Pool, PoolClient } from 'pg'

export interface SyncStore {
  applyOperation(userId: string, operation: SyncOperation): Promise<PushOperationResult>
  pull(userId: string, query: PullQuery): Promise<PullResponse | null>
}

interface TripRow {
  id: string
  timezone: string
  seq_counter: string
}

interface AppliedOperationRow {
  user_id: string
  result: PushOperationResult
}

interface PlaceLookupRow {
  trip_id: string
  suggested_by: string
  deleted_at: Date | null
  google_place_id?: string | null
  google_match?: SyncPlace['googleMatch']
  user_local_name?: string | null
  user_local_address?: string | null
}

interface VisitLookupRow {
  deleted_at: Date | null
}

interface PullTripRow {
  seq_counter: string
  sync_floor_seq: string
}

interface PullPlaceRow extends Omit<SyncPlace, 'createdAt' | 'deletedAt'> {
  createdAt: Date
  deletedAt: Date | null
}

interface PullVisitRow extends Omit<SyncVisit, 'visitedAt' | 'deletedAt'> {
  visitedAt: Date
  deletedAt: Date | null
}

interface PullMemberRow extends Omit<SyncMember, 'joinedAt' | 'deletedAt'> {
  joinedAt: Date
  deletedAt: Date | null
}

type PullRecord =
  | { kind: 'place'; seq: SyncSequence; id: string; value: SyncPlace }
  | { kind: 'visit'; seq: SyncSequence; id: string; value: SyncVisit }
  | { kind: 'member'; seq: SyncSequence; id: string; value: SyncMember }

class OperationIdRaceError extends Error {}

async function inTransaction<T>(client: PoolClient, operation: () => Promise<T>): Promise<T> {
  await client.query('BEGIN')
  try {
    const value = await operation()
    await client.query('COMMIT')
    return value
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  }
}

function duplicateResult(operation: SyncOperation): PushOperationResult {
  return { opId: operation.opId, status: 'duplicate' }
}

function rejectedResult(
  operation: SyncOperation,
  reason: Extract<PushOperationResult, { status: 'rejected' }>['reason'],
): PushOperationResult {
  return { opId: operation.opId, status: 'rejected', reason }
}

function replayResult(
  userId: string,
  operation: SyncOperation,
  prior: AppliedOperationRow,
): PushOperationResult {
  if (prior.user_id !== userId) return rejectedResult(operation, 'invalid')
  if (prior.result.status === 'rejected') {
    return { ...prior.result, opId: operation.opId }
  }
  return duplicateResult(operation)
}

async function findAppliedOperation(
  client: PoolClient,
  opId: string,
): Promise<AppliedOperationRow | null> {
  const result = await client.query<AppliedOperationRow>(
    'SELECT user_id, result FROM applied_ops WHERE op_id = $1',
    [opId],
  )
  return result.rows[0] ?? null
}

async function nextSequence(client: PoolClient, tripId: string): Promise<SyncSequence> {
  const result = await client.query<{ seq_counter: string }>(
    'UPDATE trips SET seq_counter = seq_counter + 1 WHERE id = $1 RETURNING seq_counter::text AS seq_counter',
    [tripId],
  )
  return result.rows[0]!.seq_counter
}

async function storeResult(
  client: PoolClient,
  userId: string,
  operation: SyncOperation,
  result: PushOperationResult,
): Promise<void> {
  const inserted = await client.query(
    `INSERT INTO applied_ops (op_id, user_id, trip_id, result)
     VALUES ($1, $2, $3, $4::jsonb)
     ON CONFLICT (op_id) DO NOTHING
     RETURNING op_id`,
    [operation.opId, userId, operation.tripId, JSON.stringify(result)],
  )
  if ((inserted.rowCount ?? 0) === 0) throw new OperationIdRaceError()
}

async function applyPlaceAdd(
  client: PoolClient,
  userId: string,
  operation: Extract<SyncOperation, { type: 'place.add' }>,
  trip: TripRow,
  candidateSecret: string,
): Promise<PushOperationResult> {
  if (operation.candidate && !verifyPlaceSearchCandidate(operation.candidate, candidateSecret)) {
    return rejectedResult(operation, 'invalid')
  }

  const existing = await client.query<PlaceLookupRow>(
    'SELECT trip_id, suggested_by, deleted_at FROM places WHERE id = $1',
    [operation.placeId],
  )
  const existingPlace = existing.rows[0]
  if (existingPlace) {
    return existingPlace.trip_id === operation.tripId
      ? duplicateResult(operation)
      : rejectedResult(operation, 'invalid')
  }

  const sequence = (BigInt(trip.seq_counter) + 1n).toString()
  const inserted = await client.query(
    `INSERT INTO places (
       id, trip_id, provider, provider_ref, provider_datasource, attribution, license,
       name, local_name, address, local_address, lat, lng, suggested_by, seq
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
     ON CONFLICT (id) DO NOTHING
     RETURNING id`,
    [
      operation.placeId,
      operation.tripId,
      operation.candidate?.provider ?? null,
      operation.candidate?.providerRef ?? null,
      operation.candidate?.datasource ?? null,
      operation.candidate?.attribution ?? null,
      operation.candidate?.license ?? null,
      operation.candidate?.name ?? operation.name,
      operation.candidate?.localName ?? null,
      operation.candidate?.address ?? null,
      operation.candidate?.localAddress ?? null,
      operation.candidate?.lat ?? null,
      operation.candidate?.lng ?? null,
      userId,
      sequence,
    ],
  )
  if ((inserted.rowCount ?? 0) === 0) {
    const conflict = await client.query<{ trip_id: string }>(
      'SELECT trip_id FROM places WHERE id = $1',
      [operation.placeId],
    )
    return conflict.rows[0]?.trip_id === operation.tripId
      ? duplicateResult(operation)
      : rejectedResult(operation, 'invalid')
  }

  await nextSequence(client, operation.tripId)
  return { opId: operation.opId, status: 'applied' }
}

async function applyPlaceRemove(
  client: PoolClient,
  userId: string,
  role: SyncMember['role'],
  operation: Extract<SyncOperation, { type: 'place.remove' }>,
): Promise<PushOperationResult> {
  const selected = await client.query<PlaceLookupRow>(
    'SELECT trip_id, suggested_by, deleted_at FROM places WHERE id = $1 FOR UPDATE',
    [operation.placeId],
  )
  const place = selected.rows[0]
  if (!place || place.trip_id !== operation.tripId) return rejectedResult(operation, 'invalid')
  if (place.deleted_at) return duplicateResult(operation)
  if (!canRemovePlace({ role, userId, suggestedBy: place.suggested_by })) {
    return rejectedResult(operation, 'forbidden')
  }

  const placeSequence = await nextSequence(client, operation.tripId)
  await client.query('UPDATE places SET deleted_at = now(), seq = $2 WHERE id = $1', [
    operation.placeId,
    placeSequence,
  ])

  const liveVisits = await client.query<{ user_id: string }>(
    `SELECT user_id FROM visits
     WHERE trip_id = $1 AND place_id = $2 AND deleted_at IS NULL
     ORDER BY user_id
     FOR UPDATE`,
    [operation.tripId, operation.placeId],
  )
  for (const visit of liveVisits.rows) {
    const visitSequence = await nextSequence(client, operation.tripId)
    await client.query(
      `UPDATE visits SET deleted_at = now(), seq = $3
       WHERE place_id = $1 AND user_id = $2`,
      [operation.placeId, visit.user_id, visitSequence],
    )
  }
  return { opId: operation.opId, status: 'applied' }
}

async function applyVisit(
  client: PoolClient,
  userId: string,
  operation: Extract<SyncOperation, { type: 'visit.mark' | 'visit.unmark' }>,
  timezone: string,
): Promise<PushOperationResult> {
  const placeResult = await client.query<PlaceLookupRow>(
    'SELECT trip_id, suggested_by, deleted_at FROM places WHERE id = $1',
    [operation.placeId],
  )
  const place = placeResult.rows[0]
  if (!place || place.trip_id !== operation.tripId) return rejectedResult(operation, 'invalid')

  const selected = await client.query<VisitLookupRow>(
    `SELECT deleted_at FROM visits
     WHERE place_id = $1 AND user_id = $2
     FOR UPDATE`,
    [operation.placeId, userId],
  )
  const visit = selected.rows[0]

  if (operation.type === 'visit.mark') {
    if (place.deleted_at) return rejectedResult(operation, 'invalid')
    if (visit && !visit.deleted_at) return duplicateResult(operation)

    const sequence = await nextSequence(client, operation.tripId)
    if (visit) {
      await client.query(
        `UPDATE visits
         SET marked_by = $3, visited_at = now(), visited_tz = $4, seq = $5, deleted_at = NULL
         WHERE place_id = $1 AND user_id = $2`,
        [operation.placeId, userId, userId, timezone, sequence],
      )
    } else {
      await client.query(
        `INSERT INTO visits (place_id, trip_id, user_id, marked_by, visited_at, visited_tz, seq)
         VALUES ($1, $2, $3, $3, now(), $4, $5)`,
        [operation.placeId, operation.tripId, userId, timezone, sequence],
      )
    }
    return { opId: operation.opId, status: 'applied' }
  }

  if (!visit || visit.deleted_at) return duplicateResult(operation)
  const sequence = await nextSequence(client, operation.tripId)
  await client.query(
    'UPDATE visits SET deleted_at = now(), seq = $3 WHERE place_id = $1 AND user_id = $2',
    [operation.placeId, userId, sequence],
  )
  return { opId: operation.opId, status: 'applied' }
}

async function applyGoogleLink(
  client: PoolClient,
  userId: string,
  role: SyncMember['role'],
  operation: Extract<SyncOperation, { type: 'place.google_link' }>,
): Promise<PushOperationResult> {
  const selected = await client.query<PlaceLookupRow>(
    `SELECT trip_id, suggested_by, deleted_at, google_place_id, google_match
     FROM places WHERE id = $1 FOR UPDATE`,
    [operation.placeId],
  )
  const place = selected.rows[0]
  if (!place || place.trip_id !== operation.tripId || place.deleted_at) {
    return rejectedResult(operation, 'invalid')
  }
  if (!canConfirmGooglePlace({ role, userId, suggestedBy: place.suggested_by })) {
    return rejectedResult(operation, 'forbidden')
  }

  const googleMatch = operation.googlePlaceId === null ? 'no_match' : 'matched'
  if (place.google_place_id === operation.googlePlaceId && place.google_match === googleMatch) {
    return duplicateResult(operation)
  }

  const sequence = await nextSequence(client, operation.tripId)
  await client.query(
    `UPDATE places SET google_place_id = $2, google_match = $3, seq = $4
     WHERE id = $1`,
    [operation.placeId, operation.googlePlaceId, googleMatch, sequence],
  )
  return { opId: operation.opId, status: 'applied' }
}

async function applyLocalDetails(
  client: PoolClient,
  operation: Extract<SyncOperation, { type: 'place.set_local' }>,
): Promise<PushOperationResult> {
  const selected = await client.query<PlaceLookupRow>(
    `SELECT trip_id, suggested_by, deleted_at, user_local_name, user_local_address
     FROM places WHERE id = $1 FOR UPDATE`,
    [operation.placeId],
  )
  const place = selected.rows[0]
  if (!place || place.trip_id !== operation.tripId || place.deleted_at) {
    return rejectedResult(operation, 'invalid')
  }

  const hasLocalName = Object.hasOwn(operation, 'localName')
  const hasLocalAddress = Object.hasOwn(operation, 'localAddress')
  const localName = hasLocalName ? (operation.localName ?? null) : (place.user_local_name ?? null)
  const localAddress = hasLocalAddress
    ? (operation.localAddress ?? null)
    : (place.user_local_address ?? null)
  if (localName === place.user_local_name && localAddress === place.user_local_address) {
    return duplicateResult(operation)
  }

  const sequence = await nextSequence(client, operation.tripId)
  await client.query(
    `UPDATE places SET
       user_local_name = CASE WHEN $2::boolean THEN $3::text ELSE user_local_name END,
       user_local_address = CASE WHEN $4::boolean THEN $5::text ELSE user_local_address END,
       seq = $6
     WHERE id = $1`,
    [operation.placeId, hasLocalName, localName, hasLocalAddress, localAddress, sequence],
  )
  return { opId: operation.opId, status: 'applied' }
}

async function applyNewOperation(
  client: PoolClient,
  userId: string,
  operation: SyncOperation,
  trip: TripRow,
  role: SyncMember['role'],
  candidateSecret: string,
): Promise<PushOperationResult> {
  switch (operation.type) {
    case 'place.add':
      return applyPlaceAdd(client, userId, operation, trip, candidateSecret)
    case 'place.remove':
      return applyPlaceRemove(client, userId, role, operation)
    case 'place.google_link':
      return applyGoogleLink(client, userId, role, operation)
    case 'place.set_local':
      return applyLocalDetails(client, operation)
    case 'visit.mark':
    case 'visit.unmark':
      return applyVisit(client, userId, operation, trip.timezone)
  }
}

async function listPageRows<T extends PullPlaceRow | PullVisitRow | PullMemberRow>(
  client: Pool | PoolClient,
  table: 'places' | 'visits' | 'trip_members',
  columns: string,
  liveColumn: 'deleted_at' | 'left_at',
  tripId: string,
  cursor: string,
  snapshotSeq: string,
  limit: number,
  bootstrap: boolean,
): Promise<T[]> {
  const liveFilter = bootstrap ? `AND ${liveColumn} IS NULL` : ''
  const result = await client.query<T>(
    `SELECT ${columns} FROM ${table}
     WHERE trip_id = $1 AND seq > $2 AND seq <= $3 ${liveFilter}
     ORDER BY ${table}.seq
     LIMIT $4`,
    [tripId, cursor, snapshotSeq, limit],
  )
  return result.rows
}

function comparePullRecords(left: PullRecord, right: PullRecord): number {
  const leftSeq = BigInt(left.seq)
  const rightSeq = BigInt(right.seq)
  if (leftSeq !== rightSeq) return leftSeq < rightSeq ? -1 : 1
  const kindOrder = { member: 0, place: 1, visit: 2 } as const
  const kindDifference = kindOrder[left.kind] - kindOrder[right.kind]
  return kindDifference || left.id.localeCompare(right.id)
}

export class PostgresSyncStore implements SyncStore {
  constructor(
    private readonly pool: Pool,
    private readonly candidateSecret: string,
  ) {
    if (!candidateSecret) throw new Error('PLACES_CANDIDATE_SECRET é obrigatório.')
  }

  async applyOperation(userId: string, operation: SyncOperation): Promise<PushOperationResult> {
    const client = await this.pool.connect()
    try {
      try {
        return await inTransaction(client, async () => {
          const prior = await findAppliedOperation(client, operation.opId)
          if (prior) {
            return replayResult(userId, operation, prior)
          }

          const tripResult = await client.query<TripRow>(
            `SELECT id, timezone, seq_counter::text AS seq_counter
             FROM trips
             WHERE id = $1 AND deleted_at IS NULL
             FOR UPDATE`,
            [operation.tripId],
          )
          const trip = tripResult.rows[0]
          if (!trip) return rejectedResult(operation, 'not_member')

          const afterLock = await findAppliedOperation(client, operation.opId)
          if (afterLock) {
            return replayResult(userId, operation, afterLock)
          }

          const memberResult = await client.query<{ role: SyncMember['role'] }>(
            `SELECT role FROM trip_members
             WHERE trip_id = $1 AND user_id = $2 AND left_at IS NULL
             FOR UPDATE`,
            [operation.tripId, userId],
          )
          const member = memberResult.rows[0]
          const result = member
            ? await applyNewOperation(
                client,
                userId,
                operation,
                trip,
                member.role,
                this.candidateSecret,
              )
            : rejectedResult(operation, 'not_member')

          await storeResult(client, userId, operation, result)
          return result
        })
      } catch (error) {
        if (!(error instanceof OperationIdRaceError)) throw error
        const prior = await findAppliedOperation(client, operation.opId)
        if (!prior) throw error
        return replayResult(userId, operation, prior)
      }
    } finally {
      client.release()
    }
  }

  async pull(userId: string, query: PullQuery): Promise<PullResponse | null> {
    const tripResult = await this.pool.query<PullTripRow>(
      `SELECT trips.seq_counter::text AS seq_counter,
              trips.sync_floor_seq::text AS sync_floor_seq
       FROM trips
       JOIN trip_members ON trip_members.trip_id = trips.id
       WHERE trips.id = $1
         AND trips.deleted_at IS NULL
         AND trip_members.user_id = $2
         AND trip_members.left_at IS NULL`,
      [query.tripId, userId],
    )
    const trip = tripResult.rows[0]
    if (!trip) return null

    const bootstrap = query.mode === 'bootstrap'
    const firstBootstrapPage = bootstrap && !('snapshotSeq' in query)
    const snapshotSeq = bootstrap
      ? firstBootstrapPage
        ? trip.seq_counter
        : query.snapshotSeq
      : trip.seq_counter
    const cursor = bootstrap ? (firstBootstrapPage ? '0' : query.cursor) : query.cursor
    const currentSeq = BigInt(trip.seq_counter)
    const floorSeq = BigInt(trip.sync_floor_seq)
    const cursorSeq = BigInt(cursor)
    const snapshotValue = BigInt(snapshotSeq)

    if (cursorSeq > currentSeq || (!firstBootstrapPage && cursorSeq < floorSeq)) {
      return { error: 'bootstrap_required' }
    }
    if (bootstrap && (snapshotValue > currentSeq || cursorSeq > snapshotValue)) {
      return { error: 'bootstrap_required' }
    }
    if (!firstBootstrapPage && bootstrap && snapshotValue < floorSeq) {
      return { error: 'bootstrap_required' }
    }

    const pageLimit = query.limit
    const selectedLimit = pageLimit + 1
    const [placeRows, visitRows, memberRows] = await Promise.all([
      listPageRows<PullPlaceRow>(
        this.pool,
        'places',
        `id, trip_id AS "tripId", provider, provider_ref AS "providerRef",
         provider_datasource AS "providerDatasource", attribution, license, name,
         local_name AS "localName", address, local_address AS "localAddress", lat, lng,
         google_place_id AS "googlePlaceId", google_match AS "googleMatch",
         user_local_name AS "userLocalName", user_local_address AS "userLocalAddress",
         suggested_by AS "suggestedBy", comment, day_index AS "dayIndex", position,
         seq::text AS seq, deleted_at AS "deletedAt", created_at AS "createdAt"`,
        'deleted_at',
        query.tripId,
        cursor,
        snapshotSeq,
        selectedLimit,
        bootstrap,
      ),
      listPageRows<PullVisitRow>(
        this.pool,
        'visits',
        `place_id AS "placeId", trip_id AS "tripId", user_id AS "userId",
         marked_by AS "markedBy", visited_at AS "visitedAt", visited_tz AS "visitedTz",
         seq::text AS seq, deleted_at AS "deletedAt"`,
        'deleted_at',
        query.tripId,
        cursor,
        snapshotSeq,
        selectedLimit,
        bootstrap,
      ),
      listPageRows<PullMemberRow>(
        this.pool,
        'trip_members',
        `trip_id AS "tripId", user_id AS "userId", role, joined_at AS "joinedAt",
         seq::text AS seq, left_at AS "deletedAt"`,
        'left_at',
        query.tripId,
        cursor,
        snapshotSeq,
        selectedLimit,
        bootstrap,
      ),
    ])
    const records: PullRecord[] = [
      ...placeRows.map((row) => {
        const value: SyncPlace = {
          ...row,
          createdAt: row.createdAt.toISOString(),
          deletedAt: row.deletedAt?.toISOString() ?? null,
        }
        return { kind: 'place' as const, seq: value.seq, id: value.id, value }
      }),
      ...visitRows.map((row) => {
        const value: SyncVisit = {
          ...row,
          visitedAt: row.visitedAt.toISOString(),
          deletedAt: row.deletedAt?.toISOString() ?? null,
        }
        return {
          kind: 'visit' as const,
          seq: value.seq,
          id: `${value.placeId}:${value.userId}`,
          value,
        }
      }),
      ...memberRows.map((row) => {
        const value: SyncMember = {
          ...row,
          joinedAt: row.joinedAt.toISOString(),
          deletedAt: row.deletedAt?.toISOString() ?? null,
        }
        return { kind: 'member' as const, seq: value.seq, id: value.userId, value }
      }),
    ].sort(comparePullRecords)
    const hasMore = records.length > pageLimit
    const page = records.slice(0, pageLimit)
    const nextCursor = hasMore ? page.at(-1)!.seq : snapshotSeq

    const responseData = {
      places: page.flatMap((record) => (record.kind === 'place' ? [record.value] : [])),
      visits: page.flatMap((record) => (record.kind === 'visit' ? [record.value] : [])),
      members: page.flatMap((record) => (record.kind === 'member' ? [record.value] : [])),
      nextCursor,
      hasMore,
    }

    return bootstrap
      ? { mode: 'bootstrap', snapshotSeq, ...responseData }
      : { mode: 'incremental', ...responseData }
  }
}
