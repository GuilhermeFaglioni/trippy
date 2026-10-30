import { View } from 'react-native'

import { useTheme } from '../theme-provider'
import { Text } from './text'

export type AvatarColor = 1 | 2 | 3 | 4

export type AvatarProps = {
  /** Nome da pessoa; as iniciais saem dele. */
  name: string
  /** 1–4, sorteado por pessoa e fixo dentro da viagem. */
  color: AvatarColor
  size?: 'md' | 'sm'
  /** Cor do fundo atrás do avatar, para a borda da pilha. */
  ringColor?: string
  testID?: string
}

export function getInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)

  if (words.length === 0) return '?'
  if (words.length === 1) return Array.from(words[0])[0].toUpperCase()

  return (Array.from(words[0])[0] + Array.from(words[words.length - 1])[0]).toUpperCase()
}

export function Avatar({ name, color, size = 'md', ringColor, testID }: AvatarProps) {
  const { colors, radius } = useTheme()
  const dimension = size === 'sm' ? 30 : 40
  const background = [colors.avatar1, colors.avatar2, colors.avatar3, colors.avatar4][color - 1]

  return (
    <View
      testID={testID}
      accessible
      accessibilityLabel={name}
      style={{
        alignItems: 'center',
        backgroundColor: background,
        borderColor: ringColor ?? 'transparent',
        borderRadius: radius.radiusPill,
        borderWidth: ringColor ? 2 : 0,
        height: dimension,
        justifyContent: 'center',
        width: dimension,
      }}
    >
      <Text variant={size === 'sm' ? 'avatarSm' : 'avatar'} color={colors.onMustard}>
        {getInitials(name)}
      </Text>
    </View>
  )
}

export type AvatarStackProps = {
  people: { name: string; color: AvatarColor }[]
  /** Cor do fundo onde a pilha fica. Padrão: `surface`. */
  ringColor?: string
  testID?: string
}

/** Avatares de 30px sobrepostos em -8px, com borda da cor do fundo. */
export function AvatarStack({ people, ringColor, testID }: AvatarStackProps) {
  const { colors } = useTheme()

  return (
    <View
      testID={testID}
      accessible
      accessibilityLabel={people.map((person) => person.name).join(', ')}
      style={{ flexDirection: 'row' }}
    >
      {people.map((person, index) => (
        <View key={`${person.name}-${index}`} style={{ marginLeft: index === 0 ? 0 : -8 }}>
          <Avatar {...person} size="sm" ringColor={ringColor ?? colors.surface} />
        </View>
      ))}
    </View>
  )
}
