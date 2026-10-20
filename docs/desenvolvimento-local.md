# Trippy — Desenvolvimento local

> v0.1, 19/out/2026. O fluxo é **código e testes rodando localmente primeiro**, no macOS, com o iOS Simulator do Xcode. O deploy na AWS só acontece quando o local estiver validado e o deploy for realmente necessário. Veja "Quando fazer o deploy".

## Princípio

A arquitetura isola a AWS atrás de adaptadores (`arquitetura.md`). Localmente, cada adaptador tem uma implementação que roda no Mac, a mesma API Hono roda como servidor Node comum, e o app aponta para `localhost`.

## Equivalentes locais

| Produção (AWS) | Local | Observações |
|---|---|---|
| API Gateway + Lambda (Hono) | `node` / `tsx watch` rodando o mesmo app Hono | O handler da Lambda é só um adaptador fino em volta do app. |
| Postgres no Neon | Postgres 17 em Docker | Mesmas migrations. Os testes de integração criam e removem um banco descartável no serviço local. |
| S3 + URL pré-assinada | **MinIO** em Docker (compatível com S3) | Bootstrap cria buckets e filas locais, mas ainda não liga o evento "objeto criado" à fila de miniaturas. MinIO não publica nesse SQS/ElasticMQ; esse fluxo fica para o spike de fotos/miniaturas. **Atenção:** o host faz parte da assinatura da URL. O Simulator alcança MinIO em `localhost:59000`; não troque o host depois da assinatura. |
| SQS | **ElasticMQ** em Docker (compatível com SQS) | Bootstrap cria filas e DLQs com redrive policy; filas locais têm persistência. |
| Lambda de miniaturas | Worker Node local consumindo a fila de miniaturas | Mesmo código, com `sharp`. |
| Fargate + Remotion | Um dispatcher local consome a fila e dispara o container de render **de forma assíncrona**, como faria o `RunTask`, e grava o job | Assim aparecem os mesmos problemas da produção: confirmação antes do fim, duplicação, worker morto e reconciliação. A imagem é construída para **linux/amd64** (a arquitetura do Fargate), com as fontes Noto CJK e os limites de CPU, memória e disco iguais aos da task. |
| EventBridge Scheduler | Varredura local a cada minuto procurando viagens encerradas | Fica atrás do adaptador `Scheduler` e usa **a mesma regra** de fuso e idempotência da produção. |
| Cognito | Adaptador de auth **dev**: OTP por e-mail com JWT assinado localmente | O emulador de Cognito do LocalStack é pago. O domínio só conhece `users.id` e o adaptador. O emissor (`iss`), a audiência e as chaves são **exclusivos de dev**, e a API de produção recusa esses tokens. O adaptador dev nunca entra no build de release. |
| SES (e-mail do OTP) | **Mailpit** em Docker | O código chega numa caixa local, em `localhost:58025`. |
| APNs | Adaptador que registra o push no log + `xcrun simctl push` | Isso só injeta a notificação no Simulator. Não testa o registro do token nem a entrega pelo APNs. |
| Fornecedor de lugares | API real com chave de desenvolvimento **ou** adaptador com dados gravados | Os dados gravados (fixtures) servem para os testes não dependerem da rede. |
| CloudFront (convite) | A API local servindo `GET /c/:token` | Para testar o preview do WhatsApp é preciso uma URL pública. Usar um túnel temporário, ou deixar para o deploy. |

Endereços: o Simulator alcança o Mac por `localhost`. Os containers alcançam o Mac por `host.docker.internal`. Um iPhone físico precisa do IP do Mac na rede local.

**Portas:** todos os serviços ficam vinculados a `127.0.0.1`, em portas que não conflitam com outros projetos:

| Serviço | Porta local | Endereço |
|---|---:|---|
| Postgres | 54329 | `localhost:54329` |
| MinIO S3 | 59000 | `http://localhost:59000` |
| Console MinIO | 59001 | `http://localhost:59001` |
| ElasticMQ SQS | 59324 | `http://localhost:59324` |
| Console ElasticMQ | 59325 | `http://localhost:59325` |
| Mailpit SMTP | 51025 | `localhost:51025` |
| Mailpit UI | 58025 | `http://localhost:58025` |

## Subir o ambiente local

1. Se `.env` ainda não existir, crie-o com `cp .env.example .env`. As chaves `GEOAPIFY_API_KEY` e `GOOGLE_PLACES_API_KEY` podem ficar vazias até serem usadas.
2. Suba e aguarde todos os serviços: `docker compose up -d --wait`.
3. Crie buckets, filas e DLQs: `pnpm bootstrap`.
4. Aplique migrations: `pnpm db:migrate`.
5. Inicie a API: `pnpm --filter @trippy/api dev`.
6. Inicie o app no Simulator: `npx expo run:ios`.

