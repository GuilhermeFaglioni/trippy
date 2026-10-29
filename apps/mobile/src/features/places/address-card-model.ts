import type { LivePlace } from '@trippy/sync'

export type AddressCardState =
  | { kind: 'local'; name: string; address: string; source: 'user' | 'provider' }
  | { kind: 'vendor'; name: string; address: string }
  | { kind: 'empty'; name: string }

function present(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

/** Decide o que o cartão de endereço mostra: endereço local (do usuário ou do fornecedor) tem prioridade sobre o do fornecedor. */
export function addressCardState(
  place: Pick<
    LivePlace,
    'name' | 'address' | 'localName' | 'localAddress' | 'userLocalName' | 'userLocalAddress'
  >,
): AddressCardState {
  const localName = present(place.userLocalName) ?? present(place.localName)
  const name = localName ?? place.name
  const userAddress = present(place.userLocalAddress)
  const providerLocalAddress = present(place.localAddress)
  const vendorAddress = present(place.address)

  if (userAddress !== null) return { kind: 'local', name, address: userAddress, source: 'user' }
  if (providerLocalAddress !== null) {
    return { kind: 'local', name, address: providerLocalAddress, source: 'provider' }
  }
  if (vendorAddress !== null) return { kind: 'vendor', name, address: vendorAddress }
  return { kind: 'empty', name }
}
