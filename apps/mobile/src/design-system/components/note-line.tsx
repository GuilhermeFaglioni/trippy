import { Text as NativeText } from 'react-native'

import { TEXT_SCALING_PROPS } from '../typography'
import { useTheme } from '../theme-provider'
import { textStyles } from './text'

export type NoteLineProps = {
  author: string
  text: string
  testID?: string
}

/** Observação de uma pessoa: autor em negrito, " · " e o texto (`Ana · Ir depois das 18h`). */
export function NoteLine({ author, text, testID }: NoteLineProps) {
  const { colors } = useTheme()

  return (
    <NativeText
      {...TEXT_SCALING_PROPS}
      testID={testID}
      style={[textStyles.bodySm, { color: colors.ink }]}
    >
      <NativeText style={{ fontWeight: '700' }}>{author}</NativeText>
      {` · ${text}`}
    </NativeText>
  )
}
