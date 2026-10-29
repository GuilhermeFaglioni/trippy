import type { SqlDatabase } from '../database.ts'
import { classifyLocalDetail } from '@trippy/domain/places'
import type { PlaceSearchCandidate } from '@trippy/domain'
import {
  type ItineraryDay,
  type PullPageData,
  type PullQuery,
  type PushOperationResult,
  type SyncMember,
  type SyncOperation,
  type SyncPlace,
  type SyncReview,
  type SyncVisit,
  type SyncWant,
  type UUID,
} from '../types.ts'
import {
  isUuid,
  validatePullResponse,
  validatePushResponse,
  validateSyncOperation,
} from '../validation.ts'
import { migrateSyncDatabase } from './schema.ts'
import type {
  ItineraryDraft,
  LiveMember,
  LivePlace,
  PlaceDetail,
  SyncClient,
  SyncClientStatus,
  SyncTransport,
} from './types.ts'

const DEFAULT_PAGE_SIZE = 100
const DEFAULT_PUSH_BATCH_SIZE = 50

export interface CreateSyncClientOptions {
  database: SqlDatabase
  transport: SyncTransport
  /** ID interno da pessoa autenticada, usado para projetar a visita local. */
  userId: UUID
  /** Lista viagens conhecidas pela camada do app para permitir o bootstrap inicial. */
  getTripIds: () => readonly UUID[] | Promise<readonly UUID[]>
  /** Ponto de injeção para testes; por padrão usa crypto.randomUUID do runtime. */
  idGenerator?: () => UUID
  now?: () => string
  timeZone?: string
  pageSize?: number
  pushBatchSize?: number
}

interface SyncStateRow extends Record<string, unknown> {
  trip_id: UUID
  cursor: string | null
  snapshot_seq: string | null
  last_synced_at: string | null
  needs_bootstrap: number
  itinerary_version: number | null
  removed_at: string | null
}

interface OutboxRow extends Record<string, unknown> {
  position: number
  op_id: UUID
  trip_id: UUID
  type: string
  payload: string
  created_at: string
  status: 'pending' | 'not_sent'
  attempts: number
  last_error: string | null
}

interface PlaceRow extends Record<string, unknown> {
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

interface ItineraryDraftRow extends Record<string, unknown> {
  op_id: UUID
  trip_id: UUID
  base_version: number
  current_version: number
  payload: string
  created_at: string
}

interface MemberRow extends Record<string, unknown> {
  user_id: UUID
  role: LiveMember['role']
  joined_at: string
  opened_at: string | null
}

interface StatusCounts extends Record<string, unknown> {
  pending: number
  not_sent: number
}

const tripLocks = new WeakMap<SqlDatabase, Map<UUID, Promise<void>>>()

/**
 * Cria o motor e aplica as migrations locais antes de expor operações.
 * getTripIds é consultado em cada syncNow para descobrir viagens que ainda não
 * têm linhas locais; a lista é unida às viagens já presentes em sync_state e
 * outbox. Se a descoberta falhar, o sync continua com as viagens locais.
 */
export async function createSyncClient(options: CreateSyncClientOptions): Promise<SyncClient> {
  if (!isUuid(options.userId)) throw new Error('Informe um UUID válido para o usuário local.')
  await migrateSyncDatabase(options.database, options.now)
  const client = new LocalSyncClient(options)
  await client.initialize()
  return client
}

class LocalSyncClient implements SyncClient {
  private readonly database: SqlDatabase
  private readonly transport: SyncTransport
  private readonly userId: UUID
  private readonly discoverTripIds: CreateSyncClientOptions['getTripIds']
  private readonly idGenerator: () => UUID
  private readonly now: () => string
  private readonly timeZone: string
  private readonly pageSize: number
  private readonly pushBatchSize: number
  private readonly listeners = new Set<() => void>()
  private status: SyncClientStatus = {
    lastSyncedAt: null,
    pending: 0,
    notSent: 0,
    syncing: false,
    lastError: null,
  }
  private syncPromise: Promise<void> | null = null
  private syncing = false
  private runtimeLastError: string | null = null

  constructor(options: CreateSyncClientOptions) {
    this.database = options.database
    this.transport = options.transport
    this.userId = options.userId
    this.discoverTripIds = options.getTripIds
    this.idGenerator = options.idGenerator ?? (() => globalThis.crypto.randomUUID())
    this.now = options.now ?? (() => new Date().toISOString())
    this.timeZone = options.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC'
    this.pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE
    this.pushBatchSize = options.pushBatchSize ?? DEFAULT_PUSH_BATCH_SIZE
    if (!Number.isSafeInteger(this.pageSize) || this.pageSize < 1) {
      throw new Error('pageSize precisa ser um inteiro positivo.')
    }
    if (!Number.isSafeInteger(this.pushBatchSize) || this.pushBatchSize < 1) {
      throw new Error('pushBatchSize precisa ser um inteiro positivo.')
    }
  }

  async initialize(): Promise<void> {
    await this.refreshStatus()
  }

  async addPlace(tripId: UUID, name: string): Promise<UUID> {
    const placeId = this.idGenerator()
    const operation: SyncOperation = {
      type: 'place.add',
      opId: this.idGenerator(),
      tripId,
      placeId,
      name,
    }
    await this.writeOperation(operation)
    return placeId
  }

  async addPlaceFromCandidate(tripId: UUID, candidate: PlaceSearchCandidate): Promise<UUID> {
    const placeId = this.idGenerator()
    await this.writeOperation({
      type: 'place.add',
      opId: this.idGenerator(),
      tripId,
      placeId,
      name: candidate.name,
      candidate,
    })
    return placeId
  }

  async removePlace(tripId: UUID, placeId: UUID): Promise<void> {
    await this.writeOperation({ type: 'place.remove', opId: this.idGenerator(), tripId, placeId })
  }

  async linkGooglePlace(tripId: UUID, placeId: UUID, googlePlaceId: string | null): Promise<void> {
    await this.writeOperation({
      type: 'place.google_link',
      opId: this.idGenerator(),
      tripId,
      placeId,
      googlePlaceId,
    })
  }

  async setLocalDetails(
    tripId: UUID,
    placeId: UUID,
    details: { localName?: string | null; localAddress?: string | null },
  ): Promise<void> {
    await this.writeOperation({
      type: 'place.set_local',
      opId: this.idGenerator(),
      tripId,
      placeId,
      ...details,
    })
  }

  async markVisit(tripId: UUID, placeId: UUID, userId?: UUID): Promise<void> {
    await this.writeOperation({
      type: 'visit.mark',
      opId: this.idGenerator(),
      tripId,
      placeId,
      ...(userId === undefined ? {} : { userId }),
    })
  }