O `pnpm --filter @trippy/api dev`, `pnpm bootstrap` e `pnpm db:migrate` carregam `.env` da raiz quando existe. O `pnpm test:integration` também carrega esse arquivo; variáveis já exportadas pelo shell ou CI têm precedência. A API expõe `GET /health`, que verifica Postgres, MinIO, ElasticMQ e Mailpit; responde `200` quando todos respondem e `503` quando algum serviço falha.

## Estrutura do repositório

```
apps/
  mobile/           Expo (React Native, TypeScript)
  api/              Hono, com entrada local (Node) e entrada Lambda
  worker-thumbs/    miniaturas (sharp)
  worker-render/    Remotion (Dockerfile = imagem do Fargate)
packages/
  domain/           regras de negócio em TypeScript puro, sem SDK de nuvem
  db/               migrations SQL + acesso a dados
  sync/             protocolo de sync (tipos, validação) compartilhado entre app e API
  adapters/         interfaces + implementações local e AWS (storage, queue, auth, push, places, scheduler)
infra/              CDK (só quando chegar a hora do deploy)
docker-compose.yml
```

Monorepo com **pnpm workspaces**.

## Testes

| Nível | Ferramenta | O que cobre |
|---|---|---|
| Unidade | Vitest | Domínio: permissões, regras do roteiro, conflitos, sugestão de lugar por foto, estatísticas do recap. |
| Integração | Vitest + Docker Compose local (Postgres, MinIO, ElasticMQ, Mailpit) | Migrations, bootstrap dos recursos e checks da API. O CI usa o mesmo `docker-compose.yml`. |
| App | Jest + React Native Testing Library | Componentes e a camada local (SQLite + outbox). |
| Ponta a ponta | **Maestro** no iOS Simulator | Os fluxos do `fluxos-e-telas.md`: convite, sugerir, roteiro, Hoje, fotos, recap. |

## Testes de cenário no Simulator

- **Dois "celulares":** rodar **dois Simulators ao mesmo tempo**, cada um com seu UDID fixo, usuário próprio e armazenamento isolado. Instalar, abrir e controlar cada um pelo UDID. O teste só passa se o **estado convergir** nos dois aparelhos e no servidor. Não basta as telas parecerem iguais.
- **Offline:** o build de desenvolvimento injeta falhas de rede em **todas** as fronteiras: sync, upload, busca de lugares e auth, e não só no sync. Desligar o Wi-Fi do Mac não corta o `localhost`, então não serve como teste.
- **Maestro:** um fluxo por UDID, com fixtures e reset do banco entre cenários, e retomada depois de fechar o app à força. Os cenários com duas pessoas são coordenados por um script que alterna os dois Simulators. As chaves de teste não entram no build de release.
- **Fotos:** colocar fotos de teste com EXIF variado (HEIC, JPEG, fusos diferentes, sem GPS) com `xcrun simctl addmedia`.
- **Fuso da viagem:** mudar o fuso do Simulator para Xangai e conferir dias, lembrete noturno e encerramento.
- **Push:** usar `xcrun simctl push` com payloads de exemplo.

## O que o ambiente local NÃO valida

Estes itens precisam de aparelho real ou da AWS. Eles definem quando fazer o deploy:

1. **Cognito real:** Sign in with Apple (fluxo web ou custom auth challenge), refresh token, revogação e envio pelo SES.
2. **Push real pelo APNs** num iPhone físico, incluindo o registro do token.
3. **Upload em segundo plano** num iPhone físico. No Simulator, o comportamento em segundo plano não é confiável.
4. **Fargate Spot:** falta de capacidade, interrupção, tempo, custo, e a rede da task (ECR, SSM, S3 e Neon sem NAT).
5. **Neon real:** TLS, pooler em modo transação, cotas do plano grátis e o banco "acordando".
6. **Fila na AWS:** Lambda lendo do SQS → dispatcher → ECS, e eventos do S3.
7. **Permissões e borda:** IAM, CORS do S3, CloudFront com URL assinada, e o próprio CDK.
8. **Preview do convite no WhatsApp**, que precisa de URL pública.
9. **Acesso pela rede chinesa via eSIM.**
10. **TestFlight** para a família.

## Quando fazer o deploy

- **Deploy de integração até 28/nov, obrigatório.** Ele não depende de tudo estar verde localmente. Se o ciclo local atrasar, registra-se o bloqueio e sobe-se o que já está validado. Abaixo dessa data não sobra tempo para os 10 itens acima antes do TestFlight da família em 15/dez.
- **Sign in with Apple:** fica para depois da compra da conta Apple Developer (até 20/nov). Ele é testado no deploy de 28/nov. Até lá, o login é só por código por e-mail.
