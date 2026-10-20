import { describe, expect, it } from 'vitest'
import { buildRecapSnapshot } from './recap-snapshot.ts'

describe('buildRecapSnapshot', () => {
  it('creates a stable snapshot with derived recap statistics and no unapproved fields', () => {
    const placeWithGoogleDetails = Object.assign(
      {
        id: 'place-1',
        name: 'Templo do Céu',
        localName: '天坛',
        address: 'Beijing',
        dayIndex: 0,
        position: 0,
        visits: 2,
        favorites: 3,
      },
      { googleDetails: { name: 'Google-only data must be dropped' } },
    )
    const photoWithGoogleAttribution = Object.assign(
      {
        id: 'photo-1',
        storageKey: 'fixture/temple.jpg',
        contentType: 'image/jpeg' as const,
        placeId: 'place-1',
        takenAt: '2026-09-01T08:00:00.000Z',
      },
      { googleAttribution: 'must not persist' },
    )

    const snapshot = buildRecapSnapshot({
      trip: {
        id: 'trip-1',
        name: 'Férias em Pequim',
        destination: 'Pequim',
        timezone: 'Asia/Shanghai',
        startDate: '2026-09-01',
        endDate: '2026-09-03',
      },
      createdAt: '2026-09-04T10:00:00.000Z',
      places: [
        placeWithGoogleDetails,
        {
          id: 'place-2',
          name: 'Hutong',
          localName: null,
          address: null,
          dayIndex: 1,
          position: 0,
          visits: 0,
          favorites: 0,
        },
      ],
      photos: [photoWithGoogleAttribution],
    })

    expect(snapshot).toEqual({
      schemaVersion: 1,
      createdAt: '2026-09-04T10:00:00.000Z',
      trip: {
        id: 'trip-1',
        name: 'Férias em Pequim',
        destination: 'Pequim',
        timezone: 'Asia/Shanghai',
        startDate: '2026-09-01',
        endDate: '2026-09-03',
      },
      places: [
        {
          id: 'place-1',
          name: 'Templo do Céu',
          localName: '天坛',
          address: 'Beijing',
          dayIndex: 0,
          position: 0,
          visits: 2,
          favorites: 3,
        },
        {
          id: 'place-2',
          name: 'Hutong',
          localName: null,
          address: null,
          dayIndex: 1,
          position: 0,
          visits: 0,
          favorites: 0,
        },
      ],
      photos: [
        {
          id: 'photo-1',
          storageKey: 'fixture/temple.jpg',
          contentType: 'image/jpeg',
          placeId: 'place-1',
          takenAt: '2026-09-01T08:00:00.000Z',
        },
      ],
      stats: {
        placeCount: 2,
        visitedPlaceCount: 1,
        favoritePlaceCount: 1,
        photoCount: 1,
        dayCount: 2,
      },
      highlights: { favoritePlaceIds: ['place-1'], mostVisitedPlaceId: 'place-1' },
    })
  })

  it('supports a recap without photos and without places', () => {
    const snapshot = buildRecapSnapshot({
      trip: {
        id: 'trip-2',
        name: 'Fim de semana',
        destination: 'Lisboa',
        timezone: 'Europe/Lisbon',
        startDate: '2026-09-01',
        endDate: '2026-09-01',
      },
      createdAt: '2026-09-02T10:00:00.000Z',
      places: [],
      photos: [],
    })

    expect(snapshot.stats).toEqual({
      placeCount: 0,
      visitedPlaceCount: 0,
      favoritePlaceCount: 0,
      photoCount: 0,
      dayCount: 0,
    })
    expect(snapshot.highlights).toEqual({ favoritePlaceIds: [], mostVisitedPlaceId: null })
  })
})
