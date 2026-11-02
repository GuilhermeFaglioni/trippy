import { useFonts } from 'expo-font'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { LogBox } from 'react-native'

import { customFontAssets, DesignSystemProvider } from '../design-system'
import { SessionProvider, useSession } from '../features/auth/session-provider'
import { SyncProvider } from '../features/sync/sync-provider'
import { PhotoUploadQueueProvider } from '../features/photos/photo-upload-queue-provider'

// Único aviso restante no app em desenvolvimento, e não vem do nosso código: o `Screen` do
// react-native-screens (usado pelo expo-router) liga `transitionProgress` ao driver nativo com
// `Animated.event`, e o React Native 0.88 registra um listener nesse valor. Ao fim de cada
// transição o nativo ainda envia um último `onAnimatedValueUpdate` depois de o listener JS ser
// removido, e o React Native avisa. Não afeta o app nem existe em release. Reavaliar ao atualizar
// react-native-screens ou react-native.
LogBox.ignoreLogs(['Sending `onAnimatedValueUpdate` with no listeners registered.'])

function SessionNavigator() {
  const { status, session } = useSession()

  const stack = (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={status === 'authenticated'} redirectTo="/login">
        <Stack.Screen name="index" />
        <Stack.Screen name="trips/new" />
        <Stack.Screen name="trips/[id]" />
        <Stack.Screen name="trips/[id]/photos" />
        <Stack.Screen name="trips/[id]/settings" />
        <Stack.Screen
          name="trips/[id]/address-card"
          options={{ presentation: 'fullScreenModal', headerShown: false }}
        />
      </Stack.Protected>
      <Stack.Protected guard={status !== 'authenticated'} redirectTo="/">
        <Stack.Screen name="login" />
      </Stack.Protected>
      <Stack.Screen name="diagnostics" />
    </Stack>
  )

  if (status === 'authenticated' && session !== null) {
    return (
      <PhotoUploadQueueProvider key={session.user.id} userId={session.user.id}>
        {stack}
      </PhotoUploadQueueProvider>
    )
  }

  return stack
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts(customFontAssets)

  if (!fontsLoaded && !fontError) {
    return null
  }

  return (
    <DesignSystemProvider>
      <SessionProvider>
        <SyncProvider>
          <SessionNavigator />
        </SyncProvider>
      </SessionProvider>
      <StatusBar style="auto" />
    </DesignSystemProvider>
  )
}
