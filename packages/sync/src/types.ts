import type { LocalDetailStatus, PlaceSearchCandidate, Role } from '@trippy/domain'

export type UUID = string

/** Decimais em texto evitam perda de precisão ao transportar bigint pelo JSON. */
export type SyncSequence = string

export interface OperationMetadata {
  opId: UUID
  tripId: UUID
}

export interface AddPlaceOperation extends OperationMetadata {
  type: 'place.add'
  placeId: UUID
  name: string
  candidate?: PlaceSearchCandidate
}

export interface RemovePlaceOperation extends OperationMetadata {
  type: 'place.remove'
  placeId: UUID
}

export interface MarkVisitOperation extends OperationMetadata {
  type: 'visit.mark'
  placeId: UUID
}

export interface UnmarkVisitOperation extends OperationMetadata {
  type: 'visit.unmark'
  placeId: UUID
}

export interface LinkGooglePlaceOperation extends OperationMetadata {
  type: 'place.google_link'
  placeId: UUID
  googlePlaceId: string | null
}

export interface SetLocalDetailsOperation extends OperationMetadata {
  type: 'place.set_local'
  placeId: UUID
  localName?: string | null
  localAddress?: string | null
}

export type SyncOperation =
  | AddPlaceOperation
  | RemovePlaceOperation
  | LinkGooglePlaceOperation
  | SetLocalDetailsOperation
  | MarkVisitOperation
  | UnmarkVisitOperation

export interface PushRequest {
  operations: SyncOperation[]
}

export type RejectedOperationReason = 'not_member' | 'forbidden' | 'invalid'

export type PushOperationResult =
  | { opId: UUID; status: 'applied' }
  | { opId: UUID; status: 'duplicate' }
  | { opId: UUID; status: 'rejected'; reason: RejectedOperationReason }

export interface PushResponse {
  results: PushOperationResult[]
}

export interface SyncPlace {
  id: UUID
  tripId: UUID
  provider: string | null
  providerRef: string | null
  providerDatasource: string | null
  attribution: string | null
  license: string | null
  name: string
  localName: string | null
  address: string | null
  localAddress: string | null
  googlePlaceId: string | null
  googleMatch: 'none' | 'matched' | 'no_match'
  userLocalName: string | null
  userLocalAddress: string | null
  lat: number | null
  lng: number | null
  suggestedBy: UUID
  comment: string | null
  dayIndex: number | null
  position: number | null
  seq: SyncSequence
  deletedAt: string | null
  createdAt: string
}

export interface LivePlaceLocalStatuses {
  localNameStatus: LocalDetailStatus
  localAddressStatus: LocalDetailStatus
}

export interface SyncVisit {
  placeId: UUID
  tripId: UUID
  userId: UUID
  markedBy: UUID
  visitedAt: string
  visitedTz: string
  seq: SyncSequence
  deletedAt: string | null
}

/** `deletedAt` representa `trip_members.left_at` na fronteira HTTP. */
export interface SyncMember {
  tripId: UUID
  userId: UUID
  role: Role
  joinedAt: string
  seq: SyncSequence
  deletedAt: string | null
}

export type PullQuery =
  | { tripId: UUID; mode: 'bootstrap'; limit: number }
  | {
      tripId: UUID
      mode: 'bootstrap'
      limit: number
      snapshotSeq: SyncSequence
      cursor: SyncSequence
    }
  | { tripId: UUID; mode: 'incremental'; limit: number; cursor: SyncSequence }

export interface PullPageData {
  places: SyncPlace[]
  visits: SyncVisit[]
  members: SyncMember[]
  nextCursor: SyncSequence
  hasMore: boolean
}

export type PullResponse =
  | (PullPageData & { mode: 'bootstrap'; snapshotSeq: SyncSequence })
  | (PullPageData & { mode: 'incremental' })
  | { error: 'bootstrap_required' }

export interface CreateInviteParams {
  tripId: UUID
}

export interface CreateInviteResponse {
  token: string
}

export interface AcceptInviteRequest {
  token: string
}
