import { Pressable, View } from 'react-native'

import { useTheme } from '../theme-provider'
import { Icon } from './icon'
import { Text } from './text'

export type PlaceResultProps = {
  name: string
  /** Nome na língua local (caracteres CJK etc.), ao lado do nome principal. */
  localName?: string | null
  address?: string | null
  localAddress?: string | null
  selected?: boolean
  onPress: () => void
  disabled?: boolean
  locale?: string
  testID?: string
}

/** Resultado de busca de lugar: tocar seleciona (borda terracota + check). */
export function PlaceResult({
  name,
  localName,
  address,
  localAddress,
  selected = false,
  onPress,
  disabled = false,
  locale,
  testID,
}: PlaceResultProps) {
  const { colors, radius } = useTheme()
  const showLocalName = Boolean(localName) && localName !== name
  const showLocalAddress = Boolean(localAddress) && localAddress !== address

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={[name, showLocalName ? localName : null, address]
        .filter(Boolean)
        .join(', ')}
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={{
        alignItems: 'center',
        backgroundColor: colors.surface,
        borderColor: selected ? colors.terracotta : colors.hairline,
        borderRadius: radius.radiusMd,
        borderWidth: selected ? 2 : 1,
        flexDirection: 'row',
        gap: 12,
        // A borda de 2px não empurra o conteúdo: o padding compensa.
        padding: selected ? 13 : 14,
      }}
    >
      <View
        style={{
          backgroundColor: selected ? colors.photo3 : colors.sand,
          borderRadius: radius.radiusSm,
          height: 44,
          width: 44,
        }}
      />
      <View style={{ flex: 1, gap: 2, minWidth: 0 }}>
        <Text variant="placeName" color={colors.ink} locale={locale} numberOfLines={2}>
          {showLocalName ? `${name} ${localName}` : name}
        </Text>
        {address ? (
          <Text variant="placeAddress" color={colors.inkMuted} locale={locale} numberOfLines={2}>
            {address}
          </Text>
        ) : null}
        {showLocalAddress ? (
          <Text variant="cardAddress" color={colors.inkMuted} locale={locale} numberOfLines={2}>
            {localAddress ?? ''}
          </Text>
        ) : null}
      </View>
      {selected ? (
        <Icon name="check" color={colors.terracotta} size={20} strokeWidth={2.4} />
      ) : null}
    </Pressable>
  )
}
