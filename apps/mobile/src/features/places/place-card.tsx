import { Platform, View } from 'react-native'

import { canConfirmGooglePlace } from '@trippy/domain'
import type { LivePlace, SyncClient } from '@trippy/sync'
import { Button, Card } from '../../components'
import {
  createTypographyTokens,
  normalizeFontPlatform,
  TypographyText,
  useTheme,
} from '../../design-system'
import { usePlacesClient } from './places-client'
import { PlaceAttribution } from './place-attribution'
import { LocalDetailsEditor } from './local-details-editor'
import { GoogleDetailsPanel } from './google-details-panel'

const typography = createTypographyTokens(normalizeFontPlatform(Platform.OS))

export function PlaceCard({
  place,
  tripId,
  currentUserId,
  role,
  syncClient,
  busy,
  onToggleVisit,
  onToggleWant,
  onRemove,
  onRefresh,
  testSlug,
}: {
  place: LivePlace
  tripId: string
  currentUserId: string | null
  role: 'organizer' | 'coorganizer' | 'member'
  syncClient: SyncClient
  busy: boolean
  onToggleVisit: () => void
  onToggleWant: () => void
  onRemove?: () => void
  onRefresh: () => Promise<void>
  testSlug: string
}) {
  const theme = useTheme()
  const placesClient = usePlacesClient()
  const canConfirm =
    currentUserId !== null &&
    canConfirmGooglePlace({ role, userId: currentUserId, suggestedBy: place.suggestedBy })
  const localName = place.userLocalName ?? place.localName
  const localAddress = place.userLocalAddress ?? place.localAddress

  return (
    <Card testID={`place-${testSlug}`}>
      <View style={{ gap: theme.spacing.space3 }}>
        <TypographyText family="display" style={[typography.titleM, { color: theme.colors.ink }]}>
          {place.name}
        </TypographyText>
        {localName && localName !== place.name ? (
          <TypographyText
            family="local"
            style={[typography.titleS, { color: theme.colors.inkMuted }]}
            testID={`place-local-name-${testSlug}`}
          >
            {localName}
          </TypographyText>
        ) : null}
        {localAddress ? (
          <TypographyText
            family="local"
            style={[typography.bodySm, { color: theme.colors.inkMuted }]}
            testID={`place-local-address-${testSlug}`}
          >
            {localAddress}
          </TypographyText>
        ) : null}
        <PlaceAttribution
          provider={place.provider}
          datasource={place.providerDatasource}
          attribution={place.attribution}
          testID={`place-attribution-${testSlug}`}
        />
        {place.googleMatch === 'matched' ? (
          <TypographyText
            family="sans"
            style={{ color: theme.colors.forest }}
            testID={`google-match-${testSlug}`}
          >
            Correspondência do Google confirmada
          </TypographyText>
        ) : place.googleMatch === 'no_match' ? (
          <TypographyText
            family="sans"
            style={{ color: theme.colors.inkMuted }}
            testID={`google-match-${testSlug}`}
          >
            Sem correspondência no Google
          </TypographyText>
        ) : null}
        <View style={{ flexDirection: 'row', gap: theme.spacing.space2 }}>
          <Button
            label={place.visitedByMe ? 'Eu fui ✓' : 'Eu fui'}
            onPress={onToggleVisit}
            variant="secondary"
            selected={place.visitedByMe}
            disabled={busy}
            testID={`place-visit-${testSlug}`}
          />
          <Button
            label={`${place.wantedByMe ? 'Quero ir ✓' : 'Quero ir'} · ${place.wantCount}`}
            onPress={onToggleWant}
            variant="secondary"
            selected={place.wantedByMe}
            disabled={busy}
            testID={`place-want-${testSlug}`}
          />
          {onRemove ? (
            <Button
              label="Remover lugar"
              onPress={onRemove}
              variant="secondary"
              disabled={busy}
              testID={`place-remove-${testSlug}`}
            />
          ) : null}
        </View>
        <LocalDetailsEditor place={place} tripId={tripId} client={syncClient} onSaved={onRefresh} />
        <GoogleDetailsPanel
          place={place}
          tripId={tripId}
          syncClient={syncClient}
          placesClient={placesClient}
          canConfirm={canConfirm}
          onConfirmed={onRefresh}
        />
      </View>
    </Card>
  )
}
