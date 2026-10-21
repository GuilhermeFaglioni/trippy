import { randomUUID } from 'expo-crypto'
import {
  createSyncClient,
  type SqlDatabase,
  type SyncClient,
  type SyncTransport,
  type UUID,
} from '@trippy/sync'

export type SyncClientFactoryInput = {
  database: SqlDatabase
  transport: SyncTransport
  userId: string
  getTripIds: () => readonly UUID[] | Promise<readonly UUID[]>
}

export type SyncClientFactory = (input: SyncClientFactoryInput) => SyncClient | Promise<SyncClient>

/**
 * Liga o app ao motor de `@trippy/sync`; as telas dependem só de `SyncClient`.
 * O React Native não garante `crypto.randomUUID`, então os IDs vêm do expo-crypto.
 */
export function createAppSyncClient(input: SyncClientFactoryInput): Promise<SyncClient> {
  return createSyncClient({ ...input, idGenerator: randomUUID })
}
