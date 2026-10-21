export const NETWORK_GATE_STORAGE_KEY = 'trippy.dev.network.offline'

export type NetworkGateStorage = {
  getItem(key: string): Promise<string | null>
  setItem(key: string, value: string): Promise<void>
}

export type NetworkGateOptions = {
  enabled: boolean
  storage: NetworkGateStorage
  fetcher?: typeof fetch
}

/** Portão HTTP persistente para simular uma falha real de rede em desenvolvimento. */
export class NetworkGate {
  private offline = false
  private loadPromise: Promise<boolean> | null = null
  private readonly listeners = new Set<(offline: boolean) => void>()

  constructor(private readonly options: NetworkGateOptions) {}

  getIsOffline(): boolean {
    return this.offline
  }

  subscribe(listener: (offline: boolean) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async load(): Promise<boolean> {
    if (!this.options.enabled) return false
    if (this.loadPromise !== null) return this.loadPromise

    this.loadPromise = this.options.storage
      .getItem(NETWORK_GATE_STORAGE_KEY)
      .then((value) => {
        this.publish(value === 'true')
        return this.offline
      })
      .catch(() => {
        this.publish(false)
        return false
      })

    return this.loadPromise
  }

  async setOffline(offline: boolean): Promise<boolean> {
    if (!this.options.enabled) return false

    await this.load()
    await this.options.storage.setItem(NETWORK_GATE_STORAGE_KEY, String(offline))
    this.publish(offline)
    return offline
  }

  async fetch(
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ): Promise<Response> {
    await this.load()
    if (this.options.enabled && this.offline) throw new TypeError('Network request failed')

    const fetcher = this.options.fetcher ?? fetch
    return fetcher(input, init)
  }

  private publish(offline: boolean): void {
    if (this.offline === offline) return
    this.offline = offline
    for (const listener of this.listeners) listener(offline)
  }
}

export function createNetworkGate(options: NetworkGateOptions): NetworkGate {
  return new NetworkGate(options)
}
