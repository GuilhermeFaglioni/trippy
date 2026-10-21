import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Platform, ScrollView, Share, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'

import { canRemovePlace } from '@trippy/domain'
import type { LivePlace, SyncClientStatus } from '@trippy/sync'
import { Button, Card, Notice } from '../../components'
import {
  createTypographyTokens,
  normalizeFontPlatform,
  TypographyText,
  useTheme,
} from '../../design-system'
import { useSession } from '../auth/session-provider'
import { createInviteClient, getInviteErrorMessage } from '../invites/invite-client'
import { useSync } from '../sync/sync-provider'
import type { TripRole } from '../trips/trips-client'
import { PlaceCard } from './place-card'

const typography = createTypographyTokens(normalizeFontPlatform(Platform.OS))

type TripPlacesScreenProps = {
  tripId: string
  tripName: string
  role: TripRole
}

function toTestSlug(value: string): string {
  const slug = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  return slug || 'sem-nome'
}

function createTestIdByPlace(places: LivePlace[]): Map<string, string> {
  const counts = new Map<string, number>()
  return new Map(
    places.map((place) => {
      const slug = toTestSlug(place.name)
      const occurrence = (counts.get(slug) ?? 0) + 1
      counts.set(slug, occurrence)
      return [place.id, occurrence === 1 ? slug : `${slug}-${occurrence}`]
    }),
  )
}

function syncTime(lastSyncedAt: string | null): string {
  if (lastSyncedAt === null) return 'Ainda não sincronizado'
  const timestamp = new Date(lastSyncedAt)
  if (Number.isNaN(timestamp.getTime())) return 'Ainda não sincronizado'
  return `Sincronizado às ${timestamp.toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })}`
}

function SyncFooter({ status }: { status: SyncClientStatus }) {
  const theme = useTheme()
  const lastError =
    'lastError' in status && typeof status.lastError === 'string' ? status.lastError : null
  return (
    <View testID="trip-sync-status" style={{ gap: theme.spacing.space2 }}>
      <TypographyText family="sans" style={{ color: theme.colors.inkMuted }}>
        {syncTime(status.lastSyncedAt)}
      </TypographyText>
      <TypographyText family="sans" style={{ color: theme.colors.inkMuted }}>
        {`${status.pending} pendentes`}
      </TypographyText>
      {status.notSent > 0 ? (
        <Notice
          testID="trip-sync-not-sent"
          tone="warning"
          message={`${status.notSent} operações não enviadas.`}
        />
      ) : null}
      {lastError ? (
        <Notice
          testID="trip-sync-error"
          tone="warning"
          message={`Os dados continuam neste aparelho. ${lastError}`}
        />
      ) : null}
    </View>
  )
}

