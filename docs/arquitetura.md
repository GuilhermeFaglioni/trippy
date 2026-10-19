# Trippy — Arquitetura

> v0.2, 19/out/2026. Decisões fechadas com o Guilherme a partir do debate entre Claude Code e Codex, já com a revisão do Codex incorporada. Base de produto: `visao-produto.md` e `fluxos-e-telas.md` (v0.4).

## Princípios

1. **O código não sabe que está na AWS.** O domínio é TypeScript puro. AWS, Cognito, S3, SQS e APNs ficam atrás de adaptadores. Trocar de nuvem significa reescrever a infraestrutura, não o app.
2. **Offline primeiro.** O celular é a fonte da verdade da interface. A rede é usada para sincronizar, não para funcionar.
3. **Menor custo no início.** Nada fica ligado o tempo todo sem necessidade. Não há NAT, ALB, RDS nem EFS no beta.
4. **Postgres puro.** Usamos migrations em SQL e nenhuma extensão ou driver específico de fornecedor, para migrar com `pg_dump`.

## Visão geral

```
 iPhone / Android (Expo)
 ├─ SQLite (dados da viagem) + outbox (fila de envio)
 ├─ fotos locais + fila de upload
 └─ notificação local (lembrete noturno)
        │ HTTPS (JWT do Cognito)
        ▼
 CloudFront ── /c/:token (convite, HTML com tags OG)
        │
 API Gateway HTTP API ──► Lambda "api" (Hono, TypeScript) ──TLS──► Postgres (Neon, us-east-1)
        │                      │
        │                      ├─ presigned URL ──► S3 (fotos, vídeos)   ◄── upload direto do app
        │                      ├─ SQS "recap"  ──► Lambda "dispatcher" ──► ECS Fargate Spot (Remotion)
        │                      └─ APNs (push)
        │
 S3 (evento de foto nova) ──► SQS "thumbs" ──► Lambda "thumbs" (sharp)
 Cognito User Pool (Apple + e-mail OTP via SES)
```

Região: **us-east-1**. Infraestrutura como código: **AWS CDK em TypeScript**.

## Componentes

| Camada | Escolha | Observações |
|---|---|---|
| App | Expo + React Native + TypeScript + Expo Router | Ícones com `lucide-react-native` e tokens do design system Trippy. Builds pelo EAS (plano grátis) ou locais. Sem Expo Push nem EAS Update no início. |
| Dados locais | `expo-sqlite` + outbox | Veja "Sincronização". |
| API | Hono em Lambda (Node 22) + API Gateway HTTP API | Um só Lambda "api". O mesmo app roda em container se um dia migrar para Fargate. |
| Banco | Postgres no **Neon** (plano grátis, AWS us-east-1) | A Lambda conecta com `pg` padrão pelo endpoint com pooler (modo transação) e TLS, com pool de 1 conexão por instância de Lambda e concorrência limitada. **A Lambda fica fora de VPC, sem NAT.** Migrations e `pg_dump` usam o endpoint direto, porque o pooler em modo transação não mantém estado de sessão. Migrar para RDS com `pg_dump` quando houver usuários pagantes ou o plano grátis não bastar. |
| Acesso a dados | Kysely ou Drizzle + migrations SQL versionadas | Escolher no início da construção. |
| Login | **Cognito User Pool (Essentials)** | Código por e-mail (OTP nativo do Cognito, enviado pelo SES). O Sign in with Apple pelo botão nativo do iPhone **não funciona direto no User Pool**, que só aceita a Apple pelo fluxo web (OAuth + PKCE). Duas saídas, a decidir por spike: (a) fluxo web do Cognito numa janela do sistema (`ASWebAuthenticationSession`), ou (b) *custom auth challenge*, em que uma Lambda valida o token da Apple e o Cognito emite a sessão. Refresh token de 365 dias e access token curto, guardados no `SecureStore`. Os dados locais continuam acessíveis offline. Sem sessão válida, as operações esperam na fila até reautenticar. A tabela `identities` vincula Apple, e-mail e, no futuro, Google ao mesmo `users.id` interno. |
| Fotos | S3 privado + URL pré-assinada (PUT) | O app comprime para ~2048px JPEG antes de enviar. A leitura é por CloudFront com URL assinada. |
| Miniaturas | S3 event → SQS → Lambda (sharp) | Com idempotência e fila de mensagens com falha (DLQ). |
| Vídeo do recap | **Remotion em container no ECS Fargate Spot**, disparado por SQS | O controle fica numa tabela `render_jobs` com lease. Veja "Recap". A imagem do container fica no ECR. A task roda numa VPC mínima: subnet pública, rota para o Internet Gateway, `assignPublicIp=ENABLED` e security group sem entrada. Sem NAT. |
| Push | **APNs direto** (HTTP/2, chave .p8) | O beta é só iPhone. O Android entra depois, com FCM direto. |
| Lembrete noturno | Notificação **local** (`expo-notifications`) | Funciona offline e não depende de push. |
| Convite web | CloudFront → Lambda "api" em `GET /c/:token` | Devolve HTML pronto, com título, descrição e `og:image`, para o preview do WhatsApp. Assets ficam no S3. |
| Assinaturas | RevenueCat + entitlement no nosso Postgres | **Fora do beta.** |
| Segredos | SSM Parameter Store (SecureString) | |
| Observabilidade | CloudWatch Logs (retenção de 14 dias) + AWS Budgets com alarme | Sentry é opcional depois. |

