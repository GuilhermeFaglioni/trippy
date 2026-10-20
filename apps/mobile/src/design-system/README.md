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
