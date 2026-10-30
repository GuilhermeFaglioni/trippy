import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'

// telas atuais, saem da lista quando forem refeitas com o design system (#83)
export const FEATURES_COM_EXCECAO = [
  'apps/mobile/src/features/places/address-card-screen.tsx',
  'apps/mobile/src/features/places/google-details-panel.tsx',
]

const FEATURES = 'apps/mobile/src/features/**/*.{ts,tsx}'
const FEATURES_IGNORADAS = [
  'apps/mobile/src/features/**/__tests__/**',
  'apps/mobile/src/features/**/*.test.*',
]

const MENSAGEM =
  "Use os componentes de apps/mobile/src/design-system; exceção só com eslint-disable-next-line + justificativa após ' -- '"

const TAGS_NATIVAS_PROIBIDAS = [
  'Pressable',
  'TextInput',
  'TouchableOpacity',
  'TouchableHighlight',
  'TouchableWithoutFeedback',
  'TouchableNativeFeedback',
]

const REGRAS_DE_SINTAXE = [
  {
    selector: `JSXOpeningElement[name.name=/^(${TAGS_NATIVAS_PROIBIDAS.join('|')})$/]`,
    message: MENSAGEM,
  },
  { selector: 'Literal[value=/^#[0-9a-fA-F]{3,8}$/]', message: MENSAGEM },
  { selector: String.raw`Literal[value=/^(rgb|hsl)a?\(/]`, message: MENSAGEM },
  {
    selector: 'Property[key.name=/[Cc]olor$/] > Literal[value=/^(?!transparent$)/]',
    message: MENSAGEM,
  },
  {
    selector: String.raw`Property[key.name=/^border(Top|Bottom)?(Left|Right|Start|End)?Radius$/] > Literal[raw=/^(?!0*\.?0+$)\d*\.?\d+$/]`,
    message: MENSAGEM,
  },
]

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/',
      '**/dist/',
      '**/.expo/',
      'apps/mobile/ios/',
      'apps/mobile/android/',
      '.agents/',
      '.claude/',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: [FEATURES],
    ignores: FEATURES_IGNORADAS,
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'react-native',
              importNames: TAGS_NATIVAS_PROIBIDAS,
              message: MENSAGEM,
            },
          ],
        },
      ],
      'no-restricted-syntax': ['error', ...REGRAS_DE_SINTAXE],
    },
  },
  ...(FEATURES_COM_EXCECAO.length > 0
    ? [
        {
          files: FEATURES_COM_EXCECAO,
          rules: {
            'no-restricted-imports': 'off',
            'no-restricted-syntax': 'off',
          },
        },
      ]
    : []),
)