  async unmarkVisit(tripId: UUID, placeId: UUID, userId?: UUID): Promise<void> {
    await this.writeOperation({
      type: 'visit.unmark',
      opId: this.idGenerator(),
      tripId,
      placeId,
      ...(userId === undefined ? {} : { userId }),
    })
  }

  async setFavorite(tripId: UUID, placeId: UUID, favorite: boolean): Promise<void> {
    await this.writeOperation({
      type: 'place.favorite',
      opId: this.idGenerator(),
      tripId,
      placeId,
      favorite,
    })
  }

  async ratePlace(tripId: UUID, placeId: UUID, rating: number | null): Promise<void> {
    await this.writeOperation({
      type: 'place.rate',
      opId: this.idGenerator(),
      tripId,
      placeId,
      rating,
    })
  }

  async setPlaceNote(tripId: UUID, placeId: UUID, note: string | null): Promise<void> {
    await this.writeOperation({
      type: 'place.note',
      opId: this.idGenerator(),
      tripId,
      placeId,
      note,
    })
  }

  async getPlaceDetail(tripId: UUID, placeId: UUID): Promise<PlaceDetail | null> {
    const place = (await this.listPlaces(tripId)).find((item) => item.id === placeId)
    if (!place) return null

    const reviews = await this.database.all<
      { user_id: UUID; favorite: number; rating: number | null; note: string | null } & Record<
        string,
        unknown
      >
    >(
      `SELECT user_id, favorite, rating, note FROM reviews
       WHERE place_id = ? AND trip_id = ? AND deleted_at IS NULL
       ORDER BY updated_at, user_id`,
      [placeId, tripId],
    )
    const visits = await this.database.all<
      { user_id: UUID; marked_by: UUID } & Record<string, unknown>
    >(
      `SELECT user_id, marked_by FROM visits
       WHERE place_id = ? AND trip_id = ? AND deleted_at IS NULL
       ORDER BY user_id`,
      [placeId, tripId],
    )

    const mine = reviews.find((review) => review.user_id === this.userId)
    const ratings = reviews.flatMap((review) => (review.rating === null ? [] : [review.rating]))
    const ratingAverage =
      ratings.length >= 2 ? ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length : null

    return {
      place,
      favoriteByMe: place.favoriteByMe,
      myRating: mine?.rating ?? null,
      myNote: mine?.note ?? null,
      favoriteCount: reviews.filter((review) => review.favorite !== 0).length,
      ratingCount: ratings.length,
      ratingAverage,
      notes: reviews.flatMap((review) =>
        review.user_id !== this.userId && review.note !== null && review.note.trim() !== ''
          ? [{ userId: review.user_id, note: review.note }]
          : [],
      ),
      visitors: visits.map((visit) => ({ userId: visit.user_id, markedBy: visit.marked_by })),
    }
  }

  async wantPlace(tripId: UUID, placeId: UUID): Promise<void> {
    await this.writeOperation({ type: 'place.want', opId: this.idGenerator(), tripId, placeId })
  }

  async unwantPlace(tripId: UUID, placeId: UUID): Promise<void> {
    await this.writeOperation({ type: 'place.unwant', opId: this.idGenerator(), tripId, placeId })
  }

  async arrangeItinerary(tripId: UUID, days: ItineraryDay[]): Promise<void> {
    const opId = this.idGenerator()
    const createdAt = this.now()
    await this.database.transaction(async (transaction) => {
      await this.ensureSyncState(transaction, tripId)
      const baseVersion = await this.nextItineraryBaseVersion(transaction, tripId)
      const validation = validateSyncOperation({
        type: 'itinerary.arrange',
        opId,
        tripId,
        baseVersion,
        days,
      })
      if (!validation.success)
        throw new Error(validation.issues.map((issue) => issue.message).join(' '))
      await this.applyOperation(transaction, validation.value, createdAt)
      await transaction.run(
        `INSERT INTO outbox (op_id, trip_id, type, payload, created_at, status, attempts, last_error)
         VALUES (?, ?, ?, ?, ?, 'pending', 0, NULL)`,
        [opId, tripId, validation.value.type, JSON.stringify(validation.value), createdAt],
      )
    })
    await this.refreshStatus()
    this.notifyListeners()
  }

  async listItineraryDrafts(tripId: UUID): Promise<ItineraryDraft[]> {
    const rows = await this.database.all<ItineraryDraftRow>(
      `SELECT op_id, trip_id, base_version, current_version, payload, created_at
       FROM itinerary_drafts WHERE trip_id = ? ORDER BY created_at, op_id`,
      [tripId],
    )
    return rows.map((row) => ({
      opId: row.op_id,
      tripId: row.trip_id,
      baseVersion: row.base_version,
      currentVersion: row.current_version,
      days: this.itineraryDaysFromDraft(row),
      createdAt: row.created_at,
    }))
  }

  async discardItineraryDraft(opId: UUID): Promise<void> {
    await this.database.run('DELETE FROM itinerary_drafts WHERE op_id = ?', [opId])
  }

  async reapplyItineraryDraft(opId: UUID): Promise<void> {
    const createdAt = this.now()
    await this.database.transaction(async (transaction) => {
      const row = await transaction.get<ItineraryDraftRow>(
        `SELECT op_id, trip_id, base_version, current_version, payload, created_at
         FROM itinerary_drafts WHERE op_id = ?`,
        [opId],
      )
      if (!row) throw new Error(`Rascunho de roteiro não encontrado: ${opId}.`)

      await this.ensureSyncState(transaction, row.trip_id)
      const baseVersion = await this.nextItineraryBaseVersion(transaction, row.trip_id)
      const validation = validateSyncOperation({
        type: 'itinerary.arrange',
        opId: this.idGenerator(),
        tripId: row.trip_id,
        baseVersion,
        days: this.itineraryDaysFromDraft(row),
      })
      if (!validation.success)
        throw new Error(validation.issues.map((issue) => issue.message).join(' '))
      await this.applyOperation(transaction, validation.value, createdAt)
      await transaction.run(
        `INSERT INTO outbox (op_id, trip_id, type, payload, created_at, status, attempts, last_error)
         VALUES (?, ?, ?, ?, ?, 'pending', 0, NULL)`,
        [
          validation.value.opId,
          row.trip_id,
          validation.value.type,
          JSON.stringify(validation.value),
          createdAt,
        ],
      )
      await transaction.run('DELETE FROM itinerary_drafts WHERE op_id = ?', [opId])
    })
    await this.refreshStatus()
    this.notifyListeners()
  }

