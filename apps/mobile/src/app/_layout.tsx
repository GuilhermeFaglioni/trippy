import { useFonts } from 'expo-font'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'

import { customFontAssets, DesignSystemProvider } from '../design-system'
import { SessionProvider, useSession } from '../features/auth/session-provider'

function SessionNavigator() {
  const { status } = useSession()

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={status === 'authenticated'} redirectTo="/login">
        <Stack.Screen name="index" />
      </Stack.Protected>
      <Stack.Protected guard={status !== 'authenticated'} redirectTo="/">
        <Stack.Screen name="login" />
      </Stack.Protected>
      <Stack.Screen name="diagnostics" />
    </Stack>
  )
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts(customFontAssets)

  if (!fontsLoaded && !fontError) {
    return null
  }

  return (
    <DesignSystemProvider>
      <SessionProvider>
        <SessionNavigator />
      </SessionProvider>
      <StatusBar style="auto" />
    </DesignSystemProvider>
  )
}
