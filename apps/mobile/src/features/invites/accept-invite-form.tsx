import { useMemo, useState } from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'

import { Button, Card, Notice, TextField } from '../../components'
import { TypographyText, useTheme } from '../../design-system'
import { useSession } from '../auth/session-provider'
import { useSync } from '../sync/sync-provider'
import { createInviteClient, getInviteErrorMessage } from './invite-client'

export function AcceptInviteForm() {
  const theme = useTheme()
  const router = useRouter()
  const { request } = useSession()
  const { client, rememberTripId } = useSync()
  const inviteClient = useMemo(() => createInviteClient(request), [request])
  const [token, setToken] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showTerms, setShowTerms] = useState(false)

  const accept = async () => {
    setError(null)
    setIsSubmitting(true)
    try {
      const trip = await inviteClient.accept(token)
      rememberTripId(trip.id)
      if (client !== null) {
        try {
          await client.syncNow()
        } catch {
          // A adesão foi confirmada pela API; a sincronização tenta novamente depois.
        }
      }
      router.push({
        pathname: '/trips/[id]',
        params: { id: trip.id, tripName: trip.name, role: trip.role },
      })
    } catch (acceptError) {
      setError(getInviteErrorMessage(acceptError))
    } finally {
      setIsSubmitting(false)
    }
  }

  const decline = () => {
    setShowTerms(false)
    setError(null)
    setToken('')
  }

  return (
    <Card testID="accept-invite-card">
      <View style={{ gap: theme.spacing.space3 }}>
        <TypographyText family="display" style={{ color: theme.colors.ink, fontSize: 20 }}>
          Entrar com convite
        </TypographyText>
        <TextField
          label="Código do convite"
          value={token}
          onChangeText={setToken}
          placeholder="Cole o código recebido"
          autoCapitalize="none"
          autoCorrect={false}
          disabled={isSubmitting}
          testID="accept-invite-code"
        />
        {error ? <Notice tone="danger" message={error} testID="accept-invite-error" /> : null}
        {showTerms ? (
          <View style={{ gap: theme.spacing.space3 }}>
            <Notice
              title="Antes de entrar"
              message="Ao participar desta viagem, você autoriza o Trippy a incluir suas fotos no vídeo recap do grupo e a compartilhá-lo, inclusive fora do app."
              testID="accept-invite-terms"
            />
            <Button
              label="Aceitar e entrar"
              onPress={() => void accept()}
              loading={isSubmitting}
              disabled={isSubmitting}
              testID="accept-invite-terms-accept"
            />
            <Button
              label="Recusar"
              variant="secondary"
              onPress={decline}
              disabled={isSubmitting}
              testID="accept-invite-terms-decline"
            />
          </View>
        ) : (
          <Button
            label="Entrar com convite"
            onPress={() => {
              setError(null)
              setShowTerms(true)
            }}
            disabled={!token.trim()}
            testID="accept-invite-button"
          />
        )}
      </View>
    </Card>
  )
}
