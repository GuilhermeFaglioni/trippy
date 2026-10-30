# TextField

Campo de texto com rótulo visível acima e ajuda/erro abaixo.

- `.tp-field` com `label[for]` + `input`. Borda `line-strong` (3:1).
- Estados: foco (borda 2px forest + anel focus), erro (`data-state="error"`, borda e texto `danger`, mensagem dizendo como corrigir), desabilitado (fundo sand).
- Em linhas lado a lado (Ida/Volta) use `min-width:0` nos filhos para não vazar a borda.
