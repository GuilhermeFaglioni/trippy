import type {
  PullQuery,
  PullResponse,
  PushRequest,
  PushResponse,
  LivePlaceLocalStatuses,
  SyncPlace,
  UUID,
} from '../types.ts'
import type { PlaceSearchCandidate } from '@trippy/domain'

export type LivePlace = Omit<SyncPlace, 'deletedAt'> & {
  deletedAt: null
  visitedByMe: boolean
} & LivePlaceLocalStatuses

export interface SyncClientStatus {
  lastSyncedAt: string | null
  pending: number
  notSent: number
  syncing?: boolean
  lastError?: string | null
}

export interface SyncClient {
  addPlace(tripId: UUID, name: string): Promise<UUID>
  addPlaceFromCandidate(tripId: UUID, candidate: PlaceSearchCandidate): Promise<UUID>
  removePlace(tripId: UUID, placeId: UUID): Promise<void>
  linkGooglePlace(tripId: UUID, placeId: UUID, googlePlaceId: string | null): Promise<void>
  setLocalDetails(
    tripId: UUID,
    placeId: UUID,
    details: { localName?: string | null; localAddress?: string | null },
  ): Promise<void>
  markVisit(tripId: UUID, placeId: UUID): Promise<void>
  unmarkVisit(tripId: UUID, placeId: UUID): Promise<void>
  syncNow(): Promise<void>
  listPlaces(tripId: UUID, _countryCode?: string | null): Promise<LivePlace[]>
  subscribe(listener: () => void): () => void
  getStatus(): SyncClientStatus
}

export interface SyncTransport {
  push(request: PushRequest): Promise<PushResponse>
  pull(query: PullQuery): Promise<PullResponse>
}
