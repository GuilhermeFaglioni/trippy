import { useFonts } from 'expo-font'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'

import { customFontAssets, DesignSystemProvider } from '../design-system'
import { SessionProvider, useSession } from '../features/auth/session-provider'
import { SyncProvider } from '../features/sync/sync-provider'
import { PhotoUploadQueueProvider } from '../features/photos/photo-upload-queue-provider'

function SessionNavigator() {
  const { status, session } = useSession()

  const stack = (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={status === 'authenticated'} redirectTo="/login">
        <Stack.Screen name="index" />
        <Stack.Screen name="trips/new" />
        <Stack.Screen name="trips/[id]" />
        <Stack.Screen name="trips/[id]/photos" />
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
