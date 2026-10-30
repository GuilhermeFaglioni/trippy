import { useState, type PropsWithChildren } from 'react'
import { ScrollView, View } from 'react-native'

import {
  Avatar,
  AvatarStack,
  Button,
  Card,
  DaySheet,
  Eyebrow,
  FilterChip,
  HighlightCard,
  IconButton,
  Notice,
  PlaceRow,
  ScreenHeader,
  StatusChip,
  TabBar,
  Text,
  TextField,
  tripTabs,
} from './components'
import { useTheme } from './theme-provider'

function Section({ title, children }: PropsWithChildren<{ title: string }>) {
  const { colors, spacing } = useTheme()

  return (
    <View style={{ gap: spacing.space3 }}>
      <Text variant="label" color={colors.inkMuted} accessibilityRole="header">
        {title}
      </Text>
      {children}
    </View>
  )
}

function Row({ children }: PropsWithChildren) {
  const { spacing } = useTheme()

  return (
    <View
      style={{ alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: spacing.space2 }}
    >
      {children}
    </View>
  )
}

const noop = () => undefined

const days = [
  { key: '1', label: 'Dia 1 · Pequim · seg 12/out' },
  { key: '2', label: 'Dia 2 · Pequim · ter 13/out' },
  { key: '3', label: 'Dia 3 · Xangai · qua 14/out' },
]

