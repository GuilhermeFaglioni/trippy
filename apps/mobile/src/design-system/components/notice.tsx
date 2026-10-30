import { Text as NativeText, View } from 'react-native'

import { TEXT_SCALING_PROPS } from '../typography'
import { useTheme } from '../theme-provider'
import { Icon } from './icon'
import { textStyles } from './text'

export type NoticeTone = 'offline' | 'change'

/** Trecho do aviso: texto comum ou destaque em negrito ("O que mudou:"). */
export type NoticeSegment = string | { strong: string }

export type NoticeProps = {
  tone: NoticeTone
  segments: readonly NoticeSegment[]
  testID?: string
}

export function Notice({ tone, segments, testID }: NoticeProps) {
  const { colors, radius, spacing } = useTheme()
  const foreground = tone === 'offline' ? colors.ink : colors.terracottaInk
  const plain = segments
    .map((segment) => (typeof segment === 'string' ? segment : segment.strong))
    .join('')

  return (
    <View
      testID={testID}
      accessible
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      accessibilityLabel={plain}
      style={{
        alignItems: 'flex-start',
        backgroundColor: tone === 'offline' ? colors.sand : colors.terracottaTint,
        borderRadius: radius.radiusSm,
        flexDirection: 'row',
        gap: spacing.space2,
        paddingHorizontal: 14,
        paddingVertical: 10,
      }}
    >
      {tone === 'offline' ? (
        <View style={{ paddingTop: 1 }}>
          <Icon name="wifi-off" color={foreground} size={18} />
        </View>
      ) : null}
      <NativeText
        {...TEXT_SCALING_PROPS}
        style={[textStyles.notice, { color: foreground, flex: 1 }]}
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
    </View>
  )
}

/** Nota de apoio em sand, sem ícone nem alerta (Estamos aqui: "Na China a busca pode não funcionar"). */
export function InfoNote({ children, testID }: { children: string; testID?: string }) {
  const { colors, radius } = useTheme()

  return (
    <View
      testID={testID}
      style={{
        backgroundColor: colors.sand,
        borderRadius: radius.radiusSm,
        paddingHorizontal: 14,
        paddingVertical: 12,
      }}
    >
      <NativeText
        {...TEXT_SCALING_PROPS}
        style={[textStyles.notice, { color: colors.ink, lineHeight: 19 }]}
      >
        {children}
      </NativeText>
    </View>
  )
}
