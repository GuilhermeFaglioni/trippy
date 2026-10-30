import { Pressable, View } from 'react-native'

import { useTheme } from '../theme-provider'
import { Icon } from './icon'
import { Text } from './text'

export type ScreenHeaderProps = {
  /** "Minhas viagens · Viagem China": a volta fica no topo da tela, não na barra de abas. */
  backLabel?: string
  onBack?: () => void
  /** `title-l` de 32px, até 2 linhas. */
  title: string
  locale?: string
  testID?: string
}

export function ScreenHeader({ backLabel, onBack, title, locale, testID }: ScreenHeaderProps) {
  const { colors, spacing } = useTheme()

  return (
    <View testID={testID} style={{ gap: 10 }}>
      {backLabel && onBack ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Voltar para ${backLabel}`}
          onPress={onBack}
          style={{
            alignItems: 'center',
            alignSelf: 'flex-start',
            flexDirection: 'row',
            gap: spacing.space1,
            minHeight: spacing.targetMin,
          }}
        >
          <Icon name="chevron-left" color={colors.inkMuted} size={16} />
          <Text
            variant="backLink"
            color={colors.inkMuted}
            locale={locale}
            numberOfLines={1}
            style={{ flexShrink: 1 }}
          >
            {backLabel}
          </Text>
        </Pressable>
      ) : null}
      <Text
        variant="titleL"
        color={colors.ink}
        locale={locale}
        numberOfLines={2}
        accessibilityRole="header"
      >
        {title}
      </Text>
    </View>
  )
}
