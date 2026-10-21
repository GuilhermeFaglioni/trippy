import { validatePlaceName } from '@trippy/domain/places'
import type {
  AcceptInviteRequest,
  CreateInviteParams,
  PullQuery,
  PullResponse,
  PushOperationResult,
  PushRequest,
  PushResponse,
  RejectedOperationReason,
  SyncMember,
  SyncPlace,
  SyncSequence,
  SyncVisit,
  UUID,
} from './types.ts'

export interface ValidationIssue {
  path: string
  message: string
}

export type ValidationResult<T> =
  | { success: true; value: T }
  | { success: false; issues: ValidationIssue[] }

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu
const sequencePattern = /^(0|[1-9]\d*)$/u
const maxSyncSequence = '9223372036854775807'

export function isUuid(value: unknown): value is UUID {
  return typeof value === 'string' && uuidPattern.test(value)
}

export function isSyncSequence(value: unknown): value is SyncSequence {
  return (
    typeof value === 'string' &&
    sequencePattern.test(value) &&
    (value.length < maxSyncSequence.length ||
      (value.length === maxSyncSequence.length && value <= maxSyncSequence))
  )
}

export function isTripRole(value: unknown): value is SyncMember['role'] {
  return value === 'organizer' || value === 'coorganizer' || value === 'member'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isDateTime(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && Number.isFinite(Date.parse(value))
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isFinite(value))
}

function failure<T = never>(path: string, message: string): ValidationResult<T> {
  return { success: false, issues: [{ path, message }] }
}

export function validateSyncOperation(value: unknown): ValidationResult<PushRequest['operations'][number]> {
  if (!isRecord(value)) return failure('$', 'A operação precisa ser um objeto.')
  if (!isUuid(value.opId)) return failure('opId', 'Informe um UUID válido.')
  if (!isUuid(value.tripId)) return failure('tripId', 'Informe um UUID válido.')

  if (value.type === 'place.add') {
    if (!isUuid(value.placeId)) return failure('placeId', 'Informe um UUID válido.')
    const name = validatePlaceName(value.name)
    if (!name.success) return failure('name', name.message)
    return {
      success: true,
      value: {
        type: 'place.add',
        opId: value.opId,
        tripId: value.tripId,
        placeId: value.placeId,
        name: name.value,
      },
    }
  }

  if (value.type === 'place.remove' || value.type === 'visit.mark' || value.type === 'visit.unmark') {
    if (!isUuid(value.placeId)) return failure('placeId', 'Informe um UUID válido.')
    return {
      success: true,
      value: {
        type: value.type,
        opId: value.opId,
        tripId: value.tripId,
        placeId: value.placeId,
      },
    }
  }

  return failure('type', 'Tipo de operação desconhecido.')
}

export function validatePushRequest(value: unknown): ValidationResult<PushRequest> {
  if (!isRecord(value) || !Array.isArray(value.operations)) {
    return failure('operations', 'Informe a lista de operações.')
  }

  const operations: PushRequest['operations'] = []
  const issues: ValidationIssue[] = []
  value.operations.forEach((operation, index) => {
    const result = validateSyncOperation(operation)
    if (result.success) operations.push(result.value)
    else {
      issues.push(...result.issues.map((issue) => ({
        path: `operations[${index}]${issue.path === '$' ? '' : `.${issue.path}`}`,
        message: issue.message,
      })))
    }
  })

  return issues.length > 0 ? { success: false, issues } : { success: true, value: { operations } }
}

function isRejectedReason(value: unknown): value is RejectedOperationReason {
  return value === 'not_member' || value === 'forbidden' || value === 'invalid'
}

function validatePushOperationResult(value: unknown): value is PushOperationResult {
  if (!isRecord(value) || !isUuid(value.opId)) return false
  if (value.status === 'applied' || value.status === 'duplicate') return true
  return value.status === 'rejected' && isRejectedReason(value.reason)
}

export function validatePushResponse(value: unknown): ValidationResult<PushResponse> {
  if (!isRecord(value) || !Array.isArray(value.results)) {
    return failure('results', 'Informe os resultados das operações.')
  }
  if (!value.results.every(validatePushOperationResult)) {
    return failure('results', 'Um ou mais resultados de operação são inválidos.')
  }
  return { success: true, value: { results: value.results } }
}

export function validatePullQuery(
  query: Readonly<Record<string, string | undefined>>,
): ValidationResult<PullQuery> {
  const tripId = query.trip
  if (!isUuid(tripId)) return failure('trip', 'Informe um UUID válido.')

  const limit = Number(query.limit)
  if (!query.limit || !Number.isSafeInteger(limit) || limit < 1) {
    return failure('limit', 'Informe um limite inteiro positivo.')
  }

  const cursor = query.cursor
  const snapshotSeq = query.snapshotSeq
  if (cursor === undefined && snapshotSeq === undefined) {
    return { success: true, value: { tripId, mode: 'bootstrap', limit } }
  }
  if (cursor === undefined && snapshotSeq !== undefined) {
    return failure('cursor', 'Cursor obrigatório ao continuar o bootstrap.')
  }
  if (!isSyncSequence(cursor)) return failure('cursor', 'Cursor inválido.')
  if (snapshotSeq !== undefined) {
    if (!isSyncSequence(snapshotSeq)) return failure('snapshotSeq', 'Snapshot inválido.')
    return {
      success: true,
      value: { tripId, mode: 'bootstrap', limit, snapshotSeq, cursor },
    }
  }
  return { success: true, value: { tripId, mode: 'incremental', limit, cursor } }
}

