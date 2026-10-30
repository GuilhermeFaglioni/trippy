import { useCallback, useEffect, useMemo, useState } from 'react'
import { Share } from 'react-native'

import type { LiveMember } from '@trippy/sync'
import { useSession } from '../auth/session-provider'
import { getApiBaseUrl } from '../diagnostics/health-client'
import { createInviteClient, getInviteErrorMessage } from '../invites/invite-client'
import { useSync } from '../sync/sync-provider'
import { MembersView } from './members-view'

type MembersScreenProps = {
  tripId: string
  tripName?: string
  /** O título "Grupo · N" fica no cabeçalho da viagem. */
  onMemberCount?: (count: number) => void
  /** Ajustes da viagem (datas, encerrar), só para o organizador. */
  onOpenSettings?: () => void
}

export function MembersScreen({
  tripId,
  tripName,
  onMemberCount,
  onOpenSettings,
}: MembersScreenProps) {
  const { session, request } = useSession()
  const { client } = useSync()
  const inviteClient = useMemo(() => createInviteClient(request), [request])
  const [members, setMembers] = useState<LiveMember[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [busyUserId, setBusyUserId] = useState<string | null>(null)
  const [isInviting, setIsInviting] = useState(false)
  const [error, setError] = useState<string | null>(null)

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

  const sendInvite = useCallback(async () => {
    setError(null)
    setIsInviting(true)
    try {
      const token = await inviteClient.create(tripId)
      const baseUrl = getApiBaseUrl().replace(/\/+$/u, '')
      await Share.share({
        message: `Entre na viagem ${tripName ?? ''} no Trippy: ${baseUrl}/i/${token}`.replace(
          /\s{2,}/gu,
          ' ',
        ),
      })
    } catch (inviteError) {
      setError(getInviteErrorMessage(inviteError))
    } finally {
      setIsInviting(false)
    }
  }, [inviteClient, tripId, tripName])

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
    <MembersView
      members={members}
      currentUserId={session?.user.id}
      isLoading={isLoading}
      busyUserId={busyUserId}
      isInviting={isInviting}
      error={error}
      onInvite={() => void sendInvite()}
      onSetRole={(member, role) => void setRole(member, role)}
      onRemove={(member) => void remove(member)}
      onOpenSettings={onOpenSettings}
    />
  )
}
