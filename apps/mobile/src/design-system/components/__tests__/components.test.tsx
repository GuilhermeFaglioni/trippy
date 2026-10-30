import { fireEvent, render } from '@testing-library/react-native'
import type { ReactElement } from 'react'

import { DesignSystemProvider } from '../..'
import {
  Avatar,
  AvatarStack,
  Button,
  DaySheet,
  FilterChip,
  getInitials,
  IconButton,
  Notice,
  PlaceRow,
  ScreenHeader,
  StatusChip,
  TabBar,
  TextField,
  tripTabs,
} from '..'
import { derivePressedColor } from '../color'
import { toNativeShadow } from '../shadow'
import tokenSource from '../../../../../../docs/design-system/tokens.json'

const light = Object.fromEntries(tokenSource.color.tokens.map((t) => [t.name, t.value.light]))
const noop = () => undefined

async function renderDs(element: ReactElement) {
  return render(<DesignSystemProvider>{element}</DesignSystemProvider>)
}

describe('Button', () => {
  it('principal tem 56px, terracotta, e dispara onPress', async () => {
    const onPress = jest.fn()
    const utils = await renderDs(<Button label="Criar viagem" onPress={onPress} />)
    const button = utils.getByRole('button', { name: 'Criar viagem' })

    expect(button).toHaveStyle({
      minHeight: 56,
      backgroundColor: light.terracotta,
      borderRadius: 18,
    })
    expect(utils.getByText('Criar viagem')).toHaveStyle({ color: light['on-terracotta'] })
    await fireEvent.press(button)
    expect(onPress).toHaveBeenCalledTimes(1)
  })

  it('desabilitado usa sand e ink-muted, sem disparar', async () => {
    const onPress = jest.fn()
    const utils = await renderDs(<Button label="Criar" onPress={onPress} disabled />)
    const button = utils.getByRole('button', { name: 'Criar' })

    expect(button).toHaveStyle({ backgroundColor: light.sand })
    expect(button.props.accessibilityState).toMatchObject({ disabled: true })
    await fireEvent.press(button)
    expect(onPress).not.toHaveBeenCalled()
  })

  it('carregando mantém o botão e marca busy', async () => {
    const utils = await renderDs(<Button label="Criar" onPress={noop} loading testID="b" />)

    expect(utils.getByTestId('b').props.accessibilityState).toMatchObject({
      busy: true,
      disabled: true,
    })
    expect(utils.getByTestId('b-loading-indicator')).toBeTruthy()
  })

  it('secundário alternável: marcado vira forest e anuncia checked', async () => {
    const utils = await renderDs(
      <>
        <Button variant="secondary" label="Off" pressed={false} onPress={noop} />
        <Button variant="secondary" label="On" pressed onPress={noop} />
      </>,
    )

    expect(utils.getByRole('togglebutton', { name: 'Off' }).props.accessibilityState).toMatchObject(
      {
        checked: false,
      },
    )
    const on = utils.getByRole('togglebutton', { name: 'On' })
    expect(on.props.accessibilityState).toMatchObject({ checked: true })
    expect(on).toHaveStyle({ backgroundColor: light.forest, minHeight: 44, borderRadius: 12 })
  })

  it('flutuante leva shadow-fab', async () => {
    const utils = await renderDs(<Button variant="fab" label="Lugar" onPress={noop} />)

    expect(utils.getByRole('button', { name: 'Lugar' })).toHaveStyle({
      shadowOpacity: 0.3,
      shadowOffset: { width: 0, height: 8 },
    })
  })

  it('mostra o anel de foco só com foco', async () => {
    const utils = await renderDs(<Button label="Criar" onPress={noop} testID="b" />)

    expect(utils.queryByTestId('b-focus-ring')).toBeNull()
    await fireEvent(utils.getByTestId('b'), 'focus')
    expect(utils.getByTestId('b-focus-ring')).toHaveStyle({ borderWidth: 2 })
  })
})

describe('IconButton', () => {
  it('tem 44×44, rótulo e estados marcado/desmarcado', async () => {
    const utils = await renderDs(
      <>
        <IconButton icon="check" accessibilityLabel="Eu fui" pressed={false} onPress={noop} />
        <IconButton
          icon="star"
          accessibilityLabel="Favorito"
          tone="favorite"
          pressed
          onPress={noop}
        />
        <IconButton icon="check" accessibilityLabel="Fui" pressed onPress={noop} />
      </>,
    )

    const off = utils.getByRole('togglebutton', { name: 'Eu fui' })
    expect(off).toHaveStyle({ width: 44, height: 44, borderRadius: 12 })
    expect(off.props.accessibilityState).toMatchObject({ checked: false })
    expect(
      utils.getByRole('togglebutton', { name: 'Favorito' }).props.accessibilityState,
    ).toMatchObject({
      checked: true,
    })
    expect(utils.getByRole('togglebutton', { name: 'Favorito' })).toHaveStyle({
      backgroundColor: light.surface,
    })
    expect(utils.getByRole('togglebutton', { name: 'Fui' })).toHaveStyle({
      backgroundColor: light.forest,
    })
  })

  it('quero ir marcado é terracotta e tem 52×52 com contagem', async () => {
    const utils = await renderDs(
      <IconButton icon="heart" accessibilityLabel="Quero ir, 5" pressed count={5} onPress={noop} />,
    )

    expect(utils.getByRole('togglebutton', { name: 'Quero ir, 5' })).toHaveStyle({
      backgroundColor: light.terracotta,
      width: 52,
      height: 52,
    })
    expect(utils.getByText('5')).toBeTruthy()
  })
})

