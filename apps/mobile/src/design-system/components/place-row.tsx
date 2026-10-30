import { Pressable, View } from 'react-native'

import { useTheme } from '../theme-provider'
import { Icon } from './icon'
import { IconButton } from './icon-button'
import { Text } from './text'

export type PlaceRowActions = {
  visited: boolean
  favorite: boolean
  hasPhoto?: boolean
  onToggleVisited: () => void
  onToggleFavorite: () => void
  onPhoto: () => void
}

export type PlaceRowProps = {
  number: number
  name: string
  /** Marcou "Eu fui": o número vira forest. */
  done?: boolean
  /** Tela Hoje: três ações na linha. */
  actions?: PlaceRowActions
  /** Roteiro: alça de reordenar (só organizadores). Segurar a linha inicia o arraste. */
  onDragStart?: () => void
  /** Tela Hoje, dia completo: selo "Fui" no lugar das ações. */
  trailingLabel?: string
  /** Toque na linha abre o lugar. */
  onPress?: () => void
  locale?: string
  testID?: string
}

export function PlaceRow({
  number,
  name,
  done = false,
  actions,
  trailingLabel,
  onDragStart,
  onPress,
  locale,
  testID,
}: PlaceRowProps) {
  const { colors, radius, spacing } = useTheme()

  return (
    <View
      testID={testID}
      style={{
        alignItems: 'center',
        backgroundColor: colors.surface,
        borderRadius: radius.radiusMd,
        flexDirection: 'row',
        gap: 10,
        paddingHorizontal: 14,
        paddingVertical: spacing.space3,
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${number}. ${name}`}
        disabled={!onPress}
        onPress={onPress}
        onLongPress={onDragStart}
        style={{
          alignItems: 'center',
          flex: 1,
          flexDirection: 'row',
          gap: 10,
          minHeight: spacing.targetMin,
          minWidth: 0,
        }}
      >
        <View
          style={{
            alignItems: 'center',
            backgroundColor: done ? colors.forest : colors.sand,
            borderRadius: radius.radiusPill,
            height: 26,
            justifyContent: 'center',
            width: 26,
          }}
        >
          <Text variant="chip" color={done ? colors.onForest : colors.ink}>
            {String(number)}
          </Text>
        </View>
        <Text
          variant="placeName"
          color={colors.ink}
          locale={locale}
          numberOfLines={2}
          style={{ flex: 1, minWidth: 0 }}
        >
          {name}
        </Text>
      </Pressable>
      {actions ? (
        <View style={{ flexDirection: 'row', gap: 6 }}>
          <IconButton
            icon="check"
            accessibilityLabel="Eu fui"
            testID={testID ? `${testID}-eu-fui` : undefined}
            pressed={actions.visited}
            onPress={actions.onToggleVisited}
          />
          <IconButton
            icon="star"
            accessibilityLabel="Favorito"
            testID={testID ? `${testID}-favorito` : undefined}
            tone="favorite"
            pressed={actions.favorite}
            onPress={actions.onToggleFavorite}
          />
          <IconButton
            icon="camera"
            accessibilityLabel="Foto"
            testID={testID ? `${testID}-foto` : undefined}
            onPress={actions.onPhoto}
          />
        </View>
      ) : null}
      {trailingLabel ? (
        <Text variant="chip" color={colors.forestInk}>
          {trailingLabel}
        </Text>
      ) : null}
      {onDragStart ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Reordenar ${name}`}
          onPressIn={onDragStart}
          style={{
            alignItems: 'center',
            height: spacing.targetMin,
            justifyContent: 'center',
            width: spacing.targetMin,
          }}
        >
          <Icon name="grip-vertical" color={colors.inkMuted} size={20} />
        </Pressable>
      ) : null}
    </View>
  )
}
