import React from 'react'
import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame } from 'remotion'
import type { RecapSnapshot } from '@trippy/domain'

export type RecapCompositionProps = Readonly<{
  snapshot: RecapSnapshot
  photos: readonly Readonly<{ src: string; placeName: string | null }>[]
  watermarked: boolean
}>

type Slide = Readonly<{
  type: 'cover' | 'place' | 'photo' | 'closing'
  title: string
  subtitle: string
  image: string | null
}>

const palette = {
  ink: '#102b32',
  muted: '#536a6d',
  paper: '#f5f0e7',
  forest: '#1e6155',
  gold: '#d9a65c',
  night: '#14353a',
}

export const RecapComposition: React.FC<RecapCompositionProps> = ({
  snapshot,
  photos,
  watermarked,
}) => {
  const frame = useCurrentFrame()
  const places = snapshot.places
  const featuredPlace = places[0]
  const featuredPhoto = photos[0]
  const slides: Slide[] = [
    {
      type: 'cover',
      title: snapshot.trip.destination,
      subtitle: snapshot.trip.name,
      image: null,
    },
    {
      type: 'place',
      title: featuredPlace?.localName || featuredPlace?.name || snapshot.trip.destination,
      subtitle: featuredPlace?.name ?? 'Lugares que ficaram com a gente',
      image: null,
    },
    ...(featuredPhoto
      ? [
          {
            type: 'photo' as const,
            title: featuredPhoto.placeName ?? 'Um momento da viagem',
            subtitle: 'Memórias da viagem',
            image: featuredPhoto.src,
          },
        ]
      : places[1]
        ? [
            {
              type: 'place' as const,
              title: places[1].localName || places[1].name,
              subtitle: places[1].name,
              image: null,
            },
          ]
        : [
            {
              type: 'place' as const,
              title: '北京',
              subtitle: snapshot.trip.destination,
              image: null,
            },
          ]),
    {
      type: 'closing',
      title: `${snapshot.stats.placeCount} lugares, muitas histórias`,
      subtitle: `${snapshot.stats.photoCount} fotos • ${snapshot.stats.dayCount} dias juntos`,
      image: null,
    },
  ]
  const slideIndex = Math.min(slides.length - 1, Math.floor(frame / 180))
  const localFrame = frame - slideIndex * 180
  const slide = slides[slideIndex]!
  const opacity = interpolate(localFrame, [0, 16, 164, 180], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  const rise = interpolate(localFrame, [0, 24, 180], [42, 0, -20], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })

  return (
    <AbsoluteFill
      style={{
        backgroundColor: slide.type === 'photo' ? palette.night : palette.paper,
        color: slide.type === 'photo' ? '#fffaf0' : palette.ink,
        fontFamily: '"Noto Sans CJK SC", "Noto Sans", sans-serif',
        overflow: 'hidden',
      }}
    >
      {slide.image ? (
        <>
          <Img
            src={staticFile(slide.image)}
            style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: 0.78 }}
          />
          <AbsoluteFill
            style={{
              background:
                'linear-gradient(180deg, rgba(10,31,34,.06) 25%, rgba(10,31,34,.88) 100%)',
            }}
          />
        </>
      ) : (
        <AbsoluteFill
          style={{
            background:
              slide.type === 'cover'
                ? 'linear-gradient(155deg, #d7e4dd 0%, #f5f0e7 58%, #ead5b7 100%)'
                : slide.type === 'closing'
                  ? `linear-gradient(145deg, ${palette.night}, ${palette.forest})`
                  : 'linear-gradient(145deg, #e4ece4, #f5f0e7 64%, #e7d4b6)',
          }}
        />
      )}

      <AbsoluteFill
        style={{
          justifyContent: 'space-between',
          padding: '76px 58px 86px',
          opacity,
          transform: `translateY(${rise}px)`,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            fontSize: 22,
            letterSpacing: 4,
            textTransform: 'uppercase',
            color: slide.type === 'photo' || slide.type === 'closing' ? '#fffaf0' : palette.forest,
          }}
        >
          <span style={{ width: 34, height: 2, backgroundColor: palette.gold }} />
          Trippy · {snapshot.trip.destination}
        </div>

        <div style={{ maxWidth: 600 }}>
          <div
            style={{
              marginBottom: 22,
              color: palette.gold,
              fontSize: 25,
              fontWeight: 700,
              letterSpacing: 2,
            }}
          >
            {slide.type === 'cover'
              ? 'NOSSA VIAGEM'
              : slide.type === 'closing'
                ? 'ATÉ A PRÓXIMA'
                : 'UM LUGAR NOSSO'}
          </div>
          <div
            style={{
              fontSize: slide.type === 'cover' ? 84 : 70,
              lineHeight: 1.1,
              fontWeight: 750,
              letterSpacing: -2,
              textShadow: slide.type === 'photo' ? '0 3px 24px rgba(0,0,0,.25)' : undefined,
            }}
          >
            {slide.title}
          </div>
          <div
            style={{
              marginTop: 24,
              fontSize: 29,
              lineHeight: 1.35,
              color: slide.type === 'photo' || slide.type === 'closing' ? '#e7ece5' : palette.muted,
            }}
          >
            {slide.subtitle}
          </div>
          {slide.type === 'cover' && (
            <div
              style={{
                marginTop: 48,
                paddingTop: 24,
                borderTop: `1px solid ${palette.gold}`,
                fontSize: 24,
                color: palette.muted,
              }}
            >
              {snapshot.trip.startDate} — {snapshot.trip.endDate}
            </div>
          )}
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: 20,
            letterSpacing: 2,
          }}
        >
          <span>FEITO EM GRUPO</span>
          <span>0{slideIndex + 1} / 04</span>
        </div>
      </AbsoluteFill>

      {watermarked && (
        <div
          style={{
            position: 'absolute',
            right: 30,
            top: '48%',
            color: 'rgba(255,255,255,.74)',
            fontSize: 18,
            fontWeight: 800,
            letterSpacing: 5,
            transform: 'rotate(90deg)',
            transformOrigin: 'right center',
          }}
        >
          TRIPPY · MEMÓRIAS EM GRUPO
        </div>
      )}
    </AbsoluteFill>
  )
}
