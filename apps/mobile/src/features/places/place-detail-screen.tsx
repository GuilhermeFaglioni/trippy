import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Platform, ScrollView, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import type { LiveMember, PlaceDetail, SyncClient } from '@trippy/sync'
import { Button, Card, Notice, TextField } from '../../components'
import {
  createTypographyTokens,
  normalizeFontPlatform,
  TypographyText,
  useTheme,
} from '../../design-system'
import { useSession } from '../auth/session-provider'
import { useSync } from '../sync/sync-provider'

const typography = createTypographyTokens(normalizeFontPlatform(Platform.OS))
const RATINGS = [1, 2, 3, 4, 5] as const
const NOTE_MAX_LENGTH = 500

/** Formata a média com vírgula, como o restante do app em pt-BR. */
function formatAverage(value: number): string {
  return value.toFixed(1).replace('.', ',')
}

type Identity = { label: string; slug: string }

export type PlaceDetailScreenProps = {
  tripId: string
  placeId: string
}

/**
 * Tela do lugar: favorito, nota, observação e quem foi.
 * TestIDs Maestro: lugar-favorito, lugar-nota-<n>, lugar-media, lugar-observacao-campo,
 * lugar-observacao-salvar, lugar-observacao-pessoa-<n>, lugar-quem-foi, lugar-visita-voce,
 * lugar-visita-pessoa-<n>.
 */
