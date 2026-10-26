import { View } from 'react-native'

import { TypographyText, useTheme } from '../../design-system'

export type PlaceAttributionProps = {
  provider: string | null
  datasource: string | null
  attribution: string | null
  testID?: string
}

export function PlaceAttribution({
  provider,
  datasource,
  attribution,
  testID = 'place-attribution',
}: PlaceAttributionProps) {
  const theme = useTheme()
  const hasProviderMetadata = Boolean(provider || datasource || attribution)

  return (
    <View testID={testID} style={{ gap: theme.spacing.space1 }}>
      {attribution ? (
        <TypographyText family="sans" style={{ color: theme.colors.inkMuted }}>
          {attribution}
        </TypographyText>
      ) : provider === 'geoapify' && datasource === 'openstreetmap' ? (
        <TypographyText family="sans" style={{ color: theme.colors.inkMuted }}>
          © OpenStreetMap contributors
        </TypographyText>
      ) : null}
      {datasource ? (
        <TypographyText family="sans" style={{ color: theme.colors.inkMuted }}>
          {`Fonte: ${datasource}`}
        </TypographyText>
      ) : null}
      {provider === 'geoapify' ? (
        <TypographyText family="sans" style={{ color: theme.colors.inkMuted }}>
          Powered by Geoapify
        </TypographyText>
      ) : null}
      {!hasProviderMetadata ? (
        <TypographyText family="sans" style={{ color: theme.colors.inkMuted }}>
          Lugar cadastrado manualmente · sem fornecedor
        </TypographyText>
      ) : null}
    </View>
  )
}
