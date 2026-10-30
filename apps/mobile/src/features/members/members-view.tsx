import { useState } from 'react'
import { ActivityIndicator, ScrollView, View } from 'react-native'

import { canRemoveMember, canSetMemberRole } from '@trippy/domain'
import type { LiveMember } from '@trippy/sync'
import { Notice } from '../../components'
import { useTheme } from '../../design-system'
import {
  ActionSheet,
  Avatar,
  Button,
  HighlightCard,
  IconButton,
  RichText,
  Text,
  TextButton,
  type AvatarColor,
} from '../../design-system/components'

/** TestIDs Maestro: grupo-membro-<userId>-papel, grupo-membro-<userId>-opcoes, -promover/-rebaixar/-remover. */

const ROLE_LABELS: Record<LiveMember['role'], string> = {
  organizer: 'Organizador',
  coorganizer: 'Coorganizador',
  member: 'Membro',
}

function memberName(
  member: LiveMember,
  currentUserId: string | undefined,
  names: Record<string, string> = {},
): string {
  if (member.userId === currentUserId) return 'Você'
  if (names[member.userId]) return names[member.userId]
  return `Participante ${member.userId.slice(-6)}`
}

/** Cor do avatar fixa por pessoa: o mesmo userId sempre cai na mesma das quatro. */
function avatarColor(userId: string): AvatarColor {
  let sum = 0
  for (const char of userId) sum += char.charCodeAt(0)
  return ((sum % 4) + 1) as AvatarColor
}

function roleLabel(member: LiveMember): string {
  return ROLE_LABELS[member.role]
}

export type MembersViewProps = {
  members: LiveMember[]
  currentUserId: string | undefined
  /** Nomes por userId, quando conhecidos; sem eles aparece "Participante" com o fim do id. */
  names?: Record<string, string>
  isLoading?: boolean
  busyUserId?: string | null
  isInviting?: boolean
  error?: string | null
  onInvite: () => void
  onSetRole: (member: LiveMember, role: 'coorganizer' | 'member') => void
  onRemove: (member: LiveMember) => void
  onOpenSettings?: () => void
}

