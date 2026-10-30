# StatusChip

Selo que diz o status de um lugar (no dia X, sugerido ou sem dia) e, para quem monta o roteiro, abre a escolha de dia.

- Cores: `tp-chip--day` (forest-tint/forest-ink), `tp-chip--suggested` (terracotta-tint/terracotta-ink), `tp-chip--none` (sand/ink-muted).
- **Organizador e coorganizadores:** `button.tp-chip`, com a ação no rótulo ("No dia 5 · trocar", "Sugerido · escolher dia"). Abre a folha de dias. Visual de 32px, área tocável de 44px.
- **Membros:** `span.tp-chip`, só o status, sem a ação no rótulo.
- Sempre com texto; a cor nunca é o único sinal.
