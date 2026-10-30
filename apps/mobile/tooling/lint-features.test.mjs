import assert from 'node:assert/strict'
import test from 'node:test'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { ESLint } from 'eslint'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const { FEATURES_COM_EXCECAO } = await import(
  pathToFileURL(join(repoRoot, 'eslint.config.mjs')).href
)

const RULES = new Set(['no-restricted-imports', 'no-restricted-syntax'])
const featureFile = join(repoRoot, 'apps/mobile/src/features/exemplo/x.tsx')
const eslint = new ESLint({ cwd: repoRoot })

async function lint(code, filePath = featureFile) {
  const [result] = await eslint.lintText(code, { filePath })
  return result.messages.filter((message) => RULES.has(message.ruleId))
}

async function assertBlocked(code, filePath) {
  const messages = await lint(code, filePath)
  assert.ok(messages.length > 0, `esperava bloqueio para: ${code}`)
  assert.ok(messages.every((message) => message.severity === 2))
}

async function assertAllowed(code, filePath) {
  const messages = await lint(code, filePath)
  assert.deepEqual(
    messages.map((message) => message.message),
    [],
    `esperava passar: ${code}`,
  )
}

test('bloqueia Pressable e TextInput importados e usados direto em features', async () => {
  await assertBlocked(
    "import { Pressable } from 'react-native'\nexport const A = () => <Pressable />\n",
  )
  await assertBlocked(
    "import { TextInput } from 'react-native'\nexport const A = () => <TextInput />\n",
  )
})

test('bloqueia as demais tags Touchable importadas de react-native', async () => {
  await assertBlocked(
    "import { TouchableOpacity } from 'react-native'\nexport const A = () => <TouchableOpacity />\n",
  )
})

test('bloqueia cor literal em hex, rgb/hsl e propriedades de cor', async () => {
  await assertBlocked("export const a = { color: '#fff' }\n")
  await assertBlocked("export const a = { backgroundColor: 'red' }\n")
  await assertBlocked("export const a = { borderColor: 'rgba(0, 0, 0, 0.5)' }\n")
  await assertBlocked("export const a = { shadowColor: 'hsl(120, 50%, 50%)' }\n")
  await assertBlocked("export const a = '#A1B2C3'\n")
})

test('bloqueia raio de borda literal diferente de zero', async () => {
  await assertBlocked('export const a = { borderRadius: 12 }\n')
  await assertBlocked('export const a = { borderTopLeftRadius: 8 }\n')
})

test('libera raio zero, transparent e tokens do design system', async () => {
  await assertAllowed('export const a = { borderRadius: 0 }\n')
  await assertAllowed("export const a = { backgroundColor: 'transparent' }\n")
  await assertAllowed(
    "import { tokens } from '../../design-system'\nexport const a = { backgroundColor: tokens.color.surface, borderRadius: tokens.radius.md }\n",
  )
})

test('libera arquivo da lista de exceções', async () => {
  assert.ok(FEATURES_COM_EXCECAO.length > 0)
  const excecao = join(repoRoot, FEATURES_COM_EXCECAO[0])
  await assertAllowed(
    "import { Pressable } from 'react-native'\nexport const A = () => <Pressable style={{ borderRadius: 12, backgroundColor: '#fff' }} />\n",
    excecao,
  )
})

test('libera arquivo fora de features', async () => {
  await assertAllowed(
    "import { Pressable } from 'react-native'\nexport const A = () => <Pressable style={{ borderRadius: 12, backgroundColor: '#fff' }} />\n",
    join(repoRoot, 'apps/mobile/src/components/x.tsx'),
  )
})
