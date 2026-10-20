import { ScrollView, Text, Platform } from 'react-native'

import {
  createTypographyTokens,
  TEXT_SCALING_PROPS,
  useTheme,
  type FontPlatform,
} from '../design-system'

const fontPlatform: FontPlatform =
  Platform.OS === 'android' ? 'android' : Platform.OS === 'web' ? 'web' : 'ios'
const typography = createTypographyTokens(fontPlatform)

export default function IndexRoute() {
  const theme = useTheme()

  return (
    <ScrollView
      contentContainerStyle={{
        flexGrow: 1,
        justifyContent: 'center',
        gap: theme.spacing.space3,
        padding: theme.spacing.space5,
        backgroundColor: theme.colors.ground,
      }}
    >
      <Text style={[typography.titleL, { color: theme.colors.ink }]} {...TEXT_SCALING_PROPS}>
        Trippy
      </Text>
      <Text style={[typography.body, { color: theme.colors.inkMuted }]} {...TEXT_SCALING_PROPS}>
        Fundação mobile pronta.
      </Text>
    </ScrollView>
  )
}
