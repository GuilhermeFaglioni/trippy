import { Text as NativeText, type TextStyle } from 'react-native'

import { TEXT_SCALING_PROPS } from '../typography'
import { textStyles, type TextVariant } from './text'

/** Trecho do parágrafo: texto comum ou destaque em negrito. */
export type RichTextSegment = string | { strong: string }

export type RichTextProps = {
  segments: readonly RichTextSegment[]
  variant: TextVariant
  color: string
  style?: TextStyle
  testID?: string
}

/** Parágrafo com trechos em negrito no meio da frase (Convide pelo link., vídeo recap). */
export function RichText({ segments, variant, color, style, testID }: RichTextProps) {
  return (
    <NativeText
      {...TEXT_SCALING_PROPS}
      testID={testID}
      style={[textStyles[variant], { color }, style]}
    >
      {segments.map((segment, index) =>
        typeof segment === 'string' ? (
          segment
        ) : (
          <NativeText key={index} style={{ fontWeight: '700' }}>
            {segment.strong}
          </NativeText>
        ),
      )}
    </NativeText>
  )
}
