import { describe, expect, it } from 'vitest'
import { canRemovePlace, validatePlaceName } from './places.ts'

describe('canRemovePlace', () => {
  it('permite que quem sugeriu remova o lugar', () => {
    expect(
      canRemovePlace({ role: 'member', userId: 'user-a', suggestedBy: 'user-a' }),
    ).toBe(true)
  })

  it.each(['organizer', 'coorganizer'] as const)('permite %s remover qualquer lugar', (role) => {
    expect(canRemovePlace({ role, userId: 'user-b', suggestedBy: 'user-a' })).toBe(true)
  })

  it('não permite que outro membro remova o lugar', () => {
    expect(
      canRemovePlace({ role: 'member', userId: 'user-b', suggestedBy: 'user-a' }),
    ).toBe(false)
  })
})

describe('validatePlaceName', () => {
  it('remove espaços externos antes de validar e devolver o nome', () => {
    expect(validatePlaceName('  Museu do Amanhã  ')).toEqual({
      success: true,
      value: 'Museu do Amanhã',
    })
  })

  it('recusa nome vazio após trim', () => {
    expect(validatePlaceName('  ')).toEqual({ success: false, message: 'Informe o nome do lugar.' })
  })

  it('aceita até 120 caracteres e recusa nomes maiores', () => {
    expect(validatePlaceName('a'.repeat(120))).toEqual({ success: true, value: 'a'.repeat(120) })
    expect(validatePlaceName('a'.repeat(121))).toEqual({
      success: false,
      message: 'O nome do lugar deve ter no máximo 120 caracteres.',
    })
  })

  it('conta caracteres Unicode, não unidades UTF-16', () => {
    const name = '🧭'.repeat(120)
    expect(validatePlaceName(name)).toEqual({ success: true, value: name })
  })
})
