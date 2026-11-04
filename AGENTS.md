# Trippy

App iOS/Android de viagens em grupo. Produto em `docs/visao-produto.md` e `docs/fluxos-e-telas.md`; arquitetura em `docs/arquitetura.md`; ambiente local em `docs/desenvolvimento-local.md`; plano em `docs/plano-beta.md`.

## Agent skills

### Issue tracker

Issues e specs ficam nas GitHub Issues deste repositório (`gh` CLI). See `docs/agents/issue-tracker.md`.

### Triage labels

Os cinco labels padrão: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Ciclo de desenvolvimento

Planejador → implementadores (`/implement`) → revisor independente → PR com auto-merge, com o revisor cuidando da esteira. Orquestrado pelo T3 Code, com Claude, Gemini e GPT. Skills em `.agents/skills/`. See `docs/agents/ciclo-de-desenvolvimento.md`.

### Domain docs

Contexto único: `GLOSSARY.md` e `docs/adr/` na raiz, criados sob demanda. See `docs/agents/domain.md`.
