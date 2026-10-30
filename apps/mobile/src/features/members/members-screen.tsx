import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Platform, ScrollView, View } from 'react-native'

import { canRemoveMember, canSetMemberRole } from '@trippy/domain'
import type { LiveMember } from '@trippy/sync'
import { Button, Card, Notice } from '../../components'
import {
  createTypographyTokens,
  normalizeFontPlatform,
  TypographyText,
  useTheme,
} from '../../design-system'
import { useSession } from '../auth/session-provider'
import { useSync } from '../sync/sync-provider'

/** TestIDs Maestro: grupo-membro-<userId>-papel, grupo-membro-<userId>-promover/-rebaixar/-remover. */
const typography = createTypographyTokens(normalizeFontPlatform(Platform.OS))

type MembersScreenProps = {
  tripId: string
  /** O título "Grupo · N" fica no cabeçalho da viagem. */
  onMemberCount?: (count: number) => void
  /** Ajustes da viagem (datas, encerrar), só para o organizador. */
  onOpenSettings?: () => void
}

const ROLE_LABELS: Record<LiveMember['role'], string> = {
  organizer: 'Organizador',
  coorganizer: 'Coorganizador',
  member: 'Membro',
}

function memberName(member: LiveMember, currentUserId: string | undefined): string {
  if (member.userId === currentUserId) return 'Você'
  return `Participante ${member.userId.slice(-6)}`
}

export function MembersScreen({ tripId, onMemberCount, onOpenSettings }: MembersScreenProps) {
  const theme = useTheme()
  const { session } = useSession()
  const { client } = useSync()
  const [members, setMembers] = useState<LiveMember[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [busyUserId, setBusyUserId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const actor = members.find((member) => member.userId === session?.user.id)

  const loadMembers = useCallback(
    async (showLoading = false) => {
      if (client === null || !tripId) {
        setMembers([])
        setIsLoading(false)
        return
      }
      if (showLoading) setIsLoading(true)
      setError(null)
      try {
        setMembers(await client.listMembers(tripId))
      } catch (loadError) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : 'Não foi possível carregar os membros salvos neste aparelho.',
        )
      } finally {
        if (showLoading) setIsLoading(false)
      }
    },
    [client, tripId],
  )

  useEffect(() => {
    onMemberCount?.(members.length)
  }, [members.length, onMemberCount])

  useEffect(() => {
    void loadMembers(true)
    if (client === null) return
    return client.subscribe(() => void loadMembers())
  }, [client, loadMembers])

  const runMemberMutation = useCallback(
    async (
      member: LiveMember,
      mutation: (syncClient: NonNullable<typeof client>) => Promise<unknown>,
      fallbackMessage: string,
    ) => {
      if (client === null) return
      setBusyUserId(member.userId)
      setError(null)
      try {
        await mutation(client)
        await loadMembers()
      } catch (writeError) {
        setError(writeError instanceof Error ? writeError.message : fallbackMessage)
      } finally {
        setBusyUserId(null)
      }
    },
    [client, loadMembers],
  )

  const setRole = useCallback(
    (member: LiveMember, role: 'coorganizer' | 'member') =>
      runMemberMutation(
        member,
        (syncClient) => syncClient.setMemberRole(tripId, member.userId, role),
        'Não foi possível alterar o papel.',
      ),
    [runMemberMutation, tripId],
  )

  const remove = useCallback(
    (member: LiveMember) =>
      runMemberMutation(
        member,
        (syncClient) => syncClient.removeMember(tripId, member.userId),
        'Não foi possível remover a pessoa do grupo.',
      ),
    [runMemberMutation, tripId],
  )

  return (
    <ScrollView
      testID="tela-grupo"
      contentContainerStyle={{ gap: theme.spacing.space4, padding: theme.spacing.space5 }}
    >
      {error ? <Notice testID="grupo-erro" tone="danger" message={error} /> : null}
      {isLoading ? (
        <View
          accessibilityRole="progressbar"
          testID="grupo-carregando"
          style={{ alignItems: 'center' }}
        >
          <ActivityIndicator color={theme.colors.forest} />
        </View>
      ) : members.length === 0 ? (
        <Notice
          testID="grupo-vazio"
          message="As pessoas da viagem aparecem aqui quando a sincronização local terminar."
        />
      ) : (
        members.map((member) => {
          const target = { userId: member.userId, role: member.role }
          const canChangeRole = actor !== undefined && canSetMemberRole(actor, target)
          const canRemove = actor !== undefined && canRemoveMember(actor, target)
          const busy = busyUserId === member.userId
          return (
            <Card key={member.userId} testID={`grupo-membro-${member.userId}`}>
              <View style={{ gap: theme.spacing.space3 }}>
                <View style={{ gap: theme.spacing.space1 }}>
                  <TypographyText
                    family="display"
                    style={[typography.titleM, { color: theme.colors.ink }]}
                  >
                    {memberName(member, session?.user.id)}
                  </TypographyText>
                  <TypographyText
                    family="sans"
                    testID={`grupo-membro-${member.userId}-papel`}
                    style={{ color: theme.colors.forestInk }}
                  >
                    {ROLE_LABELS[member.role]}
                  </TypographyText>
                </View>

                {canChangeRole || canRemove ? (
                  <View style={{ gap: theme.spacing.space2 }}>
                    {canChangeRole ? (
                      <Button
                        label={
                          member.role === 'coorganizer' ? 'Voltar a membro' : 'Tornar coorganizador'
                        }
                        variant="secondary"
                        disabled={busy}
                        onPress={() =>
                          void setRole(
                            member,
                            member.role === 'coorganizer' ? 'member' : 'coorganizer',
                          )
                        }
                        testID={`grupo-membro-${member.userId}-${member.role === 'coorganizer' ? 'rebaixar' : 'promover'}`}
                      />
                    ) : null}
                    {canRemove ? (
                      <Button
                        label="Remover"
                        variant="secondary"
                        disabled={busy}
                        onPress={() => void remove(member)}
                        testID={`grupo-membro-${member.userId}-remover`}
                      />
                    ) : null}
                  </View>
                ) : null}
              </View>
            </Card>
          )
        })
      )}

      {actor?.role === 'organizer' && onOpenSettings ? (
        <Button
          label="Ajustes da viagem"
          variant="secondary"
          onPress={onOpenSettings}
          testID="grupo-ajustes"
        />
      ) : null}

      {actor?.role === 'member' ? (
        <Notice
          testID="grupo-somente-leitura"
          message="Só o organizador e os coorganizadores podem gerenciar o grupo."
        />
      ) : null}
    </ScrollView>
  )
}
