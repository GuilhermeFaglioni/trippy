import { defineConfig } from 'vitest/config'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

// .env do repo ajuda nos testes locais; process.loadEnvFile preserva valores já exportados pelo CI.
const rootEnvFile = resolve(import.meta.dirname, '.env')
if (existsSync(rootEnvFile)) process.loadEnvFile(rootEnvFile)

// Testes de unidade: *.test.ts. Testes de integração (precisam de Postgres, MinIO etc.): *.int.test.ts.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['{apps,packages}/*/{src,test}/**/*.test.ts'],
          exclude: [
            '**/*.int.test.ts',
            'apps/mobile/src/**/*.test.ts',
            'apps/mobile/src/**/*.test.tsx',
            '**/node_modules/**',
          ],
        },
      },
      {
        test: {
          name: 'integration',
          include: ['{apps,packages}/*/{src,test}/**/*.int.test.ts'],
          exclude: ['apps/mobile/src/**/*.int.test.ts', '**/node_modules/**'],
        },
      },
    ],
  },
})