export function TripPlacesScreen({ tripId, tripName, role }: TripPlacesScreenProps) {
  const theme = useTheme()
  const router = useRouter()
  const { session, request } = useSession()
  const { client, status, ready, error: syncError } = useSync()
  const inviteClient = useMemo(() => createInviteClient(request), [request])
  const [places, setPlaces] = useState<LivePlace[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [busyPlaceId, setBusyPlaceId] = useState<string | null>(null)
  const [isCreatingInvite, setIsCreatingInvite] = useState(false)
  const [screenError, setScreenError] = useState<string | null>(null)
  const [inviteCode, setInviteCode] = useState<string | null>(null)
  const [inviteError, setInviteError] = useState<string | null>(null)
  const testIds = useMemo(() => createTestIdByPlace(places), [places])

  const loadPlaces = useCallback(async () => {
    if (client === null || !tripId) {
      setIsLoading(false)
      setPlaces([])
      return
    }

    setIsLoading(true)
    setScreenError(null)
    try {
      setPlaces(await client.listPlaces(tripId))
    } catch (loadError) {
      setScreenError(
        loadError instanceof Error
          ? loadError.message
          : 'Não foi possível carregar os lugares salvos neste aparelho.',
      )
    } finally {
      setIsLoading(false)
    }
  }, [client, tripId])

  useEffect(() => {
    void loadPlaces()
    if (client === null) return
    return client.subscribe(() => void loadPlaces())
  }, [client, loadPlaces])

  const toggleVisit = useCallback(
    async (place: LivePlace) => {
      if (client === null) return
      setBusyPlaceId(place.id)
      setScreenError(null)
      try {
        if (place.visitedByMe) await client.unmarkVisit(tripId, place.id)
        else await client.markVisit(tripId, place.id)
        await loadPlaces()
      } catch (writeError) {
        setScreenError(
          writeError instanceof Error
            ? writeError.message
            : 'Não foi possível salvar sua presença neste lugar.',
        )
      } finally {
        setBusyPlaceId(null)
      }
    },
    [client, loadPlaces, tripId],
  )

  const removePlace = useCallback(
    async (placeId: string) => {
      if (client === null) return
      setBusyPlaceId(placeId)
      setScreenError(null)
      try {
        await client.removePlace(tripId, placeId)
        await loadPlaces()
      } catch (writeError) {
        setScreenError(
          writeError instanceof Error ? writeError.message : 'Não foi possível remover o lugar.',
        )
      } finally {
        setBusyPlaceId(null)
      }
    },
    [client, loadPlaces, tripId],
  )

  const createInvite = useCallback(async () => {
    setInviteError(null)
    setIsCreatingInvite(true)
    try {
      setInviteCode(await inviteClient.create(tripId))
    } catch (createError) {
      setInviteError(getInviteErrorMessage(createError))
    } finally {
      setIsCreatingInvite(false)
    }
  }, [inviteClient, tripId])

  const shareInvite = useCallback(async () => {
    if (inviteCode === null) return
    await Share.share({ message: `Entre em ${tripName} com este código: ${inviteCode}` })
  }, [inviteCode, tripName])

  const canInvite = role === 'organizer' || role === 'coorganizer'

  return (
    <SafeAreaView
      testID="trip-detail-screen"
      style={{ flex: 1, backgroundColor: theme.colors.ground }}
    >
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          gap: theme.spacing.space4,
          padding: theme.spacing.space5,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ gap: theme.spacing.space2 }}>
          <TypographyText family="display" style={[typography.titleL, { color: theme.colors.ink }]}>
            {tripName || 'Viagem'}
          </TypographyText>
          <TypographyText family="sans" style={{ color: theme.colors.inkMuted }}>
            Lugares
          </TypographyText>
        </View>

        {!ready ? (
          <View accessibilityRole="progressbar" testID="trip-sync-loading">
            <ActivityIndicator color={theme.colors.forest} />
          </View>
        ) : null}
        {syncError ? (
          <Notice
            testID="trip-sync-unavailable"
            tone="warning"
            title="Sincronização local indisponível."
            message={syncError}
          />
        ) : null}
        {screenError ? (
          <Notice testID="trip-places-error" tone="danger" message={screenError} />
        ) : null}

        <Card testID="add-place-card">
          <Button
            label="Adicionar lugar"
            onPress={() =>
              router.push({
                pathname: '/trips/[id]/add-place',
                params: { id: tripId, tripName, role },
              })
            }
            disabled={client === null}
            testID="add-place-button"
          />
        </Card>

        {isLoading ? (
          <View accessibilityRole="progressbar" testID="trip-places-loading">
            <ActivityIndicator color={theme.colors.forest} />
          </View>
        ) : places.length === 0 ? (
          <Notice testID="places-empty" message="Adicione o primeiro lugar ou convide o grupo." />
        ) : (
          <View style={{ gap: theme.spacing.space3 }}>
            {places.map((place) => {
              const canRemove =
                session !== null &&
                canRemovePlace({ role, userId: session.user.id, suggestedBy: place.suggestedBy })
              const testSlug = testIds.get(place.id) ?? toTestSlug(place.name)
              if (client === null) return null
              return (
                <PlaceCard
                  key={place.id}
                  place={place}
                  tripId={tripId}
                  currentUserId={session?.user.id ?? null}
                  role={role}
                  syncClient={client}
                  testSlug={testSlug}
                  busy={busyPlaceId === place.id}
                  onToggleVisit={() => void toggleVisit(place)}
                  onRemove={canRemove ? () => void removePlace(place.id) : undefined}
                  onRefresh={loadPlaces}
                />
              )
            })}
          </View>
        )}

        {canInvite ? (
          <Card testID="trip-invite-card">
            <View style={{ gap: theme.spacing.space3 }}>
              <Button
                label="Convidar pessoas"
                onPress={() => void createInvite()}
                loading={isCreatingInvite}
                testID="create-trip-invite"
              />
              {inviteError ? (
                <Notice testID="trip-invite-error" tone="danger" message={inviteError} />
              ) : null}
              {inviteCode ? (
                <View style={{ gap: theme.spacing.space2 }}>
                  <TypographyText family="sans" style={{ color: theme.colors.inkMuted }}>
                    Código do convite
                  </TypographyText>
                  <View testID="invite-code">
                    <TypographyText
                      family="sans"
                      selectable
                      testID="invite-code-value"
                      style={[typography.titleM, { color: theme.colors.ink }]}
                    >
                      {inviteCode}
                    </TypographyText>
                  </View>
                  <TypographyText family="sans" style={{ color: theme.colors.inkMuted }}>
                    Toque e segure o código para copiar ou compartilhe com o grupo.
                  </TypographyText>
                  <Button
                    label="Compartilhar código"
                    onPress={() => void shareInvite()}
                    variant="secondary"
                    testID="share-trip-invite"
                  />
                </View>
              ) : null}
            </View>
          </Card>
        ) : null}

        <SyncFooter status={status} />
      </ScrollView>
    </SafeAreaView>
  )
}
