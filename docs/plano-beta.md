# Trippy — Plano até o beta

> v0.1, 19/out/2026. Rascunho do Codex, condensado pelo Claude Code. A arquitetura está em `arquitetura.md`.
>
> **Datas-chave:** a família recebe o TestFlight até **15/dez**, e o embarque é em **29/dez/2026**. Uma pessoa (Guilherme) com agentes.

## Regras

- **TestFlight técnico desde a semana 1.** O dia 15/dez marca o uso pela família, não a primeira tentativa de distribuir.
- **Spikes antes das telas.** Nada das 35 telas começa antes de provar login, persistência offline, upload e render.
- **Cada spike registra** a hipótese, a evidência (em aparelho real), a limitação encontrada e a decisão tomada.
- **Folga de 25% em cada semana** para integração e correções.
- **Gatilho de replanejamento:** se um gate crítico falhar até **02/nov**, ou se o ciclo completo não funcionar até **30/nov**, replanejar na hora com o Guilherme, sem absorver o atraso em silêncio.

## Semanas

| Semana | Objetivo | Pronto quando |
|---|---|---|
| **1 · 20–26/out** Fundação e spikes | Ter a infraestrutura mínima no CDK: API Gateway + Lambda, Neon com TLS, Cognito + SES, S3, SQS e alarmes de custo. Fazer um build Expo nos iPhones e o TestFlight técnico. Login com Apple + OTP. Rodar os spikes: **fornecedor de lugares**, outbox em dois celulares, lote de fotos → PUT pré-assinado, **Remotion no Fargate Spot**, e acesso pela rede chinesa se houver como testar. | O roteiro e as visitas sobrevivem a um reinício offline e aparecem no segundo celular depois de reconectar. Um lote de fotos e um MP4 completam o caminho de ida e volta. Os riscos que sobraram têm próximo passo definido. |
| **2 · 27/out–02/nov** Fechar gates e base de dados | Escolher o fornecedor de lugares, com os direitos de uso documentados. Fazer o modelo de dados e as migrations: usuários, membros, papéis, viagens e lugares. Sync completo: push e pull por cursor, idempotência, remoções e conflito por versão do roteiro. Resolver lote interrompido e URL de upload vencida, refresh do Cognito, e a fila do recap com interrupção do Spot. | Os gates críticos passam em dois aparelhos. Reenvio não duplica nada. Versão antiga não sobrescreve o roteiro. Membro removido não consegue escrever. |
| **3 · 03–09/nov** Planejamento compartilhado | Login e retorno à viagem, home, criação e estados vazios. Convite web com preview no WhatsApp e aviso de compartilhamento do vídeo. Adicionar lugar (busca e link), "quero ir", dia e ordem para organizadores, consulta para membros, gestão de membros e cartão do lugar. | Duas pessoas fazem convite → entrar → sugerir → montar roteiro, e consultam tudo em modo avião. O servidor recusa edição indevida. |
| **4 · 10–16/nov** Durante a viagem, offline | Tela Hoje, cartão, Eu fui, favorito, avaliação e observações. Estamos aqui, com GPS negado e nome digitado. Último sync e fila visíveis. Fases e fuso da viagem, dia livre e tudo visitado. Pronto para viajar e Avisar via WhatsApp. Push APNs. | Duas pessoas passam um dia simulado offline, divergem no roteiro e reconectam sem perder nada. Os dias seguem o fuso da viagem, não o do Brasil. |
| **5 · 17–23/nov** Memórias | Seleção em lote, cópia durável, sugestão de lugar pelo horário, lembrete noturno local, upload com novas tentativas e miniaturas. Álbum por dia, por lugar e sem lugar. Visualizador e salvar. Esconder e remover por papel. | Um lote real (HEIC e fotos sem EXIF) sobrevive a perda de rede e reinício, sem duplicatas. Com uma pessoa só contribuindo, o grupo já tem álbum. |
| **6 · 24–30/nov** Recap e primeiro ensaio integral | Encerramento automático e manual, snapshot com versões, telas do recap, vídeo, estados (gerando, falhou, sem fotos), baixar e compartilhar, e gerar de novo. | Uma viagem de teste vai do convite ao vídeo, incluindo os casos sem fotos, com fotos tardias e com falha de render. Job duplicado não publica duas versões. |
| **7 · 01–07/dez** Estabilização | Ensaio curto com a família e com um grupo de fora, se houver. Revisar acessibilidade (texto ampliado, contraste, leitor de tela). Testar backup e restore do Neon. Alarmes e fila de falhas. Teste rápido no Android. Teste China/eSIM, se houver acesso. | Ciclo completo sem perda de conteúdo e sem vazamento entre grupos. **Funcionalidades congeladas no fim da semana.** |
| **8 · 08–14/dez** Contingência e preparação | Corrigir só bloqueios. TestFlight com todos os familiares. Fazer login antes de embarcar, cadastrar a viagem real, conferir os endereços locais e verificar que tudo abre em modo avião. Guia mínimo para a família. | Todos os iPhones instalam, abrem e consultam o roteiro offline. Pelo menos dois aparelhos completam contribuição e sync. |
| **15/dez** Entrega | Beta familiar completo no TestFlight. De 16 a 28/dez, só correções indispensáveis. | |

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
