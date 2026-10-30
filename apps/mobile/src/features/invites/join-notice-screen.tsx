import { Modal, ScrollView, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { useTheme } from '../../design-system'
import { Button, Card, Icon, RichText, Text, TextButton } from '../../design-system/components'

type JoinNoticeScreenProps = {
  visible: boolean
  /** Nome da viagem, quando já conhecido; sem ele o título fala "na viagem". */
  tripName?: string
  loading?: boolean
  onAccept: () => void
  onDecline: () => void
}

/** Tela 28: o aviso de uso das fotos e do nome no recap, antes de entrar no grupo. */
export function JoinNoticeScreen({
  visible,
  tripName,
  loading = false,
  onAccept,
  onDecline,
}: JoinNoticeScreenProps) {
  const { colors, radius, spacing } = useTheme()

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onDecline}>
      <SafeAreaView
        testID="accept-invite-terms"
        style={{ backgroundColor: colors.ground, flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={{
            flexGrow: 1,
            gap: 18,
            paddingBottom: 36,
            paddingHorizontal: 24,
            paddingTop: 12,
          }}
        >
          <View
            style={{
              alignItems: 'center',
              backgroundColor: colors.terracotta,
              borderRadius: radius.radiusLg,
              height: 64,
              justifyContent: 'center',
              width: 64,
            }}
          >
            <Icon name="video-camera" color={colors.onTerracotta} size={30} />
          </View>
          <Text variant="titleL" color={colors.ink} accessibilityRole="header">
            {tripName ? `Antes de entrar na ${tripName}` : 'Antes de entrar na viagem'}
          </Text>
          <Card style={{ borderRadius: radius.radiusLg, padding: spacing.space4 }}>
            <RichText
              variant="fieldInput"
              color={colors.ink}
              style={{ fontWeight: '400', lineHeight: 22 }}
              segments={[
                'No fim da viagem, o app monta um ',
                { strong: 'vídeo recap' },
                ' com as fotos e os lugares do grupo.',
              ]}
            />
            <RichText
              variant="fieldInput"
              color={colors.ink}
              style={{ fontWeight: '400', lineHeight: 22 }}
              segments={[
                'Ao entrar, você autoriza que as fotos que mandar e o seu nome apareçam nesse vídeo, e que qualquer pessoa do grupo ',
                { strong: 'compartilhe o vídeo fora do app' },
                ', como no Instagram ou no WhatsApp.',
              ]}
            />
            <Text variant="backLink" color={colors.inkMuted} style={{ lineHeight: 21 }}>
              O recap é gerado assim que a viagem termina. Até lá, você pode esconder qualquer foto
              sua dele. Depois, esconder ou remover uma foto só muda o recap se o organizador gerar
              de novo, e vídeos que alguém já postou ou baixou não mudam.
            </Text>
          </Card>
          <View style={{ flex: 1, minHeight: spacing.space5 }} />
          <Button
            label="Entendi, entrar no grupo"
            onPress={onAccept}
            loading={loading}
            testID="accept-invite-terms-accept"
          />
          <TextButton
            label="Agora não"
            block
            onPress={onDecline}
            testID="accept-invite-terms-decline"
          />
        </ScrollView>
      </SafeAreaView>
    </Modal>
  )
}
