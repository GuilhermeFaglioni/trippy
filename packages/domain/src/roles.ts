export type Role = 'organizer' | 'coorganizer' | 'member'

export type Member = { userId: string; role: Role }

/** Só organizador e coorganizadores mudam dia e ordem do roteiro (fluxos-e-telas.md, fluxo 5). */
export function canEditItinerary(role: Role): boolean {
  return role === 'organizer' || role === 'coorganizer'
}

/**
 * Quem assume quando o organizador sai: um coorganizador; se não houver, um membro qualquer
 * (visao-produto.md, "Sucessão"). `pick` escolhe entre os candidatos, para o sorteio ser testável.
 */
export function nextOrganizer(
  remaining: readonly Member[],
  pick: (candidates: readonly Member[]) => Member = (c) => c[Math.floor(Math.random() * c.length)]!,
): Member | undefined {
  const coorganizers = remaining.filter((m) => m.role === 'coorganizer')
  const candidates = coorganizers.length > 0 ? coorganizers : remaining
  return candidates.length > 0 ? pick(candidates) : undefined
}
