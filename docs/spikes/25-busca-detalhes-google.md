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

### B4 — revalidação pendente antes de T5

O relatório do agente macOS de 23/10/2026 registrou os pontos abaixo durante a conferência de coordenadas. Os arquivos de evidência originais permanecem no Mac e não estavam acessíveis nesta worktree; portanto, os itens são atribuídos ao relatório e não foram revalidados nesta rodada:

- `cn-sh-bund` (marcado `verified`): diferença reportada de 518 m para tolerância de 150 m. Revalidar a fonte e o ponto de referência do calçadão do Bund e decidir, com evidência, se o ponto ou a tolerância está incorreto.
- `global-banff-springs` (marcado `verified`): diferença reportada de 315 m para tolerância de 250 m. Revalidar a fonte, o ponto e a tolerância antes de medir.
- `cn-bj-opposite-house` (marcado `unverified`): o relatório não encontrou coordenada no item Wikidata consultado. Confirmar uma referência independente ou manter o caso fora de `measuredSample25`.
- `global-savoy`: o item consultado redireciona de Q27081583 para Q746639; o relatório indica que a coordenada está correta. Confirmar e registrar a referência canônica usada.

Não alterei `packages/places-spike/data/amostra-25.json` nem ampliei tolerâncias para fazer os pontos passar. A revisão das fontes, pontos, tolerâncias e rótulos continua pendente antes de T5.

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

## Rodada 3 — diagnóstico offline e executor da amostra

### Escopo e evidência

Esta rodada parte do relatório do Simulator/macOS recebido na conversa. Os logs e respostas da Geoapify citados nesse relatório ficam no Mac e não estavam acessíveis nesta worktree. Nenhuma chamada Geoapify ou Google foi feita. Os casos "Pequim/Macau" usados nos testes são **sintéticos** e demonstram proteção local, não reproduzem nem provam a causa dos resultados reais.

### Correções sustentadas pelo código

- O adaptador já enviava `filter=countrycode:<país do destino>` na busca primária e `filter=circle:<destino>,<raio configurado>` na secundária, mas não verificava esses limites nas respostas. Agora a primária descarta candidatos cujo `country_code` explícito difere do país resolvido; a secundária confere a distância Haversine contra o mesmo raio enviado. Campos de país ausentes continuam aceitos porque a busca do fornecedor já recebe o filtro.
- O cache do geocoding do destino agora inclui o idioma da consulta. Antes, duas buscas pelo mesmo texto em idiomas diferentes compartilhavam a primeira resolução.
- Os 5 s agora são um prazo total por busca, compartilhado entre o geocoding do destino e a consulta primária/secundária. Antes, cada requisição sequencial tinha seu próprio timeout de 5 s, permitindo quase 10 s combinados. Um teste com relógio sintético prova que uma segunda resposta além do prazo termina como `provider_timeout` e registra o timeout sem expor conteúdo remoto.

Essas proteções impedem respostas explicitamente fora dos filtros solicitados e limitam o tempo composto. **Elas não provam que a resolução real de “Pequim, China” foi correta**: o relatório recebido não inclui a resposta de geocoding do destino. Se o próprio destino for resolvido para outra cidade dentro do mesmo país, a busca ainda pode ser enviesada para lá; é necessária evidência sanitizada da requisição de destino e de sua resolução.

### Plano offline T5

O comando `corepack pnpm --filter @trippy/places-spike benchmark:sample-25:dry-run` carrega e valida `data/amostra-25.json`, exclui os 13 casos não verificados e lista 141 consultas primárias (47 casos verificados × PT/EN/local) por segmento. A tentativa Places aparece como condicional a primária vazia ou rejeição humana; o dry-run não a despacha, faz zero chamadas e deixa métricas nulas. Isso é preparação de execução, não medição T5: não fornece top-1/top-5, ganho real da segunda tentativa, endereço local escolhido, correspondência Google, latência, erros ou créditos.

### Decisões e pendências

- O ranking continua na ordem devolvida pelo fornecedor. A #25 mede top-1/top-5, mas não define um algoritmo local de reordenação. A observação de que “Torré” ficou à frente de “Torre Eiffel” veio do relatório macOS; a resposta bruta não está disponível para análise. **Pedir decisão humana** antes de introduzir ordenação por relevância, incluindo normalização de acentos/idioma.
- A busca secundária retorna os resultados que o Places fornecer; não há retry automático nem mesclagem com Geocoding. Isso preserva o fluxo da #25 e o ADR 0001, que exigem medir o ganho antes de decidir automação.
- T5 continua bloqueado: falta orçamento numérico aprovado para chamadas e falta a escolha humana dos candidatos. A execução real também depende de respostas Geoapify sanitizadas, fontes/rótulos T4 revalidados e acesso aos créditos reais no painel.
- A causa da falha reportada para China, o ranking real em português e os timeouts de produção continuam **não comprovados por esta rodada offline**. Revalidar depois no ambiente macOS, dentro de orçamento definido.

### Checks desta rodada

- `corepack pnpm exec vitest run --project unit packages/adapters/src/places/geoapify.test.ts packages/places-spike/src/sample-25.test.ts packages/places-spike/src/sample-25-plan.test.ts` — 3 arquivos, 17 testes passaram.
- `corepack pnpm lint` — passou globalmente.
- `corepack pnpm -r --parallel typecheck` — passou nos 10 workspaces.
- `corepack pnpm exec vitest run --project unit` — 28 arquivos, 236 testes passaram.
- `corepack pnpm --filter @trippy/mobile test` — 32 suítes, 144 testes passaram.
- Prettier nos 7 arquivos alterados e `git diff --check` — passaram.
- O comando dry-run acima — 60 casos validados, 47 verificados, 13 excluídos, 141 chamadas primárias planejadas e 0 chamadas externas.
- `corepack pnpm typecheck` e `corepack pnpm test` não completaram como scripts raiz porque chamam `pnpm` aninhado, ausente no PATH do ambiente; rodei os componentes equivalentes diretamente, todos aprovados conforme acima. Integração com banco, chamadas reais e validação T5 não executadas nesta rodada.

### Correção após a revisão independente — 23/10/2026

A revisão identificou que o catch de `response.json()` classificava o aborto do prazo total durante a leitura do corpo como `provider_error/invalid_json`. O adaptador agora preserva `provider_timeout` e status `timeout` quando o prazo expira durante a leitura, tanto ao geocodificar o destino quanto na busca primária/secundária. JSON malformado sem timeout continua como `provider_error/invalid_json`.

As regressões sintéticas cobrem aborto no corpo nos três estágios e JSON inválido em cada estágio; não usam rede nem provam comportamento de respostas reais.

Checks executados para esta correção:

- `corepack pnpm exec vitest run --project unit packages/adapters/src/places/geoapify.test.ts packages/places-spike/src/sample-25.test.ts packages/places-spike/src/sample-25-plan.test.ts` — 3 arquivos / 23 testes passaram.
- `corepack pnpm --filter @trippy/adapters typecheck` — passou.
- `corepack pnpm exec eslint packages/adapters/src/places/geoapify.ts packages/adapters/src/places/geoapify.test.ts` — passou.
- Prettier nos três arquivos desta correção e `git diff --check` — passaram.

Não executei a suíte completa, integração de banco, chamadas a Geoapify/Google ou T5. As fontes e coordenadas B4 permanecem pendentes de revalidação independente antes de T5.