describe('StatusChip', () => {
  it('membro vê só o status (sem botão)', async () => {
    const utils = await renderDs(<StatusChip tone="day" label="No dia 5" />)

    expect(utils.queryByRole('button')).toBeNull()
    expect(utils.getByText('No dia 5')).toBeTruthy()
  })

  it('organizador tem botão com área tocável de 44px', async () => {
    const onPress = jest.fn()
    const utils = await renderDs(
      <StatusChip tone="suggested" label="Sugerido · escolher dia" onPress={onPress} />,
    )
    const chip = utils.getByRole('button', { name: 'Sugerido · escolher dia' })

    expect(chip).toHaveStyle({ minHeight: 32, backgroundColor: light['terracotta-tint'] })
    expect(chip).toHaveProp('hitSlop', { top: 6, bottom: 6, left: 2, right: 2 })
    await fireEvent.press(chip)
    expect(onPress).toHaveBeenCalled()
  })
})

describe('FilterChip', () => {
  it('marcado/desmarcado muda estado e cores', async () => {
    const utils = await renderDs(
      <>
        <FilterChip label="Todos 14" selected onPress={noop} />
        <FilterChip label="Sugeridos 6" selected={false} onPress={noop} />
      </>,
    )

    const on = utils.getByRole('button', { name: 'Todos 14' })
    const off = utils.getByRole('button', { name: 'Sugeridos 6' })
    expect(on.props.accessibilityState).toMatchObject({ selected: true })
    expect(on).toHaveStyle({ backgroundColor: light.ink, height: 36 })
    expect(off.props.accessibilityState).toMatchObject({ selected: false })
    expect(off).toHaveStyle({ borderColor: light['line-strong'] })
    expect(off).toHaveProp('hitSlop', { top: 4, bottom: 4 })
  })
})

describe('Avatar', () => {
  it('tira iniciais, usa a cor 1–4 e o tamanho', async () => {
    expect(getInitials('Ana Souza')).toBe('AS')
    expect(getInitials('Rafa')).toBe('R')
    const utils = await renderDs(
      <>
        <Avatar name="Ana Souza" color={2} testID="a" />
        <AvatarStack
          people={[
            { name: 'Ana', color: 1 },
            { name: 'Pedro', color: 3 },
          ]}
          testID="s"
        />
      </>,
    )

    expect(utils.getByTestId('a')).toHaveStyle({ width: 40, backgroundColor: light['avatar-2'] })
    expect(utils.getByLabelText('Ana, Pedro')).toBeTruthy()
  })
})

describe('Notice', () => {
  it('offline é sand e lê o texto inteiro', async () => {
    const utils = await renderDs(
      <Notice
        tone="offline"
        segments={['Sem internet · ', { strong: '3 fotos' }, ' esperando']}
        testID="n"
      />,
    )

    expect(utils.getByTestId('n')).toHaveStyle({ backgroundColor: light.sand })
    expect(utils.getByLabelText('Sem internet · 3 fotos esperando')).toBeTruthy()
  })

  it('mudança é terracotta-tint', async () => {
    const utils = await renderDs(<Notice tone="change" segments={['Ana moveu']} testID="n" />)

    expect(utils.getByTestId('n')).toHaveStyle({ backgroundColor: light['terracotta-tint'] })
  })
})

describe('TextField', () => {
  it('normal: borda 1px line-strong; foco: 2px forest + anel', async () => {
    const utils = await renderDs(<TextField label="Nome" value="" onChangeText={noop} testID="f" />)
    const input = utils.getByTestId('f')

    expect(input).toHaveStyle({ borderWidth: 1, borderColor: light['line-strong'], minHeight: 52 })
    await fireEvent(input, 'focus')
    expect(utils.getByTestId('f')).toHaveStyle({ borderWidth: 2, borderColor: light.forest })
    expect(utils.getByTestId('f-focus-ring')).toBeTruthy()
  })

  it('erro: borda danger e mensagem', async () => {
    const utils = await renderDs(
      <TextField
        label="Volta"
        value="x"
        onChangeText={noop}
        error="Escolha uma data de volta depois da ida"
        testID="f"
      />,
    )

    expect(utils.getByTestId('f')).toHaveStyle({ borderWidth: 2, borderColor: light.danger })
    expect(utils.getByText('Escolha uma data de volta depois da ida')).toHaveStyle({
      color: light.danger,
    })
  })

  it('desabilitado: sand, ink-muted, não editável', async () => {
    const utils = await renderDs(
      <TextField label="Nome" value="Ana" onChangeText={noop} disabled testID="f" />,
    )
    const input = utils.getByTestId('f')

    expect(input).toHaveStyle({ backgroundColor: light.sand, color: light['ink-muted'] })
    expect(input.props.accessibilityState).toMatchObject({ disabled: true })
    expect(input.props.editable).toBe(false)
  })
})

