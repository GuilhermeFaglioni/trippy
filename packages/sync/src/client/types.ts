import type { PullQuery, PullResponse, PushRequest, PushResponse, SyncPlace, UUID } from '../types.ts'

export type LivePlace = Omit<SyncPlace, 'deletedAt'> & { deletedAt: null; visitedByMe: boolean }

export interface SyncClientStatus {
  lastSyncedAt: string | null
  pending: number
  notSent: number
}

export interface SyncClient {
  addPlace(tripId: UUID, name: string): Promise<UUID>
  removePlace(tripId: UUID, placeId: UUID): Promise<void>
  markVisit(tripId: UUID, placeId: UUID): Promise<void>
  unmarkVisit(tripId: UUID, placeId: UUID): Promise<void>
  syncNow(): Promise<void>
  listPlaces(tripId: UUID): Promise<LivePlace[]>
  subscribe(listener: () => void): () => void
  getStatus(): SyncClientStatus
}

export interface SyncTransport {
  push(request: PushRequest): Promise<PushResponse>
  pull(query: PullQuery): Promise<PullResponse>
}
