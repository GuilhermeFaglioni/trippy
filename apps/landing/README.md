# @trippy/landing

Landing page com lista de espera. Vite + Three.js, sem framework.

```bash
pnpm --filter @trippy/landing dev     # http://localhost:5180
pnpm --filter @trippy/landing build   # gera dist/ estático
```

- **Cena 3D** (`src/scene.ts`): uma cena persistente atrás do texto; o scroll vira a linha do tempo `t` (abertura → planejar → viajar → lembrar → lista) e a câmera, a luz e os objetos são função de `t`.
- **Fallbacks:** sem WebGL, paisagem estática em CSS. Com "reduzir movimento", cada capítulo vira um quadro fixo trocado só por opacidade. Aparelho lento perde sombras e resolução sozinho.
- **Idiomas:** português em `/` (`index.html`) e inglês em `/en/` (`en/index.html`), com link de troca no topo e `hreflang`. O texto fica no HTML de cada página; as mensagens do formulário estão em `src/waitlist.ts`. Cada lead grava a coluna `idioma`. Ao mudar um texto, mude nas duas páginas.
- **Deploy:** `Dockerfile` + `nginx.conf` desta pasta (contexto de build na raiz do repo).
- **Lista de espera** (`src/waitlist.ts`): POST para `VITE_WAITLIST_URL`, um Apps Script que grava numa planilha. Instalação em `apps-script/README.md`.
