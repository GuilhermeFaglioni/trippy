import { View } from 'react-native'
import { Redirect, useLocalSearchParams } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'

import type { LiveMember } from '@trippy/sync'
import { useTheme } from '../../design-system'
import { ScreenHeader, TabBar, tripTabs } from '../../design-system/components'
import { JoinNoticeScreen } from '../../features/invites/join-notice-screen'
import { MembersView } from '../../features/members/members-view'

const noop = () => undefined

const members: LiveMember[] = [
  ['me', 'organizer', true],
  ['ana', 'coorganizer', true],
  ['pedro', 'member', true],
  ['ju', 'member', true],
  ['lu', 'member', false],
  ['rafa', 'member', false],
].map(([userId, role, opened]) => ({
  userId: String(userId),
  role: role as LiveMember['role'],
  joinedAt: '2026-10-20T10:00:00Z',
  openedAt: opened ? '2026-10-21T10:00:00Z' : null,
}))

/** Pré-visualização só de desenvolvimento das telas 22 e 28: `/dev/grupo?tela=grupo|aviso`. */
export default function GroupPreviewRoute() {
  const theme = useTheme()
  const { tela } = useLocalSearchParams<{ tela?: string }>()
  if (!__DEV__) return <Redirect href="/" />

  if (tela === 'aviso') {
    return <JoinNoticeScreen visible tripName="Viagem China" onAccept={noop} onDecline={noop} />
  }

  return (
    <View style={{ backgroundColor: theme.colors.ground, flex: 1 }}>
      <SafeAreaView edges={['top']}>
        <View style={{ paddingHorizontal: theme.spacing.space5, paddingTop: theme.spacing.space3 }}>
          <ScreenHeader
            backLabel="Minhas viagens · Viagem China"
            onBack={noop}
            title={`Grupo · ${members.length}`}
          />
        </View>
      </SafeAreaView>
      <View style={{ flex: 1 }}>
        <MembersView
          members={members}
          currentUserId="me"
          names={{ ana: 'Ana', pedro: 'Pedro', ju: 'Ju', lu: 'Lu', rafa: 'Rafa' }}
          onInvite={noop}
          onSetRole={noop}
          onRemove={noop}
        />
      </View>
      <TabBar
        items={[tripTabs.itinerary, tripTabs.places, tripTabs.memories, tripTabs.group]}
        currentKey={tripTabs.group.key}
        onSelect={noop}
      />
    </View>
  )
}