  async listMembers(tripId: UUID): Promise<LiveMember[]> {
    const rows = await this.database.all<MemberRow>(
      `SELECT user_id, role, joined_at, opened_at FROM members
       WHERE trip_id = ? AND deleted_at IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM sync_state WHERE sync_state.trip_id = members.trip_id
             AND sync_state.removed_at IS NOT NULL
         )
       ORDER BY joined_at, user_id`,
      [tripId],
    )
    return rows.map((row) => ({
      userId: row.user_id,
      role: row.role,
      joinedAt: row.joined_at,
      openedAt: row.opened_at,
    }))
  }

  async removeMember(tripId: UUID, userId: UUID): Promise<void> {
    await this.writeOperation({ type: 'member.remove', opId: this.idGenerator(), tripId, userId })
  }

  async setMemberRole(tripId: UUID, userId: UUID, role: 'coorganizer' | 'member'): Promise<void> {
    await this.writeOperation({
      type: 'member.set_role',
      opId: this.idGenerator(),
      tripId,
      userId,
      role,
    })
  }

  async endTrip(tripId: UUID): Promise<void> {
    await this.writeOperation({ type: 'trip.end', opId: this.idGenerator(), tripId })
  }

  async openTrip(tripId: UUID): Promise<void> {
    await this.writeOperation({ type: 'trip.open', opId: this.idGenerator(), tripId })
  }

  async listRemovedTrips(): Promise<UUID[]> {
    const rows = await this.database.all<{ trip_id: UUID } & Record<string, unknown>>(
      'SELECT trip_id FROM sync_state WHERE removed_at IS NOT NULL ORDER BY removed_at, trip_id',
    )
    return rows.map((row) => row.trip_id)
  }

  async countNotSent(tripId: UUID): Promise<number> {
    const row = await this.database.get<{ count: number } & Record<string, unknown>>(
      "SELECT COUNT(*) AS count FROM outbox WHERE trip_id = ? AND status = 'not_sent'",
      [tripId],
    )
    return Number(row?.count ?? 0)
  }

  syncNow(): Promise<void> {
    if (this.syncPromise) return this.syncPromise
    const promise = this.performSync()
    this.syncPromise = promise
    void promise.then(
      () => {
        if (this.syncPromise === promise) this.syncPromise = null
      },
      () => {
        if (this.syncPromise === promise) this.syncPromise = null
      },
    )
    return promise
  }