## Modelo de dados (rascunho)

```
users(id, cognito_sub, name, email, created_at)
trips(id, name, destination, start_date, end_date, timezone, cover_key, organizer_id,
      itinerary_version, seq_counter, ended_at, created_at)
trip_members(trip_id, user_id, role[organizer|coorganizer|member],
             accepted_video_terms_at, joined_at, left_at)
invites(id, trip_id, token_hash, created_by, revoked_at)
places(id, trip_id, provider, provider_ref, name, local_name, address, local_address,
       lat, lng, suggested_by, comment, day_index NULL, position, deleted_at)
place_reactions(place_id, user_id, deleted_at)  -- "quero ir"
visits(place_id, user_id, marked_by, visited_at, visited_tz, deleted_at)
favorites(place_id, user_id, deleted_at)
ratings(place_id, user_id, stars, deleted_at)
notes(id, place_id, user_id, text, deleted_at)
photos(id, trip_id, place_id NULL, user_id, s3_key, taken_at_original, taken_tz, lat, lng,
       hidden_from_recap, status[pending|uploaded|ready], deleted_at)
recaps(id, trip_id, version, status[queued|rendering|ready|failed],
       snapshot jsonb, video_key, watermark, created_at)
devices(id, user_id, platform, push_token)
applied_ops(op_id UNIQUE, user_id, trip_id, result, applied_at)  -- gravado na mesma transação da mudança
identities(user_id, provider[apple|email|google], provider_subject)
render_jobs(id, recap_id, variant[clean|watermarked], status, lease_until, task_arn,
            attempts, last_error)
```

Cada tabela sincronizável tem `trip_id`, `seq bigint` e `deleted_at`. **O `seq` não vem de uma sequência global.** Uma sequência global não segue a ordem de commit: uma transação que pegou o número 10 pode terminar depois da que pegou o 11, e o pull pularia o 10. Por isso, cada escrita numa viagem trava a linha da viagem (`SELECT … FOR UPDATE`), incrementa `trips.seq_counter` e usa esse valor. Assim os commits de uma viagem ficam em série e o cursor é coerente. Remoções são lógicas, para que o pull as entregue.

## Sincronização

- **Escrita local:** toda ação (sugerir lugar, "Eu fui", mover de dia, foto) grava no SQLite e enfileira uma operação no outbox, com `op_id` (UUID).
- **Push:** `POST /sync/push` envia operações em lote. O servidor aplica cada uma numa transação, registra o `op_id` em `applied_ops` (repetir é inofensivo) e confere permissão por papel.
- **Pull:** `GET /sync/pull?trip=…&cursor=…&limit=…` devolve as linhas de todas as tabelas com `seq > cursor`, incluindo remoções, ordenadas por `seq` e paginadas. O primeiro acesso (bootstrap) baixa o estado atual inteiro e o cursor. Se o cursor for antigo demais para a retenção de remoções, o servidor manda fazer o bootstrap de novo.
- **Membro removido:** o push dele é recusado, o app marca as operações pendentes como "não enviadas" (sem apagar) e, ao saber da remoção, tira a viagem do acesso local.
- **Conflitos no roteiro:** as operações de dia e ordem levam a `itinerary_version` em que foram feitas. Se o servidor estiver em outra versão, a operação volta como conflito. O app guarda o rascunho, baixa o roteiro atual e mostra o que mudou. Não há last-write-wins no roteiro. A comparação e o incremento da versão são atômicos. Um lote de movimentos dependentes vai como uma operação só.
- **Registros por pessoa** (visita, favorito, nota, avaliação) podem divergir quando a mesma pessoa usa dois aparelhos, ou quando o organizador marca a presença de alguém. Vale a ordem em que o servidor aceitou as operações. Quem foi marcado por outra pessoa sempre pode se desmarcar.
- **Quando sincroniza:** ao abrir o app, ao voltar para ele, quando a rede volta e periodicamente com o app aberto. Em segundo plano, tenta via `expo-background-task`, **sem garantia**.
- **Interface honesta:** o app mostra a hora da última sincronização e o que está pendente.

## Fotos

