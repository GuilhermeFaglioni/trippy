import { canEditItinerary, canRemoveMember, canSetMemberRole, type Member } from '@trippy/domain'
import { canConfirmGooglePlace, canRemovePlace } from '@trippy/domain/places'
import { verifyPlaceSearchCandidate } from '../places/candidate-token.ts'
import type {
  PullQuery,
  PullResponse,
  PushOperationResult,
  SyncMember,
  SyncOperation,
  SyncPlace,
  SyncReview,
  SyncSequence,
  SyncVisit,
  SyncWant,
} from '@trippy/sync'
import pg, { type PoolClient } from 'pg'

type Pool = InstanceType<typeof pg.Pool>

export interface SyncStore {
  applyOperation(userId: string, operation: SyncOperation): Promise<PushOperationResult>
  pull(userId: string, query: PullQuery): Promise<PullResponse | null>
}

interface TripRow {
  id: string
  timezone: string
  seq_counter: string
  itinerary_version: number
  trip_days: number
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
  itinerary_version: number
  member_user_id: string | null
  left_at: Date | null
}

interface PullPlaceRow extends Omit<SyncPlace, 'createdAt' | 'deletedAt'> {
  createdAt: Date
  deletedAt: Date | null
}

interface PullVisitRow extends Omit<SyncVisit, 'visitedAt' | 'deletedAt'> {
  visitedAt: Date
  deletedAt: Date | null
}

interface PullWantRow extends Omit<SyncWant, 'createdAt' | 'deletedAt'> {
  createdAt: Date
  deletedAt: Date | null
}

interface PullReviewRow extends Omit<SyncReview, 'updatedAt' | 'deletedAt'> {
  updatedAt: Date
  deletedAt: Date | null
}

interface ReviewState {
  favorite: boolean
  rating: number | null
  note: string | null
}

interface PullMemberRow extends Omit<SyncMember, 'joinedAt' | 'openedAt' | 'deletedAt'> {
  joinedAt: Date
  openedAt: Date | null
  deletedAt: Date | null
}

type PullRecord =
  | { kind: 'place'; seq: SyncSequence; id: string; value: SyncPlace }
  | { kind: 'visit'; seq: SyncSequence; id: string; value: SyncVisit }
  | { kind: 'want'; seq: SyncSequence; id: string; value: SyncWant }
  | { kind: 'review'; seq: SyncSequence; id: string; value: SyncReview }
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

