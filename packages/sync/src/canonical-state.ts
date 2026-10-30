import type { SyncMember, SyncPlace, SyncReview, SyncVisit, SyncWant } from './types.ts'

export interface TripState {
  places: readonly SyncPlace[]
  visits: readonly SyncVisit[]
  wants: readonly SyncWant[]
  reviews: readonly SyncReview[]
  members: readonly SyncMember[]
}

export interface CanonicalTripState {
  places: SyncPlace[]
  visits: SyncVisit[]
  wants: SyncWant[]
  reviews: SyncReview[]
  members: SyncMember[]
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

/** Mantém apenas registros vivos e ordena cada coleção por chaves estáveis. */
export function canonicalTripState(state: TripState): CanonicalTripState {
  return {
    places: state.places
      .filter((place) => place.deletedAt === null)
      .sort((left, right) => compare(left.id, right.id)),
    visits: state.visits
      .filter((visit) => visit.deletedAt === null)
      .sort(
        (left, right) => compare(left.placeId, right.placeId) || compare(left.userId, right.userId),
      ),
    wants: state.wants
      .filter((want) => want.deletedAt === null)
      .sort(
        (left, right) => compare(left.placeId, right.placeId) || compare(left.userId, right.userId),
      ),
    reviews: state.reviews
      .filter((review) => review.deletedAt === null)
      .sort(
        (left, right) => compare(left.placeId, right.placeId) || compare(left.userId, right.userId),
      ),
    members: state.members
      .filter((member) => member.deletedAt === null)
      .sort((left, right) => compare(left.userId, right.userId)),
  }
}
