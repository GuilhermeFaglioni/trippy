import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, ScrollView, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import type { LiveMember, PlaceDetail, SyncClient } from '@trippy/sync'
import {
  Button,
  Card,
  CircleButton,
  IconButton,
  NoteLine,
  Notice,
  PersonChip,
  PhotoTile,
  StarRating,
  Text,
  TextField,
  TextLink,
  useTheme,
} from '../../design-system'
import { useSession } from '../auth/session-provider'
import { useSync } from '../sync/sync-provider'
import { LocalDetailsEditor } from './local-details-editor'

const NOTE_MAX_LENGTH = 500
const CARD_PADDING = { paddingHorizontal: 14, paddingVertical: 12 } as const

/** Formata a média com vírgula, como o restante do app em pt-BR. */
function formatAverage(value: number): string {
  return value.toFixed(1).replace('.', ',')
}

type Identity = { label: string; slug: string }

export type PlaceDetailScreenProps = {
  tripId: string
  placeId: string
  onBack?: () => void
  onShowAddress?: (placeId: string) => void
  onOpenPhotos?: () => void
}

/**
 * Tela do lugar (referência `08-lugar`): ações, fotos, quem foi, nota, observações e, para quem
 * organiza, a edição de nome e endereço locais.
 * TestIDs Maestro: lugar-voltar, lugar-fui, lugar-favorito, lugar-mostrar-endereco,
 * lugar-fotos-ver-todas, lugar-nota-<n>, lugar-media, lugar-observacao-escrever,
 * lugar-observacao-campo, lugar-observacao-salvar, lugar-observacao-pessoa-<n>, lugar-quem-foi,
 * lugar-visita-voce, lugar-visita-pessoa-<n>, local-name-<id>, local-address-<id>,
 * save-local-details-<id>.
 */
