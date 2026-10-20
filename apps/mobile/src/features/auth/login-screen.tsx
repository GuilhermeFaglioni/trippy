import { useState } from 'react'
import { Platform, ScrollView, View } from 'react-native'
import { router } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'

import { Button, Card, Notice, TextField, TrippySymbol, type NoticeTone } from '../../components'
import {
  createTypographyTokens,
  normalizeFontPlatform,
  TypographyText,
  useTheme,
} from '../../design-system'
import { getAuthErrorMessage } from './auth-client'
import { useSession } from './session-provider'

type LoginStage = 'email' | 'code'
type LoginNotice = {
  title: string
  message: string
  tone: NoticeTone
}

const typography = createTypographyTokens(normalizeFontPlatform(Platform.OS))

export function LoginScreen() {
  const theme = useTheme()
  const { status, startEmail, verifyEmail } = useSession()
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [stage, setStage] = useState<LoginStage>('email')
  const [busy, setBusy] = useState<'start' | 'verify' | null>(null)
  const [notice, setNotice] = useState<LoginNotice | null>(null)

  const requestCode = async () => {
    setBusy('start')
    setNotice(null)

    try {
      await startEmail(email)
      setStage('code')
      setCode('')
      setNotice({
        title: 'Código enviado',
        message: `Enviamos um código de seis dígitos para ${email}.`,
        tone: 'success',
      })
    } catch (error) {
      setNotice({
        title: 'Não foi possível enviar o código',
        message: getAuthErrorMessage(error),
        tone: 'danger',
      })
    } finally {
      setBusy(null)
    }
  }

  const confirmCode = async () => {
    setBusy('verify')
    setNotice(null)

    try {
      await verifyEmail(email, code)
      router.replace('/')
    } catch (error) {
      setNotice({
        title: 'Não foi possível entrar',
        message: getAuthErrorMessage(error),
        tone: 'danger',
      })
    } finally {
      setBusy(null)
    }
  }

  const changeEmail = () => {
    setStage('email')
    setCode('')
    setNotice(null)
  }

  if (status === 'loading') {
    return <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.ground }} />
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.ground }}>
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: 'center',
          gap: theme.spacing.space5,
          padding: theme.spacing.space6,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <TrippySymbol size={56} testID="login-brand-symbol" />
        <View style={{ gap: theme.spacing.space2 }}>
          <TypographyText family="display" style={[typography.titleL, { color: theme.colors.ink }]}>
            Entre no Trippy
          </TypographyText>
          <TypographyText family="sans" style={[typography.body, { color: theme.colors.inkMuted }]}>
            Acesse suas viagens com um código enviado por e-mail.
          </TypographyText>
        </View>

        <Card testID="login-card">
          <View style={{ gap: theme.spacing.space4 }}>
            {notice ? (
              <Notice
                testID="login-notice"
                title={notice.title}
                message={notice.message}
                tone={notice.tone}
              />
            ) : null}

            {stage === 'email' ? (
              <>
                <TextField
                  label="E-mail"
                  value={email}
                  onChangeText={(value) => {
                    setEmail(value)
                    setNotice(null)
                  }}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                  returnKeyType="send"
                  onSubmitEditing={() => void requestCode()}
                  disabled={busy !== null}
                  testID="login-email-input"
                />
                <Button
                  label="Enviar código"
                  onPress={() => void requestCode()}
                  loading={busy === 'start'}
                  disabled={busy === 'verify'}
                  testID="login-email-submit"
                />
              </>
            ) : (
              <>
                <TypographyText
                  family="sans"
                  style={[typography.body, { color: theme.colors.ink }]}
                >
                  {`Digite o código enviado para ${email}.`}
                </TypographyText>
                <TextField
                  label="Código de seis dígitos"
                  value={code}
                  onChangeText={(value) => {
                    setCode(value.replace(/\D/g, '').slice(0, 6))
                    setNotice(null)
                  }}
                  keyboardType="number-pad"
                  returnKeyType="done"
                  onSubmitEditing={() => void confirmCode()}
                  maxLength={6}
                  disabled={busy !== null}
                  testID="login-code-input"
                />
                <Button
                  label="Entrar"
                  onPress={() => void confirmCode()}
                  loading={busy === 'verify'}
                  disabled={busy === 'start'}
                  testID="login-code-submit"
                />
                <Button
                  label="Reenviar código"
                  variant="secondary"
                  onPress={() => void requestCode()}
                  loading={busy === 'start'}
                  disabled={busy === 'verify'}
                  testID="login-code-resend"
                />
                <Button
                  label="Trocar e-mail"
                  variant="secondary"
                  onPress={changeEmail}
                  disabled={busy !== null}
                  testID="login-change-email"
                />
              </>
            )}
          </View>
        </Card>

        <Button
          label="Diagnóstico da API"
          variant="secondary"
          onPress={() => router.push('/diagnostics')}
          testID="login-diagnostics"
        />
      </ScrollView>
    </SafeAreaView>
  )
}
