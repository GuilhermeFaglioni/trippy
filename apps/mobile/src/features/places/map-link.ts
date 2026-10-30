import type { LivePlace } from '@trippy/sync'

/** Link do app de mapas padrão: Apple Maps no iPhone, `geo:` (Google Maps ou Amap) no Android. */
export function mapUrl(
  place: Pick<LivePlace, 'lat' | 'lng'>,
  query: string,
  platform: 'ios' | 'android',
): string {
  const encoded = encodeURIComponent(query)
  const hasCoordinates = place.lat !== null && place.lng !== null
  if (platform === 'ios') {
    return hasCoordinates
      ? `https://maps.apple.com/?ll=${place.lat},${place.lng}&q=${encoded}`
      : `https://maps.apple.com/?q=${encoded}`
  }
  return hasCoordinates
    ? `geo:${place.lat},${place.lng}?q=${place.lat},${place.lng}(${encoded})`
    : `geo:0,0?q=${encoded}`
}