async function inReadOnlyRepeatableRead<T>(
  client: PoolClient,
  operation: () => Promise<T>,
): Promise<T> {
  await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
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
  if (prior.result.status === 'rejected' || prior.result.status === 'conflict') {
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

async function nextPlaceDayPosition(
  client: PoolClient,
  tripId: string,
  dayIndex: number,
): Promise<number> {
  const result = await client.query<{ next_position: number }>(
    `SELECT COALESCE(MAX(position), -1) + 1 AS next_position FROM places
     WHERE trip_id = $1 AND deleted_at IS NULL AND day_index = $2`,
    [tripId, dayIndex],
  )
  return result.rows[0]!.next_position
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
  const dayIndex = operation.dayIndex ?? null
  const position =
    dayIndex === null ? null : await nextPlaceDayPosition(client, operation.tripId, dayIndex)
  const inserted = await client.query(
    `INSERT INTO places (
       id, trip_id, provider, provider_ref, country_code, provider_datasource, attribution, license,
       name, local_name, address, local_address, lat, lng, suggested_by, seq, day_index, position
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
     ON CONFLICT (id) DO NOTHING
     RETURNING id`,
    [
      operation.placeId,
      operation.tripId,
      operation.candidate?.provider ?? null,
      operation.candidate?.providerRef ?? null,
      operation.candidate?.countryCode ?? null,
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
      dayIndex,
      position,
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

  const liveWants = await client.query<{ user_id: string }>(
    `SELECT user_id FROM place_wants
     WHERE trip_id = $1 AND place_id = $2 AND deleted_at IS NULL
     ORDER BY user_id
     FOR UPDATE`,
    [operation.tripId, operation.placeId],
  )
  for (const want of liveWants.rows) {
    const wantSequence = await nextSequence(client, operation.tripId)
    await client.query(
      `UPDATE place_wants SET deleted_at = now(), seq = $3
       WHERE place_id = $1 AND user_id = $2`,
      [operation.placeId, want.user_id, wantSequence],
    )
  }

  const liveReviews = await client.query<{ user_id: string }>(
    `SELECT user_id FROM place_reviews
     WHERE trip_id = $1 AND place_id = $2 AND deleted_at IS NULL
     ORDER BY user_id
     FOR UPDATE`,
    [operation.tripId, operation.placeId],
  )
  for (const review of liveReviews.rows) {
    const reviewSequence = await nextSequence(client, operation.tripId)
    await client.query(
      `UPDATE place_reviews SET deleted_at = now(), seq = $3
       WHERE place_id = $1 AND user_id = $2`,
      [operation.placeId, review.user_id, reviewSequence],
    )
  }
  return { opId: operation.opId, status: 'applied' }
}

async function applyVisit(
  client: PoolClient,
  userId: string,
  role: SyncMember['role'],
  operation: Extract<SyncOperation, { type: 'visit.mark' | 'visit.unmark' }>,
  timezone: string,
): Promise<PushOperationResult> {
  const placeResult = await client.query<PlaceLookupRow>(
    'SELECT trip_id, suggested_by, deleted_at FROM places WHERE id = $1',
    [operation.placeId],
  )
  const place = placeResult.rows[0]
  if (!place || place.trip_id !== operation.tripId) return rejectedResult(operation, 'invalid')

  // Marcar ou desmarcar outra pessoa exige organizador/coorganizador e alvo membro ativo.
  const targetId = operation.userId ?? userId
  if (targetId !== userId) {
    if (role !== 'organizer' && role !== 'coorganizer')
      return rejectedResult(operation, 'forbidden')
    const target = await client.query<{ user_id: string }>(
      `SELECT user_id FROM trip_members
       WHERE trip_id = $1 AND user_id = $2 AND left_at IS NULL`,
      [operation.tripId, targetId],
    )
    if ((target.rowCount ?? 0) === 0) return rejectedResult(operation, 'invalid')
  }

  const selected = await client.query<VisitLookupRow>(
    `SELECT deleted_at FROM visits
     WHERE place_id = $1 AND user_id = $2
     FOR UPDATE`,
    [operation.placeId, targetId],
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
        [operation.placeId, targetId, userId, timezone, sequence],
      )
    } else {
      await client.query(
        `INSERT INTO visits (place_id, trip_id, user_id, marked_by, visited_at, visited_tz, seq)
         VALUES ($1, $2, $3, $4, now(), $5, $6)`,
        [operation.placeId, operation.tripId, targetId, userId, timezone, sequence],
      )
    }
    return { opId: operation.opId, status: 'applied' }
  }

  if (!visit || visit.deleted_at) return duplicateResult(operation)
  const sequence = await nextSequence(client, operation.tripId)
  await client.query(
    'UPDATE visits SET deleted_at = now(), seq = $3 WHERE place_id = $1 AND user_id = $2',
    [operation.placeId, targetId, sequence],
  )
  return { opId: operation.opId, status: 'applied' }
}

async function applyWant(
  client: PoolClient,
  userId: string,
  operation: Extract<SyncOperation, { type: 'place.want' | 'place.unwant' }>,
): Promise<PushOperationResult> {
  const placeResult = await client.query<PlaceLookupRow>(
    'SELECT trip_id, suggested_by, deleted_at FROM places WHERE id = $1',
    [operation.placeId],
  )
  const place = placeResult.rows[0]
  if (!place || place.trip_id !== operation.tripId) return rejectedResult(operation, 'invalid')

  const selected = await client.query<VisitLookupRow>(
    `SELECT deleted_at FROM place_wants
     WHERE place_id = $1 AND user_id = $2
     FOR UPDATE`,
    [operation.placeId, userId],
  )
  const want = selected.rows[0]

  if (operation.type === 'place.want') {
    if (place.deleted_at) return rejectedResult(operation, 'invalid')
    if (want && !want.deleted_at) return duplicateResult(operation)

    const sequence = await nextSequence(client, operation.tripId)
    if (want) {
      await client.query(
        `UPDATE place_wants
         SET created_at = now(), seq = $3, deleted_at = NULL
         WHERE place_id = $1 AND user_id = $2`,
        [operation.placeId, userId, sequence],
      )
    } else {
      await client.query(
        `INSERT INTO place_wants (place_id, trip_id, user_id, created_at, seq)
         VALUES ($1, $2, $3, now(), $4)`,
        [operation.placeId, operation.tripId, userId, sequence],
      )
    }
    return { opId: operation.opId, status: 'applied' }
  }

  if (!want || want.deleted_at) return duplicateResult(operation)
  const sequence = await nextSequence(client, operation.tripId)
  await client.query(
    'UPDATE place_wants SET deleted_at = now(), seq = $3 WHERE place_id = $1 AND user_id = $2',
    [operation.placeId, userId, sequence],
  )
  return { opId: operation.opId, status: 'applied' }
}

async function applyReview(
  client: PoolClient,
  userId: string,
  operation: Extract<SyncOperation, { type: 'place.favorite' | 'place.rate' | 'place.note' }>,
): Promise<PushOperationResult> {
  const placeResult = await client.query<PlaceLookupRow>(
    'SELECT trip_id, suggested_by, deleted_at FROM places WHERE id = $1',
    [operation.placeId],
  )
  const place = placeResult.rows[0]
  if (!place || place.trip_id !== operation.tripId || place.deleted_at) {
    return rejectedResult(operation, 'invalid')
  }

  const selected = await client.query<ReviewState>(
    `SELECT favorite, rating, note FROM place_reviews
     WHERE place_id = $1 AND user_id = $2
     FOR UPDATE`,
    [operation.placeId, userId],
  )
  const existing = selected.rows[0]
  const current: ReviewState = existing ?? { favorite: false, rating: null, note: null }
  const next: ReviewState = {
    favorite: operation.type === 'place.favorite' ? operation.favorite : current.favorite,
    rating: operation.type === 'place.rate' ? operation.rating : current.rating,
    note: operation.type === 'place.note' ? operation.note : current.note,
  }
  if (
    next.favorite === current.favorite &&
    next.rating === current.rating &&
    next.note === current.note
  ) {
    return duplicateResult(operation)
  }

  const sequence = await nextSequence(client, operation.tripId)
  if (existing) {
    await client.query(
      `UPDATE place_reviews
       SET favorite = $3, rating = $4, note = $5, updated_at = now(), seq = $6
       WHERE place_id = $1 AND user_id = $2`,
      [operation.placeId, userId, next.favorite, next.rating, next.note, sequence],
    )
  } else {
    await client.query(
      `INSERT INTO place_reviews (
         place_id, trip_id, user_id, favorite, rating, note, updated_at, seq
       ) VALUES ($1, $2, $3, $4, $5, $6, now(), $7)`,
      [
        operation.placeId,
        operation.tripId,
        userId,
        next.favorite,
        next.rating,
        next.note,
        sequence,
      ],
    )
  }
  return { opId: operation.opId, status: 'applied' }
}

async function applyItineraryArrange(
  client: PoolClient,
  userId: string,
  role: SyncMember['role'],
  operation: Extract<SyncOperation, { type: 'itinerary.arrange' }>,
  trip: TripRow,
): Promise<PushOperationResult> {
  if (!canEditItinerary(role)) return rejectedResult(operation, 'forbidden')
  if (operation.days.some((day) => day.dayIndex >= trip.trip_days)) {
    return rejectedResult(operation, 'invalid')
  }

  const placeIds = operation.days.flatMap((day) =>
    day.placeIds.map((placeId) => placeId.toLowerCase()),
  )
  const dayIndexes = operation.days.map((day) => day.dayIndex)
  const validPlaces = await client.query<{ id: string }>(
    `SELECT id FROM places
     WHERE trip_id = $1 AND deleted_at IS NULL AND id = ANY($2::uuid[])
     FOR UPDATE`,
    [operation.tripId, placeIds],
  )
  if (validPlaces.rowCount !== placeIds.length) return rejectedResult(operation, 'invalid')

  const version = await client.query<{ itinerary_version: number }>(
    `UPDATE trips
     SET itinerary_version = itinerary_version + 1
     WHERE id = $1 AND itinerary_version = $2
     RETURNING itinerary_version`,
    [operation.tripId, operation.baseVersion],
  )
  if (!version.rows[0]) {
    const current = await client.query<{ itinerary_version: number }>(
      'SELECT itinerary_version FROM trips WHERE id = $1',
      [operation.tripId],
    )
    return {
      opId: operation.opId,
      status: 'conflict',
      currentVersion: current.rows[0]!.itinerary_version,
    }
  }

  const affected = await client.query<{
    id: string
    day_index: number | null
    position: number | null
  }>(
    `SELECT id, day_index, position FROM places
     WHERE trip_id = $1 AND deleted_at IS NULL
       AND (id = ANY($2::uuid[]) OR day_index = ANY($3::int[]))
     ORDER BY id
     FOR UPDATE`,
    [operation.tripId, placeIds, dayIndexes],
  )
  const placements = new Map<string, { dayIndex: number; position: number }>()
  for (const day of operation.days) {
    day.placeIds.forEach((placeId, position) => {
      placements.set(placeId.toLowerCase(), { dayIndex: day.dayIndex, position })
    })
  }

  for (const place of affected.rows) {
    const placement = placements.get(place.id)
    const dayIndex = placement?.dayIndex ?? null
    const position = placement?.position ?? null
    if (place.day_index === dayIndex && place.position === position) continue

    const sequence = await nextSequence(client, operation.tripId)
    await client.query('UPDATE places SET day_index = $2, position = $3, seq = $4 WHERE id = $1', [
      place.id,
      dayIndex,
      position,
      sequence,
    ])
  }

  return { opId: operation.opId, status: 'applied' }
}

async function findActiveTargetMember(
  client: PoolClient,
  tripId: string,
  userId: string,
): Promise<Member | null> {
  const result = await client.query<{ user_id: string; role: SyncMember['role'] }>(
    `SELECT user_id, role FROM trip_members
     WHERE trip_id = $1 AND user_id = $2 AND left_at IS NULL
     FOR UPDATE`,
    [tripId, userId],
  )
  const target = result.rows[0]
  return target ? { userId: target.user_id, role: target.role } : null
}

async function applyMemberRemove(
  client: PoolClient,
  actor: Member,
  operation: Extract<SyncOperation, { type: 'member.remove' }>,
): Promise<PushOperationResult> {
  const target = await findActiveTargetMember(client, operation.tripId, operation.userId)
  if (!target) return rejectedResult(operation, 'invalid')
  if (!canRemoveMember(actor, target)) return rejectedResult(operation, 'forbidden')

  const sequence = await nextSequence(client, operation.tripId)
  await client.query(
    `UPDATE trip_members SET left_at = now(), seq = $3
     WHERE trip_id = $1 AND user_id = $2`,
    [operation.tripId, operation.userId, sequence],
  )
  return { opId: operation.opId, status: 'applied' }
}

async function applyMemberSetRole(
  client: PoolClient,
  actor: Member,
  operation: Extract<SyncOperation, { type: 'member.set_role' }>,
): Promise<PushOperationResult> {
  const target = await findActiveTargetMember(client, operation.tripId, operation.userId)
  if (!target) return rejectedResult(operation, 'invalid')
  if (!canSetMemberRole(actor, target)) return rejectedResult(operation, 'forbidden')

  const sequence = await nextSequence(client, operation.tripId)
  await client.query(
    `UPDATE trip_members SET role = $3, seq = $4
     WHERE trip_id = $1 AND user_id = $2`,
    [operation.tripId, operation.userId, operation.role, sequence],
  )
  return { opId: operation.opId, status: 'applied' }
}

async function applyTripEnd(
  client: PoolClient,
  role: SyncMember['role'],
  operation: Extract<SyncOperation, { type: 'trip.end' }>,
): Promise<PushOperationResult> {
  if (role !== 'organizer') return rejectedResult(operation, 'forbidden')

  await client.query('UPDATE trips SET ended_at = now() WHERE id = $1 AND ended_at IS NULL', [
    operation.tripId,
  ])
  return { opId: operation.opId, status: 'applied' }
}

async function applyTripOpen(
  client: PoolClient,
  userId: string,
  operation: Extract<SyncOperation, { type: 'trip.open' }>,
): Promise<PushOperationResult> {
  const memberResult = await client.query<{ first_opened_at: Date | null }>(
    `SELECT first_opened_at FROM trip_members
     WHERE trip_id = $1 AND user_id = $2 AND left_at IS NULL
     FOR UPDATE`,
    [operation.tripId, userId],
  )
  const member = memberResult.rows[0]
  if (!member) return rejectedResult(operation, 'not_member')
  if (member.first_opened_at) return { opId: operation.opId, status: 'applied' }

  const sequence = await nextSequence(client, operation.tripId)
  await client.query(
    `UPDATE trip_members SET first_opened_at = now(), seq = $3
     WHERE trip_id = $1 AND user_id = $2 AND left_at IS NULL AND first_opened_at IS NULL`,
    [operation.tripId, userId, sequence],
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
      return applyVisit(client, userId, role, operation, trip.timezone)
    case 'place.want':
    case 'place.unwant':
      return applyWant(client, userId, operation)
    case 'place.favorite':
    case 'place.rate':
    case 'place.note':
      return applyReview(client, userId, operation)
    case 'itinerary.arrange':
      return applyItineraryArrange(client, userId, role, operation, trip)
    case 'member.remove':
      return applyMemberRemove(client, { userId, role }, operation)
    case 'member.set_role':
      return applyMemberSetRole(client, { userId, role }, operation)
    case 'trip.end':
      return applyTripEnd(client, role, operation)
    case 'trip.open':
      return applyTripOpen(client, userId, operation)
  }
}

async function listPageRows<
  T extends PullPlaceRow | PullVisitRow | PullWantRow | PullReviewRow | PullMemberRow,
>(
  client: Pool | PoolClient,
  table: 'places' | 'visits' | 'place_wants' | 'place_reviews' | 'trip_members',
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
  const kindOrder = { member: 0, place: 1, visit: 2, want: 3, review: 4 } as const
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
            `SELECT id, timezone, seq_counter::text AS seq_counter,
                    itinerary_version,
                    COALESCE(end_date - start_date + 1, 0)::int AS trip_days
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
    const client = await this.pool.connect()
    try {
      return await inReadOnlyRepeatableRead(client, async () => {
        const tripResult = await client.query<PullTripRow>(
          `SELECT trips.seq_counter::text AS seq_counter,
                  trips.itinerary_version,
                  trips.sync_floor_seq::text AS sync_floor_seq,
                  trip_members.user_id AS member_user_id,
                  trip_members.left_at
           FROM trips
           LEFT JOIN trip_members
             ON trip_members.trip_id = trips.id AND trip_members.user_id = $2
           WHERE trips.id = $1 AND trips.deleted_at IS NULL`,
          [query.tripId, userId],
        )
        const trip = tripResult.rows[0]
        if (!trip || !trip.member_user_id) return null
        if (trip.left_at) return { error: 'not_member' }

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
        const [placeRows, visitRows, wantRows, reviewRows, memberRows] = await Promise.all([
          listPageRows<PullPlaceRow>(
            client,
            'places',
            `id, trip_id AS "tripId", provider, provider_ref AS "providerRef",
             country_code AS "countryCode",
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
            client,
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
          listPageRows<PullWantRow>(
            client,
            'place_wants',
            `place_id AS "placeId", trip_id AS "tripId", user_id AS "userId",
             created_at AS "createdAt", seq::text AS seq, deleted_at AS "deletedAt"`,
            'deleted_at',
            query.tripId,
            cursor,
            snapshotSeq,
            selectedLimit,
            bootstrap,
          ),
          listPageRows<PullReviewRow>(
            client,
            'place_reviews',
            `place_id AS "placeId", trip_id AS "tripId", user_id AS "userId",
             favorite, rating, note, updated_at AS "updatedAt",
             seq::text AS seq, deleted_at AS "deletedAt"`,
            'deleted_at',
            query.tripId,
            cursor,
            snapshotSeq,
            selectedLimit,
            bootstrap,
          ),
          listPageRows<PullMemberRow>(
            client,
            'trip_members',
            `trip_id AS "tripId", user_id AS "userId", role, joined_at AS "joinedAt",
             first_opened_at AS "openedAt", seq::text AS seq, left_at AS "deletedAt"`,
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
          ...wantRows.map((row) => {
            const value: SyncWant = {
              ...row,
              createdAt: row.createdAt.toISOString(),
              deletedAt: row.deletedAt?.toISOString() ?? null,
            }
            return {
              kind: 'want' as const,
              seq: value.seq,
              id: `${value.placeId}:${value.userId}`,
              value,
            }
          }),
          ...reviewRows.map((row) => {
            const value: SyncReview = {
              ...row,
              updatedAt: row.updatedAt.toISOString(),
              deletedAt: row.deletedAt?.toISOString() ?? null,
            }
            return {
              kind: 'review' as const,
              seq: value.seq,
              id: `${value.placeId}:${value.userId}`,
              value,
            }
          }),
          ...memberRows.map((row) => {
            const value: SyncMember = {
              ...row,
              joinedAt: row.joinedAt.toISOString(),
              openedAt: row.openedAt?.toISOString() ?? null,
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
          wants: page.flatMap((record) => (record.kind === 'want' ? [record.value] : [])),
          reviews: page.flatMap((record) => (record.kind === 'review' ? [record.value] : [])),
          members: page.flatMap((record) => (record.kind === 'member' ? [record.value] : [])),
          itinerary: { version: trip.itinerary_version, atSeq: trip.seq_counter },
          nextCursor,
          hasMore,
        }

        return bootstrap
          ? { mode: 'bootstrap', snapshotSeq, ...responseData }
          : { mode: 'incremental', ...responseData }
      })
    } finally {
      client.release()
    }
  }
}
