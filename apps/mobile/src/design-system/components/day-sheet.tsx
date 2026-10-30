import { useEffect, useRef, useState } from 'react'
import { Animated, Easing, Modal, Pressable, View } from 'react-native'

import { useTheme } from '../theme-provider'
import { Icon } from './icon'
import { Text } from './text'
import { useReducedMotion } from './use-reduced-motion'

export type DaySheetOption = {
  key: string
  label: string
  selected?: boolean
}

export type DaySheetProps = {
  visible: boolean
  title: string
  options: readonly DaySheetOption[]
  onSelect: (key: string) => void
  onClose: () => void
  testID?: string
}

const SHEET_OFFSET = 320

/** Folha inferior para escolher o dia de um lugar. */
export function DaySheet({ visible, title, options, onSelect, onClose, testID }: DaySheetProps) {
  const { colors, radius, spacing, duration, easing } = useTheme()
  const reducedMotion = useReducedMotion()
  const progress = useRef(new Animated.Value(0)).current
  const [mounted, setMounted] = useState(visible)

  useEffect(() => {
    if (visible) {
      setMounted(true)
    }

    Animated.timing(progress, {
      toValue: visible ? 1 : 0,
      duration: reducedMotion ? duration.durationFast : duration.durationBase,
      easing: Easing.bezier(...easing.easeStandard),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished && !visible) setMounted(false)
    })
  }, [visible, reducedMotion, progress, duration, easing])

  return (
    <Modal
      visible={mounted}
      transparent
      animationType="none"
      onRequestClose={onClose}
      testID={testID}
    >
      <Animated.View style={{ backgroundColor: 'rgba(0,0,0,0.4)', flex: 1, opacity: progress }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Fechar"
          onPress={onClose}
          style={{ flex: 1 }}
        />
      </Animated.View>
      <Animated.View
        style={{
          backgroundColor: colors.surface,
          borderTopLeftRadius: radius.radiusLg,
          borderTopRightRadius: radius.radiusLg,
          bottom: 0,
          gap: spacing.space2,
          left: 0,
          opacity: reducedMotion ? progress : 1,
          paddingBottom: spacing.space6,
          paddingHorizontal: spacing.space5,
          paddingTop: spacing.space5,
          position: 'absolute',
          right: 0,
          transform: [
            {
              translateY: reducedMotion
                ? 0
                : progress.interpolate({ inputRange: [0, 1], outputRange: [SHEET_OFFSET, 0] }),
            },
          ],
        }}
      >
        <View
          style={{ alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' }}
        >
          <Text variant="titleS" color={colors.ink} accessibilityRole="header" style={{ flex: 1 }}>
            {title}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Fechar"
            onPress={onClose}
            style={{
              alignItems: 'center',
              height: spacing.targetMin,
              justifyContent: 'center',
              width: spacing.targetMin,
            }}
          >
            <Icon name="x" color={colors.ink} size={20} />
          </Pressable>
        </View>
        {options.map((option) => (
          <Pressable
            key={option.key}
            accessibilityRole="button"
            accessibilityLabel={option.label}
            accessibilityState={{ selected: option.selected === true }}
            onPress={() => onSelect(option.key)}
            style={({ pressed }) => ({
              alignItems: 'center',
              backgroundColor: option.selected ? colors.ink : pressed ? colors.sand : 'transparent',
              borderColor: option.selected ? colors.ink : colors.lineStrong,
              borderRadius: radius.radiusSm,
              borderWidth: 1,
              flexDirection: 'row',
              justifyContent: 'space-between',
              minHeight: 52,
              paddingHorizontal: spacing.space4,
              paddingVertical: spacing.space2,
            })}
          >
            <Text
              variant={option.selected ? 'bodyStrong' : 'body'}
              color={option.selected ? colors.ground : colors.ink}
              style={{ flex: 1 }}
            >
              {option.label}
            </Text>
            {option.selected ? <Icon name="check" color={colors.ground} size={20} /> : null}
          </Pressable>
        ))}
      </Animated.View>
    </Modal>
  )
}