function validatePlace(value: unknown): value is SyncPlace {
  return (
    isRecord(value) &&
    isUuid(value.id) &&
    isUuid(value.tripId) &&
    isNullableString(value.provider) &&
    isNullableString(value.providerRef) &&
    typeof value.name === 'string' &&
    isNullableString(value.localName) &&
    isNullableString(value.address) &&
    isNullableString(value.localAddress) &&
    isNullableNumber(value.lat) &&
    isNullableNumber(value.lng) &&
    isUuid(value.suggestedBy) &&
    isNullableString(value.comment) &&
    (value.dayIndex === null || (typeof value.dayIndex === 'number' && Number.isInteger(value.dayIndex))) &&
    (value.position === null || (typeof value.position === 'number' && Number.isInteger(value.position))) &&
    isSyncSequence(value.seq) &&
    (value.deletedAt === null || isDateTime(value.deletedAt)) &&
    isDateTime(value.createdAt)
  )
}

function validateVisit(value: unknown): value is SyncVisit {
  return (
    isRecord(value) &&
    isUuid(value.placeId) &&
    isUuid(value.tripId) &&
    isUuid(value.userId) &&
    isUuid(value.markedBy) &&
    isDateTime(value.visitedAt) &&
    typeof value.visitedTz === 'string' &&
    isSyncSequence(value.seq) &&
    (value.deletedAt === null || isDateTime(value.deletedAt))
  )
}

function validateMember(value: unknown): value is SyncMember {
  return (
    isRecord(value) &&
    isUuid(value.tripId) &&
    isUuid(value.userId) &&
    isTripRole(value.role) &&
    isDateTime(value.joinedAt) &&
    isSyncSequence(value.seq) &&
    (value.deletedAt === null || isDateTime(value.deletedAt))
  )
}

function isStringArrayOf<T>(value: unknown, validate: (item: unknown) => item is T): value is T[] {
  return Array.isArray(value) && value.every(validate)
}

function validatePullPageData(value: Record<string, unknown>): value is Record<string, unknown> & {
  places: SyncPlace[]
  visits: SyncVisit[]
  members: SyncMember[]
  nextCursor: SyncSequence
  hasMore: boolean
} {
  return (
    isStringArrayOf(value.places, validatePlace) &&
    isStringArrayOf(value.visits, validateVisit) &&
    isStringArrayOf(value.members, validateMember) &&
    isSyncSequence(value.nextCursor) &&
    typeof value.hasMore === 'boolean'
  )
}

export function validatePullResponse(value: unknown): ValidationResult<PullResponse> {
  if (isRecord(value) && value.error === 'bootstrap_required') {
    return { success: true, value: { error: 'bootstrap_required' } }
  }
  if (!isRecord(value) || !validatePullPageData(value)) {
    return failure('$', 'Resposta de pull inválida.')
  }

  if (value.mode === 'bootstrap' && isSyncSequence(value.snapshotSeq)) {
    return {
      success: true,
      value: {
        mode: 'bootstrap',
        snapshotSeq: value.snapshotSeq,
        places: value.places,
        visits: value.visits,
        members: value.members,
        nextCursor: value.nextCursor,
        hasMore: value.hasMore,
      },
    }
  }
  if (value.mode === 'incremental') {
    return {
      success: true,
      value: {
        mode: 'incremental',
        places: value.places,
        visits: value.visits,
        members: value.members,
        nextCursor: value.nextCursor,
        hasMore: value.hasMore,
      },
    }
  }
  return failure('mode', 'Modo de pull desconhecido.')
}

export function validateCreateInviteParams(value: unknown): ValidationResult<CreateInviteParams> {
  if (!isRecord(value) || !isUuid(value.tripId)) {
    return failure('tripId', 'Informe um UUID válido.')
  }
  return { success: true, value: { tripId: value.tripId } }
}

export function validateCreateInviteResponse(value: unknown): ValidationResult<{ token: string }> {
  if (!isRecord(value) || typeof value.token !== 'string' || value.token.length === 0) {
    return failure('token', 'Token de convite inválido.')
  }
  return { success: true, value: { token: value.token } }
}

export function validateAcceptInviteRequest(value: unknown): ValidationResult<AcceptInviteRequest> {
  if (!isRecord(value) || typeof value.token !== 'string' || value.token.trim().length === 0) {
    return failure('token', 'Informe um token de convite.')
  }
  return { success: true, value: { token: value.token.trim() } }
}