/** Cada componente do design system em todos os estados, no tema do aparelho. */
export function DesignSystemGallery() {
  const { colors, spacing, mode } = useTheme()
  const [filter, setFilter] = useState('all')
  const [visited, setVisited] = useState(true)
  const [favorite, setFavorite] = useState(true)
  const [want, setWant] = useState(true)
  const [toggled, setToggled] = useState(false)
  const [tab, setTab] = useState('places')
  const [sheetOpen, setSheetOpen] = useState(false)
  const [sheetDay, setSheetDay] = useState('2')
  const [name, setName] = useState('Viagem China')
  const [date, setDate] = useState('10/10')

  return (
    <View style={{ backgroundColor: colors.ground, flex: 1 }}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{
          gap: spacing.space6,
          paddingBottom: spacing.space6,
          paddingHorizontal: spacing.space5,
          paddingTop: spacing.space2,
        }}
      >
        <ScreenHeader
          backLabel="Minhas viagens · Viagem China"
          onBack={noop}
          title={`Design system (${mode === 'dark' ? 'escuro' : 'claro'})`}
        />

        <Section title="Button">
          <Button label="Criar viagem" onPress={noop} testID="gallery-primary" />
          <Button label="Criar viagem" onPress={noop} disabled />
          <Button label="Criar viagem" onPress={noop} loading />
          <Row>
            <Button variant="secondary" label="Sugerir ao grupo" onPress={noop} />
            <Button
              variant="secondary"
              label="Alternável"
              pressed={toggled}
              onPress={() => setToggled((value) => !value)}
            />
            <Button variant="secondary" label="Marcado" pressed onPress={noop} />
            <Button variant="secondary" label="Desabilitado" onPress={noop} disabled />
          </Row>
          <Row>
            <Button variant="fab" label="Lugar" icon="plus" onPress={noop} />
          </Row>
          <Row>
            <IconButton
              icon="check"
              accessibilityLabel="Eu fui"
              pressed={visited}
              onPress={() => setVisited((v) => !v)}
            />
            <IconButton
              icon="check"
              accessibilityLabel="Eu fui (desmarcado)"
              pressed={false}
              onPress={noop}
            />
            <IconButton
              icon="star"
              accessibilityLabel="Favorito"
              tone="favorite"
              pressed={favorite}
              onPress={() => setFavorite((v) => !v)}
            />
            <IconButton
              icon="star"
              accessibilityLabel="Favorito (desmarcado)"
              tone="favorite"
              pressed={false}
              onPress={noop}
            />
            <IconButton icon="camera" accessibilityLabel="Foto" onPress={noop} />
            <IconButton
              icon="camera"
              accessibilityLabel="Foto (desabilitado)"
              onPress={noop}
              disabled
            />
            <IconButton
              icon="heart"
              accessibilityLabel="Quero ir, 5"
              pressed={want}
              count={5}
              onPress={() => setWant((v) => !v)}
            />
            <IconButton
              icon="heart"
              accessibilityLabel="Quero ir, 3"
              pressed={false}
              count={3}
              onPress={noop}
            />
          </Row>
        </Section>

        <Section title="Card e card de destaque">
          <Card>
            <Eyebrow>Seção</Eyebrow>
            <Text variant="titleS" color={colors.ink}>
              Card comum
            </Text>
            <Text variant="bodySm" color={colors.inkMuted}>
              Superfície plana, 16px de padding, sem altura fixa.
            </Text>
          </Card>
          <HighlightCard>
            <Eyebrow onHighlight>Próximo lugar</Eyebrow>
            <Text variant="titleM" color={colors.onForest}>
              Yu Garden
            </Text>
            <Text variant="bodySm" color={colors.onForest} locale="zh-CN">
              豫园 · 安仁街218号
            </Text>
            <Button variant="inverse" label="Mostrar endereço" onPress={noop} />
          </HighlightCard>
        </Section>

        <Section title="StatusChip">
          <Row>
            <StatusChip tone="day" label="No dia 5" />
            <StatusChip tone="suggested" label="Sugerido" />
            <StatusChip tone="none" label="Sem dia" />
          </Row>
          <Row>
            <StatusChip tone="day" label="No dia 5 · trocar" onPress={() => setSheetOpen(true)} />
            <StatusChip
              tone="suggested"
              label="Sugerido · escolher dia"
              onPress={() => setSheetOpen(true)}
            />
            <StatusChip
              tone="none"
              label="Sem dia · escolher dia"
              onPress={() => setSheetOpen(true)}
            />
          </Row>
        </Section>

        <Section title="FilterChip">
          <Row>
            <FilterChip
              label="Todos 14"
              selected={filter === 'all'}
              onPress={() => setFilter('all')}
            />
            <FilterChip
              label="Sugeridos 6"
              selected={filter === 'suggested'}
              onPress={() => setFilter('suggested')}
            />
            <FilterChip
              label="Sem dia 2"
              selected={filter === 'none'}
              onPress={() => setFilter('none')}
            />
          </Row>
        </Section>

        <Section title="Avatar">
          <Row>
            <Avatar name="Ana Souza" color={1} />
            <Avatar name="Pedro Lima" color={2} />
            <Avatar name="Lu Martins" color={3} />
            <Avatar name="Rafa" color={4} />
            <Avatar name="Ana Souza" color={1} size="sm" />
          </Row>
          <Card>
            <AvatarStack
              people={[
                { name: 'Ana Souza', color: 1 },
                { name: 'Pedro Lima', color: 2 },
                { name: 'Lu Martins', color: 3 },
                { name: 'Rafa Costa', color: 4 },
              ]}
            />
          </Card>
        </Section>

        <Section title="Notice">
          <Notice
            tone="offline"
            segments={[
              'Sem internet · atualizado às 9h · ',
              { strong: '3 fotos e 2 registros' },
              ' esperando envio',
            ]}
          />
          <Notice
            tone="change"
            segments={[{ strong: 'O que mudou:' }, ' Ana moveu "Templo Jing\'an" para amanhã.']}
          />
        </Section>

        <Section title="TextField">
          <TextField
            label="Nome da viagem"
            value={name}
            onChangeText={setName}
            placeholder="Viagem China"
          />
          <TextField
            label="Campo vazio"
            value=""
            onChangeText={noop}
            placeholder="Digite aqui"
            help="Ajuda abaixo do campo."
          />
          <TextField
            label="Volta"
            value={date}
            onChangeText={setDate}
            error="Escolha uma data de volta depois da ida"
          />
          <TextField label="Desabilitado" value="Ana Souza" onChangeText={noop} disabled />
          <Row>
            <View style={{ flex: 1, minWidth: 0 }}>
              <TextField label="Ida" value="10/10" onChangeText={noop} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <TextField label="Volta" value="21/10" onChangeText={noop} />
            </View>
          </Row>
        </Section>

        <Section title="PlaceRow">
          <PlaceRow
            number={1}
            name="Nanjing Road"
            done
            actions={{
              visited,
              favorite,
              onToggleVisited: () => setVisited((v) => !v),
              onToggleFavorite: () => setFavorite((v) => !v),
              onPhoto: noop,
            }}
          />
          <PlaceRow
            number={2}
            name="Yu Garden"
            actions={{
              visited: false,
              favorite: false,
              onToggleVisited: noop,
              onToggleFavorite: noop,
              onPhoto: noop,
            }}
          />
          <PlaceRow
            number={3}
            name="The Bund ao anoitecer, com um nome bem comprido que passa de duas linhas"
            actions={{
              visited: false,
              favorite: false,
              onToggleVisited: noop,
              onToggleFavorite: noop,
              onPhoto: noop,
            }}
          />
          <PlaceRow number={4} name="Muralha em Mutianyu (reordenar)" done onDragStart={noop} />
        </Section>

        <Section title="Folha de dias">
          <Button
            variant="secondary"
            label="Abrir folha de dias"
            onPress={() => setSheetOpen(true)}
            block
          />
        </Section>

        <Section title="TabBar">
          <View
            style={{
              borderColor: colors.hairline,
              borderWidth: 1,
              marginHorizontal: -spacing.space5,
            }}
          >
            <TabBar
              items={[
                tripTabs.today,
                tripTabs.itinerary,
                tripTabs.places,
                tripTabs.memories,
                tripTabs.group,
              ]}
              currentKey={tab}
              onSelect={setTab}
            />
          </View>
          <View
            style={{
              borderColor: colors.hairline,
              borderWidth: 1,
              marginHorizontal: -spacing.space5,
            }}
          >
            <TabBar
              items={[tripTabs.itinerary, tripTabs.places, tripTabs.memories, tripTabs.group]}
              currentKey="places"
              onSelect={noop}
            />
          </View>
        </Section>
      </ScrollView>

      <DaySheet
        visible={sheetOpen}
        title="Escolher dia"
        options={days.map((day) => ({ ...day, selected: day.key === sheetDay }))}
        onSelect={(key) => {
          setSheetDay(key)
          setSheetOpen(false)
        }}
        onClose={() => setSheetOpen(false)}
      />
    </View>
  )
}