/** Tela 22: convite, lista de pessoas com papel e a folha de opções de cada uma. */
export function MembersView({
  members,
  currentUserId,
  names = {},
  isLoading = false,
  busyUserId = null,
  isInviting = false,
  error = null,
  onInvite,
  onSetRole,
  onRemove,
  onOpenSettings,
}: MembersViewProps) {
  const theme = useTheme()
  const [optionsFor, setOptionsFor] = useState<LiveMember | null>(null)
  const closeThen = (action: () => void) => {
    setOptionsFor(null)
    action()
  }
  const actor = members.find((member) => member.userId === currentUserId)
  const canInvite = actor?.role === 'organizer' || actor?.role === 'coorganizer'

  const optionsTarget = optionsFor
    ? { userId: optionsFor.userId, role: optionsFor.role }
    : undefined
  const canChangeRole =
    actor !== undefined && optionsTarget !== undefined && canSetMemberRole(actor, optionsTarget)
  const canRemove =
    actor !== undefined && optionsTarget !== undefined && canRemoveMember(actor, optionsTarget)

  return (
    <ScrollView
      testID="tela-grupo"
      contentContainerStyle={{ gap: theme.spacing.space3, padding: theme.spacing.space5 }}
    >
      {error ? <Notice testID="grupo-erro" tone="danger" message={error} /> : null}

      {canInvite ? (
        <HighlightCard
          testID="grupo-convite"
          style={{
            alignItems: 'center',
            flexDirection: 'row',
            gap: theme.spacing.space3,
            paddingHorizontal: theme.spacing.space4,
            paddingVertical: 14,
          }}
        >
          <RichText
            variant="notice"
            color={theme.colors.onForest}
            segments={[{ strong: 'Convide pelo link.' }, ' Abre sem instalar o app.']}
            style={{ flex: 1, fontSize: 14, lineHeight: 20 }}
          />
          <Button
            label="Enviar"
            variant="inverse"
            block={false}
            loading={isInviting}
            onPress={() => onInvite()}
            testID="grupo-convite-enviar"
          />
        </HighlightCard>
      ) : null}

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
        <View
          testID="grupo-membros"
          style={{
            backgroundColor: theme.colors.surface,
            borderRadius: theme.radius.radiusMd,
            paddingLeft: theme.spacing.space4,
            paddingRight: 6,
          }}
        >
          {members.map((member, index) => {
            const name = memberName(member, currentUserId, names)
            const target = { userId: member.userId, role: member.role }
            const hasOptions =
              actor !== undefined &&
              (canSetMemberRole(actor, target) || canRemoveMember(actor, target))
            return (
              <View
                key={member.userId}
                testID={`grupo-membro-${member.userId}`}
                style={{
                  alignItems: 'center',
                  borderBottomColor: theme.colors.line,
                  borderBottomWidth: index === members.length - 1 ? 0 : 1,
                  flexDirection: 'row',
                  gap: 10,
                  minHeight: 60,
                  opacity: busyUserId === member.userId ? 0.5 : 1,
                }}
              >
                <Avatar name={name} color={avatarColor(member.userId)} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text variant="placeName" color={theme.colors.ink} numberOfLines={1}>
                    {name}
                  </Text>
                  <Text
                    variant="placeAddress"
                    testID={`grupo-membro-${member.userId}-papel`}
                    color={theme.colors.inkMuted}
                    numberOfLines={1}
                  >
                    {`${roleLabel(member)} · ${member.openedAt ? 'abriu no celular' : 'ainda não abriu'}`}
                  </Text>
                </View>
                {hasOptions ? (
                  <IconButton
                    icon="more"
                    tone="plain"
                    accessibilityLabel={`Opções de ${name}`}
                    onPress={() => setOptionsFor(member)}
                    testID={`grupo-membro-${member.userId}-opcoes`}
                  />
                ) : null}
              </View>
            )
          })}
        </View>
      )}

      {actor?.role === 'organizer' && onOpenSettings ? (
        <Button
          label="Ajustes da viagem"
          variant="secondary"
          block
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

      <ActionSheet
        visible={optionsFor !== null}
        onClose={() => setOptionsFor(null)}
        testID="grupo-opcoes"
      >
        {optionsFor ? (
          <>
            <Text variant="titleM" color={theme.colors.ink}>
              {`${memberName(optionsFor, currentUserId, names)} · ${roleLabel(optionsFor)}`}
            </Text>
            {canChangeRole ? (
              <>
                <Button
                  label={
                    optionsFor.role === 'coorganizer' ? 'Voltar a membro' : 'Tornar coorganizador'
                  }
                  variant="secondary"
                  block
                  onPress={() =>
                    closeThen(() =>
                      onSetRole(
                        optionsFor,
                        optionsFor.role === 'coorganizer' ? 'member' : 'coorganizer',
                      ),
                    )
                  }
                  testID={`grupo-membro-${optionsFor.userId}-${optionsFor.role === 'coorganizer' ? 'rebaixar' : 'promover'}`}
                />
                <Text variant="fieldHelp" color={theme.colors.inkMuted}>
                  Coorganizadores montam o roteiro, marcam presença dos outros e removem fotos e
                  membros.
                </Text>
              </>
            ) : null}
            {canRemove ? (
              <Button
                label="Remover do grupo"
                variant="danger"
                block
                onPress={() => closeThen(() => onRemove(optionsFor))}
                testID={`grupo-membro-${optionsFor.userId}-remover`}
              />
            ) : null}
            <TextButton
              label="Cancelar"
              block
              onPress={() => setOptionsFor(null)}
              testID="grupo-opcoes-cancelar"
            />
          </>
        ) : null}
      </ActionSheet>
    </ScrollView>
  )
}
