import { useContext } from 'react'
import { Pressable, View, useWindowDimensions } from 'react-native'
import { SafeAreaInsetsContext } from 'react-native-safe-area-context'

import { useTheme } from '../theme-provider'
import { Icon, type IconName } from './icon'
import { Text } from './text'

export type TabBarItem = {
  key: string
  label: string
  icon: IconName
  /** Substitui o testID derivado (`<barra>-<key>`). */
  testID?: string
}

export type TabBarProps = {
  items: readonly TabBarItem[]
  currentKey: string
  onSelect: (key: string) => void
  testID?: string
}

/** Abas de uma viagem. Hoje só entra na lista durante a viagem. */
export const tripTabs = {
  today: { key: 'today', label: 'Hoje', icon: 'sun' },
  itinerary: { key: 'itinerary', label: 'Roteiro', icon: 'list-ordered' },
  places: { key: 'places', label: 'Lugares', icon: 'map-pin' },
  memories: { key: 'memories', label: 'Memórias', icon: 'images' },
  group: { key: 'group', label: 'Grupo', icon: 'users' },
} as const satisfies Record<string, TabBarItem>

export function TabBar({ items, currentKey, onSelect, testID }: TabBarProps) {
  const { colors, spacing } = useTheme()
  const { fontScale } = useWindowDimensions()
  const insets = useContext(SafeAreaInsetsContext)
  // Acima de 150% os rótulos quebram em até 2 linhas e a barra cresce.
  const labelLines = fontScale > 1.5 ? 2 : 1

  return (
    <View
      testID={testID}
      accessibilityRole="tablist"
      style={{
        backgroundColor: colors.surface,
        borderTopColor: colors.hairline,
        borderTopWidth: 1,
        flexDirection: 'row',
        minHeight: 84,
        paddingBottom: Math.max(20, insets?.bottom ?? 0),
        paddingHorizontal: spacing.space2,
        paddingTop: spacing.space2,
      }}
    >
      {items.map((item) => {
        const current = item.key === currentKey
        const color = current ? colors.terracottaText : colors.inkMuted

        return (
          <Pressable
            key={item.key}
            testID={item.testID ?? (testID ? `${testID}-${item.key}` : undefined)}
            accessibilityRole="tab"
            accessibilityLabel={item.label}
            accessibilityState={{ selected: current }}
            onPress={() => onSelect(item.key)}
            style={{
              alignItems: 'center',
              flex: 1,
              gap: spacing.space1,
              minHeight: spacing.targetMin,
            }}
          >
            <Icon name={item.icon} color={color} size={22} strokeWidth={current ? 2.2 : 1.8} />
            <Text
              variant={current ? 'tabCurrent' : 'tab'}
              color={color}
              numberOfLines={labelLines}
              style={{ textAlign: 'center' }}
            >
              {item.label}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}