export function PlaceDetailScreen({ tripId, placeId }: PlaceDetailScreenProps) {
  const theme = useTheme()
  const { session } = useSession()
  const { client, ready, error: syncError } = useSync()
  const userId = session?.user.id ?? null
  const [detail, setDetail] = useState<PlaceDetail | null>(null)
  const [members, setMembers] = useState<LiveMember[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [screenError, setScreenError] = useState<string | null>(null)
  const [noteDraft, setNoteDraft] = useState('')

  const load = useCallback(async () => {
    if (client === null) {
      setDetail(null)
      setMembers([])
      setIsLoading(false)
      return
    }
    setIsLoading(true)
    setScreenError(null)
    try {
      const [nextDetail, nextMembers] = await Promise.all([
        client.getPlaceDetail(tripId, placeId),
        client.listMembers(tripId),
      ])
      setDetail(nextDetail)
      setMembers(nextMembers)
    } catch (loadError) {
      setScreenError(
        loadError instanceof Error
          ? loadError.message
          : 'Não foi possível carregar este lugar neste aparelho.',
      )
    } finally {
      setIsLoading(false)
    }
  }, [client, placeId, tripId])

  useEffect(() => {
    void load()
    if (client === null) return
    return client.subscribe(() => void load())
  }, [client, load])

  // Só reposiciona o rascunho quando a observação salva muda, para não apagar o que a pessoa digita.
  const savedNote = detail?.myNote ?? null
  useEffect(() => {
    setNoteDraft(savedNote ?? '')
  }, [savedNote])

  /** Executa uma escrita e recarrega a tela com o estado local atualizado. */
  const write = useCallback(
    async (action: (syncClient: SyncClient) => Promise<void>, fallback: string) => {
      if (client === null) return
      setIsSaving(true)
      setScreenError(null)
      try {
        await action(client)
        await load()
      } catch (writeError) {
        setScreenError(writeError instanceof Error ? writeError.message : fallback)
      } finally {
        setIsSaving(false)
      }
    },
    [client, load],
  )

  if (!ready || (isLoading && detail === null)) {
    return (
      <View accessibilityRole="progressbar" testID="lugar-carregando" style={{ flex: 1 }}>
        <ActivityIndicator color={theme.colors.forest} />
      </View>
    )
  }

  const others = members.filter((member) => member.userId !== userId)
  const me = members.find((member) => member.userId === userId) ?? null
  const canManageVisits = me?.role === 'organizer' || me?.role === 'coorganizer'
  const orderedMembers = me ? [me, ...others] : others
  const visitorIds = new Set(detail?.visitors.map((visitor) => visitor.userId) ?? [])

  // Não há nomes no sync: a própria pessoa vira "Você" e as outras, "Pessoa N" na ordem da lista.
  const identify = (memberId: string): Identity => {
    if (memberId === userId) return { label: 'Você', slug: 'voce' }
    const index = others.findIndex((member) => member.userId === memberId)
    if (index === -1) return { label: 'Outra pessoa', slug: 'outra-pessoa' }
    return { label: `Pessoa ${index + 1}`, slug: `pessoa-${index + 1}` }
  }

  const toggleVisit = (memberId: string, visited: boolean) => {
    // Sem userId a escrita vale para a pessoa local.
    const target = memberId === userId ? undefined : memberId
    void write(
      (syncClient) =>
        visited
          ? syncClient.unmarkVisit(tripId, placeId, target)
          : syncClient.markVisit(tripId, placeId, target),
      'Não foi possível salvar a presença neste lugar.',
    )
  }

  const toggleFavorite = () => {
    if (detail === null) return
    void write(
      (syncClient) => syncClient.setFavorite(tripId, placeId, !detail.favoriteByMe),
      'Não foi possível salvar o favorito.',
    )
  }

  const rate = (rating: number) => {
    if (detail === null) return
    const next = detail.myRating === rating ? null : rating
    void write(
      (syncClient) => syncClient.ratePlace(tripId, placeId, next),
      'Não foi possível salvar sua nota.',
    )
  }

  const saveNote = () => {
    if (detail === null) return
    const note = noteDraft.trim()
    if (note === (detail.myNote ?? '')) return
    void write(
      (syncClient) => syncClient.setPlaceNote(tripId, placeId, note.length > 0 ? note : null),
      'Não foi possível salvar sua observação.',
    )
  }

  const name = detail
    ? (detail.place.userLocalName ?? detail.place.localName ?? detail.place.name)
    : ''

  return (
    <SafeAreaView testID="tela-lugar" style={{ flex: 1, backgroundColor: theme.colors.ground }}>
      <ScrollView
        contentContainerStyle={{
          gap: theme.spacing.space4,
          padding: theme.spacing.space5,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ gap: theme.spacing.space2 }}>
          <TypographyText family="display" style={[typography.titleL, { color: theme.colors.ink }]}>
            {name || 'Lugar'}
          </TypographyText>
          <TypographyText family="sans" style={{ color: theme.colors.inkMuted }}>
            Detalhes do lugar
          </TypographyText>
        </View>

        {syncError ? (
          <Notice
            testID="lugar-sync-indisponivel"
            tone="warning"
            title="Sincronização local indisponível."
            message={syncError}
          />
        ) : null}
        {screenError ? <Notice testID="lugar-erro" tone="danger" message={screenError} /> : null}

        {!isLoading && detail === null ? (
          <Notice
            testID="lugar-nao-encontrado"
            message="Este lugar não está disponível neste aparelho."
          />
        ) : null}

        {detail !== null ? (
          <>
            <Card>
              <View style={{ gap: theme.spacing.space3 }}>
                <Button
                  label={detail.favoriteByMe ? 'Favorito ✓' : 'Favorito'}
                  variant="secondary"
                  selected={detail.favoriteByMe}
                  disabled={isSaving}
                  onPress={toggleFavorite}
                  testID="lugar-favorito"
                />
                <TypographyText family="sans" style={{ color: theme.colors.inkMuted }}>
                  {`${detail.favoriteCount} ${detail.favoriteCount === 1 ? 'favorito' : 'favoritos'} no grupo`}
                </TypographyText>
              </View>
            </Card>

            <Card>
              <View style={{ gap: theme.spacing.space3 }}>
                <TypographyText
                  family="display"
                  style={[typography.titleS, { color: theme.colors.ink }]}
                >
                  Sua nota
                </TypographyText>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.space2 }}>
                  {RATINGS.map((rating) => (
                    <Button
                      key={rating}
                      label={String(rating)}
                      accessibilityLabel={`Nota ${rating} de 5`}
                      variant="secondary"
                      selected={detail.myRating === rating}
                      disabled={isSaving}
                      onPress={() => rate(rating)}
                      testID={`lugar-nota-${rating}`}
                    />
                  ))}
                </View>
                {detail.ratingAverage !== null ? (
                  <TypographyText
                    family="sans"
                    testID="lugar-media"
                    style={{ color: theme.colors.inkMuted }}
                  >
                    {`média ${formatAverage(detail.ratingAverage)} · ${detail.ratingCount} ${detail.ratingCount === 1 ? 'avaliação' : 'avaliações'}`}
                  </TypographyText>
                ) : null}
              </View>
            </Card>

            <Card>
              <View style={{ gap: theme.spacing.space3 }}>
                <TextField
                  label="Sua observação"
                  value={noteDraft}
                  onChangeText={setNoteDraft}
                  onBlur={saveNote}
                  multiline
                  maxLength={NOTE_MAX_LENGTH}
                  testID="lugar-observacao-campo"
                />
                <Button
                  label="Salvar observação"
                  variant="secondary"
                  disabled={isSaving}
                  onPress={saveNote}
                  testID="lugar-observacao-salvar"
                />
                {detail.notes.length > 0 ? (
                  <View testID="lugar-observacoes-do-grupo" style={{ gap: theme.spacing.space2 }}>
                    <TypographyText family="sans" style={{ color: theme.colors.ink }}>
                      Observações do grupo
                    </TypographyText>
                    {detail.notes.map((note) => {
                      const { label, slug } = identify(note.userId)
                      return (
                        <TypographyText
                          key={note.userId}
                          family="sans"
                          testID={`lugar-observacao-${slug}`}
                          style={{ color: theme.colors.inkMuted }}
                        >
                          {`${label}: ${note.note}`}
                        </TypographyText>
                      )
                    })}
                  </View>
                ) : null}
              </View>
            </Card>

            <Card testID="lugar-quem-foi">
              <View style={{ gap: theme.spacing.space3 }}>
                <TypographyText
                  family="display"
                  style={[typography.titleS, { color: theme.colors.ink }]}
                >
                  Quem foi
                </TypographyText>
                {orderedMembers.map((member) => {
                  const { label, slug } = identify(member.userId)
                  const isMe = member.userId === userId
                  const visited = visitorIds.has(member.userId)
                  const canToggle = isMe || canManageVisits
                  return (
                    <View
                      key={member.userId}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: theme.spacing.space2,
                      }}
                    >
                      <View>
                        <TypographyText family="sans" style={{ color: theme.colors.ink }}>
                          {label}
                        </TypographyText>
                        <TypographyText family="sans" style={{ color: theme.colors.inkMuted }}>
                          {visited ? 'Foi' : 'Não foi'}
                        </TypographyText>
                      </View>
                      {canToggle ? (
                        <Button
                          label={
                            isMe
                              ? visited
                                ? 'Eu fui ✓'
                                : 'Eu fui'
                              : visited
                                ? 'Foi ✓'
                                : 'Marcar como foi'
                          }
                          variant="secondary"
                          selected={visited}
                          disabled={isSaving}
                          onPress={() => toggleVisit(member.userId, visited)}
                          testID={`lugar-visita-${slug}`}
                        />
                      ) : null}
                    </View>
                  )
                })}
              </View>
            </Card>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  )
}
