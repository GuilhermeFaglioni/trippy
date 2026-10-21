import type { Role } from './roles.ts'

export interface CanRemovePlaceInput {
  role: Role
  userId: string
  suggestedBy: string
}

/** Quem sugeriu o lugar ou tem papel de organização pode removê-lo. */
export function canRemovePlace({ role, userId, suggestedBy }: CanRemovePlaceInput): boolean {
  return userId === suggestedBy || role === 'organizer' || role === 'coorganizer'
}

export type PlaceNameValidation =
  | { success: true; value: string }
  | { success: false; message: string }

/** Valida e normaliza o nome manual do lugar para persistência e sincronização. */
export function validatePlaceName(value: unknown): PlaceNameValidation {
  if (typeof value !== 'string') {
    return { success: false, message: 'Informe o nome do lugar.' }
  }

  const trimmed = value.trim()
  const length = Array.from(trimmed).length
  if (length === 0) return { success: false, message: 'Informe o nome do lugar.' }
  if (length > 120) {
    return { success: false, message: 'O nome do lugar deve ter no máximo 120 caracteres.' }
  }

  return { success: true, value: trimmed }
}
