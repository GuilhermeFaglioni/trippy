import type { LiveMember } from '@trippy/sync'

type NamedMember = Pick<LiveMember, 'userId'> & { name?: string | null }

/** Nome completo cadastrado (ou derivado do e-mail pela API); null quando não há. */
export function memberFullName(member: NamedMember): string | null {
  const name = member.name?.trim()
  return name ? name : null
}

/** Primeiro nome, como a lista do Grupo mostra ("Ana"); null quando não há nome. */
export function memberFirstName(member: NamedMember): string | null {
  return memberFullName(member)?.split(/\s+/u)[0] ?? null
}

/** Nome sem cadastro: "Participante" com o fim do id para distinguir uma pessoa da outra. */
export function memberFallbackName(userId: string): string {
  return `Participante ${userId.slice(-4)}`
}

/** "Lu", "Lu e Rafa" ou "Lu, Rafa e Ju"; null se alguma pessoa estiver sem nome. */
export function joinFirstNames(members: readonly NamedMember[]): string | null {
  const names = members.map(memberFirstName)
  if (names.length === 0 || names.some((name) => name === null)) return null
  const list = names as string[]
  if (list.length === 1) return list[0]
  return `${list.slice(0, -1).join(', ')} e ${list[list.length - 1]}`
}
