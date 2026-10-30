import { Pressable, View } from 'react-native'

import { useTheme } from '../theme-provider'
import { IconButton } from './icon-button'
import { StatusChip, type StatusChipTone } from './status-chip'
import { Text } from './text'

export type PlaceListRowProps = {
  name: string
  /** "Ana · "comentário"" ou "Sugerido por você": uma linha, com reticências. */
  byline: string
  /** Cor do placeholder da miniatura (paleta `photo-1..4`). */
  thumbTone?: 1 | 2 | 3 | 4
  status: { tone: StatusChipTone; label: string; onPress?: () => void }
  want: { count: number; marked: boolean; onToggle: () => void; disabled?: boolean }
  /** Toque na linha abre o lugar. */
  onPress: () => void
  locale?: string
  testID?: string
}

/** Linha compacta da lista Lugares: miniatura, nome, quem sugeriu, status e "quero ir". */
export function PlaceListRow({
  name,
  byline,
  thumbTone = 1,
  status,
  want,
  onPress,
  locale,
  testID,
}: PlaceListRowProps) {
  const { colors, radius } = useTheme()
  const thumb = [colors.photo1, colors.photo2, colors.photo3, colors.photo4][thumbTone - 1]

  return (
    <View
      testID={testID}
      style={{
        alignItems: 'flex-start',
        backgroundColor: colors.surface,
        borderRadius: radius.radiusMd,
        flexDirection: 'row',
        gap: 12,
        padding: 12,
      }}
    >
      <Pressable
        accessible={false}
        importantForAccessibility="no"
        onPress={onPress}
        style={{
          backgroundColor: thumb,
          borderRadius: radius.radiusSm,
          height: 52,
          width: 52,
        }}
      />
      <View style={{ flex: 1, gap: 4, minWidth: 0 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${name}. ${byline}`}
          onPress={onPress}
          style={{ gap: 4 }}
        >
          <Text variant="placeName" color={colors.ink} locale={locale} numberOfLines={2}>
            {name}
          </Text>
          <Text variant="placeAddress" color={colors.inkMuted} locale={locale} numberOfLines={1}>
            {byline}
          </Text>
        </Pressable>
        <StatusChip
          tone={status.tone}
          label={status.label}
          onPress={status.onPress}
          testID={testID ? `${testID}-status` : undefined}
        />
      </View>
      <IconButton
        icon="heart"
        accessibilityLabel={`Quero ir, ${want.count}`}
        pressed={want.marked}
        count={want.count}
        disabled={want.disabled}
        onPress={want.onToggle}
        testID={testID ? `${testID}-want` : undefined}
      />
    </View>
  )
}
