# Tipografia mobile

`docs/design-system/tokens.json` é a fonte única dos tokens e das famílias de fonte. `createTypographyTokens(platform, locale)` converte os estilos do JSON para `TextStyle`; os estilos `cardName` e `cardAddress` recebem diretamente a família Noto regional. Sem locale, usam Noto Sans SC, primeira família local declarada no token.

React Native aceita uma família por `Text.fontFamily`, sem pilha CSS. Use `TypographyText` para strings `display` e `sans`: trechos CJK recebem uma família Noto local e trechos latinos mantêm Bricolage Grotesque ou DM Sans. Use `family="local"` para nomes e endereços: a string inteira usa uma família Noto regional, inclusive os trechos latinos. A família calculada por `family`/`locale` prevalece sobre `style.fontFamily`, inclusive quando o estilo veio de `getTypography()` sem locale.

O locale seleciona a forma regional dos ideogramas Han: `zh-*` usa SC, `ja-*` usa JP e `ko-*` usa KR. Kana detecta JP e Hangul detecta KR mesmo sem locale. Han sem escrita distintiva usa o locale; se ele não for informado, usa SC. Pontuação CJK acompanha a região selecionada. `TextField` escolhe uma única família para o campo inteiro: se o valor ou placeholder contém CJK, usa a família regional apropriada; caso contrário, mantém DM Sans. Passe `locale` quando texto Han não trouxer kana ou hangul.

Fontes locais: subconjuntos variáveis regionais oficiais Noto Sans CJK, em [notofonts/noto-cjk](https://github.com/notofonts/noto-cjk/tree/main/Sans/Variable/TTF/Subset), licenciados pela [SIL Open Font License 1.1 do pacote Noto Sans SC](https://github.com/google/fonts/blob/main/ofl/notosanssc/OFL.txt), com aviso de copyright, em `../../assets/fonts/NotoCJK-OFL.txt`.

| Arquivo                   |                      Bytes |
| ------------------------- | -------------------------: |
| `NotoSansSC-Variable.ttf` |                 17.773.132 |
| `NotoSansJP-Variable.ttf` |                  9.590.732 |
| `NotoSansKR-Variable.ttf` |                 10.415.420 |
| **Total**                 | **37.779.284 (36,03 MiB)** |

O total aumenta o bundle mobile em cerca de 36 MiB antes de compressão. O SDK Expo 58 carrega os assets por `useFonts`; veja a [documentação Expo Font SDK 58](https://docs.expo.dev/versions/v58.0.0/sdk/font/).

## Componentes

`components/` reproduz as classes `tp-*` de `docs/design-system/componentes/bundle.css` com os tokens de `tokens.json`: `Button` (principal, secundário alternável, flutuante e `inverse` para o card de destaque), `IconButton` (44 × 44; com `count`, o "quero ir" de 52 × 52), `Card`, `HighlightCard`, `Eyebrow`, `StatusChip` (botão com `onPress`, selo sem), `FilterChip`, `Avatar`, `AvatarStack`, `Notice`, `TextField`, `PlaceRow`, `TabBar`, `ScreenHeader` e `DaySheet`. Ícones são Lucide (`Icon`, só os nomes de `iconSet`).

- Área tocável mínima de 44px: o desenho menor (chips de 32/36px) é completado com `hitSlop`.
- Todo texto usa `Text`/`TypographyText` e escala com Dynamic Type até 200%; alturas são mínimas. `TabBar` quebra rótulos em 2 linhas acima de 150%.
- `DaySheet` respeita "Reduzir movimento": só opacidade, em `duration-fast`.
- Estado alternável anuncia `accessibilityState.checked` (botões) ou `selected` (filtros, abas, dias).
- Galeria só de desenvolvimento: rota `/dev/design-system` (fora de `__DEV__` volta para a home). Alterne claro/escuro pela aparência do Simulator (`xcrun simctl ui booted appearance dark`).
- `src/components` é o conjunto antigo, usado pelas telas atuais; sai quando as telas migrarem para estes componentes.

## Lint

Em `apps/mobile/src/features`, o ESLint bloqueia cor/raio literal e `Pressable`/`TextInput`/`Touchable*` direto. Exceção explícita: `// eslint-disable-next-line <regra> -- <motivo>`. As telas antigas que ainda violam ficam em `FEATURES_COM_EXCECAO` (`eslint.config.mjs`). Testes da regra: `pnpm --filter @trippy/mobile test:lint-rule`.
