import { Redirect, useLocalSearchParams } from 'expo-router'
import { View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { ScreenHeader, TabBar, tripTabs, useTheme } from '../../design-system'
import { HereView } from '../../features/today/here-view'
import { TodayView, type TodayViewProps } from '../../features/today/today-view'

const noop = () => undefined

const rows = [
  { id: '1', slug: 'nanjing-road', number: 1, name: 'Nanjing Road', visited: true, favorite: true },
  { id: '2', slug: 'yu-garden', number: 2, name: 'Yu Garden', visited: false, favorite: false },
  {
    id: '3',
    slug: 'the-bund',
    number: 3,
    name: 'The Bund ao anoitecer',
    visited: false,
    favorite: false,
  },
]

const today: TodayViewProps = {
  offlineNotice: [
    'Sem internet · atualizado às 9h · ',
    { strong: '3 fotos e 2 registros' },
    ' esperando envio',
  ],
  error: null,
  title: 'Dia 3 de 12: Xangai',
  phase: 'during',
  rows,
  next: { id: '2', name: 'Yu Garden', localLine: '豫园 · 安仁街218号' },
  allVisited: false,
  tomorrow: null,
  changes: [[{ strong: 'O que mudou:' }, ' Ana moveu "Templo Jing\'an" para amanhã.']],
  busyPlaceId: null,
  onToggleVisit: noop,
  onToggleFavorite: noop,
  onPhoto: noop,
  onShowAddress: noop,
  onHere: noop,
}

const done: TodayViewProps = {
  ...today,
  offlineNotice: null,
  changes: [],
  next: null,
  allVisited: true,
  tomorrow: 'Amanhã: Dia 4 em Suzhou, começando pelo Jardim do Administrador Humilde.',
  rows: rows.map((row) => ({ ...row, visited: true })),
}

const hereBase = {
  name: '',
  nameError: null,
  error: null,
  busy: false,
  canSubmit: true,
  onCancel: noop,
  onSelect: noop,
  onChangeName: noop,
  onRetryLocation: noop,
  onSubmit: noop,
}

/** Prévia só de desenvolvimento com dados de exemplo: `/dev/hoje?estado=hoje|completo|aqui|aqui-sem-gps`. */
export default function HojePreviewRoute() {
  const { estado } = useLocalSearchParams<{ estado?: string }>()
  const { colors, spacing } = useTheme()

  if (!__DEV__) return <Redirect href="/" />

  if (estado === 'aqui' || estado === 'aqui-sem-gps') {
    return estado === 'aqui' ? (
      <HereView
        {...hereBase}
        phase="candidates"
        candidates={[
          {
            key: 'a',
            name: 'Café Sumerian',
            localName: '苏美尔咖啡',
            detail: 'a 40 m · pelo GPS do celular',
          },
          { key: 'b', name: "Parque Jing'an", localName: null, detail: 'a 210 m' },
        ]}
        selectedKey="a"
      />
    ) : (
      <HereView {...hereBase} phase="no-gps" candidates={[]} selectedKey={null} />
    )
  }

  const props = estado === 'completo' ? done : today
  return (
    <View style={{ flex: 1, backgroundColor: colors.ground }}>
      <SafeAreaView edges={['top']}>
        <View style={{ paddingHorizontal: spacing.space5, paddingTop: spacing.space3 }}>
          <ScreenHeader backLabel="Minhas viagens · Viagem China" onBack={noop} />
        </View>
      </SafeAreaView>
      <View style={{ flex: 1 }}>
        <TodayView {...props} />
      </View>
      <TabBar
        items={[
          tripTabs.today,
          tripTabs.itinerary,
          tripTabs.places,
          tripTabs.memories,
          tripTabs.group,
        ]}
        currentKey={tripTabs.today.key}
        onSelect={noop}
      />
    </View>
  )
}