  async listPlaces(tripId: UUID, _countryCode?: string | null): Promise<LivePlace[]> {
    void _countryCode
    const rows = await this.database.all<
      PlaceRow & {
        visited_by_me: number
        want_count: number
        wanted_by_me: number
        favorite_by_me: number
      }
    >(
      `SELECT places.*, EXISTS (
         SELECT 1 FROM visits
         WHERE visits.place_id = places.id
           AND visits.trip_id = places.trip_id
           AND visits.user_id = ?
           AND visits.deleted_at IS NULL
       ) AS visited_by_me,
       (
         SELECT COUNT(*) FROM wants
         WHERE wants.place_id = places.id
           AND wants.trip_id = places.trip_id
           AND wants.deleted_at IS NULL
       ) AS want_count,
       EXISTS (
         SELECT 1 FROM wants
         WHERE wants.place_id = places.id
           AND wants.trip_id = places.trip_id
           AND wants.user_id = ?
           AND wants.deleted_at IS NULL
       ) AS wanted_by_me,
       EXISTS (
         SELECT 1 FROM reviews
         WHERE reviews.place_id = places.id
           AND reviews.trip_id = places.trip_id
           AND reviews.user_id = ?
           AND reviews.favorite = 1
           AND reviews.deleted_at IS NULL
       ) AS favorite_by_me
       FROM places
       WHERE places.trip_id = ? AND places.deleted_at IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM members
           WHERE members.trip_id = places.trip_id
             AND members.user_id = ?
             AND members.deleted_at IS NOT NULL
         )
         AND NOT EXISTS (
           SELECT 1 FROM sync_state
           WHERE sync_state.trip_id = places.trip_id AND sync_state.removed_at IS NOT NULL
         )
       ORDER BY places.position IS NULL, places.position, places.created_at, places.id`,
      [this.userId, this.userId, this.userId, tripId, this.userId],
    )
    return rows.map((row) => {
      const place = this.placeFromRow(row)
      return {
        ...place,
        deletedAt: null,
        visitedByMe: row.visited_by_me !== 0,
        wantCount: Number(row.want_count),
        wantedByMe: row.wanted_by_me !== 0,
        favoriteByMe: row.favorite_by_me !== 0,
        localNameStatus: classifyLocalDetail({
          userValue: place.userLocalName,
          providerValue: place.localName,
          countryCode: place.countryCode,
          kind: 'name',
        }),
        localAddressStatus: classifyLocalDetail({
          userValue: place.userLocalAddress,
          providerValue: place.localAddress,
          countryCode: place.countryCode,
          kind: 'address',
        }),
      }
    })
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getStatus(): SyncClientStatus {
    return { ...this.status }
  }

  private async writeOperation(operation: SyncOperation): Promise<void> {
    const validation = validateSyncOperation(operation)
    if (!validation.success)
      throw new Error(validation.issues.map((issue) => issue.message).join(' '))
    const normalized = validation.value
    const createdAt = this.now()
    await this.database.transaction(async (transaction) => {
      await this.ensureSyncState(transaction, normalized.tripId)
      await this.applyOperation(transaction, normalized, createdAt)
      await transaction.run(
        `INSERT INTO outbox (op_id, trip_id, type, payload, created_at, status, attempts, last_error)
         VALUES (?, ?, ?, ?, ?, 'pending', 0, NULL)`,
        [
          normalized.opId,
          normalized.tripId,
          normalized.type,
          JSON.stringify(normalized),
          createdAt,
        ],
      )
    })
    await this.refreshStatus()
    this.notifyListeners()
  }

  private async performSync(): Promise<void> {
    this.syncing = true
    try {
      await this.refreshStatus()
      this.notifyListeners()
      const tripIds = new Set<UUID>()
      const discoveredTripIds = new Set<UUID>()
      let discoveryError: string | null = null
      try {
        for (const tripId of await this.discoverTripIds()) {
          if (isUuid(tripId)) {
            tripIds.add(tripId)
            discoveredTripIds.add(tripId)
          }
        }
      } catch (error) {
        discoveryError = errorMessage(error)
      }
      const localTripRows = await this.database.all<{ trip_id: UUID } & Record<string, unknown>>(
        `SELECT trip_id FROM (
           SELECT trip_id FROM outbox
           UNION SELECT trip_id FROM places
           UNION SELECT trip_id FROM visits
           UNION SELECT trip_id FROM wants
           UNION SELECT trip_id FROM reviews
           UNION SELECT trip_id FROM members
           UNION SELECT trip_id FROM sync_state
         ) ORDER BY trip_id`,
      )
      for (const row of localTripRows) tripIds.add(row.trip_id)
      for (const tripId of [...tripIds].sort()) {
        await this.withTripLock(tripId, async () => {
          const state = await this.getSyncState(tripId)
          if (state.removed_at !== null) {
            if (!discoveredTripIds.has(tripId)) return
            await this.database.transaction(async (transaction) => {
              await transaction.run(
                `UPDATE sync_state SET removed_at = NULL, cursor = NULL, snapshot_seq = NULL,
                   itinerary_version = NULL, needs_bootstrap = 1 WHERE trip_id = ?`,
                [tripId],
              )
            })
          }
          await this.pushTrip(tripId)
          await this.pullTrip(tripId)
          await this.database.transaction(async (transaction) => {
            await this.ensureSyncState(transaction, tripId)
            await transaction.run(
              `UPDATE sync_state SET last_synced_at = ?
               WHERE trip_id = ? AND needs_bootstrap = 0 AND snapshot_seq IS NULL`,
              [this.now(), tripId],
            )
          })
        })
      }
      this.runtimeLastError = discoveryError
    } catch (error) {
      this.runtimeLastError = errorMessage(error)
      throw error
    } finally {
      this.syncing = false
      await this.refreshStatus()
      this.notifyListeners()
    }
  }

  /** Envia pendências e persiste quando a projeção exige reconciliação completa. */
  private async pushTrip(tripId: UUID): Promise<void> {
    const rows = await this.database.all<OutboxRow>(
      `SELECT position, op_id, trip_id, type, payload, created_at, status, attempts, last_error
       FROM outbox WHERE trip_id = ? AND status = 'pending' ORDER BY position`,
      [tripId],
    )
    const operations: Array<{ operation: SyncOperation; row: OutboxRow }> = rows.map((row) => {
      let payload: unknown
      try {
        payload = JSON.parse(row.payload)
      } catch {
        throw new Error(`Payload inválido no outbox para ${row.op_id}.`)
      }
      const validation = validateSyncOperation(payload)
      if (
        !validation.success ||
        validation.value.opId !== row.op_id ||
        validation.value.tripId !== tripId
      ) {
        throw new Error(`Operação inválida no outbox para ${row.op_id}.`)
      }
      return { operation: validation.value, row }
    })

    for (let index = 0; index < operations.length; index += this.pushBatchSize) {
      const batch = operations.slice(index, index + this.pushBatchSize)
      const operationIds = batch.map(({ row }) => row.op_id)
      await this.database.transaction(async (transaction) => {
        for (const opId of operationIds) {
          await transaction.run(
            `UPDATE outbox SET attempts = attempts + 1, last_error = NULL
             WHERE op_id = ? AND status = 'pending'`,
            [opId],
          )
        }
      })

      let response: unknown
      try {
        response = await this.transport.push({
          operations: batch.map(({ operation }) => operation),
        })
      } catch (error) {
        await this.recordPushError(operationIds, errorMessage(error))
        throw error
      }

      const validated = validatePushResponse(response)
      if (!validated.success) {
        const error = new Error(
          `Resposta de push inválida: ${validated.issues.map((issue) => issue.message).join(' ')}`,
        )
        await this.recordPushError(operationIds, error.message)
        throw error
      }
      let results: Map<UUID, PushOperationResult>
      try {
        results = this.matchPushResults(operationIds, validated.value.results)
      } catch (error) {
        await this.recordPushError(operationIds, errorMessage(error))
        throw error
      }
      await this.database.transaction(async (transaction) => {
        await this.ensureSyncState(transaction, tripId)
        let needsBootstrap = false
        for (const opId of operationIds) {
          const result = results.get(opId)!
          if (result.status === 'applied' || result.status === 'duplicate') {
            await transaction.run('DELETE FROM outbox WHERE op_id = ?', [opId])
            if (result.status === 'applied') {
              const entry = batch.find(({ row }) => row.op_id === opId)
              if (entry?.operation.type === 'itinerary.arrange') {
                const nextVersion = entry.operation.baseVersion + 1
                await transaction.run(
                  `UPDATE sync_state SET itinerary_version = ?
                   WHERE trip_id = ? AND (itinerary_version IS NULL OR itinerary_version < ?)`,
                  [nextVersion, tripId, nextVersion],
                )
              }
            }
            if (result.status === 'duplicate') needsBootstrap = true
          } else if (result.status === 'conflict') {
            const entry = batch.find(({ row }) => row.op_id === opId)
            if (!entry || entry.operation.type !== 'itinerary.arrange') {
              throw new Error(`Conflito inesperado para operação ${opId}.`)
            }
            const operation = entry.operation
            await transaction.run('DELETE FROM outbox WHERE op_id = ?', [opId])
            await transaction.run(
              `INSERT INTO itinerary_drafts
                 (op_id, trip_id, base_version, current_version, payload, created_at)
               VALUES (?, ?, ?, ?, ?, ?)`,
              [
                operation.opId,
                operation.tripId,
                operation.baseVersion,
                result.currentVersion,
                JSON.stringify(operation.days),
                entry.row.created_at,
              ],
            )
            needsBootstrap = true
          } else if (
            result.status === 'rejected' &&
            (result.reason === 'not_member' || result.reason === 'forbidden')
          ) {
            needsBootstrap = true
            await transaction.run(
              `UPDATE outbox SET status = 'not_sent', last_error = ? WHERE op_id = ?`,
              [result.reason, opId],
            )
          } else if (result.status === 'rejected') {
            await transaction.run('UPDATE outbox SET last_error = ? WHERE op_id = ?', [
              `rejected: ${result.reason}`,
              opId,
            ])
          }
        }
        if (needsBootstrap) {
          // Um snapshot parcial já pode ter passado pela linha otimista; recomeça do zero.
          await transaction.run(
            'UPDATE sync_state SET needs_bootstrap = 1, snapshot_seq = NULL WHERE trip_id = ?',
            [tripId],
          )
        }
      })
    }
  }

  private matchPushResults(
    operationIds: readonly UUID[],
    results: readonly PushOperationResult[],
  ): Map<UUID, PushOperationResult> {
    const matched = new Map<UUID, PushOperationResult>()
    for (const result of results) {
      if (!operationIds.includes(result.opId) || matched.has(result.opId)) {
        throw new Error(`Resposta de push inconsistente para ${result.opId}.`)
      }
      matched.set(result.opId, result)
    }
    if (matched.size !== operationIds.length) {
      throw new Error('Resposta de push sem resultado para todas as operações.')
    }
    return matched
  }

  private async recordPushError(operationIds: readonly UUID[], message: string): Promise<void> {
    this.runtimeLastError = message
    await this.database.transaction(async (transaction) => {
      for (const opId of operationIds) {
        await transaction.run(
          `UPDATE outbox SET last_error = ? WHERE op_id = ? AND status = 'pending'`,
          [message, opId],
        )
      }
    })
    await this.refreshStatus()
    this.notifyListeners()
  }

  private async pullTrip(tripId: UUID): Promise<void> {
    for (let resetCount = 0; resetCount < 2; resetCount += 1) {
      let state = await this.getSyncState(tripId)
      if (state.needs_bootstrap !== 0 && state.snapshot_seq === null) {
        await this.clearTripForBootstrap(tripId)
        state = await this.getSyncState(tripId)
      }
      let needsReset = false
      if (state.needs_bootstrap !== 0 || state.snapshot_seq !== null || state.cursor === null) {
        const outcome = await this.pullBootstrap(tripId, state)
        if (outcome === 'removed') return
        needsReset = outcome
      }
      if (!needsReset) {
        const outcome = await this.pullIncremental(tripId)
        if (outcome === 'removed') return
        needsReset = outcome
      }
      if (!needsReset) return
      if (resetCount === 1)
        throw new Error(`Servidor exigiu novo bootstrap repetidamente para ${tripId}.`)
      await this.clearTripForBootstrap(tripId)
    }
  }

  /** Retorna true quando o servidor exigiu reiniciar o bootstrap. */
  private async pullBootstrap(tripId: UUID, state: SyncStateRow): Promise<boolean | 'removed'> {
    let snapshotSeq = state.snapshot_seq
    let cursor = state.cursor

    while (true) {
      const query: PullQuery =
        snapshotSeq === null
          ? { tripId, mode: 'bootstrap', limit: this.pageSize }
          : { tripId, mode: 'bootstrap', limit: this.pageSize, snapshotSeq, cursor: cursor ?? '0' }
      const response = await this.pullPage(query)
      if ('error' in response) {
        if (response.error === 'not_member') {
          await this.markTripRemoved(tripId)
          return 'removed'
        }
        return true
      }
      if (response.mode !== 'bootstrap')
        throw new Error('Servidor respondeu modo incorreto durante bootstrap.')
      if (snapshotSeq !== null && response.snapshotSeq !== snapshotSeq) {
        throw new Error('snapshotSeq mudou durante o bootstrap.')
      }
      snapshotSeq = response.snapshotSeq
      const oldCursor = cursor ?? '0'
      if (response.hasMore && compareSequence(response.nextCursor, oldCursor) <= 0) {
        throw new Error('Bootstrap informou hasMore sem avançar o cursor.')
      }
      await this.database.transaction(async (transaction) => {
        await this.applyPullPage(transaction, tripId, response)
        if (response.hasMore) {
          await transaction.run(
            'UPDATE sync_state SET cursor = ?, snapshot_seq = ? WHERE trip_id = ?',
            [response.nextCursor, snapshotSeq, tripId],
          )
        } else {
          await transaction.run(
            `UPDATE sync_state SET cursor = ?, snapshot_seq = NULL, needs_bootstrap = 0
             WHERE trip_id = ?`,
            [snapshotSeq, tripId],
          )
        }
        await this.reapplyPending(transaction, tripId)
      })
      if (!response.hasMore) return false
      cursor = response.nextCursor
    }
  }

  /** Retorna true quando o cursor expirou e é necessário limpar/refazer bootstrap. */
  private async pullIncremental(tripId: UUID): Promise<boolean | 'removed'> {
    while (true) {
      const state = await this.getSyncState(tripId)
      if (state.cursor === null) throw new Error(`Cursor ausente após bootstrap de ${tripId}.`)
      const query: PullQuery = {
        tripId,
        mode: 'incremental',
        limit: this.pageSize,
        cursor: state.cursor,
      }
      const response = await this.pullPage(query)
      if ('error' in response) {
        if (response.error === 'not_member') {
          await this.markTripRemoved(tripId)
          return 'removed'
        }
        return true
      }
      if (response.mode !== 'incremental')
        throw new Error('Servidor respondeu modo incorreto durante pull incremental.')
      if (response.hasMore && compareSequence(response.nextCursor, state.cursor) <= 0) {
        throw new Error('Pull informou hasMore sem avançar o cursor.')
      }
      await this.database.transaction(async (transaction) => {
        await this.applyPullPage(transaction, tripId, response)
        await transaction.run('UPDATE sync_state SET cursor = ? WHERE trip_id = ?', [
          response.nextCursor,
          tripId,
        ])
        await this.reapplyPending(transaction, tripId)
      })
      if (!response.hasMore) return false
    }
  }

  private async pullPage(query: PullQuery) {
    const response: unknown = await this.transport.pull(query)
    const validation = validatePullResponse(response)
    if (!validation.success) {
      throw new Error(
        `Resposta de pull inválida: ${validation.issues.map((issue) => issue.message).join(' ')}`,
      )
    }
    return validation.value
  }

  private async applyPullPage(
    transaction: SqlDatabase,
    tripId: UUID,
    page: PullPageData,
  ): Promise<void> {
    for (const place of page.places) {
      if (place.tripId !== tripId) throw new Error('Pull incluiu lugar de outra viagem.')
      await this.upsertPlace(transaction, place)
    }
    for (const visit of page.visits) {
      if (visit.tripId !== tripId) throw new Error('Pull incluiu visita de outra viagem.')
      await this.upsertVisit(transaction, visit)
    }
    for (const want of page.wants) {
      if (want.tripId !== tripId) throw new Error('Pull incluiu quero ir de outra viagem.')
      await this.upsertWant(transaction, want)
    }
    for (const review of page.reviews) {
      if (review.tripId !== tripId) throw new Error('Pull incluiu avaliação de outra viagem.')
      await this.upsertReview(transaction, review)
    }
    for (const member of page.members) {
      if (member.tripId !== tripId) throw new Error('Pull incluiu membro de outra viagem.')
      await this.upsertMember(transaction, member)
    }
    if (compareSequence(page.nextCursor, page.itinerary.atSeq) === 0) {
      await transaction.run('UPDATE sync_state SET itinerary_version = ? WHERE trip_id = ?', [
        page.itinerary.version,
        tripId,
      ])
    }
  }

  private async markTripRemoved(tripId: UUID): Promise<void> {
    await this.database.transaction(async (transaction) => {
      await this.ensureSyncState(transaction, tripId)
      await transaction.run('DELETE FROM places WHERE trip_id = ?', [tripId])
      await transaction.run('DELETE FROM visits WHERE trip_id = ?', [tripId])
      await transaction.run('DELETE FROM wants WHERE trip_id = ?', [tripId])
      await transaction.run('DELETE FROM reviews WHERE trip_id = ?', [tripId])
      await transaction.run('DELETE FROM members WHERE trip_id = ?', [tripId])
      await transaction.run(
        `UPDATE outbox SET status = 'not_sent', last_error = 'not_member'
         WHERE trip_id = ? AND status = 'pending'`,
        [tripId],
      )
      await transaction.run(
        `UPDATE sync_state SET cursor = NULL, snapshot_seq = NULL, needs_bootstrap = 0,
           itinerary_version = NULL, removed_at = ? WHERE trip_id = ?`,
        [this.now(), tripId],
      )
    })
  }

  private async clearTripForBootstrap(tripId: UUID): Promise<void> {
    await this.database.transaction(async (transaction) => {
      await this.ensureSyncState(transaction, tripId)
      await transaction.run('DELETE FROM places WHERE trip_id = ?', [tripId])
      await transaction.run('DELETE FROM visits WHERE trip_id = ?', [tripId])
      await transaction.run('DELETE FROM wants WHERE trip_id = ?', [tripId])
      await transaction.run('DELETE FROM reviews WHERE trip_id = ?', [tripId])
      await transaction.run('DELETE FROM members WHERE trip_id = ?', [tripId])
      await transaction.run(
        'UPDATE sync_state SET cursor = NULL, snapshot_seq = NULL WHERE trip_id = ?',
        [tripId],
      )
      await this.reapplyPending(transaction, tripId)
    })
  }

  private async reapplyPending(transaction: SqlDatabase, tripId: UUID): Promise<void> {
    const rows = await transaction.all<OutboxRow>(
      `SELECT position, op_id, trip_id, type, payload, created_at, status, attempts, last_error
       FROM outbox WHERE trip_id = ? AND status = 'pending' ORDER BY position`,
      [tripId],
    )
    for (const row of rows) {
      const parsed: unknown = JSON.parse(row.payload)
      const validation = validateSyncOperation(parsed)
      if (!validation.success) throw new Error(`Operação pendente inválida: ${row.op_id}.`)
      await this.applyOperation(transaction, validation.value, row.created_at)
    }
  }

  private async applyOperation(
    transaction: SqlDatabase,
    operation: SyncOperation,
    createdAt: string,
  ): Promise<void> {
    if (operation.type === 'place.add') {
      const candidate = operation.candidate
      await transaction.run(
        `INSERT INTO places (
           id, trip_id, provider, provider_ref, country_code, provider_datasource, attribution, license,
           name, local_name, address, local_address, lat, lng, google_place_id, google_match,
           user_local_name, user_local_address, suggested_by, comment, day_index, position,
           seq, deleted_at, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'none', NULL, NULL, ?, NULL, NULL, NULL, '0', NULL, ?)
         ON CONFLICT (id) DO UPDATE SET
           trip_id = excluded.trip_id, provider = excluded.provider,
           provider_ref = excluded.provider_ref, country_code = excluded.country_code,
           provider_datasource = excluded.provider_datasource,
           attribution = excluded.attribution, license = excluded.license, name = excluded.name,
           local_name = excluded.local_name, address = excluded.address,
           local_address = excluded.local_address, lat = excluded.lat, lng = excluded.lng,
           google_place_id = excluded.google_place_id, google_match = excluded.google_match,
           user_local_name = excluded.user_local_name,
           user_local_address = excluded.user_local_address, suggested_by = excluded.suggested_by,
           seq = '0', deleted_at = NULL, created_at = excluded.created_at`,
        [
          operation.placeId,
          operation.tripId,
          candidate?.provider ?? null,
          candidate?.providerRef ?? null,
          candidate?.countryCode ?? null,
          candidate?.datasource ?? null,
          candidate?.attribution ?? null,
          candidate?.license ?? null,
          operation.name,
          candidate?.localName ?? null,
          candidate?.address ?? null,
          candidate?.localAddress ?? null,
          candidate?.lat ?? null,
          candidate?.lng ?? null,
          this.userId,
          createdAt,
        ],
      )
      return
    }

    if (operation.type === 'place.google_link') {
      await transaction.run(
        `UPDATE places SET google_place_id = ?, google_match = ?, seq = '0'
         WHERE id = ? AND trip_id = ?`,
        [
          operation.googlePlaceId,
          operation.googlePlaceId === null ? 'no_match' : 'matched',
          operation.placeId,
          operation.tripId,
        ],
      )
      return
    }

    if (operation.type === 'place.set_local') {
      const assignments: string[] = []
      const parameters: Array<string | null> = []
      if (Object.hasOwn(operation, 'localName')) {
        assignments.push('user_local_name = ?')
        parameters.push(operation.localName ?? null)
      }
      if (Object.hasOwn(operation, 'localAddress')) {
        assignments.push('user_local_address = ?')
        parameters.push(operation.localAddress ?? null)
      }
      assignments.push("seq = '0'")
      parameters.push(operation.placeId, operation.tripId)
      await transaction.run(
        `UPDATE places SET ${assignments.join(', ')} WHERE id = ? AND trip_id = ?`,
        parameters,
      )
      return
    }

    if (operation.type === 'place.remove') {
      await transaction.run(
        'UPDATE places SET deleted_at = ?, seq = ? WHERE id = ? AND trip_id = ?',
        [createdAt, '0', operation.placeId, operation.tripId],
      )
      return
    }

    if (operation.type === 'itinerary.arrange') {
      const dayIndexes = operation.days.map(({ dayIndex }) => dayIndex)
      const placeholders = dayIndexes.map(() => '?').join(', ')
      await transaction.run(
        `UPDATE places SET day_index = NULL, position = NULL, seq = '0'
         WHERE trip_id = ? AND deleted_at IS NULL AND day_index IN (${placeholders})`,
        [operation.tripId, ...dayIndexes],
      )
      for (const day of operation.days) {
        for (const [position, placeId] of day.placeIds.entries()) {
          await transaction.run(
            `UPDATE places SET day_index = ?, position = ?, seq = '0'
             WHERE id = ? AND trip_id = ? AND deleted_at IS NULL`,
            [day.dayIndex, position, placeId, operation.tripId],
          )
        }
      }
      return
    }

    if (operation.type === 'member.remove') {
      await transaction.run(
        `UPDATE members SET deleted_at = ?, seq = '0'
         WHERE trip_id = ? AND user_id = ? AND deleted_at IS NULL`,
        [createdAt, operation.tripId, operation.userId],
      )
      return
    }

    if (operation.type === 'member.set_role') {
      await transaction.run(
        `UPDATE members SET role = ?, seq = '0'
         WHERE trip_id = ? AND user_id = ? AND deleted_at IS NULL`,
        [operation.role, operation.tripId, operation.userId],
      )
      return
    }

    if (operation.type === 'trip.end') {
      return
    }

    if (operation.type === 'place.want') {
      await transaction.run(
        `INSERT INTO wants (place_id, trip_id, user_id, created_at, seq, deleted_at)
         VALUES (?, ?, ?, ?, '0', NULL)
         ON CONFLICT (place_id, user_id) DO UPDATE SET
           trip_id = excluded.trip_id, created_at = excluded.created_at,
           seq = '0', deleted_at = NULL`,
        [operation.placeId, operation.tripId, this.userId, createdAt],
      )
      return
    }

    if (operation.type === 'place.unwant') {
      await transaction.run(
        `INSERT INTO wants (place_id, trip_id, user_id, created_at, seq, deleted_at)
         VALUES (?, ?, ?, ?, '0', ?)
         ON CONFLICT (place_id, user_id) DO UPDATE SET
           trip_id = excluded.trip_id, seq = '0', deleted_at = excluded.deleted_at`,
        [operation.placeId, operation.tripId, this.userId, createdAt, createdAt],
      )
      return
    }

    if (operation.type === 'trip.open') {
      await transaction.run(
        `UPDATE members SET opened_at = COALESCE(opened_at, ?)
         WHERE trip_id = ? AND user_id = ?`,
        [createdAt, operation.tripId, this.userId],
      )
      return
    }

    if (operation.type === 'place.favorite') {
      await transaction.run(
        `INSERT INTO reviews (
           place_id, trip_id, user_id, favorite, rating, note, updated_at, seq, deleted_at
         ) VALUES (?, ?, ?, ?, NULL, NULL, ?, '0', NULL)
         ON CONFLICT (place_id, user_id) DO UPDATE SET
           trip_id = excluded.trip_id, favorite = excluded.favorite,
           updated_at = excluded.updated_at, seq = '0'`,
        [operation.placeId, operation.tripId, this.userId, operation.favorite ? 1 : 0, createdAt],
      )
      return
    }

    if (operation.type === 'place.rate') {
      await transaction.run(
        `INSERT INTO reviews (
           place_id, trip_id, user_id, favorite, rating, note, updated_at, seq, deleted_at
         ) VALUES (?, ?, ?, 0, ?, NULL, ?, '0', NULL)
         ON CONFLICT (place_id, user_id) DO UPDATE SET
           trip_id = excluded.trip_id, rating = excluded.rating,
           updated_at = excluded.updated_at, seq = '0'`,
        [operation.placeId, operation.tripId, this.userId, operation.rating, createdAt],
      )
      return
    }

    if (operation.type === 'place.note') {
      await transaction.run(
        `INSERT INTO reviews (
           place_id, trip_id, user_id, favorite, rating, note, updated_at, seq, deleted_at
         ) VALUES (?, ?, ?, 0, NULL, ?, ?, '0', NULL)
         ON CONFLICT (place_id, user_id) DO UPDATE SET
           trip_id = excluded.trip_id, note = excluded.note,
           updated_at = excluded.updated_at, seq = '0'`,
        [operation.placeId, operation.tripId, this.userId, operation.note, createdAt],
      )
      return
    }

    // Quem marca ou desmarca é o remetente; a visita pertence ao alvo (padrão: o próprio remetente).
    const targetId = operation.userId ?? this.userId
    if (operation.type === 'visit.mark') {
      await transaction.run(
        `INSERT INTO visits (
           place_id, trip_id, user_id, marked_by, visited_at, visited_tz, seq, deleted_at
         ) VALUES (?, ?, ?, ?, ?, ?, '0', NULL)
         ON CONFLICT (place_id, user_id) DO UPDATE SET
           trip_id = excluded.trip_id, marked_by = excluded.marked_by,
           visited_at = excluded.visited_at, visited_tz = excluded.visited_tz,
           seq = '0', deleted_at = NULL`,
        [operation.placeId, operation.tripId, targetId, this.userId, createdAt, this.timeZone],
      )
      return
    }

    await transaction.run(
      `INSERT INTO visits (
         place_id, trip_id, user_id, marked_by, visited_at, visited_tz, seq, deleted_at
       ) VALUES (?, ?, ?, ?, ?, ?, '0', ?)
       ON CONFLICT (place_id, user_id) DO UPDATE SET
         trip_id = excluded.trip_id, seq = '0', deleted_at = excluded.deleted_at`,
      [
        operation.placeId,
        operation.tripId,
        targetId,
        this.userId,
        createdAt,
        this.timeZone,
        createdAt,
      ],
    )
  }

  private async upsertPlace(transaction: SqlDatabase, place: SyncPlace): Promise<void> {
    await transaction.run(
      `INSERT INTO places (
         id, trip_id, provider, provider_ref, country_code, provider_datasource, attribution, license,
         name, local_name, address, local_address, lat, lng, google_place_id, google_match,
         user_local_name, user_local_address, suggested_by, comment, day_index, position,
         seq, deleted_at, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET
         trip_id = excluded.trip_id, provider = excluded.provider, provider_ref = excluded.provider_ref,
         country_code = excluded.country_code,
         provider_datasource = excluded.provider_datasource, attribution = excluded.attribution,
         license = excluded.license,
         name = excluded.name, local_name = excluded.local_name, address = excluded.address,
         local_address = excluded.local_address, lat = excluded.lat, lng = excluded.lng,
         google_place_id = excluded.google_place_id, google_match = excluded.google_match,
         user_local_name = excluded.user_local_name, user_local_address = excluded.user_local_address,
         suggested_by = excluded.suggested_by, comment = excluded.comment,
         day_index = excluded.day_index, position = excluded.position, seq = excluded.seq,
         deleted_at = excluded.deleted_at, created_at = excluded.created_at`,
      [
        place.id,
        place.tripId,
        place.provider,
        place.providerRef,
        place.countryCode,
        place.providerDatasource,
        place.attribution,
        place.license,
        place.name,
        place.localName,
        place.address,
        place.localAddress,
        place.lat,
        place.lng,
        place.googlePlaceId,
        place.googleMatch,
        place.userLocalName,
        place.userLocalAddress,
        place.suggestedBy,
        place.comment,
        place.dayIndex,
        place.position,
        place.seq,
        place.deletedAt,
        place.createdAt,
      ],
    )
  }

  private async upsertVisit(transaction: SqlDatabase, visit: SyncVisit): Promise<void> {
    await transaction.run(
      `INSERT INTO visits (
         place_id, trip_id, user_id, marked_by, visited_at, visited_tz, seq, deleted_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (place_id, user_id) DO UPDATE SET
         trip_id = excluded.trip_id, marked_by = excluded.marked_by,
         visited_at = excluded.visited_at, visited_tz = excluded.visited_tz,
         seq = excluded.seq, deleted_at = excluded.deleted_at`,
      [
        visit.placeId,
        visit.tripId,
        visit.userId,
        visit.markedBy,
        visit.visitedAt,
        visit.visitedTz,
        visit.seq,
        visit.deletedAt,
      ],
    )
  }

  private async upsertWant(transaction: SqlDatabase, want: SyncWant): Promise<void> {
    await transaction.run(
      `INSERT INTO wants (place_id, trip_id, user_id, created_at, seq, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (place_id, user_id) DO UPDATE SET
         trip_id = excluded.trip_id, created_at = excluded.created_at,
         seq = excluded.seq, deleted_at = excluded.deleted_at`,
      [want.placeId, want.tripId, want.userId, want.createdAt, want.seq, want.deletedAt],
    )
  }

  private async upsertReview(transaction: SqlDatabase, review: SyncReview): Promise<void> {
    await transaction.run(
      `INSERT INTO reviews (
         place_id, trip_id, user_id, favorite, rating, note, updated_at, seq, deleted_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (place_id, user_id) DO UPDATE SET
         trip_id = excluded.trip_id, favorite = excluded.favorite, rating = excluded.rating,
         note = excluded.note, updated_at = excluded.updated_at, seq = excluded.seq,
         deleted_at = excluded.deleted_at`,
      [
        review.placeId,
        review.tripId,
        review.userId,
        review.favorite ? 1 : 0,
        review.rating,
        review.note,
        review.updatedAt,
        review.seq,
        review.deletedAt,
      ],
    )
  }

  private async upsertMember(transaction: SqlDatabase, member: SyncMember): Promise<void> {
    await transaction.run(
      `INSERT INTO members (trip_id, user_id, role, joined_at, opened_at, seq, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (trip_id, user_id) DO UPDATE SET
         role = excluded.role, joined_at = excluded.joined_at,
         opened_at = COALESCE(excluded.opened_at, members.opened_at),
         seq = excluded.seq, deleted_at = excluded.deleted_at`,
      [
        member.tripId,
        member.userId,
        member.role,
        member.joinedAt,
        member.openedAt,
        member.seq,
        member.deletedAt,
      ],
    )
  }

  private async nextItineraryBaseVersion(transaction: SqlDatabase, tripId: UUID): Promise<number> {
    const state = await transaction.get<
      { itinerary_version: number | null } & Record<string, unknown>
    >('SELECT itinerary_version FROM sync_state WHERE trip_id = ?', [tripId])
    const pending = await transaction.get<{ count: number } & Record<string, unknown>>(
      `SELECT COUNT(*) AS count FROM outbox
       WHERE trip_id = ? AND type = 'itinerary.arrange' AND status = 'pending'`,
      [tripId],
    )
    return (state?.itinerary_version ?? 0) + Number(pending?.count ?? 0)
  }

  private itineraryDaysFromDraft(row: ItineraryDraftRow): ItineraryDay[] {
    let payload: unknown
    try {
      payload = JSON.parse(row.payload)
    } catch {
      throw new Error(`Payload inválido no rascunho de roteiro ${row.op_id}.`)
    }
    const validation = validateSyncOperation({
      type: 'itinerary.arrange',
      opId: row.op_id,
      tripId: row.trip_id,
      baseVersion: row.base_version,
      days: payload,
    })
    if (!validation.success || validation.value.type !== 'itinerary.arrange') {
      throw new Error(`Rascunho de roteiro inválido: ${row.op_id}.`)
    }
    return validation.value.days
  }

  private async ensureSyncState(transaction: SqlDatabase, tripId: UUID): Promise<void> {
    await transaction.run('INSERT OR IGNORE INTO sync_state (trip_id) VALUES (?)', [tripId])
  }

  private async getSyncState(tripId: UUID): Promise<SyncStateRow> {
    await this.database.transaction(async (transaction) =>
      this.ensureSyncState(transaction, tripId),
    )
    const state = await this.database.get<SyncStateRow>(
      `SELECT trip_id, cursor, snapshot_seq, last_synced_at, needs_bootstrap,
         itinerary_version, removed_at
       FROM sync_state WHERE trip_id = ?`,
      [tripId],
    )
    if (!state) throw new Error(`Estado de sync ausente para ${tripId}.`)
    return state
  }

  private async refreshStatus(): Promise<void> {
    const counts = await this.database.get<StatusCounts>(
      `SELECT
         SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
         SUM(CASE WHEN status = 'not_sent' THEN 1 ELSE 0 END) AS not_sent
       FROM outbox`,
    )
    const sync = await this.database.get<
      { last_synced_at: string | null } & Record<string, unknown>
    >('SELECT MAX(last_synced_at) AS last_synced_at FROM sync_state')
    const lastError = await this.database.get<
      { last_error: string | null } & Record<string, unknown>
    >('SELECT last_error FROM outbox WHERE last_error IS NOT NULL ORDER BY position DESC LIMIT 1')
    this.status = {
      lastSyncedAt: sync?.last_synced_at ?? null,
      pending: Number(counts?.pending ?? 0),
      notSent: Number(counts?.not_sent ?? 0),
      syncing: this.syncing,
      lastError: this.runtimeLastError ?? lastError?.last_error ?? null,
    }
  }

  private notifyListeners(): void {
    for (const listener of [...this.listeners]) listener()
  }

  private async withTripLock(tripId: UUID, operation: () => Promise<void>): Promise<void> {
    let locks = tripLocks.get(this.database)
    if (!locks) {
      locks = new Map()
      tripLocks.set(this.database, locks)
    }
    const previous = locks.get(tripId) ?? Promise.resolve()
    const current = previous.catch(() => undefined).then(operation)
    locks.set(tripId, current)
    try {
      await current
    } finally {
      if (locks.get(tripId) === current) locks.delete(tripId)
    }
  }

  private placeFromRow(row: PlaceRow): SyncPlace {
    return {
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
    }
  }
}

function compareSequence(left: string, right: string): number {
  const leftValue = BigInt(left)
  const rightValue = BigInt(right)
  return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
