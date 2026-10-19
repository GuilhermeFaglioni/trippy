# Trippy — Plano até o beta

> v0.2, 19/out/2026. Rascunho do Codex, condensado pelo Claude Code e reordenado para desenvolvimento local primeiro. A arquitetura está em `arquitetura.md`.
>
> **Datas-chave:** a família recebe o TestFlight até **15/dez**, e o embarque é em **29/dez/2026**. Uma pessoa (Guilherme) com agentes.

## Regras

- **Local primeiro.** Código e testes rodam no Mac (Docker + iOS Simulator) até o ciclo estar validado. Veja `desenvolvimento-local.md`.
- **Deploy de integração até 28/nov, obrigatório**, mesmo que nem tudo esteja verde localmente.
- **Exceção:** uma prova mínima do Sign in with Apple com o Cognito real nas primeiras semanas.
- **Cada spike registra** a hipótese, a evidência, a limitação encontrada e a decisão tomada.
- **Folga de 25% em cada semana** para integração e correções.
- **Gatilho de replanejamento:** se um gate crítico falhar até **02/nov**, ou se o ciclo local não fechar até **27/nov**, replanejar na hora com o Guilherme.

## Ponto de partida: repositório no GitHub + CI (20–22/out)

Antes de qualquer feature, o repositório vai para o GitHub com um CI que bloqueia o merge quando algo quebra. Skills usadas: `ci-cd-and-automation` (quality gates), `github-actions` (builds de React Native) e `github-actions-hardening` (segurança).

**Branches:** `develop` é o branch padrão e recebe os PRs de feature. A `main` é o release e **só recebe PRs vindos do `develop`**. A promoção do `develop` para a `main` acontece quando se quer um build para testar no iPhone, não a cada feature.

| Workflow | Quando roda | O que faz |
|---|---|---|
| `ci.yml` → **quality** e **integration** | Todo PR e push no `develop` e na `main` | `pnpm install` com cache, ESLint + Prettier, `tsc` (typecheck), testes de unidade com Vitest. Integração com Postgres como service. **Obrigatório nos dois branches.** |
| `security.yml` | Todo PR + semanal | `pnpm audit`. Mais o Dependabot (npm, github-actions e docker-compose). **Obrigatório nos dois branches.** |
| `release.yml` → **origem do PR** | PR para a `main` | Recusa PR para a `main` que não venha do `develop`. |
| `release.yml` → **ios-simulator** | **Sempre** em PR para a `main`; no `develop`, só com o label `ios` e no **build noturno** | Runner macOS: `expo prebuild` + build para o Simulator. O `.app` fica como artefato. |
| `release.yml` → **e2e-maestro**, **render-image** (quando existirem) | PR para a `main` | Testes Maestro no Simulator, e build amd64 do Remotion com render curto. |
| `release.yml` → **testflight** (a partir de 28/nov) | Depois do merge na `main` | Deploy e envio para o TestFlight, via GitHub Environment `release` com **aprovação manual**. Haverá também um Environment `dev`. |

**Regras de segurança do CI:**

- `permissions: contents: read` por padrão, com escopo extra só no job que precisar.
- Actions de terceiros fixadas por **SHA completo**.
- Nada de `pull_request_target`.
- Nenhum segredo de produção no CI.
- Proteção dos dois branches: merge só por PR, force-push bloqueado e checks obrigatórios. No `develop`: quality, integration e audit. Na `main`: os mesmos, mais a origem do PR e o build iOS.

**Pronto quando:** um PR com erro de tipo, teste falhando ou lint quebrado fica **bloqueado**, um PR limpo passa em menos de 10 minutos, um PR para a `main` vindo de outro branch é recusado, e o build de iOS gera o artefato do Simulator.

## Semanas

