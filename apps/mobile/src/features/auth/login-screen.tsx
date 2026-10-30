import { useState } from 'react'
import { ScrollView, View } from 'react-native'
import { router } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'

import {
  Button,
  Card,
  DecorTile,
  Notice,
  Text,
  TextButton,
  TextField,
  TrippyLogo,
  useTheme,
  withAlpha,
} from '../../design-system'
import { getAuthErrorMessage } from './auth-client'
import { useSession } from './session-provider'

type LoginStage = 'choose' | 'email' | 'code'
type LoginNotice = {
  title: string
  message: string
}

export function LoginScreen() {
  const theme = useTheme()
  const { status, startEmail, verifyEmail } = useSession()
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [stage, setStage] = useState<LoginStage>('choose')
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
      })
    } catch (error) {
      setNotice({
        title: 'Não foi possível enviar o código',
        message: getAuthErrorMessage(error),
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

  const providerUnavailable = (provider: string) =>
    setNotice({
      title: `${provider} ainda não está disponível`,
      message: 'Por enquanto, entre com e-mail: enviamos um código para você.',
    })

  const forest = theme.colors.forest
  const onForest = theme.colors.onForest
  const muted = withAlpha(onForest, 0.8)

  if (status === 'loading') {
    return <SafeAreaView style={{ flex: 1, backgroundColor: forest }} />
  }

  return (
    <SafeAreaView testID="login-screen" style={{ flex: 1, backgroundColor: forest }}>
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          gap: theme.spacing.space6,
          paddingBottom: theme.spacing.space5,
          paddingHorizontal: theme.spacing.space6,
          paddingTop: theme.spacing.space3,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <TrippyLogo size="lg" onForest testID="login-brand-symbol" />

        <View style={{ flex: 1, gap: theme.spacing.space4, justifyContent: 'center' }}>
          <View style={{ flexDirection: 'row', gap: theme.spacing.space2 }}>
            <DecorTile
              color={theme.colors.mustard}
              width={96}
              height={128}
              radius={20}
              rotate={-6}
            />
            <DecorTile
              color={theme.colors.terracotta}
              width={96}
              height={128}
              radius={20}
              rotate={3}
              offsetY={16}
            />
            <DecorTile color={onForest} width={96} height={128} radius={20} rotate={-2} />
          </View>
          <Text
            variant="hero"
            color={onForest}
            accessibilityRole="header"
            style={{ marginTop: theme.spacing.space5 }}
          >
            A viagem do grupo, num lugar só.
          </Text>
          <Text variant="body" color={muted}>
            Sugestões, roteiro, fotos e o recap no final.
          </Text>
        </View>

        {notice ? (
          <Notice
            testID="login-notice"
            tone="change"
            segments={[{ strong: notice.title }, ' ', notice.message]}
          />
        ) : null}

        {stage === 'choose' ? (
          <View style={{ gap: theme.spacing.space3 }}>
            <Button
              label="Continuar com Apple"
              variant="inverse"
              minHeight={54}
              onPress={() => providerUnavailable('Apple')}
              testID="login-apple"
            />
            <Button
              label="Continuar com Google"
              variant="outlineInverse"
              minHeight={54}
              onPress={() => providerUnavailable('Google')}
              testID="login-google"
            />
            <TextButton
              label="Entrar com e-mail"
              tone="onForest"
              onPress={() => {
                setNotice(null)
                setStage('email')
              }}
              testID="login-use-email"
            />
            <Text
              variant="caption"
              color={muted}
              style={{ fontWeight: '400', textAlign: 'center' }}
            >
              Vai para a China? Google não funciona lá sem VPN. Prefira Apple ou e-mail, para
              conseguir entrar durante a viagem.
            </Text>
            {__DEV__ ? (
              <TextButton
                label="Diagnóstico da API"
                tone="onForest"
                onPress={() => router.push('/diagnostics')}
                testID="login-diagnostics"
              />
            ) : null}
          </View>
        ) : (
          <Card testID="login-card">
            <View style={{ gap: theme.spacing.space4 }}>
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
                  <TextButton
                    label="Voltar"
                    onPress={() => {
                      setNotice(null)
                      setStage('choose')
                    }}
                    testID="login-back"
                  />
                </>
              ) : (
                <>
                  <Text variant="body" color={theme.colors.ink}>
                    {`Digite o código enviado para ${email}.`}
                  </Text>
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
                  <TextButton
                    label="Trocar e-mail"
                    onPress={changeEmail}
                    disabled={busy !== null}
                    testID="login-change-email"
                  />
                </>
              )}
            </View>
          </Card>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}
