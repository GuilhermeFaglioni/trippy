import { useCallback, useEffect, useMemo, useState } from 'react'
import { Platform, Share, View } from 'react-native'

import { readyToTravel } from '@trippy/domain'
import type { LiveMember, LivePlace } from '@trippy/sync'
import { Button, Card, Notice } from '../../components'
import {
  createTypographyTokens,
  normalizeFontPlatform,
  TypographyText,
  useTheme,
} from '../../design-system'
import { createInviteClient, getInviteErrorMessage } from '../invites/invite-client'
import { getApiBaseUrl } from '../diagnostics/health-client'
import { useSession } from '../auth/session-provider'
import { useSync } from '../sync/sync-provider'
import type { TripSummary } from './trips-client'

/** TestIDs Maestro: pronto-viajar-card, pronto-viajar-avisar. */
const typography = createTypographyTokens(normalizeFontPlatform(Platform.OS))

type ReadyToTravelCardProps = {
  tripId: string
  tripName: string
  trip: TripSummary
}

export function ReadyToTravelCard({ tripId, tripName, trip }: ReadyToTravelCardProps) {
  const theme = useTheme()
  const { request } = useSession()
  const { client } = useSync()
  const inviteClient = useMemo(() => createInviteClient(request), [request])
  const [places, setPlaces] = useState<LivePlace[]>([])
  const [members, setMembers] = useState<LiveMember[]>([])
  const [isInviting, setIsInviting] = useState(false)
  const [inviteError, setInviteError] = useState<string | null>(null)

  const loadSummary = useCallback(async () => {
    if (client === null || !tripId) {
      setPlaces([])
      setMembers([])
      return
    }
    try {
      const [nextPlaces, nextMembers] = await Promise.all([
        client.listPlaces(tripId),
        client.listMembers(tripId),
      ])
      setPlaces(nextPlaces)
      setMembers(nextMembers)
    } catch {
      setPlaces([])
      setMembers([])
    }
  }, [client, tripId])

  useEffect(() => {
    void loadSummary()
    if (client === null) return
    return client.subscribe(() => void loadSummary())
  }, [client, loadSummary])

  const summary = readyToTravel({
    phase: trip.phase,
    startDate: trip.startDate,
    timezone: trip.timezone,
    now: new Date(),
    destination: trip.destination,
    places,
    members,
  })

  const avisar = useCallback(async () => {
    setInviteError(null)
    setIsInviting(true)
    try {
      const token = await inviteClient.create(tripId)
      const baseUrl = getApiBaseUrl().replace(/\/+$/u, '')
      await Share.share({
        message: `Abra a viagem ${tripName} no Trippy: ${baseUrl}/i/${token}`,
      })
    } catch (error) {
      setInviteError(getInviteErrorMessage(error))
    } finally {
      setIsInviting(false)
    }
  }, [inviteClient, tripId, tripName])

  if (!summary.visible) return null

  const membersNotOpened = summary.membersNotOpened.length

  return (
    <Card testID="pronto-viajar-card">
      <View style={{ gap: theme.spacing.space3 }}>
        <TypographyText family="display" style={[typography.titleM, { color: theme.colors.ink }]}>
          Pronto para viajar
        </TypographyText>

        {summary.placesWithoutLocalAddress > 0 ? (
          <TypographyText family="sans" style={{ color: theme.colors.ink }}>
            {summary.placesWithoutLocalAddress === 1
              ? '1 lugar sem endereço no idioma local'
              : `${summary.placesWithoutLocalAddress} lugares sem endereço no idioma local`}
          </TypographyText>
        ) : null}

        {summary.recommendRegisterBeforeBoarding ? (
          <Notice
            testID="pronto-viajar-china"
            tone="warning"
            message="Cadastre os endereços locais antes de embarcar: na China o mapa e a busca podem falhar."
          />
        ) : null}

        <TypographyText family="sans" style={{ color: theme.colors.inkMuted }}>
          {`${summary.membersOpened} de ${summary.membersTotal} pessoas já abriram a viagem`}
        </TypographyText>

        {membersNotOpened > 0 ? (
          <Button
            label="Avisar"
            variant="secondary"
            loading={isInviting}
            disabled={isInviting}
            onPress={() => void avisar()}
            testID="pronto-viajar-avisar"
          />
        ) : null}

        {inviteError ? (
          <Notice testID="pronto-viajar-erro" tone="danger" message={inviteError} />
        ) : null}
      </View>
    </Card>
  )
}
