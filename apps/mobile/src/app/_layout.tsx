import { useFonts } from 'expo-font'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'

import { customFontAssets, DesignSystemProvider } from '../design-system'

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts(customFontAssets)

  if (!fontsLoaded && !fontError) {
    return null
  }

  return (
    <DesignSystemProvider>
      <Stack screenOptions={{ headerShown: false }} />
      <StatusBar style="auto" />
    </DesignSystemProvider>
  )
}
