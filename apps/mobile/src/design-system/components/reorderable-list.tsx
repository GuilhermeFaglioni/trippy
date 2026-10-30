import { useMemo, useRef, useState, type ReactNode } from 'react'
import { Animated, PanResponder, View } from 'react-native'

export type ReorderableDrag = {
  /** Esta linha está sendo arrastada. */
  active: boolean
  /** Posição visual atual (já considera o arraste em andamento). */
  index: number
  /** Chamado pelo toque longo da linha. */
  start: () => void
  /** Chamado quando o dedo sai da linha sem ter arrastado. */
  release: () => void
  /** Reordenação sem gesto (ações de acessibilidade). */
  moveBy: (delta: -1 | 1) => void
}

export type ReorderableListProps<T> = {
  items: readonly T[]
  keyOf: (item: T) => string
  /** Altura de cada linha com o espaçamento entre elas. */
  rowHeight: number
  enabled: boolean
  /** Devolve a lista na nova ordem. */
  onReorder: (next: T[]) => void
  /** Avisa quando o arraste começa e termina, para travar a rolagem da tela. */
  onDragChange?: (dragging: boolean) => void
  renderItem: (item: T, drag: ReorderableDrag) => ReactNode
  testID?: string
}

function move<T>(items: readonly T[], from: number, to: number): T[] {
  const next = [...items]
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item!)
  return next
}

/** Lista de linhas de altura fixa: segurar uma linha e arrastar troca a ordem ao soltar. */
export function ReorderableList<T>({
  items,
  keyOf,
  rowHeight,
  enabled,
  onReorder,
  onDragChange,
  renderItem,
  testID,
}: ReorderableListProps<T>) {
  const dy = useRef(new Animated.Value(0)).current
  const [dragKey, setDragKey] = useState<string | null>(null)
  const [target, setTarget] = useState(0)
  const live = useRef({
    key: null as string | null,
    from: 0,
    target: 0,
    panning: false,
    items,
    onReorder,
    onDragChange,
    keyOf,
  })
  live.current.items = items
  live.current.onReorder = onReorder
  live.current.onDragChange = onDragChange
  live.current.keyOf = keyOf

  const finish = (commit: boolean) => {
    const state = live.current
    if (state.key === null) return
    const { from, target: to } = state
    state.key = null
    state.panning = false
    dy.setValue(0)
    setDragKey(null)
    state.onDragChange?.(false)
    if (commit && to !== from) state.onReorder(move(state.items, from, to))
  }
  const finishRef = useRef(finish)
  finishRef.current = finish

  const responder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponderCapture: () => live.current.key !== null,
        onPanResponderGrant: () => {
          live.current.panning = true
        },
        onPanResponderMove: (_event, gesture) => {
          const state = live.current
          if (state.key === null) return
          dy.setValue(gesture.dy)
          const next = Math.max(
            0,
            Math.min(state.items.length - 1, state.from + Math.round(gesture.dy / rowHeight)),
          )
          if (next !== state.target) {
            state.target = next
            setTarget(next)
          }
        },
        onPanResponderRelease: () => finishRef.current(true),
        onPanResponderTerminate: () => finishRef.current(false),
        onPanResponderTerminationRequest: () => false,
      }),
    [dy, rowHeight],
  )

  const from = dragKey === null ? -1 : items.findIndex((item) => keyOf(item) === dragKey)

  return (
    <View testID={testID} {...(enabled ? responder.panHandlers : {})}>
      {items.map((item, position) => {
        const key = keyOf(item)
        const active = key === dragKey
        let visual = position
        if (!active && from >= 0) {
          if (from < position && position <= target) visual = position - 1
          else if (from > position && position >= target) visual = position + 1
        }
        if (active) visual = target

        return (
          <Animated.View
            key={key}
            style={{
              height: rowHeight,
              zIndex: active ? 2 : 0,
              transform: [
                {
                  translateY: active ? dy : (visual - position) * rowHeight,
                },
              ],
            }}
          >
            {renderItem(item, {
              active,
              index: visual,
              start: () => {
                if (!enabled || live.current.key !== null) return
                live.current.key = key
                live.current.from = position
                live.current.target = position
                live.current.panning = false
                dy.setValue(0)
                setTarget(position)
                setDragKey(key)
                live.current.onDragChange?.(true)
              },
              release: () => {
                // O toque longo sem arrastar termina aqui; com arraste, o gesto assume antes.
                setTimeout(() => {
                  if (live.current.key === key && !live.current.panning) finishRef.current(false)
                }, 0)
              },
              moveBy: (delta) => {
                const to = position + delta
                if (!enabled || to < 0 || to >= items.length) return
                onReorder(move(items, position, to))
              },
            })}
          </Animated.View>
        )
      })}
    </View>
  )
}
