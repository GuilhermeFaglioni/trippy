import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

export default defineConfig({
  server: { port: 5180 },
  // three.js vem num chunk próprio, carregado sob demanda depois do HTML
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 800,
    // duas páginas: português na raiz, inglês em /en/
    rolldownOptions: {
      input: {
        pt: fileURLToPath(new URL('./index.html', import.meta.url)),
        en: fileURLToPath(new URL('./en/index.html', import.meta.url)),
      },
    },
  },
})
