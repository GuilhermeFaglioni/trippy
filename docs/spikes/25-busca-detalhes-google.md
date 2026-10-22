# Spike 25 — Busca de lugares e Detalhes do Google

## Fechamento T2b — 22/10/2026

A busca primária do Geoapify usa `format=json`, cujo contrato documentado retorna registros planos em `results[]`. O adaptador agora lê esses campos diretamente. A busca secundária continua lendo `FeatureCollection` em `features[].properties`; o fluxo e a consulta permanecem separados, sem mesclagem automática.

O parser exige identidade (`place_id`), nome, coordenadas finitas dentro dos limites e uma origem de dados identificável. Endereço, nome local e país seguem opcionais. A regressão foi reproduzida contra o parser anterior durante a execução inicial do T2b: os registros planos eram descartados; os testes direcionados atuais confirmam os dois formatos e o descarte de entradas inválidas.

As fixtures em `packages/adapters/src/places/fixtures/` são **sintéticas e derivadas da documentação**, não respostas coletadas da API. A proveniência e os formatos de referência estão registrados no README da pasta; não houve chamada à Geoapify nem uso de credenciais nesta validação.

## Verificações locais

- `corepack pnpm exec vitest run --project unit` — 27 arquivos e 229 testes passaram nesta correção.
- `corepack pnpm --filter @trippy/mobile test` — 32 suítes e 144 testes Jest passaram nesta correção.
- `corepack pnpm lint` — passou nesta correção.
- `corepack pnpm -r --parallel typecheck` — passou nos 10 workspaces nesta correção.
- `corepack pnpm format:check` — a checagem inicial falhou nos 13 arquivos da entrega cumulativa da #25 listados no histórico da issue. Todos pertencem ao diff da branch contra `origin/develop`; foram formatados nesta correção e a repetição passou globalmente. `packages/adapters/src/places/geoapify.ts` já estava formatado desde a T2b.
- `git diff --check` — passou.
- `git apply --check docs/handoff/patch-2026-10-22-env-preparo-25.patch` — passou contra o handoff na branch `docs/handoff-semana-1`.
- Integração de banco não executada: o CLI `docker` está disponível, mas não há o plugin `docker compose`; `pg_isready` também não está disponível, e esta worktree não tem `.env` nem banco configurado.

Ambiente: Node `v24.22.1`, Corepack/pnpm `12.6.0`.

## T4 — amostra independente

`packages/places-spike/data/amostra-25.json` contém 60 casos estruturados: 30 na China, 20 globais e 10 de endereço. A amostra marca 47 casos como `verified` e 13 como `unverified`; estes últimos são excluídos de `measuredSample25`. O teste `sample-25.test.ts` passou e verifica contagens, idiomas, referências independentes de OSM, datum/conversão e campos obrigatórios. Esta validação é estrutural: neste fechamento não reabri as fontes para revalidar cada rótulo nem medi resultados de fornecedores.

## T5 — pendente

Não foram feitas chamadas de medição a Geoapify ou Google. Continuam pendentes a avaliação top-1/top-5 por caso e segmento, o recorte de atrações essenciais da China, presença do candidato separada da escolha humana, ganho da segunda tentativa Places, endereço local do candidato escolhido e correspondência com Google. Também faltam chamadas/SKUs por toque, latência, erros e créditos reais conferidos nos painéis de faturamento. Portanto, T5 e a validação final do spike continuam abertos.

## Preparação segura do ambiente desta branch

Cada worktree da #25 precisa de um `.env` local, ignorado pelo Git, e de um banco próprio. Para criar uma worktree, copie o `.env` da checkout principal somente quando ainda não houver `.env` no destino; não copie `.env.example` por cima de um `.env` existente. Depois, ajuste `DATABASE_URL` para o banco exclusivo da worktree antes de rodar migrations ou testes de integração.

Compare somente os nomes das variáveis, sem imprimir valores:

```sh
comm -23 \
  <(awk -F= '/^[A-Za-z_][A-Za-z0-9_]*=/ {print $1}' .env.example | sort -u) \
  <(awk -F= '/^[A-Za-z_][A-Za-z0-9_]*=/ {print $1}' .env | sort -u)
```

Esse comando lista chaves ausentes em `.env`. Complete apenas as ausentes e preserve os valores já existentes. Esta entrega acrescenta `PLACES_CANDIDATE_SECRET`, `PLACES_GEOAPIFY_SEARCH_RADIUS_METERS`, `PLACES_SEARCH_USER_DAILY_LIMIT`, `PLACES_SEARCH_TRIP_DAILY_LIMIT`, `PLACES_GOOGLE_DETAILS_USER_DAILY_LIMIT`, `PLACES_GOOGLE_DETAILS_TRIP_DAILY_LIMIT` e `PLACES_GOOGLE_RESTRICTION_RADIUS_METERS`. `PLACES_CANDIDATE_SECRET` é obrigatório e precisa ter valor local não vazio; gere um valor de desenvolvimento e não o registre em logs, terminal compartilhado ou Git. Os seis limites/raios são opcionais no carregamento da configuração. As chaves de fornecedores continuam opcionais até que uma validação real autorizada dependa delas; não são necessárias para os testes com fixtures.

O handoff geral foi atualizado em commit local `5c33a16cffca8cfef0aaa5075c4feea991a5131c`, na branch `docs/handoff-semana-1` e em worktree isolada. A orientação antiga de copiar sempre o `.env` da checkout principal foi substituída. O patch `docs/handoff/patch-2026-10-22-env-preparo-25.patch` reproduz essa substituição; ele passou por aplicação a seco sobre a versão base do handoff e o resultado foi comparado com o commit integrado.
