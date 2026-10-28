export type PhotoExifMetadata = {
  takenAtOriginal: string | null
  takenTz: string | null
  lat: number | null
  lng: number | null
}

type ExifRecord = Record<string, unknown>

const EMPTY_METADATA: PhotoExifMetadata = {
  takenAtOriginal: null,
  takenTz: null,
  lat: null,
  lng: null,
}

function parseExifNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null

  if (typeof value === 'string') {
    const normalized = value.trim()
    if (!normalized) return null

    const rational = /^(-?\d+(?:\.\d+)?)\s*\/\s*(-?\d+(?:\.\d+)?)$/.exec(normalized)
    if (rational) {
      const numerator = Number(rational[1])
      const denominator = Number(rational[2])
      return denominator === 0 ? null : numerator / denominator
    }

    const parsed = Number(normalized)
    return Number.isFinite(parsed) ? parsed : null
  }

  if (
    typeof value === 'object' &&
    value !== null &&
    'numerator' in value &&
    'denominator' in value
  ) {
    const candidate = value as { numerator: unknown; denominator: unknown }
    const numerator = parseExifNumber(candidate.numerator)
    const denominator = parseExifNumber(candidate.denominator)
    if (numerator === null || denominator === null || denominator === 0) return null
    return numerator / denominator
  }

  return null
}

function parseOriginalTime(value: unknown): { value: string; inlineOffset: string | null } | null {
  if (typeof value !== 'string') return null

  const match =
    /^(\d{4})[-:](\d{2})[-:](\d{2})[ T](\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/i.exec(
      value.trim(),
    )
  if (!match) return null

  const [, yearText, monthText, dayText, hourText, minuteText, secondText, fraction, offset] = match
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  const hour = Number(hourText)
  const minute = Number(minuteText)
  const second = Number(secondText)
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()

  if (
    year < 1 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth ||
    hour > 23 ||
    minute > 59 ||
    second > 60
  ) {
    return null
  }

  const inlineOffset = offset ? normalizeOffset(offset) : null
  if (offset && inlineOffset === null) return null

  return {
    value: `${yearText}-${monthText}-${dayText}T${hourText}:${minuteText}:${secondText}${fraction ?? ''}`,
    inlineOffset,
  }
}

function normalizeOffset(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  if (/^Z$/i.test(normalized)) return '+00:00'

  const match = /^([+-])(\d{2}):?(\d{2})$/.exec(normalized)
  if (!match) return null

  const hours = Number(match[2])
  const minutes = Number(match[3])
  if (hours > 14 || minutes > 59 || (hours === 14 && minutes !== 0)) return null
  return `${match[1]}${match[2]}:${match[3]}`
}

function normalizeGpsCoordinate(
  value: unknown,
  reference: unknown,
  maximum: number,
  negativeReference: string,
  positiveReference: string,
): number | null {
  const parts = Array.isArray(value) ? value : [value]
  const numbers = parts.map(parseExifNumber)
  if (numbers.some((number) => number === null)) return null

  let coordinate: number
  if (numbers.length === 3) {
    const [degrees, minutes, seconds] = numbers as [number, number, number]
    if (
      degrees < 0 ||
      degrees > maximum ||
      minutes < 0 ||
      minutes >= 60 ||
      seconds < 0 ||
      seconds >= 60 ||
      (degrees === maximum && (minutes > 0 || seconds > 0))
    ) {
      return null
    }
    coordinate = degrees + minutes / 60 + seconds / 3600
  } else if (numbers.length === 1) {
    coordinate = Math.abs(numbers[0] as number)
    if (coordinate > maximum) return null
  } else {
    return null
  }

  const normalizedReference = typeof reference === 'string' ? reference.trim().toUpperCase() : ''
  if (
    normalizedReference &&
    normalizedReference !== negativeReference &&
    normalizedReference !== positiveReference
  ) {
    return null
  }

  if (normalizedReference === negativeReference) return -coordinate
  if (normalizedReference === positiveReference) return coordinate
  return numbers.length === 1 && (numbers[0] as number) < 0 ? -coordinate : coordinate
}

export function normalizePhotoExif(exif: ExifRecord | null | undefined): PhotoExifMetadata {
  if (!exif) return EMPTY_METADATA

  const originalTime = parseOriginalTime(exif.DateTimeOriginal)
  const takenTz =
    normalizeOffset(exif.OffsetTimeOriginal) ??
    normalizeOffset(exif.OffsetTime) ??
    originalTime?.inlineOffset ??
    null
  const lat = normalizeGpsCoordinate(exif.GPSLatitude, exif.GPSLatitudeRef, 90, 'S', 'N')
  const lng = normalizeGpsCoordinate(exif.GPSLongitude, exif.GPSLongitudeRef, 180, 'W', 'E')

  return {
    takenAtOriginal: originalTime?.value ?? null,
    takenTz: originalTime ? takenTz : null,
    lat: lat !== null && lng !== null ? lat : null,
    lng: lat !== null && lng !== null ? lng : null,
  }
}