describe('PlaceRow', () => {
  const actions = {
    visited: true,
    favorite: false,
    onToggleVisited: jest.fn(),
    onToggleFavorite: jest.fn(),
    onPhoto: jest.fn(),
  }

  it('mostra número, nome em até 2 linhas e as três ações com estado', async () => {
    const utils = await renderDs(<PlaceRow number={1} name="Nanjing Road" done actions={actions} />)

    expect(utils.getByText('Nanjing Road')).toHaveProp('numberOfLines', 2)
    expect(utils.getByText('1')).toHaveStyle({ color: light['on-forest'] })
    expect(
      utils.getByRole('togglebutton', { name: 'Eu fui' }).props.accessibilityState,
    ).toMatchObject({
      checked: true,
    })
    expect(
      utils.getByRole('togglebutton', { name: 'Favorito' }).props.accessibilityState,
    ).toMatchObject({
      checked: false,
    })
    await fireEvent.press(utils.getByRole('button', { name: 'Foto' }))
    expect(actions.onPhoto).toHaveBeenCalled()
  })

  it('no roteiro troca as ações pela alça de reordenar', async () => {
    const onDragStart = jest.fn()
    const utils = await renderDs(<PlaceRow number={2} name="Yu Garden" onDragStart={onDragStart} />)

    expect(utils.queryByRole('togglebutton', { name: 'Eu fui' })).toBeNull()
    await fireEvent(utils.getByRole('button', { name: 'Reordenar Yu Garden' }), 'pressIn')
    expect(onDragStart).toHaveBeenCalled()
  })
})

describe('TabBar', () => {
  it('marca a aba atual como selecionada e seleciona outra', async () => {
    const onSelect = jest.fn()
    const utils = await renderDs(
      <TabBar
        items={[tripTabs.today, tripTabs.itinerary, tripTabs.places]}
        currentKey="places"
        onSelect={onSelect}
      />,
    )

    expect(utils.getByRole('tab', { name: 'Lugares' }).props.accessibilityState).toMatchObject({
      selected: true,
    })
    expect(utils.getByRole('tab', { name: 'Hoje' }).props.accessibilityState).toMatchObject({
      selected: false,
    })
    expect(utils.getByText('Lugares')).toHaveStyle({
      color: light['terracotta-text'],
      fontWeight: '700',
    })
    await fireEvent.press(utils.getByRole('tab', { name: 'Hoje' }))
    expect(onSelect).toHaveBeenCalledWith('today')
  })
})

describe('ScreenHeader', () => {
  it('mostra voltar e título-l de até 2 linhas', async () => {
    const onBack = jest.fn()
    const utils = await renderDs(
      <ScreenHeader backLabel="Minhas viagens · Viagem China" onBack={onBack} title="Lugares" />,
    )

    expect(utils.getByText('Lugares')).toHaveStyle({ fontSize: 32 })
    expect(utils.getByText('Lugares')).toHaveProp('numberOfLines', 2)
    await fireEvent.press(
      utils.getByRole('button', { name: 'Voltar para Minhas viagens · Viagem China' }),
    )
    expect(onBack).toHaveBeenCalled()
  })
})

describe('DaySheet', () => {
  it('lista os dias com o selecionado marcado e fecha ao escolher', async () => {
    const onSelect = jest.fn()
    const utils = await renderDs(
      <DaySheet
        visible
        title="Escolher dia"
        options={[
          { key: '1', label: 'Dia 1' },
          { key: '2', label: 'Dia 2', selected: true },
        ]}
        onSelect={onSelect}
        onClose={noop}
      />,
    )

    expect(utils.getByRole('button', { name: 'Dia 2' }).props.accessibilityState).toMatchObject({
      selected: true,
    })
    expect(utils.getByRole('button', { name: 'Dia 1' }).props.accessibilityState).toMatchObject({
      selected: false,
    })
    await fireEvent.press(utils.getByRole('button', { name: 'Dia 1' }))
    expect(onSelect).toHaveBeenCalledWith('1')
  })
})

describe('utilitários', () => {
  it('derivePressedColor escurece 8%', () => {
    expect(derivePressedColor('#C2410C')).toBe('#B23C0B')
  })

  it('toNativeShadow converte shadow-fab', () => {
    expect(toNativeShadow('0 8px 20px rgba(194,65,12,0.30)')).toMatchObject({
      shadowColor: 'rgb(194, 65, 12)',
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.3,
      shadowRadius: 10,
    })
  })
})
