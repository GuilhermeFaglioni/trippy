import { Pressable, ScrollView, View } from 'react-native'

import { useTheme } from '../theme-provider'
import { Icon } from './icon'
import { Text } from './text'
import type { ReorderableDrag } from './reorderable-list'

export type DayPickerItem = {
  key: string
  /** Número mostrado em destaque. */
  number: number
}

export type DayPickerProps = {
  days: readonly DayPickerItem[]
  /** Dia escolhido; `null` com `allSelected`. */
  selectedKey: string | null
  allLabel: string
  allSelected: boolean
  onSelect: (key: string) => void
  onSelectAll: () => void
  testID?: string
}

/** Seletor de dias do Roteiro: botões "Dia N" e "Todos os N dias". */
export function DayPicker({
  days,
  selectedKey,
  allLabel,
  allSelected,
  onSelect,
  onSelectAll,
  testID,
}: DayPickerProps) {
  const { colors, radius } = useTheme()

  return (
    <View testID={testID} style={{ alignItems: 'center', flexDirection: 'row', gap: 6 }}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ flex: 1 }}
        contentContainerStyle={{ gap: 6 }}
      >
        {days.map((day) => {
          const selected = !allSelected && day.key === selectedKey
          return (
            <Pressable
              key={day.key}
              testID={`${testID ?? 'seletor-dia'}-${day.key}`}
              accessibilityRole="button"
              accessibilityLabel={`Dia ${day.number}`}
              accessibilityState={{ selected }}
              onPress={() => onSelect(day.key)}
              style={{
                alignItems: 'center',
                backgroundColor: selected ? colors.ink : colors.surface,
                borderColor: colors.lineStrong,
                borderRadius: radius.radiusSm,
                borderWidth: selected ? 0 : 1,
                height: 56,
                justifyContent: 'center',
                width: 48,
              }}
            >
              <Text variant="filter" color={selected ? colors.ground : colors.ink}>
                Dia
              </Text>
              <Text variant="titleS" color={selected ? colors.ground : colors.ink}>
                {String(day.number)}
              </Text>
            </Pressable>
          )
        })}
      </ScrollView>
      <Pressable
        testID={`${testID ?? 'seletor-dia'}-todos`}
        accessibilityRole="button"
        accessibilityLabel={allLabel}
        accessibilityState={{ selected: allSelected }}
        onPress={onSelectAll}
        style={{
          alignItems: 'center',
          backgroundColor: allSelected ? colors.ink : colors.surface,
          borderColor: colors.lineStrong,
          borderRadius: radius.radiusSm,
          borderWidth: allSelected ? 0 : 1,
          height: 56,
          justifyContent: 'center',
          paddingHorizontal: 12,
        }}
      >
        <Text variant="filterSelected" color={allSelected ? colors.ground : colors.ink}>
          {allLabel}
        </Text>
      </Pressable>
    </View>
  )
}

export const STOP_ROW_HEIGHT = 70

export type StopCardProps = {
  number: number
  name: string
  meta: string
  /** Última parada do dia: sem linha de ligação. */
  last: boolean
  /** Organizador: mostra o ícone de mover de dia e a alça, e aceita segurar e arrastar. */
  editable: boolean
  drag?: ReorderableDrag
  onPress?: () => void
  onMoveDay?: () => void
  testID?: string
}

/** Parada do roteiro: número na linha do tempo e linha compacta com nome e meta. */
export function StopCard({
  number,
  name,
  meta,
  last,
  editable,
  drag,
  onPress,
  onMoveDay,
  testID,
}: StopCardProps) {
  const { colors, radius, spacing } = useTheme()
  const active = drag?.active === true

  return (
    <View testID={testID} style={{ flexDirection: 'row', gap: 12, height: STOP_ROW_HEIGHT }}>
      <View style={{ alignItems: 'center', width: 28 }}>
        <View
          style={{
            alignItems: 'center',
            backgroundColor: colors.forest,
            borderRadius: radius.radiusPill,
            height: 28,
            justifyContent: 'center',
            width: 28,
          }}
        >
          <Text variant="chip" color={colors.onForest}>
            {String(drag ? drag.index + 1 : number)}
          </Text>
        </View>
        {last ? null : (
          <View style={{ backgroundColor: colors.line, flex: 1, minHeight: 16, width: 2 }} />
        )}
      </View>
      <View
        style={[
          {
            alignItems: 'center',
            alignSelf: 'flex-start',
            backgroundColor: colors.surface,
            borderRadius: radius.radiusMd,
            flex: 1,
            flexDirection: 'row',
            gap: 4,
            height: 60,
            paddingLeft: 14,
            paddingRight: 6,
          },
          active ? { borderColor: colors.lineStrong, borderWidth: 1 } : null,
        ]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${number}. ${name}`}
          accessibilityHint={editable ? 'Segure e arraste para mudar a ordem.' : undefined}
          accessibilityActions={
            editable
              ? [
                  { name: 'moveUp', label: 'Subir na ordem' },
                  { name: 'moveDown', label: 'Descer na ordem' },
                ]
              : undefined
          }
          onAccessibilityAction={(event) => {
            if (event.nativeEvent.actionName === 'moveUp') drag?.moveBy(-1)
            if (event.nativeEvent.actionName === 'moveDown') drag?.moveBy(1)
          }}
          onPress={onPress}
          onLongPress={editable ? drag?.start : undefined}
          delayLongPress={350}
          onPressOut={editable ? drag?.release : undefined}
          style={{ flex: 1, justifyContent: 'center', minHeight: spacing.targetMin, minWidth: 0 }}
        >
          <Text variant="placeName" color={colors.ink} numberOfLines={1}>
            {name}
          </Text>
          <Text variant="placeAddress" color={colors.inkMuted} numberOfLines={1}>
            {meta}
          </Text>
        </Pressable>
        {editable ? (
          <>
            <Pressable
              testID={testID ? `${testID}-mover-dia` : undefined}
              accessibilityRole="button"
              accessibilityLabel="Mover para outro dia"
              onPress={onMoveDay}
              style={{
                alignItems: 'center',
                height: spacing.targetMin,
                justifyContent: 'center',
                width: spacing.targetMin,
              }}
            >
              <Icon name="calendar-move" color={colors.ink} size={20} />
            </Pressable>
            <View
              accessible={false}
              importantForAccessibility="no-hide-descendants"
              style={{
                alignItems: 'center',
                height: spacing.targetMin,
                justifyContent: 'center',
                width: spacing.targetMin,
              }}
            >
              <Icon name="grip-vertical" color={colors.inkMuted} size={20} strokeWidth={2.4} />
            </View>
          </>
        ) : null}
      </View>
    </View>
  )
}

export type DashedButtonProps = {
  label: string
  onPress: () => void
  /** Recuo à esquerda, para alinhar com os cartões da linha do tempo. */
  inset?: number
  testID?: string
}

/** Botão tracejado "+ Adicionar …". */
export function DashedButton({ label, onPress, inset = 0, testID }: DashedButtonProps) {
  const { colors, radius } = useTheme()

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={{
        alignItems: 'center',
        borderColor: colors.lineStrong,
        borderRadius: radius.radiusSm,
        borderStyle: 'dashed',
        borderWidth: 1,
        height: 48,
        justifyContent: 'center',
        marginLeft: inset,
      }}
    >
      <Text variant="buttonSecondary" color={colors.ink} style={{ fontWeight: '500' }}>
        {label}
      </Text>
    </Pressable>
  )
}
