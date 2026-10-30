import { Pressable, View } from 'react-native'

import { useTheme } from '../theme-provider'
import { Text } from './text'

export type TripCoverTone = 1 | 2 | 3 | 4

function useCoverColor(tone: TripCoverTone): string {
  const { colors } = useTheme()
  return [colors.photo1, colors.photo2, colors.photo3, colors.photo4][tone - 1]
}

export type TripRowProps = {
  title: string
  meta: string
  /** Cor de capa sem foto (`photo-1…4`). */
  cover: TripCoverTone
  onPress: () => void
  testID?: string
}

/** Linha de viagem em planejamento: capa de 56px, título e metadado. */
export function TripRow({ title, meta, cover, onPress, testID }: TripRowProps) {
  const { colors, radius, spacing } = useTheme()
  const coverColor = useCoverColor(cover)

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${meta}`}
      accessibilityHint="Abre esta viagem."
      onPress={onPress}
      style={({ pressed }) => ({
        alignItems: 'center',
        backgroundColor: pressed ? colors.sand : colors.surface,
        borderRadius: radius.radiusMd,
        flexDirection: 'row',
        gap: 14,
        padding: spacing.space3,
      })}
    >
      <View
        style={{
          backgroundColor: coverColor,
          borderRadius: radius.radiusSm,
          height: 56,
          width: 56,
        }}
      />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text variant="placeName" color={colors.ink} numberOfLines={2} style={{ fontSize: 16 }}>
          {title}
        </Text>
        <Text variant="fieldHelp" color={colors.inkMuted} numberOfLines={2}>
          {meta}
        </Text>
      </View>
    </Pressable>
  )
}

export type MemoryTileProps = {
  title: string
  cover: TripCoverTone
  onPress: () => void
  testID?: string
}

/** Ladrilho de memória (viagem encerrada): 96px de altura, nome no canto inferior. */
export function MemoryTile({ title, cover, onPress, testID }: MemoryTileProps) {
  const { colors, radius, spacing } = useTheme()
  const coverColor = useCoverColor(cover)

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={`${title}, memória`}
      accessibilityHint="Abre esta viagem."
      onPress={onPress}
      style={({ pressed }) => ({
        backgroundColor: coverColor,
        borderRadius: radius.radiusMd,
        flex: 1,
        justifyContent: 'flex-end',
        minHeight: 96,
        opacity: pressed ? 0.85 : 1,
        padding: spacing.space3,
      })}
    >
      <Text variant="avatar" color={colors.ink} numberOfLines={2}>
        {title}
      </Text>
    </Pressable>
  )
}
