import { useCallback, useEffect, useMemo, useState } from 'react'
import { Share } from 'react-native'

import { readyToTravel } from '@trippy/domain'
import type { LiveMember, LivePlace } from '@trippy/sync'
import { useTheme } from '../../design-system'
import { HighlightCard, Text, TextLink } from '../../design-system/components'
import { createInviteClient, getInviteErrorMessage } from '../invites/invite-client'
import { getApiBaseUrl } from '../diagnostics/health-client'
import { useSession } from '../auth/session-provider'
import { useSync } from '../sync/sync-provider'
import type { TripSummary } from './trips-client'

/** TestIDs Maestro: pronto-viajar-card, pronto-viajar-avisar. */

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
    if (isInviting) return
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
  }, [inviteClient, isInviting, tripId, tripName])

  if (!summary.visible) return null

  const membersNotOpened = summary.membersNotOpened.length
  const days = summary.daysUntilStart
  const title =
    days === 0
      ? 'Pronto para viajar? A viagem começa hoje'
      : days === 1
        ? 'Pronto para viajar? Falta 1 dia'
        : `Pronto para viajar? Faltam ${days} dias`
  const language = summary.recommendRegisterBeforeBoarding ? 'em chinês' : 'no idioma local'
  const details = [
    summary.placesWithoutLocalAddress > 0
      ? `${summary.placesWithoutLocalAddress} ${
          summary.placesWithoutLocalAddress === 1 ? 'lugar sem endereço' : 'lugares sem endereço'
        } ${language}`
      : null,
    `${summary.membersOpened} de ${summary.membersTotal} pessoas já abriram a viagem no celular`,
  ]
    .filter((part) => part !== null)
    .join(' · ')

  return (
    <HighlightCard
      testID="pronto-viajar-card"
      style={{
        borderRadius: theme.radius.radiusLg,
        gap: 6,
        paddingHorizontal: 16,
        paddingVertical: 14,
      }}
    >
      <Text variant="placeName" color={theme.colors.onForest} accessibilityRole="header">
        {title}
      </Text>
      <Text
        variant="notice"
        color={theme.colors.onForest}
        style={{ lineHeight: 19, opacity: 0.85 }}
      >
        {details}
      </Text>
      {membersNotOpened > 0 ? (
        <>
          <TextLink
            label="Lembrar quem falta pelo WhatsApp"
            tone="onHighlight"
            onPress={() => void avisar()}
            testID="pronto-viajar-avisar"
          />
          <Text
            variant="notice"
            color={theme.colors.onForest}
            style={{ fontSize: 12, lineHeight: 16, opacity: 0.85 }}
          >
            Abre o WhatsApp com o link da viagem. Notificação do app não chega a quem ainda não
            abriu a viagem.
          </Text>
        </>
      ) : null}
      {inviteError ? (
        <Text
          testID="pronto-viajar-erro"
          variant="notice"
          color={theme.colors.mustard}
          accessibilityRole="alert"
        >
          {inviteError}
        </Text>
      ) : null}
    </HighlightCard>
  )
}
