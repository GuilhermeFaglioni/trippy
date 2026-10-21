import { describe, expect, it } from 'vitest'
import {
  canEditItinerary,
  canRemoveMember,
  canSetMemberRole,
  nextOrganizer,
  type Member,
} from './roles.ts'

describe('canEditItinerary', () => {
  it('permite organizador e coorganizador', () => {
    expect(canEditItinerary('organizer')).toBe(true)
    expect(canEditItinerary('coorganizer')).toBe(true)
  })

  it('bloqueia membro comum', () => {
    expect(canEditItinerary('member')).toBe(false)
  })
})

describe('canRemoveMember', () => {
  const organizer: Member = { userId: 'organizer', role: 'organizer' }
  const coorganizer: Member = { userId: 'coorganizer', role: 'coorganizer' }
  const member: Member = { userId: 'member', role: 'member' }

  it('organizador pode remover qualquer pessoa, menos a si', () => {
    expect(canRemoveMember(organizer, member)).toBe(true)
    expect(canRemoveMember(organizer, coorganizer)).toBe(true)
    expect(canRemoveMember(organizer, organizer)).toBe(false)
  })

  it('coorganizador pode remover apenas membro comum', () => {
    expect(canRemoveMember(coorganizer, member)).toBe(true)
    expect(canRemoveMember(coorganizer, organizer)).toBe(false)
    expect(canRemoveMember(coorganizer, coorganizer)).toBe(false)
  })

  it('membro comum não pode remover ninguém', () => {
    expect(canRemoveMember(member, organizer)).toBe(false)
    expect(canRemoveMember(member, coorganizer)).toBe(false)
    expect(canRemoveMember(member, member)).toBe(false)
  })
})

describe('canSetMemberRole', () => {
  const organizer: Member = { userId: 'organizer', role: 'organizer' }
  const anotherOrganizer: Member = { userId: 'another-organizer', role: 'organizer' }
  const coorganizer: Member = { userId: 'coorganizer', role: 'coorganizer' }
  const member: Member = { userId: 'member', role: 'member' }

  it('somente organizador pode mudar papel de outra pessoa que não seja organizador', () => {
    expect(canSetMemberRole(organizer, member)).toBe(true)
    expect(canSetMemberRole(organizer, coorganizer)).toBe(true)
    expect(canSetMemberRole(organizer, organizer)).toBe(false)
    expect(canSetMemberRole(organizer, anotherOrganizer)).toBe(false)
    expect(canSetMemberRole(coorganizer, member)).toBe(false)
    expect(canSetMemberRole(member, coorganizer)).toBe(false)
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
