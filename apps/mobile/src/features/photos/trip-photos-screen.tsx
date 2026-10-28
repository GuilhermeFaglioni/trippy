import { useMemo } from 'react'
import { ActivityIndicator, Image, Platform, ScrollView, View } from 'react-native'
import { useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'

import { Button, Card, Notice } from '../../components'
import {
  createTypographyTokens,
  normalizeFontPlatform,
  TypographyText,
  useTheme,
} from '../../design-system'
import type { QueuedPhoto } from './photo-queue'
import type { RemoteTripPhoto } from './photo-client'
import { useTripPhotos } from './use-trip-photos'

const typography = createTypographyTokens(normalizeFontPlatform(Platform.OS))

export type TripPhotoRow = {
  id: string
  uri: string | null
  locationLabel: string
  statusLabel: string
}

function localStatusLabel(status: QueuedPhoto['status']): string {
  const labels: Record<QueuedPhoto['status'], string> = {
    preparing: 'Preparando',
    queued: 'Na fila',
    uploading: 'Enviando',
    awaiting_confirmation: 'Confirmando',
    complete: 'Enviada',
    failed: 'Falhou · toque para tentar de novo',
  }
  return labels[status]
}

function remoteStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    pending: 'Aguardando envio',
    uploaded: 'Enviada',
    ready: 'Pronta',
  }
  return labels[status] ?? 'Disponível na viagem'
}

export function toTripPhotoRows(
  localPhotos: QueuedPhoto[],
  remotePhotos: RemoteTripPhoto[],
): TripPhotoRow[] {
  const localIds = new Set(localPhotos.map((photo) => photo.photoId))
  const localRows = localPhotos.map((photo) => ({
    id: photo.photoId,
    uri: photo.uploadUri ?? photo.originalUri,
    locationLabel: 'Sem lugar',
    statusLabel: localStatusLabel(photo.status),
  }))
  const remoteRows = remotePhotos
    .filter((photo) => !localIds.has(photo.id))
    .map((photo) => ({
      id: photo.id,
      uri: photo.thumbnailUrl ?? null,
      locationLabel: photo.placeId === null ? 'Sem lugar' : 'Com lugar',
      statusLabel: remoteStatusLabel(photo.status),
    }))

  return [...localRows, ...remoteRows]
}

export type TripPhotosScreenViewProps = {
  tripName: string
  photos: TripPhotoRow[]
  isLoading: boolean
  isAdding: boolean
  isRetrying: boolean
  loadError: string | null
  remoteError: string | null
  actionError: string | null
  onBack(): void
  onAddPhotos(): void
  onRetryUploads(): void
}

function PhotoRow({ photo }: { photo: TripPhotoRow }) {
  const theme = useTheme()

  return (
    <Card testID={`trip-photo-${photo.id}`}>
      <View
        accessible
        accessibilityRole="text"
        accessibilityLabel={`Foto da viagem. ${photo.locationLabel}. ${photo.statusLabel}.`}
        style={{ alignItems: 'center', flexDirection: 'row', gap: theme.spacing.space3 }}
      >
        {photo.uri ? (
          <Image
            accessible={false}
            source={{ uri: photo.uri }}
            style={{
              backgroundColor: theme.colors.photo1,
              borderRadius: theme.radius.radiusSm,
              height: 64,
              width: 64,
            }}
          />
        ) : (
          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={{
              backgroundColor: theme.colors.photo1,
              borderRadius: theme.radius.radiusSm,
              height: 64,
              width: 64,
            }}
          />
        )}
        <View style={{ flex: 1, gap: theme.spacing.space1 }}>
          <TypographyText family="sans" style={{ color: theme.colors.ink }}>
            {photo.locationLabel}
          </TypographyText>
          <TypographyText family="sans" style={{ color: theme.colors.inkMuted }}>
            {photo.statusLabel}
          </TypographyText>
        </View>
      </View>
    </Card>
  )
}

