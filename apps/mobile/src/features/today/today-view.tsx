import { ScrollView, View } from 'react-native'

import {
  Button,
  Card,
  Eyebrow,
  HighlightCard,
  Notice,
  PlaceRow,
  Text,
  useTheme,
  type NoticeSegment,
} from '../../design-system'

export type TodayRow = {
  id: string
  slug: string
  number: number
  name: string
  visited: boolean
  favorite: boolean
}

export type TodayNextPlace = {
  id: string
  name: string
  /** "豫园 · 安仁街218号": nome e endereço locais, quando houver. */
  localLine: string | null
}

export type TodayViewProps = {
  /** Aviso offline/atrasado; `null` quando está tudo em dia. */
  offlineNotice: readonly NoticeSegment[] | null
  error: string | null
  title: string
  /** `during`: dia da viagem; nas outras fases só o título e o aviso aparecem. */
  phase: 'before' | 'during' | 'after'
  rows: readonly TodayRow[]
  next: TodayNextPlace | null
  /** Todos os lugares do dia marcados: troca o destaque por "Dia completo". */
  allVisited: boolean
  tomorrow: string | null
  changes: readonly (readonly NoticeSegment[])[]
  busyPlaceId: string | null
  onToggleVisit: (placeId: string) => void
  onToggleFavorite: (placeId: string) => void
  onPhoto: () => void
  onShowAddress?: (placeId: string) => void
  onHere: () => void
}

export function TodayView({
  offlineNotice,
  error,
  title,
  phase,
  rows,
  next,
  allVisited,
  tomorrow,
  changes,
  busyPlaceId,
  onToggleVisit,
  onToggleFavorite,
  onPhoto,
  onShowAddress,
  onHere,
}: TodayViewProps) {
  const { colors, spacing } = useTheme()
  const during = phase === 'during'

  return (
    <ScrollView
      testID="tela-hoje"
      contentContainerStyle={{
        flexGrow: 1,
        gap: spacing.space3,
        paddingBottom: spacing.space5,
        paddingHorizontal: spacing.space5,
      }}
      keyboardShouldPersistTaps="handled"
    >
      {offlineNotice ? (
        <Notice testID="hoje-banner-desatualizacao" tone="offline" segments={offlineNotice} />
      ) : null}
      {error ? (
        <Notice testID="hoje-erro" tone="change" segments={[{ strong: 'Erro: ' }, error]} />
      ) : null}

      <Text variant="titleL" color={colors.ink} accessibilityRole="header" testID="hoje-dia">
        {title}
      </Text>

      {during && allVisited ? (
        <HighlightCard testID="hoje-dia-completo" style={{ padding: spacing.space5 }}>
          <Eyebrow onHighlight>Dia completo</Eyebrow>
          <Text variant="titleM" color={colors.onForest}>
            {`Você marcou os ${rows.length} lugares de hoje`}
          </Text>
          {tomorrow ? (
            <Text variant="bodySm" color={colors.onForest} style={{ opacity: 0.8 }}>
              {tomorrow}
            </Text>
          ) : null}
        </HighlightCard>
      ) : null}

      {during && !allVisited && next ? (
        <HighlightCard>
          <Eyebrow onHighlight>Próximo lugar</Eyebrow>
          <Text variant="titleM" color={colors.onForest} testID="hoje-proximo-lugar">
            {next.name}
          </Text>
          {next.localLine ? (
            <Text variant="bodySm" color={colors.onForest} style={{ opacity: 0.8 }}>
              {next.localLine}
            </Text>
          ) : null}
          {onShowAddress ? (
            <Button
              label="Mostrar endereço"
              variant="inverse"
              onPress={() => onShowAddress(next.id)}
              testID="hoje-mostrar-endereco"
            />
          ) : null}
        </HighlightCard>
      ) : null}

      {during && rows.length === 0 ? (
        <Card testID="hoje-sem-lugares">
          <Text variant="body" color={colors.inkMuted}>
            Nenhum lugar no roteiro de hoje
          </Text>
        </Card>
      ) : null}

      {!allVisited
        ? changes.map((segments, index) => (
            <Notice
              key={index}
              testID={index === 0 ? 'hoje-o-que-mudou' : `hoje-o-que-mudou-${index}`}
              tone="change"
              segments={segments}
            />
          ))
        : null}

      {during ? (
        <View style={{ gap: spacing.space2 }}>
          {rows.map((row) => (
            <PlaceRow
              key={row.id}
              testID={`hoje-lugar-${row.slug}`}
              number={row.number}
              name={row.name}
              done={row.visited}
              {...(allVisited
                ? { trailingLabel: 'Fui' }
                : {
                    actions: {
                      visited: row.visited,
                      favorite: row.favorite,
                      onToggleVisited: () => busyPlaceId === null && onToggleVisit(row.id),
                      onToggleFavorite: () => busyPlaceId === null && onToggleFavorite(row.id),
                      onPhoto,
                    },
                  })}
            />
          ))}
        </View>
      ) : null}

      {during ? <View style={{ flex: 1 }} /> : null}

      {during && allVisited ? (
        <Button label="Mandar as fotos de hoje" onPress={onPhoto} testID="hoje-mandar-fotos" />
      ) : null}
      {during ? (
        <Button
          label="Estamos aqui (fora do roteiro)"
          variant="secondary"
          block
          onPress={onHere}
          testID="hoje-estamos-aqui"
        />
      ) : null}
    </ScrollView>
  )
}
