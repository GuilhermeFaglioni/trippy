import { View } from 'react-native'

import { useTheme } from '../theme-provider'
import { Icon, type IconName } from './icon'
import { Text } from './text'

export type EmptyStateProps = {
  icon: IconName
  title: string
  message: string
  testID?: string
}

/** Tela sem conteúdo: círculo forest-tint com ícone, título e uma frase. */
export function EmptyState({ icon, title, message, testID }: EmptyStateProps) {
  const { colors, radius } = useTheme()

  return (
    <View testID={testID} style={{ alignItems: 'center', gap: 12 }}>
      <View
        style={{
          alignItems: 'center',
          backgroundColor: colors.forestTint,
          borderRadius: radius.radiusPill,
          height: 72,
          justifyContent: 'center',
          width: 72,
        }}
      >
        <Icon name={icon} color={colors.forestInk} size={32} strokeWidth={1.8} />
      </View>
      <Text variant="titleM" color={colors.ink} style={{ textAlign: 'center' }}>
        {title}
      </Text>
      <Text variant="body" color={colors.inkMuted} style={{ maxWidth: 280, textAlign: 'center' }}>
        {message}
      </Text>
    </View>
  )
}
