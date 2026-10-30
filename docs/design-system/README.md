# Trippy

App iOS/Android para viagens em grupo: sugerir lugares, montar o roteiro, registrar o dia e ganhar um recap no final. v0.2, extraído das telas do canvas "Trippy — Telas v0.1". Ainda em definição.

## Tom e conteúdo

- Português do Brasil, frases curtas, segunda pessoa ("Você foi convidado…").
- Botões dizem o que acontece: **Criar viagem**, **Sugerir ao grupo**, **Mostrar endereço**, **Eu fui**.
- Telas vazias mostram o próximo passo sem cobrar ninguém: "Dia livre. Quer adicionar algum lugar?".
- O app nunca finge estar atualizado: offline, mostra a hora da última atualização.
- Nomes de lugares no idioma local aparecem ao lado do nome em português sempre que existirem.

## Cores

- **Fundo areia** (`ground`) com cards (`surface`) planos. A separação vem do contraste de fundo, não de sombra.
- **Verde floresta** (`forest`) é a cor de identidade: um card de destaque por tela.
- **Terracota** (`terracotta`) é cor de ação: botão principal (um por tela), "quero ir" marcado, aba ativa.
  - Texto sobre terracota é sempre `on-terracotta` (branco, 5.2:1). Nunca `ink` (3.2:1, falha).
  - Terracota usada como texto ou ícone sobre fundo (aba ativa, links) usa `terracotta-text`, que clareia no tema escuro.
  - **Exceções permitidas:** o fundo das telas do recap. Capas, miniaturas e fotos sem imagem **não** usam terracota: usam `photo-1…4`.
- **Mostarda** (`mustard`) é apoio decorativo. Texto sobre ela é `on-mustard` nos dois temas.
- **Avatares** usam `avatar-1…4`, sorteados por pessoa e fixos dentro da viagem.
- Estados usam pares tint/ink: `forest-tint` + `forest-ink` (no dia, quem foi), `terracotta-tint` + `terracotta-ink` (sugerido, mudanças, alertas), `sand` + `ink-muted` (sem dia).
- **Bordas:** controles (campos, botões secundários, botões de ícone) usam `line-strong` (3:1). `line` e `hairline` são só decorativas.

## Tipografia

- Bricolage Grotesque nos títulos (`title-l` 32px no topo de cada tela), DM Sans no resto. Rótulos de seção em `label`.
- **Outros alfabetos:** as pilhas de fonte caem para Noto Sans SC/JP/KR. Nomes e endereços em idioma local (cartão, linha de lugar) usam a família `local` direto, para não misturar métricas.
- **Fonte ampliada pelo celular:** todos os tamanhos escalam com Dynamic Type (iOS) e Font scale (Android) até 200%. Alturas são mínimas, nunca fixas: botões e linhas crescem com o texto. Os rótulos da barra de abas nunca somem: acima de 150% eles quebram em até 2 linhas e a barra cresce em altura.
- **Textos longos:**
  - Nome de lugar em lista: até 2 linhas, depois reticências. Na tela do lugar: sem limite.
  - Nome de viagem em card: 1 linha com reticências. Título de tela: até 2 linhas.
  - Metadados e comentários em lista: 1 linha com reticências; o texto inteiro fica na tela de detalhe.
  - Nunca truncar endereço no cartão para mostrar: ele quebra linha e reduz até `card-address`.

## Formas e espaço

- Três raios: `radius-sm` (12, controles), `radius-md` (18, botão principal e cards), `radius-lg` (22, destaques e capas), mais `radius-pill` para chips.
- **Sombra:** o sistema é plano. A única exceção é `shadow-fab`, no botão flutuante "+ Lugar", que precisa se separar da lista que rola por baixo.
- Margem lateral `space-5` (20px), blocos separados por `space-4`/`space-3`, barra de abas de 84px.

## Toque

Todo controle tem área tocável de no mínimo `target-min` (44 × 44px), **mesmo quando o visual é menor**: filtros de 36px, estrelas de 26px, chip "+ marcar", ícones de fechar. Amplie a área com padding invisível; não aumente o desenho. Alvos vizinhos não se sobrepõem (mínimo 8px entre áreas).

## Movimento

Tokens em `tokens.json` (famílias `duration` e `easing`):

