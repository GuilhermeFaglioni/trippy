import { View } from 'react-native'

import { TypographyText, useTheme } from '../design-system'
import { getTypography } from './component-typography'

export type NoticeTone = 'neutral' | 'success' | 'warning' | 'danger'

export type NoticeProps = {
  message: string
  title?: string
  tone?: NoticeTone
  locale?: string
  testID?: string
}

export function Notice({ message, title, tone = 'neutral', locale, testID }: NoticeProps) {
  const theme = useTheme()
  const colors = {
    neutral: { background: theme.colors.sand, foreground: theme.colors.inkMuted },
    success: { background: theme.colors.forestTint, foreground: theme.colors.forestInk },
    warning: {
      background: theme.colors.terracottaTint,
      foreground: theme.colors.terracottaInk,
    },
    danger: { background: theme.colors.surface, foreground: theme.colors.danger },
  }[tone]

  return (
    <View
      testID={testID}
      accessible={tone === 'danger'}
      accessibilityRole={tone === 'danger' ? 'alert' : undefined}
      accessibilityLiveRegion={tone === 'danger' ? 'assertive' : 'polite'}
      style={{
        backgroundColor: colors.background,
        borderRadius: theme.radius.radiusSm,
        padding: theme.spacing.space4,
      }}
    >
      {title ? (
        <TypographyText
          family="sans"
          locale={locale}
          style={[
            getTypography('bodyStrong'),
            { color: colors.foreground, marginBottom: theme.spacing.space1 },
          ]}
        >
          {title}
        </TypographyText>
      ) : null}
      <TypographyText
        family="sans"
        locale={locale}
        style={[getTypography('body'), { color: colors.foreground }]}
      >
        {message}
      </TypographyText>
    </View>
  )
}
