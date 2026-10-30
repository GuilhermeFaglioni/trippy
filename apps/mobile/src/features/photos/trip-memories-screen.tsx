import { View } from 'react-native'

import { Button, Text } from '../../design-system/components'
import { useTheme } from '../../design-system'

type TripMemoriesScreenProps = { onSendPhotos: () => void }

/** Aba Memórias sem fotos (`32-memorias-sem-fotos`). */
export function TripMemoriesScreen({ onSendPhotos }: TripMemoriesScreenProps) {
  const { colors, radius, spacing } = useTheme()

  return (
    <View testID="tela-memorias" style={{ flex: 1, gap: spacing.space4, padding: spacing.space5 }}>
      <View style={{ flexDirection: 'row', gap: spacing.space3 }}>
        {[0, 1, 2].map((slot) => (
          <View
            key={slot}
            style={{
              aspectRatio: 1,
              borderColor: colors.lineStrong,
              borderRadius: radius.radiusSm,
              borderStyle: 'dashed',
              borderWidth: 1,
              flex: 1,
            }}
          />
        ))}
      </View>
      <View style={{ gap: spacing.space2 }}>
        <Text variant="titleM" color={colors.ink}>
          As fotos da viagem aparecem aqui
        </Text>
        <Text variant="body" color={colors.inkMuted}>
          Mande as suas quando for conveniente. O app sugere o lugar de cada uma pela hora.
        </Text>
      </View>
      <View style={{ flex: 1 }} />
      <Button label="Mandar fotos" onPress={onSendPhotos} testID="memorias-mandar-fotos" />
    </View>
  )
}
