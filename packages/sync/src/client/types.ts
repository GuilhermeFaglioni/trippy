import type { Role } from '@trippy/domain'
import type {
  ItineraryDay,
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
  /** Quantidade de pessoas que querem ir, sem contar reações removidas. */
  wantCount: number
  wantedByMe: boolean
} & LivePlaceLocalStatuses

export interface ItineraryDraft {
  opId: UUID
  tripId: UUID
  baseVersion: number
  currentVersion: number
  days: ItineraryDay[]
  createdAt: string
}

export interface LiveMember {
  userId: UUID
  role: Role
  joinedAt: string
  openedAt: string | null
}

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
  /** Registra a reação "quero ir" da pessoa local no lugar. */
  wantPlace(tripId: UUID, placeId: UUID): Promise<void>
  /** Remove a reação "quero ir" da pessoa local no lugar. */
  unwantPlace(tripId: UUID, placeId: UUID): Promise<void>
  /** Enfileira uma única alteração com a ordem completa dos dias informados. */
  arrangeItinerary(tripId: UUID, days: ItineraryDay[]): Promise<void>
  /** Lista rascunhos de roteiro preservados após conflitos. */
  listItineraryDrafts(tripId: UUID): Promise<ItineraryDraft[]>
  /** Descarta um rascunho e mantém o roteiro atual do servidor. */
  discardItineraryDraft(opId: UUID): Promise<void>
  /** Reenfileira um rascunho usando a versão atual conhecida. */
  reapplyItineraryDraft(opId: UUID): Promise<void>
  /** Lista somente membros ativos da viagem. */
  listMembers(tripId: UUID): Promise<LiveMember[]>
  /** Enfileira a remoção de um membro da viagem. */
  removeMember(tripId: UUID, userId: UUID): Promise<void>
  /** Enfileira a troca do papel para coorganizador ou membro. */
  setMemberRole(tripId: UUID, userId: UUID, role: 'coorganizer' | 'member'): Promise<void>
  endTrip(tripId: UUID): Promise<void>
  /** Registra a primeira abertura da viagem pelo usuário atual (idempotente). */
  openTrip(tripId: UUID): Promise<void>
  /** Lista viagens removidas que deixaram de sincronizar no aparelho. */
  listRemovedTrips(): Promise<UUID[]>
  /** Conta as operações da viagem marcadas como não enviadas. */
  countNotSent(tripId: UUID): Promise<number>
  syncNow(): Promise<void>
  listPlaces(tripId: UUID, _countryCode?: string | null): Promise<LivePlace[]>
  subscribe(listener: () => void): () => void
  getStatus(): SyncClientStatus
}

export interface SyncTransport {
  push(request: PushRequest): Promise<PushResponse>
  pull(query: PullQuery): Promise<PullResponse>
}
