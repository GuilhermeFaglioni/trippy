# Button

Botões do Trippy em quatro variantes: principal, secundário, só ícone e flutuante.

- **Principal** (`tp-btn tp-btn--primary tp-btn--block`): uma por tela, largura total, 56px, rótulo com verbo ("Criar viagem").
- **Secundário** (`tp-btn--secondary`): ações de apoio. Pode ser alternável com `aria-pressed` (vira `forest`).
- **Só ícone** (`tp-btn--icon`): 44×44, sempre com `aria-label`. Alternáveis (Eu fui, Favorito) usam `aria-pressed` e trocam o ícone de traço por preenchido.
- **Flutuante** (`tp-btn--fab`): só "+ Lugar", a única peça com sombra (`shadow-fab`).
- Desabilitado: `disabled` → fundo `sand`, texto `ink-muted`.
- O consumidor fornece: rótulo, ícone (Lucide, 18–20px) e o handler.
