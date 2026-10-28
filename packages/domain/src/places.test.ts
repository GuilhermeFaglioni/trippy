import { describe, expect, it } from 'vitest'
import {
  canConfirmGooglePlace,
  canRemovePlace,
  classifyLocalDetail,
  validatePlaceName,
} from './places.ts'

describe('canRemovePlace', () => {
  it('permite que quem sugeriu remova o lugar', () => {
    expect(canRemovePlace({ role: 'member', userId: 'user-a', suggestedBy: 'user-a' })).toBe(true)
  })

  it.each(['organizer', 'coorganizer'] as const)('permite %s remover qualquer lugar', (role) => {
    expect(canRemovePlace({ role, userId: 'user-b', suggestedBy: 'user-a' })).toBe(true)
  })

  it('não permite que outro membro remova o lugar', () => {
    expect(canRemovePlace({ role: 'member', userId: 'user-b', suggestedBy: 'user-a' })).toBe(false)
  })
})

describe('canConfirmGooglePlace', () => {
  it('usa a mesma regra de remoção', () => {
    const cases = [
      { role: 'member' as const, userId: 'user-a', suggestedBy: 'user-a' },
      { role: 'organizer' as const, userId: 'user-b', suggestedBy: 'user-a' },
      { role: 'coorganizer' as const, userId: 'user-b', suggestedBy: 'user-a' },
      { role: 'member' as const, userId: 'user-b', suggestedBy: 'user-a' },
    ]

    for (const input of cases) {
      expect(canConfirmGooglePlace(input)).toBe(canRemovePlace(input))
    }
  })
})

describe('classifyLocalDetail', () => {
  it('marca vazio como ausente e prefere valor da pessoa ao do fornecedor', () => {
    expect(
      classifyLocalDetail({
        userValue: '  ',
        providerValue: null,
        countryCode: null,
        kind: 'name',
      }),
    ).toBe('missing')
    expect(
      classifyLocalDetail({
        userValue: '4 Jingshan Front St',
        providerValue: '北京市东城区景山前街4号',
        countryCode: 'CN',
        kind: 'address',
      }),
    ).toBe('not_local_language')
  })

  it('marca endereço curto ou sem número e sem marcador de via como incompleto', () => {
    expect(
      classifyLocalDetail({
        userValue: null,
        providerValue: 'Rua 1',
        countryCode: 'BR',
        kind: 'address',
      }),
    ).toBe('incomplete')
    expect(
      classifyLocalDetail({
        userValue: null,
        providerValue: 'Jingshan Front',
        countryCode: 'CN',
        kind: 'address',
      }),
    ).toBe('incomplete')
    expect(
      classifyLocalDetail({
        userValue: null,
        providerValue: 'Avenida Paulista',
        countryCode: 'BR',
        kind: 'address',
      }),
    ).toBe('ok')
    expect(
      classifyLocalDetail({
        userValue: null,
        providerValue: 'Av. Paulista',
        countryCode: 'BR',
        kind: 'address',
      }),
    ).toBe('ok')
  })

  it('não marca nome como incompleto nem infere idioma sem contexto local', () => {
    expect(
      classifyLocalDetail({
        userValue: null,
        providerValue: 'KFC',
        countryCode: 'US',
        kind: 'name',
      }),
    ).toBe('ok')
    expect(
      classifyLocalDetail({
        userValue: null,
        providerValue: 'Forbidden City',
        countryCode: null,
        kind: 'name',
      }),
    ).toBe('ok')
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
