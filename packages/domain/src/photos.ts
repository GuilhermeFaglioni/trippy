export type PhotoUploadMetadata = Readonly<{
  id: string
  takenAtOriginal: string | null
  takenTz: string | null
  lat: number | null
  lng: number | null
}>

export type PhotoUploadValidation =
  | { success: true; value: PhotoUploadMetadata }
  | { success: false; fields: Partial<Record<keyof PhotoUploadMetadata, string>> }

const uuidPattern = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/iu

export function validatePhotoUploadInput(value: unknown): PhotoUploadValidation {
  const body =
    typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}
  const fields: Partial<Record<keyof PhotoUploadMetadata, string>> = {}

  const id = body.id
  if (typeof id !== 'string' || !uuidPattern.test(id)) {
    fields.id = 'Informe um UUID válido para a foto.'
  }

  function optionalText(field: 'takenAtOriginal' | 'takenTz', label: string): string | null {
    const candidate = body[field]
    if (candidate === undefined || candidate === null) return null
    if (typeof candidate !== 'string' || candidate.trim().length === 0 || candidate.length > 100) {
      fields[field] = `Informe ${label} como texto ou nulo.`
      return null
    }
    return candidate
  }

  function optionalCoordinate(field: 'lat' | 'lng', label: string): number | null {
    const candidate = body[field]
    if (candidate === undefined || candidate === null) return null
    if (typeof candidate !== 'number' || !Number.isFinite(candidate)) {
      fields[field] = `Informe ${label} como número ou nulo.`
      return null
    }
    const min = field === 'lat' ? -90 : -180
    const max = field === 'lat' ? 90 : 180
    if (candidate < min || candidate > max) {
      fields[field] = `${label} fora do intervalo válido.`
      return null
    }
    return candidate
  }

  const takenAtOriginal = optionalText('takenAtOriginal', 'o horário original')
  const takenTz = optionalText('takenTz', 'o fuso original')
  const lat = optionalCoordinate('lat', 'a latitude')
  const lng = optionalCoordinate('lng', 'a longitude')
  if ((lat === null) !== (lng === null)) {
    fields.lat ??= 'Informe latitude e longitude juntas, ou deixe ambas nulas.'
    fields.lng ??= 'Informe latitude e longitude juntas, ou deixe ambas nulas.'
  }

  if (Object.keys(fields).length > 0) return { success: false, fields }
  return {
    success: true,
    value: { id: id as string, takenAtOriginal, takenTz, lat, lng },
  }
}
