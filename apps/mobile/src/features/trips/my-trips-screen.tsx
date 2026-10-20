import { Platform, ScrollView, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { Button, Card, Notice, TrippyWordmark } from '../../components'
import {
  createTypographyTokens,
  normalizeFontPlatform,
  TypographyText,
  useTheme,
} from '../../design-system'

const typography = createTypographyTokens(normalizeFontPlatform(Platform.OS))

export function MyTripsScreen() {
  const theme = useTheme()

  return (
    <SafeAreaView
      testID="my-trips-screen"
      style={{ flex: 1, backgroundColor: theme.colors.ground }}
    >
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          gap: theme.spacing.space5,
          padding: theme.spacing.space5,
        }}
      >
        <TrippyWordmark />
        <TypographyText family="display" style={[typography.titleL, { color: theme.colors.ink }]}>
          Minhas viagens
        </TypographyText>

        <Card testID="my-trips-empty-card">
          <View style={{ gap: theme.spacing.space4 }}>
            <Notice
              title="Você ainda não tem viagens."
              message="Suas viagens vão aparecer aqui quando você criar uma ou aceitar um convite."
            />
            <Button
              label="Criar minha primeira viagem"
              onPress={() => undefined}
              testID="my-trips-empty-create"
            />
          </View>
        </Card>
      </ScrollView>
    </SafeAreaView>
  )
}
