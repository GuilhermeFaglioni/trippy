export type RecapTrip = Readonly<{
  id: string
  name: string
  destination: string
  timezone: string
  startDate: string
  endDate: string
}>

export type RecapPlaceInput = Readonly<{
  id: string
  name: string
  localName: string | null
  address: string | null
  dayIndex: number
  position: number
  visits: number
  favorites: number
}>

export type RecapPhotoInput = Readonly<{
  id: string
  storageKey: string
  contentType: 'image/jpeg' | 'image/png'
  placeId: string | null
  takenAt: string | null
}>

export type RecapSnapshot = Readonly<{
  schemaVersion: 1
  createdAt: string
  trip: RecapTrip
  places: readonly RecapPlaceInput[]
  photos: readonly RecapPhotoInput[]
  stats: Readonly<{
    placeCount: number
    visitedPlaceCount: number
    favoritePlaceCount: number
    photoCount: number
    dayCount: number
  }>
  highlights: Readonly<{
    favoritePlaceIds: readonly string[]
    mostVisitedPlaceId: string | null
  }>
}>

export type BuildRecapSnapshotInput = Readonly<{
  trip: RecapTrip
  createdAt: string
  places: readonly RecapPlaceInput[]
  photos: readonly RecapPhotoInput[]
}>

export function buildRecapSnapshot(input: BuildRecapSnapshotInput): RecapSnapshot {
  const places = input.places
    .map((place) => ({
      id: place.id,
      name: place.name,
      localName: place.localName,
      address: place.address,
      dayIndex: place.dayIndex,
      position: place.position,
      visits: place.visits,
      favorites: place.favorites,
    }))
    .sort((left, right) => left.dayIndex - right.dayIndex || left.position - right.position)

  const photos = input.photos
    .map((photo) => ({
      id: photo.id,
      storageKey: photo.storageKey,
      contentType: photo.contentType,
      placeId: photo.placeId,
      takenAt: photo.takenAt,
    }))
    .sort((left, right) => {
      if (left.takenAt === null) return right.takenAt === null ? left.id.localeCompare(right.id) : 1
      if (right.takenAt === null) return -1
      return left.takenAt.localeCompare(right.takenAt) || left.id.localeCompare(right.id)
    })

  const favoritePlaces = places.filter((place) => place.favorites > 0)
  const mostVisitedPlace = [...places]
    .filter((place) => place.visits > 0)
    .sort(
      (left, right) =>
        right.visits - left.visits ||
        left.dayIndex - right.dayIndex ||
        left.position - right.position ||
        left.id.localeCompare(right.id),
    )[0]

  return {
    schemaVersion: 1,
    createdAt: input.createdAt,
    trip: {
      id: input.trip.id,
      name: input.trip.name,
      destination: input.trip.destination,
      timezone: input.trip.timezone,
      startDate: input.trip.startDate,
      endDate: input.trip.endDate,
    },
    places,
    photos,
    stats: {
      placeCount: places.length,
      visitedPlaceCount: places.filter((place) => place.visits > 0).length,
      favoritePlaceCount: favoritePlaces.length,
      photoCount: photos.length,
      dayCount: new Set(places.map((place) => place.dayIndex)).size,
    },
    highlights: {
      favoritePlaceIds: favoritePlaces.map((place) => place.id),
      mostVisitedPlaceId: mostVisitedPlace?.id ?? null,
    },
  }
}