export function TripPhotosScreenView({
  tripName,
  photos,
  isLoading,
  isAdding,
  isRetrying,
  loadError,
  remoteError,
  actionError,
  onBack,
  onAddPhotos,
  onRetryUploads,
}: TripPhotosScreenViewProps) {
  const theme = useTheme()

  return (
    <SafeAreaView
      testID="trip-photos-screen"
      style={{ flex: 1, backgroundColor: theme.colors.ground }}
    >
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          gap: theme.spacing.space4,
          padding: theme.spacing.space5,
        }}
      >
        <Button label="Voltar" variant="secondary" onPress={onBack} testID="trip-photos-back" />
        <TypographyText family="display" style={[typography.titleL, { color: theme.colors.ink }]}>
          {tripName || 'Fotos da viagem'}
        </TypographyText>

        <Card variant="highlight">
          <View style={{ gap: theme.spacing.space2 }}>
            <TypographyText family="sans" style={{ color: theme.colors.onForest }}>
              Fotos da viagem
            </TypographyText>
            <TypographyText family="sans" style={{ color: theme.colors.onForest }}>
              Adicione fotos em lote. Cada foto fica sem lugar até alguém associá-la.
            </TypographyText>
          </View>
        </Card>

        <Button
          label="Adicionar fotos"
          loading={isAdding}
          onPress={onAddPhotos}
          testID="trip-photos-add"
        />
        <Button
          label="Tentar envios novamente"
          variant="secondary"
          loading={isRetrying}
          onPress={onRetryUploads}
          testID="trip-photos-retry"
        />

        {loadError ? (
          <Notice
            tone="danger"
            title="Não foi possível abrir as fotos locais."
            message={loadError}
            testID="trip-photos-load-error"
          />
        ) : null}
        {remoteError ? (
          <Notice
            tone="warning"
            title="Fotos do servidor indisponíveis."
            message="As fotos guardadas neste dispositivo continuam acessíveis. Tente atualizar quando houver conexão."
            testID="trip-photos-remote-error"
          />
        ) : null}
        {actionError ? (
          <Notice
            tone="danger"
            title="Não foi possível adicionar todas as fotos."
            message={actionError}
          />
        ) : null}

        {isLoading ? (
          <View
            testID="trip-photos-loading"
            accessibilityRole="progressbar"
            accessibilityLabel="Carregando fotos da viagem"
            style={{ alignItems: 'center', padding: theme.spacing.space5 }}
          >
            <ActivityIndicator color={theme.colors.forest} />
          </View>
        ) : photos.length === 0 ? (
          <Card testID="trip-photos-empty">
            <Notice
              title="As fotos da viagem aparecem aqui."
              message="Adicione suas fotos. Elas ficam sem lugar enquanto aguardam associação."
            />
          </Card>
        ) : (
          <View style={{ gap: theme.spacing.space3 }}>
            <TypographyText family="sans" style={{ color: theme.colors.inkMuted }}>
              {photos.length === 1 ? '1 foto' : `${photos.length} fotos`}
            </TypographyText>
            {photos.map((photo) => (
              <PhotoRow key={photo.id} photo={photo} />
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

export function TripPhotosScreen({ tripId, tripName }: { tripId: string; tripName: string }) {
  const router = useRouter()
  const state = useTripPhotos(tripId)
  const photos = useMemo(
    () => toTripPhotoRows(state.localPhotos, state.remotePhotos),
    [state.localPhotos, state.remotePhotos],
  )

  return (
    <TripPhotosScreenView
      tripName={tripName}
      photos={photos}
      isLoading={state.isLoading}
      isAdding={state.isAdding}
      isRetrying={state.isRetrying}
      loadError={state.loadError}
      remoteError={state.remoteError}
      actionError={state.actionError}
      onBack={() => router.back()}
      onAddPhotos={() => void state.addPhotos()}
      onRetryUploads={() => void state.retryUploads()}
    />
  )
}
