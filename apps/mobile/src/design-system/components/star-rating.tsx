import { Pressable, View } from 'react-native'

import { useTheme } from '../theme-provider'
import { Icon } from './icon'

export type StarRatingProps = {
  /** 0 = sem nota. */
  value: number
  onChange: (rating: number) => void
  disabled?: boolean
  /** Os testIDs saem como `<testID>-<n>`. */
  testID?: string
}

const STARS = [1, 2, 3, 4, 5] as const

/** Cinco estrelas de 44px; as até `value` ficam preenchidas em terracotta. */
export function StarRating({ value, onChange, disabled = false, testID }: StarRatingProps) {
  const { colors, spacing } = useTheme()

  return (
    <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', gap: spacing.space1 }}>
      {STARS.map((star) => (
        <Pressable
          key={star}
          testID={testID ? `${testID}-${star}` : undefined}
          accessibilityRole="radio"
          accessibilityLabel={`${star} ${star === 1 ? 'estrela' : 'estrelas'}`}
          accessibilityState={{ checked: value === star, disabled }}
          disabled={disabled}
          onPress={() => onChange(star)}
          style={{
            alignItems: 'center',
            height: spacing.targetMin,
            justifyContent: 'center',
            width: spacing.targetMin,
          }}
        >
          <Icon
            name="star"
            color={disabled ? colors.inkMuted : colors.terracottaText}
            size={24}
            strokeWidth={1.8}
            filled={star <= value}
          />
        </Pressable>
      ))}
    </View>
  )
}
