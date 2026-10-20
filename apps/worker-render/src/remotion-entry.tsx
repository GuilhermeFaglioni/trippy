import React from 'react'
import { Composition, registerRoot } from 'remotion'
import type { RecapCompositionProps } from './RecapComposition.tsx'
import { RecapComposition } from './RecapComposition.tsx'

const defaultProps: RecapCompositionProps = {
  snapshot: {
    schemaVersion: 1,
    createdAt: '2026-09-04T10:00:00.000Z',
    trip: {
      id: 'demo',
      name: 'Uma viagem em grupo',
      destination: 'Pequim',
      timezone: 'Asia/Shanghai',
      startDate: '2026-09-01',
      endDate: '2026-09-03',
    },
    places: [
      {
        id: 'temple-of-heaven',
        name: 'Temple of Heaven',
        localName: '天坛',
        address: 'Beijing',
        dayIndex: 0,
        position: 0,
        visits: 1,
        favorites: 1,
      },
    ],
    photos: [],
    stats: {
      placeCount: 1,
      visitedPlaceCount: 1,
      favoritePlaceCount: 1,
      photoCount: 0,
      dayCount: 1,
    },
    highlights: { favoritePlaceIds: ['temple-of-heaven'], mostVisitedPlaceId: 'temple-of-heaven' },
  },
  photos: [],
  watermarked: false,
}

const RecapVideoComposition = Composition as unknown as React.FC<{
  id: string
  component: React.ComponentType<RecapCompositionProps>
  width: number
  height: number
  fps: number
  durationInFrames: number
  defaultProps: RecapCompositionProps
}>

const Root: React.FC = () => (
  <RecapVideoComposition
    id="TrippyRecap"
    component={RecapComposition}
    width={540}
    height={960}
    fps={20}
    durationInFrames={600}
    defaultProps={defaultProps}
  />
)

registerRoot(Root)