export function PlaceDetailScreen({
  tripId,
  placeId,
  onBack,
  onShowAddress,
  onOpenPhotos,
}: PlaceDetailScreenProps) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const { session } = useSession()
  const { client, ready, error: syncError } = useSync()
  const userId = session?.user.id ?? null
  const [detail, setDetail] = useState<PlaceDetail | null>(null)
  const [members, setMembers] = useState<LiveMember[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [screenError, setScreenError] = useState<string | null>(null)
  const [noteDraft, setNoteDraft] = useState('')
  const [isWriting, setIsWriting] = useState(false)

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
  const iWent = userId !== null && visitorIds.has(userId)

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
    if (note === (detail.myNote ?? '')) {
      setIsWriting(false)
      return
    }
    void write(
      (syncClient) => syncClient.setPlaceNote(tripId, placeId, note.length > 0 ? note : null),
      'Não foi possível salvar sua observação.',
    ).then(() => setIsWriting(false))
  }

  const place = detail?.place ?? null
  const name = place?.name ?? ''
  const localLine = place
    ? [place.userLocalName ?? place.localName, place.userLocalAddress ?? place.localAddress]
        .filter((part): part is string => part != null && part.trim() !== '')
        .join(' · ')
    : ''
  const contextLine = place
    ? [
        place.dayIndex != null ? `Dia ${place.dayIndex + 1}` : null,
        place.suggestedBy === userId
          ? 'sugerido por você'
          : `sugerido por ${identify(place.suggestedBy).label}`,
      ]
        .filter((part) => part !== null)
        .join(' · ')
    : ''
  const visitCount = detail?.visitors.length ?? 0
  const noteCount = (detail?.notes.length ?? 0) + (detail?.myNote ? 1 : 0)

  return (
    <View testID="tela-lugar" style={{ flex: 1, backgroundColor: theme.colors.ground }}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: theme.spacing.space6 }}
        keyboardShouldPersistTaps="handled"
      >
        <View
          style={{
            backgroundColor: theme.colors.photo1,
            height: 200,
            paddingHorizontal: theme.spacing.space5,
            paddingTop: insets.top + theme.spacing.space1,
          }}
        >
          {onBack ? (
            <View style={{ alignSelf: 'flex-start' }}>
              <CircleButton
                icon="chevron-left"
                accessibilityLabel="Voltar"
                onPress={onBack}
                testID="lugar-voltar"
              />
            </View>
          ) : null}
        </View>

        <View
          style={{
            gap: 14,
            paddingHorizontal: theme.spacing.space5,
            paddingTop: theme.spacing.space4,
          }}
        >
          {syncError ? (
            <Notice
              testID="lugar-sync-indisponivel"
              tone="change"
              segments={[{ strong: 'Sincronização local indisponível. ' }, syncError]}
            />
          ) : null}
          {screenError ? (
            <Notice testID="lugar-erro" tone="change" segments={[screenError]} />
          ) : null}

          {!isLoading && detail === null ? (
            <Notice
              testID="lugar-nao-encontrado"
              tone="offline"
              segments={['Este lugar não está disponível neste aparelho.']}
            />
          ) : null}

          {detail !== null && place !== null ? (
            <>
              <View style={{ gap: theme.spacing.space1 }}>
                {contextLine ? (
                  <Text variant="notice" color={theme.colors.inkMuted} testID="lugar-contexto">
                    {contextLine}
                  </Text>
                ) : null}
                <Text
                  variant="titleL"
                  color={theme.colors.ink}
                  accessibilityRole="header"
                  testID="lugar-nome"
                  style={{ fontSize: 28, letterSpacing: -0.6, lineHeight: 31 }}
                >
                  {name || 'Lugar'}
                </Text>
                {localLine ? (
                  <Text variant="bodySm" color={theme.colors.inkMuted} testID="lugar-nome-local">
                    {localLine}
                  </Text>
                ) : null}
              </View>

              <View style={{ alignItems: 'flex-start', flexDirection: 'row', gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Button
                    label="Fui"
                    icon="check"
                    variant="secondary"
                    block
                    pressed={iWent}
                    disabled={isSaving || userId === null}
                    onPress={() => userId !== null && toggleVisit(userId, iWent)}
                    testID="lugar-fui"
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Button
                    label={detail.favoriteByMe ? 'Favorito' : 'Favoritar'}
                    icon="star"
                    variant="secondary"
                    tone="favorite"
                    block
                    pressed={detail.favoriteByMe}
                    disabled={isSaving}
                    onPress={toggleFavorite}
                    testID="lugar-favorito"
                  />
                </View>
                {onShowAddress ? (
                  <IconButton
                    icon="address-card"
                    accessibilityLabel="Mostrar endereço"
                    onPress={() => onShowAddress(placeId)}
                    testID="lugar-mostrar-endereco"
                  />
                ) : null}
              </View>

              <View style={{ gap: theme.spacing.space2 }}>
                <View
                  style={{
                    alignItems: 'center',
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                  }}
                >
                  <Text variant="count" color={theme.colors.inkMuted}>
                    Fotos
                  </Text>
                  {onOpenPhotos ? (
                    <TextLink
                      label="Ver todas"
                      onPress={onOpenPhotos}
                      testID="lugar-fotos-ver-todas"
                    />
                  ) : null}
                </View>
                <View style={{ flexDirection: 'row', gap: 6 }}>
                  <PhotoTile
                    kind="add"
                    accessibilityLabel="Adicionar foto"
                    onPress={onOpenPhotos}
                    testID="lugar-fotos-adicionar"
                  />
                </View>
              </View>

              <Card testID="lugar-quem-foi" style={{ gap: 8, ...CARD_PADDING }}>
                <Text variant="count" color={theme.colors.inkMuted}>
                  {`Quem foi · ${visitCount}`}
                </Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {orderedMembers.map((member) => {
                    const { label, slug } = identify(member.userId)
                    const isMe = member.userId === userId
                    const visited = visitorIds.has(member.userId)
                    const canToggle = (isMe || canManageVisits) && !isSaving
                    if (visited) {
                      return (
                        <PersonChip
                          key={member.userId}
                          label={label}
                          removable={canToggle && member.userId === userId}
                          accessibilityLabel={
                            canToggle ? `${label} foi. Tocar para desmarcar` : `${label} foi`
                          }
                          onPress={canToggle ? () => toggleVisit(member.userId, true) : undefined}
                          testID={`lugar-visita-${slug}`}
                        />
                      )
                    }
                    return canToggle ? (
                      <PersonChip
                        key={member.userId}
                        tone="add"
                        label={isMe ? '+ marcar' : `+ ${label}`}
                        accessibilityLabel={`Marcar ${label} como foi`}
                        onPress={() => toggleVisit(member.userId, false)}
                        testID={`lugar-visita-${slug}`}
                      />
                    ) : null
                  })}
                </View>
                <Text variant="caption" color={theme.colors.inkMuted}>
                  Toque no seu nome para desmarcar.
                </Text>
              </Card>

              <Card
                style={{ gap: theme.spacing.space1, paddingHorizontal: 14, paddingVertical: 8 }}
              >
                <View style={{ alignItems: 'center', flexDirection: 'row', gap: 4 }}>
                  <Text variant="count" color={theme.colors.inkMuted} style={{ flex: 1 }}>
                    Sua avaliação
                  </Text>
                  <StarRating
                    value={detail.myRating ?? 0}
                    disabled={isSaving}
                    onChange={rate}
                    testID="lugar-nota"
                  />
                </View>
                {detail.ratingAverage !== null ? (
                  <Text variant="caption" color={theme.colors.inkMuted} testID="lugar-media">
                    {`média ${formatAverage(detail.ratingAverage)} · ${detail.ratingCount} ${detail.ratingCount === 1 ? 'avaliação' : 'avaliações'}`}
                  </Text>
                ) : null}
              </Card>

              <Card style={{ gap: 10, ...CARD_PADDING }}>
                <View
                  style={{
                    alignItems: 'center',
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                  }}
                >
                  <Text variant="count" color={theme.colors.inkMuted}>
                    {`Observações · ${noteCount}`}
                  </Text>
                  {isWriting ? null : (
                    <TextLink
                      label={detail.myNote ? 'Editar' : 'Escrever'}
                      onPress={() => setIsWriting(true)}
                      compact
                      testID="lugar-observacao-escrever"
                    />
                  )}
                </View>
                {isWriting ? (
                  <View style={{ gap: theme.spacing.space3 }}>
                    <TextField
                      label="Sua observação"
                      value={noteDraft}
                      onChangeText={setNoteDraft}
                      multiline
                      maxLength={NOTE_MAX_LENGTH}
                      testID="lugar-observacao-campo"
                    />
                    <Button
                      label="Salvar observação"
                      variant="secondary"
                      block
                      disabled={isSaving}
                      onPress={saveNote}
                      testID="lugar-observacao-salvar"
                    />
                  </View>
                ) : null}
                <View testID="lugar-observacoes-do-grupo" style={{ gap: 10 }}>
                  {detail.notes.map((note) => {
                    const { label, slug } = identify(note.userId)
                    return (
                      <NoteLine
                        key={note.userId}
                        author={label}
                        text={note.note}
                        testID={`lugar-observacao-${slug}`}
                      />
                    )
                  })}
                  {detail.myNote ? (
                    <NoteLine author="Você" text={detail.myNote} testID="lugar-observacao-voce" />
                  ) : null}
                </View>
              </Card>

              {canManageVisits && client !== null ? (
                <Card>
                  <LocalDetailsEditor
                    place={place}
                    tripId={tripId}
                    client={client}
                    onSaved={load}
                  />
                </Card>
              ) : null}
            </>
          ) : null}
        </View>
      </ScrollView>
    </View>
  )
}
