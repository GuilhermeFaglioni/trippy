declare module 'node:sqlite' {
  export class DatabaseSync {
    constructor(path: string)
    exec(sql: string): void
    prepare(sql: string): StatementSync
    close(): void
  }

  interface StatementSync {
    run(...parameters: unknown[]): {
      changes: number | bigint
      lastInsertRowid: number | bigint
    }
    all(...parameters: unknown[]): unknown[]
    get(...parameters: unknown[]): unknown
  }
}

declare module 'node:fs/promises' {
  export function mkdtemp(prefix: string): Promise<string>
  export function rm(
    path: string,
    options?: { recursive?: boolean; force?: boolean },
  ): Promise<void>
}

declare module 'node:os' {
  export function tmpdir(): string
}

declare module 'node:path' {
  export function join(...parts: string[]): string
}