1. A pessoa escolhe as fotos em lote. O app copia cada uma para um diretório permanente, lê o horário original, o fuso e o GPS do EXIF **antes** de converter, e então comprime para JPEG.
2. O app sugere o lugar de cada foto comparando o horário (e o GPS, quando houver) com o `visited_at` das visitas do dia. Isso roda no celular, offline. Sem EXIF ou sem visita no horário, a foto fica sem sugestão e a pessoa escolhe.
3. A fila de upload pede uma URL pré-assinada, faz o PUT direto no S3 e confirma na API. Ela continua com o app aberto e tenta em segundo plano sem garantia.
4. O S3 dispara a geração das miniaturas, e a foto passa a `ready`.

## Recap

1. **Fim automático:** ao criar a viagem ou mudar suas datas, a API cria ou atualiza um agendamento único no **EventBridge Scheduler**, no fuso da viagem. Ele chama a API no fim da data de volta. **Encerrar viagem** feito offline vale quando sincronizar.
2. **Snapshot:** na mesma transação, a API grava o snapshot em `recaps`, com estatísticas, destaques, favoritos e as fotos já confirmadas no servidor (fotos pendentes entram numa próxima geração), e cria os `render_jobs`. Uma tabela de outbox no Postgres garante que a mensagem para o SQS `recap` seja publicada mesmo que a primeira tentativa falhe.
3. **Dispatcher:** a Lambda `dispatcher` lê a mensagem, faz o `RunTask` no Fargate Spot, grava o `task_arn` e o lease no job e só então confirma a mensagem. **A fonte da verdade é o `render_jobs`, não a fila.**
4. **Render:** o container Remotion lê o snapshot e as fotos do S3, renderiza, valida e grava o MP4. Depois marca o job e o recap como `ready` (idempotente por versão e variante), e o grupo recebe um push.
5. **Reconciliação:** um evento do EventBridge (mudança de estado de task do ECS) e uma varredura periódica pegam tasks interrompidas pelo Spot, que nunca iniciaram ou com lease vencido. Elas são reenfileiradas com limite de tentativas e, quando o limite estoura, o recap fica como `failed` (o app mostra **Tentar de novo**).
6. **Gerar de novo:** cria uma nova versão do snapshot. As versões anteriores continuam guardadas.
7. **Marca d'água:** cada versão é renderizada em duas variantes, **sem marca** e **com marca**. O download e o compartilhamento entregam a variante que vale **no momento do pedido**: sem marca se o organizador for assinante. Cópias já entregues não mudam. No beta, as assinaturas estão desligadas.

## Lugares

Decisão em **`docs/adr/0001-fornecedores-de-lugares.md`**:
- **Buscar, descobrir e salvar:** Geoapify, a única fonte persistida.
- **Enriquecer e confirmar:** "Detalhes do Google" ao vivo, só por toque, guardando apenas o `place_id`.
- **Depois do beta:** índice próprio do FSQ OS Places.

A busca roda **no servidor**, atrás do adaptador `PlacesProvider`. A tabela `places` guarda a origem e a licença de cada campo, separada das correções do usuário. O fallback continua sendo nome digitado + GPS.

## Custo estimado no beta (on-demand, us-east-1)

| Item | US$/mês |
|---|---|
| Neon (plano grátis) | 0 |
| Lambda, API Gateway, SQS, SES, Cognito no volume do beta | ~0 a 2 |
| S3 + CloudFront | ~1 a 3 |
| Fargate Spot para o vídeo | centavos por recap |
| Route 53 | 0,50 |
| CloudWatch | ~1 a 2 |
| ECR + IPv4 público das tasks (só enquanto rodam) | centavos |
| **Total** | **~US$ 2 a 8 (estimativa a medir)** |

O total supõe dezenas de usuários, poucos GB de fotos, dezenas de recaps e o free tier do Lambda, do CloudFront e do Neon. Medir na semana 1 e configurar o AWS Budgets com alarme. Fora desse total: o fornecedor de lugares, o domínio, as contas de desenvolvedor e uma eventual licença do Remotion.

## Riscos e spikes (validar antes de construir em escala)

1. **Fornecedor de lugares:** a licença precisa permitir guardar os dados, com cobertura de nome e endereço local (inclusive na China) e custo conhecido.
2. **Sync offline:** testar com dois celulares, vários dias offline, fechar o app à força, operações repetidas e reordenação concorrente.
3. **Fotos:** lote com HEIC e JPEG, fusos diferentes, rede caindo e retomada.
4. **Vídeo:** render de 30 a 60s no Fargate Spot, medindo tempo e custo. Testar fontes chinesas (Noto), poucas fotos e nenhuma foto.
5. **Login:** decidir entre o fluxo web do Cognito e o custom auth challenge para a Apple. Validar o OTP do Cognito e a sessão longa em build de release, incluindo o reabrir offline.
6. **China pelo eSIM:** API, S3 e APNs acessíveis. Esse teste não bloqueia a construção, porque a China não é o caso principal.

## Depois do beta

Assinaturas (RevenueCat), Android em produção (FCM), migração para RDS quando fizer sentido, mapa do percurso e "dia mais intenso" no recap.
