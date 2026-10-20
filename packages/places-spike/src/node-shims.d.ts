declare module 'node:fs/promises' {
  export function mkdir(path: string, options: { recursive: true }): Promise<string | undefined>
  export function writeFile(path: string, data: string, encoding: 'utf8'): Promise<void>
}

declare module 'node:path' {
  export const sep: string
  export function dirname(path: string): string
  export function relative(from: string, to: string): string
  export function resolve(...paths: string[]): string
}

declare module 'node:url' {
  export function fileURLToPath(url: URL | string): string
  export function pathToFileURL(path: string): URL
}

declare const process: {
  argv: string[]
  execPath: string
  env: Record<string, string | undefined>
  exitCode?: number
}
