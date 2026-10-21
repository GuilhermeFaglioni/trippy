import type { SqlDatabase } from '../database.ts'
import {
  type PullPageData,
  type PullQuery,
  type PushOperationResult,
  type SyncMember,
  type SyncOperation,
  type SyncPlace,
  type SyncVisit,
  type UUID,
} from '../types.ts'
import {
  isUuid,
  validatePullResponse,
  validatePushResponse,
  validateSyncOperation,
} from '../validation.ts'
import { migrateSyncDatabase } from './schema.ts'
import type { LivePlace, SyncClient, SyncClientStatus, SyncTransport } from './types.ts'

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

  async removePlace(tripId: UUID, placeId: UUID): Promise<void> {
    await this.writeOperation({ type: 'place.remove', opId: this.idGenerator(), tripId, placeId })
  }

  async markVisit(tripId: UUID, placeId: UUID): Promise<void> {
    await this.writeOperation({ type: 'visit.mark', opId: this.idGenerator(), tripId, placeId })
  }

  async unmarkVisit(tripId: UUID, placeId: UUID): Promise<void> {
    await this.writeOperation({ type: 'visit.unmark', opId: this.idGenerator(), tripId, placeId })
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

  async listPlaces(tripId: UUID): Promise<LivePlace[]> {
    const rows = await this.database.all<PlaceRow & { visited_by_me: number }>(
      `SELECT places.*, EXISTS (
         SELECT 1 FROM visits
         WHERE visits.place_id = places.id
           AND visits.trip_id = places.trip_id
           AND visits.user_id = ?
           AND visits.deleted_at IS NULL
       ) AS visited_by_me
       FROM places
       WHERE places.trip_id = ? AND places.deleted_at IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM members
           WHERE members.trip_id = places.trip_id
             AND members.user_id = ?
             AND members.deleted_at IS NOT NULL
         )
       ORDER BY places.position IS NULL, places.position, places.created_at, places.id`,
      [this.userId, tripId, this.userId],
    )
    return rows.map((row) => ({
      ...this.placeFromRow(row),
      deletedAt: null,
      visitedByMe: row.visited_by_me !== 0,
    }))
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
      let discoveryError: string | null = null
      try {
        for (const tripId of await this.discoverTripIds()) {
          if (isUuid(tripId)) tripIds.add(tripId)
        }
      } catch (error) {
        discoveryError = errorMessage(error)
      }
      const localTripRows = await this.database.all<{ trip_id: UUID } & Record<string, unknown>>(
        `SELECT trip_id FROM (
           SELECT trip_id FROM outbox
           UNION SELECT trip_id FROM places
           UNION SELECT trip_id FROM visits
           UNION SELECT trip_id FROM members
           UNION SELECT trip_id FROM sync_state
         ) ORDER BY trip_id`,
      )
      for (const row of localTripRows) tripIds.add(row.trip_id)
      for (const tripId of [...tripIds].sort()) {
        await this.withTripLock(tripId, async () => {
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
            if (result.status === 'duplicate') needsBootstrap = true
          } else if (result.reason === 'not_member' || result.reason === 'forbidden') {
            needsBootstrap = true
            await transaction.run(
              `UPDATE outbox SET status = 'not_sent', last_error = ? WHERE op_id = ?`,
              [result.reason, opId],
            )
          } else {
            await transaction.run('UPDATE outbox SET last_error = ? WHERE op_id = ?', [
              `rejected: ${result.reason}`,
              opId,
            ])
          }
        }
        if (needsBootstrap) {
          await transaction.run('UPDATE sync_state SET needs_bootstrap = 1 WHERE trip_id = ?', [
            tripId,
          ])
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
        needsReset = await this.pullBootstrap(tripId, state)
      }
      if (!needsReset) needsReset = await this.pullIncremental(tripId)
      if (!needsReset) return
      if (resetCount === 1)
        throw new Error(`Servidor exigiu novo bootstrap repetidamente para ${tripId}.`)
      await this.clearTripForBootstrap(tripId)
    }
  }

  /** Retorna true quando o servidor exigiu reiniciar o bootstrap. */
  private async pullBootstrap(tripId: UUID, state: SyncStateRow): Promise<boolean> {
    let snapshotSeq = state.snapshot_seq
    let cursor = state.cursor

    while (true) {
      const query: PullQuery =
        snapshotSeq === null
          ? { tripId, mode: 'bootstrap', limit: this.pageSize }
          : { tripId, mode: 'bootstrap', limit: this.pageSize, snapshotSeq, cursor: cursor ?? '0' }
      const response = await this.pullPage(query)
      if ('error' in response) return true
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
  private async pullIncremental(tripId: UUID): Promise<boolean> {
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
      if ('error' in response) return true
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
    for (const member of page.members) {
      if (member.tripId !== tripId) throw new Error('Pull incluiu membro de outra viagem.')
      await this.upsertMember(transaction, member)
    }
  }

  private async clearTripForBootstrap(tripId: UUID): Promise<void> {
    await this.database.transaction(async (transaction) => {
      await this.ensureSyncState(transaction, tripId)
      await transaction.run('DELETE FROM places WHERE trip_id = ?', [tripId])
      await transaction.run('DELETE FROM visits WHERE trip_id = ?', [tripId])
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
      await transaction.run(
        `INSERT INTO places (
           id, trip_id, provider, provider_ref, name, local_name, address, local_address, lat, lng,
           suggested_by, comment, day_index, position, seq, deleted_at, created_at
         ) VALUES (?, ?, NULL, NULL, ?, NULL, NULL, NULL, NULL, NULL, ?, NULL, NULL, NULL, '0', NULL, ?)
         ON CONFLICT (id) DO UPDATE SET
           trip_id = excluded.trip_id, name = excluded.name, suggested_by = excluded.suggested_by,
           seq = '0', deleted_at = NULL, created_at = excluded.created_at`,
        [operation.placeId, operation.tripId, operation.name, this.userId, createdAt],
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

    if (operation.type === 'visit.mark') {
      await transaction.run(
        `INSERT INTO visits (
           place_id, trip_id, user_id, marked_by, visited_at, visited_tz, seq, deleted_at
         ) VALUES (?, ?, ?, ?, ?, ?, '0', NULL)
         ON CONFLICT (place_id, user_id) DO UPDATE SET
           trip_id = excluded.trip_id, marked_by = excluded.marked_by,
           visited_at = excluded.visited_at, visited_tz = excluded.visited_tz,
           seq = '0', deleted_at = NULL`,
        [operation.placeId, operation.tripId, this.userId, this.userId, createdAt, this.timeZone],
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
        this.userId,
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
         id, trip_id, provider, provider_ref, name, local_name, address, local_address, lat, lng,
         suggested_by, comment, day_index, position, seq, deleted_at, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET
         trip_id = excluded.trip_id, provider = excluded.provider, provider_ref = excluded.provider_ref,
         name = excluded.name, local_name = excluded.local_name, address = excluded.address,
         local_address = excluded.local_address, lat = excluded.lat, lng = excluded.lng,
         suggested_by = excluded.suggested_by, comment = excluded.comment,
         day_index = excluded.day_index, position = excluded.position, seq = excluded.seq,
         deleted_at = excluded.deleted_at, created_at = excluded.created_at`,
      [
        place.id,
        place.tripId,
        place.provider,
        place.providerRef,
        place.name,
        place.localName,
        place.address,
        place.localAddress,
        place.lat,
        place.lng,
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

  private async upsertMember(transaction: SqlDatabase, member: SyncMember): Promise<void> {
    await transaction.run(
      `INSERT INTO members (trip_id, user_id, role, joined_at, seq, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (trip_id, user_id) DO UPDATE SET
         role = excluded.role, joined_at = excluded.joined_at,
         seq = excluded.seq, deleted_at = excluded.deleted_at`,
      [member.tripId, member.userId, member.role, member.joinedAt, member.seq, member.deletedAt],
    )
  }

  private async ensureSyncState(transaction: SqlDatabase, tripId: UUID): Promise<void> {
    await transaction.run('INSERT OR IGNORE INTO sync_state (trip_id) VALUES (?)', [tripId])
  }

  private async getSyncState(tripId: UUID): Promise<SyncStateRow> {
    await this.database.transaction(async (transaction) =>
      this.ensureSyncState(transaction, tripId),
    )
    const state = await this.database.get<SyncStateRow>(
      `SELECT trip_id, cursor, snapshot_seq, last_synced_at, needs_bootstrap
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
