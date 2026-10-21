import type { Role } from '@trippy/domain'

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

export interface ItineraryDay {
  dayIndex: number
  placeIds: UUID[]
}

export interface ArrangeItineraryOperation extends OperationMetadata {
  type: 'itinerary.arrange'
  baseVersion: number
  days: ItineraryDay[]
}

export interface RemoveMemberOperation extends OperationMetadata {
  type: 'member.remove'
  userId: UUID
}

export interface SetMemberRoleOperation extends OperationMetadata {
  type: 'member.set_role'
  userId: UUID
  role: 'coorganizer' | 'member'
}

export type SyncOperation =
  | AddPlaceOperation
  | RemovePlaceOperation
  | MarkVisitOperation
  | UnmarkVisitOperation
  | ArrangeItineraryOperation
  | RemoveMemberOperation
  | SetMemberRoleOperation

export interface PushRequest {
  operations: SyncOperation[]
}

export type RejectedOperationReason = 'not_member' | 'forbidden' | 'invalid'

export type PushOperationResult =
  | { opId: UUID; status: 'applied' }
  | { opId: UUID; status: 'duplicate' }
  | { opId: UUID; status: 'conflict'; currentVersion: number }
  | { opId: UUID; status: 'rejected'; reason: RejectedOperationReason }

export interface PushResponse {
  results: PushOperationResult[]
}

export interface SyncPlace {
  id: UUID
  tripId: UUID
  provider: string | null
  providerRef: string | null
  name: string
  localName: string | null
  address: string | null
  localAddress: string | null
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
  itinerary: { version: number; atSeq: SyncSequence }
  nextCursor: SyncSequence
  hasMore: boolean
}

export type PullResponse =
  | (PullPageData & { mode: 'bootstrap'; snapshotSeq: SyncSequence })
  | (PullPageData & { mode: 'incremental' })
  | { error: 'bootstrap_required' }
  | { error: 'not_member' }

export interface CreateInviteParams {
  tripId: UUID
}

export interface CreateInviteResponse {
  token: string
}

export interface AcceptInviteRequest {
  token: string
}