| Período | Objetivo | Pronto quando |
|---|---|---|
| **20/out–02/nov** Base local e spikes | Depois do CI: monorepo, `docker compose` (Postgres, MinIO, ElasticMQ, Mailpit), API Hono, migrations, app Expo no Simulator. Spikes **locais**: fornecedor de lugares (com licença), sync e outbox com dois Simulators, lote de fotos → MinIO, render Remotion no container amd64, auth dev. **Prova mínima de Apple + Cognito real.** Contas, domínio, SES e conversa com o fornecedor começam no dia 20. | Um roteiro e uma visita sobrevivem a reinício offline e convergem entre os dois Simulators. Um lote de fotos e um MP4 fazem o caminho de ida e volta localmente. O fornecedor está escolhido ou é risco declarado. O caminho do login com a Apple está decidido. |
| **03–16/nov** Planejamento e Hoje offline | Login, home, criação, convite (servido localmente), aviso, adicionar lugar, "quero ir", roteiro com papéis, membros, cartão. Tela Hoje, Eu fui, favorito, avaliação, observações, Estamos aqui, fases e fuso, Pronto para viajar. | Duas pessoas (dois Simulators) fazem convite → sugerir → montar roteiro → um dia offline, divergem e reconectam sem perder nada. Os testes Maestro desses fluxos passam. |
| **17–23/nov** Memórias + recap mínimo | Lote com sugestão de lugar, lembrete local, miniaturas, álbum, visualizador, esconder e remover. Recap mínimo integrado cedo: snapshot, job e vídeo simples. | Um lote com HEIC e fotos sem EXIF sobrevive a falhas e reinício sem duplicar. Um recap mínimo sai do snapshot até o MP4. |
| **24–27/nov** Fechar o ciclo local | Recap completo (telas, estados, gerar de novo, variantes com e sem marca), encerramento automático e manual, reconciliação de jobs. CDK preparado em paralelo. | O ciclo completo roda localmente com os testes verdes. Se não rodar, o bloqueio fica registrado. |
| **28/nov** Deploy de integração | CDK: API Gateway + Lambda, Neon, Cognito, SES, S3 + CloudFront, SQS, ECS Fargate Spot, Scheduler, alarmes de custo. | A stack sobe e o app no Simulator funciona apontando para a AWS. |
| **29/nov–07/dez** Validação real | Cognito + Apple, iPhones físicos, APNs, upload em segundo plano, Spot (interrupção e custo), Neon real, preview no WhatsApp, China/eSIM se houver acesso. TestFlight técnico. Ensaio curto com a família. **Funcionalidades congeladas em 07/dez.** | O ciclo completo funciona em iPhones reais via TestFlight, sem perda de conteúdo nem vazamento entre grupos. |
| **08–14/dez** Contingência e preparação | Corrigir só bloqueios. TestFlight com todos os familiares, login antes de embarcar, viagem real cadastrada, endereços locais conferidos, tudo abrindo em modo avião. Guia mínimo. | Todos os iPhones instalam, abrem e consultam o roteiro offline. Pelo menos dois aparelhos completam contribuição e sync. |
| **15/dez** Entrega | Beta familiar no TestFlight. De 16 a 28/dez, só correções indispensáveis. | |

## Se atrasar: o que pode ser cortado

- **Recap:** simplificar movimento, ornamentos e modelos do vídeo para um modelo só.
- **Visual:** variações e refinamentos do tema escuro.
- **Testes de escala:** reduzir o tamanho dos testes de carga. Os testes de integridade ficam.
- **Spot:** se o Fargate Spot atrapalhar o prazo, usar Fargate on-demand (com aprovação do custo).

**O que não se corta:** sugestão individual com busca e link, colaboração e permissões, roteiro offline, visitas e fotos em fila durável, lote com sugestão de lugar e lembrete, endereço local, convite web e aviso, álbum, recap, vídeo e gerar de novo. Cortar qualquer item aprovado exige decisão explícita do Guilherme.

## Dependências externas (começar em 20/out)

Elas não andam mais rápido com agentes:

- **Apple:** conta de desenvolvedor, Sign in with Apple, TestFlight e chave APNs.
- **SES:** sair do sandbox e configurar DKIM no domínio.
- **Domínio do app.**
- **Contrato com o fornecedor de lugares.**
- **Acesso a uma rede chinesa para teste** (opcional).

## Depois do beta

Assinaturas com RevenueCat, Android em produção (FCM), lançamento público, migração Neon → RDS se necessário (com ensaio de `pg_dump`/restore) e alta disponibilidade.
