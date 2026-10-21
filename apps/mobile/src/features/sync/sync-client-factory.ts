import type { SqlDatabase, SyncClient, SyncTransport, UUID } from '@trippy/sync'

export type SyncClientFactoryInput = {
  database: SqlDatabase
  transport: SyncTransport
  userId: string
  getTripIds: () => readonly UUID[] | Promise<readonly UUID[]>
}

export type SyncClientFactory = (input: SyncClientFactoryInput) => SyncClient

let connectedFactory: SyncClientFactory | null = null

/**
 * Ponte isolada para `packages/sync`: S1 fixou os contratos, mas o commit-base
 * ainda não exporta a fábrica de cliente que S3 está implementando. Ao integrar
 * S3, conecte o `createSyncClient` exportado aqui; as telas já dependem só de
 * `SyncClient`.
 */
export function connectSyncClientFactory(factory: SyncClientFactory): void {
  connectedFactory = factory
}

export function createAppSyncClient(input: SyncClientFactoryInput): SyncClient {
  if (connectedFactory === null) {
    throw new Error('O motor de sincronização ainda não foi conectado ao app.')
  }
  return connectedFactory(input)
}
