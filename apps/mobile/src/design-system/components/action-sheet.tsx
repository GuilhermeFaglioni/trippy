import type { ReactNode } from 'react'
import { Modal, Pressable, View } from 'react-native'

import { useTheme } from '../theme-provider'

export type ActionSheetProps = {
  visible: boolean
  onClose: () => void
  children: ReactNode
  testID?: string
}

/** Folha inferior com conteúdo livre (título, texto e ações), como "Encerrar a viagem hoje?". */
export function ActionSheet({ visible, onClose, children, testID }: ActionSheetProps) {
  const { colors, radius, spacing } = useTheme()

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end' }} testID={testID}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Fechar"
          onPress={onClose}
          style={{
            backgroundColor: 'rgba(0,0,0,0.4)',
            bottom: 0,
            left: 0,
            position: 'absolute',
            right: 0,
            top: 0,
          }}
        />
        <View
          style={{
            backgroundColor: colors.ground,
            borderTopLeftRadius: radius.radiusLg,
            borderTopRightRadius: radius.radiusLg,
            gap: spacing.space3,
            paddingBottom: spacing.space6,
            paddingHorizontal: spacing.space5,
            paddingTop: spacing.space5,
          }}
        >
          {children}
        </View>
      </View>
    </Modal>
  )
}