| token | valor | uso |
| --- | --- | --- |
| `duration-fast` | 150ms | toque, troca de estado de botão e chip |
| `duration-base` | 250ms | abrir folhas, trocar de aba, entrar card |
| `duration-slow` | 400ms | transição entre telas do recap |
| `duration-count` | 900ms | números do recap contando até o valor |
| `ease-standard` | cubic-bezier(0.2, 0, 0, 1) | padrão |
| `ease-emphasized` | cubic-bezier(0.3, 0, 0, 1.2) | entrada de números e destaques do recap |

Com "Reduzir movimento" ligado no celular: sem deslocamento nem contagem, só troca de opacidade em `duration-fast`.

## Estados

**Campos de texto**
- Normal: borda 1px `line-strong`, fundo `surface`.
- Foco: borda 2px `forest` + anel `focus`.
- Erro: borda 2px `danger` e mensagem abaixo em `danger`, dizendo o que corrigir ("Escolha uma data de volta depois da ida").
- Desabilitado: fundo `sand`, texto `ink-muted`, sem borda forte; nunca usar só opacidade.

**Botões**
- Principal: `terracotta` / `on-terracotta`. Pressionado: escurece 8%. Desabilitado: fundo `sand`, texto `ink-muted`. Carregando: rótulo vira indicador, largura mantida.
- Secundário: `surface` com borda `line-strong`. Selecionado vira `forest` / `on-forest`.
- Foco (teclado, leitor de tela): anel `focus` de 2px com afastamento de 2px em todos.

**Seleção (filtros, chips, dias do roteiro)**
- Desmarcado: `surface` ou transparente com borda `line-strong`, texto `ink`.
- Marcado: fundo `ink`, texto `ground`, peso 700.

**Marcações de lugar**: o estado nunca depende só da cor; muda ícone e rótulo.

| ação | desmarcado | marcado |
| --- | --- | --- |
| Eu fui | ícone de check em traço, rótulo "Eu fui", borda `line-strong` | fundo `forest`, check `on-forest`, rótulo "Fui" |
| Favorito | estrela em traço, rótulo "Favoritar" | estrela preenchida `terracotta-text`, rótulo "Favorito" |
| Quero ir | coração em traço + contagem, borda `line-strong` | fundo `terracotta`, coração preenchido `on-terracotta` + contagem |

Leitores de tela anunciam o estado ("Eu fui, marcado").

## Navegação

Barra inferior com as abas da viagem: Hoje (só em viagem), Roteiro, Lugares, Memórias, Grupo. Aba ativa em `terracotta-text`, rótulo em negrito e ícone preenchido; inativas em `ink-muted`.

## Iconografia

**Lucide** (lucide-react / lucide-react-native), traço 2px (1.8 nas abas inativas, 2.2 na ativa), pontas arredondadas, 18–22px, na cor do texto. Escolhida sobre Phosphor porque o traço já casa com as telas e tem pacote nativo para React Native. Estado marcado: mesmo ícone com `fill="currentColor"` (estrela, coração) ou traço mais grosso (check). Sem emoji.

Ícones principais: `sun` (Hoje), `list-ordered` (Roteiro), `map-pin` (Lugares), `images` (Memórias), `users` (Grupo), `check` (Eu fui), `star` (Favorito), `heart` (Quero ir), `camera` (Foto), `wifi-off`, `grip-vertical` (reordenar), `chevron-left` (voltar).

## Logo

- **Símbolo** (Logos/trippy-mark.svg): pino de mapa areia sobre quadrado `forest` de cantos `radius-lg`, com o "sol" `mustard` no centro e uma pílula `terracotta` (bilhete) no canto. Ícone do app e avatar de redes.
- **Logotipo**: "trippy" em Bricolage Grotesque 800, minúsculo, tracking -0.5px, em `forest` sobre fundo claro e `on-forest` sobre forest. Ao lado do símbolo, altura do texto = 50% do símbolo, espaço = 25%.
- Nas telas: símbolo de 32px ao lado do logotipo no topo de Minhas viagens e do convite; 56px no login.
- Área de respiro: 25% do lado do símbolo. Não aplicar terracota no logotipo inteiro nem esticar o símbolo.

## Componentes

Button, Card (comum e destaque), StatusChip, FilterChip, Avatar, Notice, TextField, PlaceRow e TabBar, como classes `tp-*` em `components/bundle.css`. Implementados em React Native em `apps/mobile/src/design-system/components` (galeria de desenvolvimento em `/dev/design-system`).

## Em aberto

- Tema escuro definido nos tokens; telas de teste no canvas.
