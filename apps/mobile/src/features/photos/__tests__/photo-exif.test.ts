import { normalizePhotoExif } from '../photo-exif'

describe('normalizePhotoExif', () => {
  it('preserves the original wall time without inventing a timezone', () => {
    expect(normalizePhotoExif({ DateTimeOriginal: '2026:10:20 07:06:05' })).toEqual({
      takenAtOriginal: '2026-10-20T07:06:05',
      takenTz: null,
      lat: null,
      lng: null,
    })
  })

  it('keeps the recorded UTC offset and converts GPS degrees-minutes-seconds', () => {
    expect(
      normalizePhotoExif({
        DateTimeOriginal: '2026:10:20 07:06:05',
        OffsetTimeOriginal: '+08:00',
        GPSLatitude: [31, 13, 12],
        GPSLatitudeRef: 'N',
        GPSLongitude: [121, 28, 12],
        GPSLongitudeRef: 'W',
      }),
    ).toEqual({
      takenAtOriginal: '2026-10-20T07:06:05',
      takenTz: '+08:00',
      lat: 31.22,
      lng: -121.47,
    })
  })

  it('returns null metadata when tags are absent or malformed', () => {
    expect(normalizePhotoExif({ DateTimeOriginal: 'yesterday', GPSLatitude: [91, 0, 0] })).toEqual({
      takenAtOriginal: null,
      takenTz: null,
      lat: null,
      lng: null,
    })
    expect(normalizePhotoExif(null)).toEqual({
      takenAtOriginal: null,
      takenTz: null,
      lat: null,
      lng: null,
    })
  })
})
