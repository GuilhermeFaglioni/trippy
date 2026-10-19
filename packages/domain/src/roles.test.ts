import { describe, expect, it } from 'vitest'
import { canEditItinerary, nextOrganizer, type Member } from './roles.ts'

describe('canEditItinerary', () => {
  it('permite organizador e coorganizador', () => {
    expect(canEditItinerary('organizer')).toBe(true)
    expect(canEditItinerary('coorganizer')).toBe(true)
  })

  it('bloqueia membro comum', () => {
    expect(canEditItinerary('member')).toBe(false)
  })
})

describe('nextOrganizer', () => {
  const first = (c: readonly Member[]) => c[0]!

  it('prefere um coorganizador', () => {
    const remaining: Member[] = [
      { userId: 'pedro', role: 'member' },
      { userId: 'ana', role: 'coorganizer' },
    ]
    expect(nextOrganizer(remaining, first)?.userId).toBe('ana')
  })

  it('sem coorganizador, escolhe entre os membros', () => {
    const remaining: Member[] = [{ userId: 'lu', role: 'member' }]
    expect(nextOrganizer(remaining, first)?.userId).toBe('lu')
  })

  it('grupo vazio não tem sucessor', () => {
    expect(nextOrganizer([])).toBeUndefined()
  })
})
