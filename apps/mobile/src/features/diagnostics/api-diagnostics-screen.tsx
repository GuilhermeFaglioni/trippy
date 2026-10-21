import { useCallback, useEffect, useRef, useState } from 'react'
import { StatusBar } from 'expo-status-bar'
import { Platform, ScrollView, Switch, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import {
  createTypographyTokens,
  normalizeFontPlatform,
  TypographyText,
  useTheme,
} from '../../design-system'
import { Button, Card, Notice, TextField, type NoticeTone } from '../../components'
import { checkApiHealth, getApiBaseUrl, type HealthCheckResult } from './health-client'
import { networkGate } from '../sync/network-gate-runtime'
import { useNetworkOffline } from '../sync/use-network-gate'

type ScreenStatus = Exclude<HealthCheckResult['status'], 'aborted'> | 'checking'
type NoticeCopy = {
  title: string
  message: string
  tone: NoticeTone
  buttonLabel: string
}

const fontPlatform = normalizeFontPlatform(Platform.OS)
const typography = createTypographyTokens(fontPlatform)
const isDevelopmentBuild = typeof __DEV__ !== 'undefined' && __DEV__

export function ApiDiagnosticsScreen() {
  const theme = useTheme()
  const isOffline = useNetworkOffline()
  const [apiBaseUrl, setApiBaseUrl] = useState(getApiBaseUrl)
  const [status, setStatus] = useState<ScreenStatus>('checking')
  const [isSavingOffline, setIsSavingOffline] = useState(false)
  const [offlineError, setOfflineError] = useState<string | null>(null)
  const mountedRef = useRef(false)
  const activeRequestRef = useRef<AbortController | null>(null)
  const apiBaseUrlRef = useRef(apiBaseUrl)
  apiBaseUrlRef.current = apiBaseUrl

  const runHealthCheck = useCallback(async () => {
    if (activeRequestRef.current) return

    const controller = new AbortController()
    activeRequestRef.current = controller
    setStatus('checking')

    try {
      const result = await checkApiHealth(apiBaseUrlRef.current, { signal: controller.signal })
      if (mountedRef.current && !controller.signal.aborted && result.status !== 'aborted') {
        setStatus(result.status)
      }
    } catch {
      if (mountedRef.current && !controller.signal.aborted) setStatus('unavailable')
    } finally {
      if (activeRequestRef.current === controller) activeRequestRef.current = null
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true
    void runHealthCheck()

    return () => {
      mountedRef.current = false
      activeRequestRef.current?.abort()
      activeRequestRef.current = null
    }
  }, [runHealthCheck])

  const isChecking = status === 'checking'
  const notice: Record<ScreenStatus, NoticeCopy> = {
    checking: {
      title: 'Verificando conexão',
      message: 'Consultando a API local.',
      tone: 'neutral',
      buttonLabel: 'Verificando conexão',
    },
    available: {
      title: 'API disponível',
      message: 'Conexão confirmada.',
      tone: 'success',
      buttonLabel: 'Verificar de novo',
    },
    unavailable: {
      title: 'API indisponível',
      message: 'Não foi possível confirmar a conexão. Confira o endereço e tente de novo.',
      tone: 'danger',
      buttonLabel: 'Tentar novamente',
    },
    timeout: {
      title: 'A API demorou para responder',
      message: 'Confira a conexão e tente novamente.',
      tone: 'warning',
      buttonLabel: 'Tentar novamente',
    },
  }
  const currentNotice = notice[status]

  const changeOfflineMode = useCallback(async (offline: boolean) => {
    setIsSavingOffline(true)
    setOfflineError(null)
    try {
      await networkGate.setOffline(offline)
    } catch {
      setOfflineError('Não foi possível salvar o estado do interruptor.')
    } finally {
      setIsSavingOffline(false)
    }
  }, [])

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.ground }}>
      <StatusBar style={theme.mode === 'dark' ? 'light' : 'dark'} />
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          gap: theme.spacing.space5,
          padding: theme.spacing.space5,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ gap: theme.spacing.space2 }}>
          <TypographyText family="display" style={[typography.titleL, { color: theme.colors.ink }]}>
            Diagnóstico da API
          </TypographyText>
          <TypographyText family="sans" style={[typography.body, { color: theme.colors.inkMuted }]}>
            Confira se o serviço local está disponível.
          </TypographyText>
        </View>

        <Card testID="api-diagnostics-card">
          <View style={{ gap: theme.spacing.space4 }}>
            <Notice
              testID="api-health-notice"
              title={currentNotice.title}
              message={currentNotice.message}
              tone={currentNotice.tone}
            />

            <View style={{ gap: theme.spacing.space2 }}>
              <TextField
                label="Endereço da API"
                value={apiBaseUrl}
                onChangeText={setApiBaseUrl}
                accessibilityHint="Usado somente para este diagnóstico."
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                disabled={isChecking}
                testID="api-base-url"
              />
              <TypographyText
                family="sans"
                style={[typography.bodySm, { color: theme.colors.inkMuted }]}
              >
                Usado apenas para esta verificação.
              </TypographyText>
            </View>

            <Button
              label={currentNotice.buttonLabel}
              onPress={() => void runHealthCheck()}
              loading={isChecking}
              accessibilityHint="Consulta novamente a disponibilidade da API."
              testID="check-api-health"
            />
          </View>
        </Card>

        {isDevelopmentBuild ? (
          <Card testID="offline-network-card">
            <View style={{ gap: theme.spacing.space3 }}>
              <View style={{ gap: theme.spacing.space1 }}>
                <TypographyText
                  family="sans"
                  style={[typography.bodyStrong, { color: theme.colors.ink }]}
                >
                  Simular sem internet
                </TypographyText>
                <TypographyText
                  family="sans"
                  style={[typography.bodySm, { color: theme.colors.inkMuted }]}
                >
                  Faz os clientes HTTP do app falharem como numa queda de rede.
                </TypographyText>
              </View>
              <Switch
                testID="simulate-offline-toggle"
                accessibilityLabel="Simular sem internet"
                accessibilityRole="switch"
                value={isOffline}
                disabled={isSavingOffline}
                onValueChange={(offline) => void changeOfflineMode(offline)}
              />
              {offlineError ? (
                <Notice tone="danger" message={offlineError} testID="offline-toggle-error" />
              ) : null}
            </View>
          </Card>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  )
}
