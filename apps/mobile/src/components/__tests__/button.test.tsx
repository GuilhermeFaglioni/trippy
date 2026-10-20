import { fireEvent, render } from '@testing-library/react-native'

import { DesignSystemProvider } from '../../design-system'
import { Button } from '../button'
import { derivePressedColor } from '../button-colors'
import { colorToken, numericToken } from './test-tokens'

async function renderButton(props: React.ComponentProps<typeof Button>) {
  return render(
    <DesignSystemProvider>
      <Button {...props} />
    </DesignSystemProvider>,
  )
}

describe('Button', () => {
  it('usa alvo mínimo, papel e escala de texto até 200%', async () => {
    const onPress = jest.fn()
    const utils = await renderButton({ label: 'Criar viagem', onPress, testID: 'create-trip' })

    const button = utils.getByRole('button', { name: 'Criar viagem' })

    expect(button).toHaveStyle({
      minHeight: numericToken('target-min'),
      minWidth: numericToken('target-min'),
      borderRadius: numericToken('radius-md'),
    })
    expect(utils.getByText('Criar viagem')).toHaveProp('maxFontSizeMultiplier', 2)
    expect(utils.getByTestId('create-trip-focus-ring')).toHaveStyle({
      borderWidth: 2,
      padding: 2,
      borderColor: 'transparent',
    })
    expect(button).not.toHaveProp('hitSlop')

    await fireEvent.press(button)
    expect(onPress).toHaveBeenCalledTimes(1)
  })

  it('deriva o fundo pressionado do token oficial escurecendo 8%', async () => {
    const utils = await render(
      <DesignSystemProvider>
        <PrimaryButtonProbe />
      </DesignSystemProvider>,
    )
    expect(utils.getByRole('button', { name: 'Salvar' })).toHaveStyle({
      backgroundColor: colorToken('terracotta'),
    })
    expect(derivePressedColor(colorToken('terracotta'))).toBe('#B23C0B')
  })

  it('mantém rótulo acessível e largura visual durante carregamento', async () => {
    const onPress = jest.fn()
    const utils = await renderButton({
      label: 'Salvar',
      onPress,
      loading: true,
      testID: 'saving-button',
    })

    const button = utils.getByRole('button', { name: 'Salvar' })
    expect(button).toBeDisabled()
    expect(button).toBeBusy()
    expect(utils.getByTestId('saving-button-loading-indicator')).toBeOnTheScreen()
    expect(utils.getByText('Salvar')).toHaveStyle({ opacity: 0 })
    await fireEvent.press(button)
    expect(onPress).not.toHaveBeenCalled()
  })

  it('desabilita semanticamente e usa tokens de estado desabilitado', async () => {
    const onPress = jest.fn()
    const utils = await render(
      <DesignSystemProvider>
        <Button label="Continuar" onPress={onPress} disabled testID="disabled-button" />
      </DesignSystemProvider>,
    )

    const button = utils.getByRole('button', { name: 'Continuar' })
    expect(button).toBeDisabled()
    expect(button).toHaveStyle({ backgroundColor: colorToken('sand') })
    expect(utils.getByText('Continuar')).toHaveStyle({ color: colorToken('ink-muted') })
    await fireEvent.press(button)
    expect(onPress).not.toHaveBeenCalled()
  })

  it('usa surface e borda forte no secundário; selecionado usa forest', async () => {
    const utils = await render(
      <DesignSystemProvider>
        <SecondaryButtonProbe selected={false} />
      </DesignSystemProvider>,
    )
    const button = utils.getByRole('button', { name: 'Ver roteiro' })
    expect(button).toHaveStyle({
      backgroundColor: colorToken('surface'),
      borderColor: colorToken('line-strong'),
      borderRadius: numericToken('radius-sm'),
    })

    await utils.rerender(
      <DesignSystemProvider>
        <SecondaryButtonProbe selected />
      </DesignSystemProvider>,
    )

    expect(utils.getByRole('button', { name: 'Ver roteiro' })).toBeSelected()
    expect(utils.getByRole('button', { name: 'Ver roteiro' })).toHaveStyle({
      backgroundColor: colorToken('forest'),
    })
    expect(utils.getByText('Ver roteiro')).toHaveStyle({ color: colorToken('on-forest') })
  })

  it('mostra anel de foco com token oficial', async () => {
    const utils = await renderButton({
      label: 'Salvar',
      onPress: jest.fn(),
      testID: 'save-button',
    })
    await fireEvent(utils.getByRole('button', { name: 'Salvar' }), 'focus')

    expect(utils.getByTestId('save-button-focus-ring')).toHaveStyle({
      borderColor: colorToken('focus'),
    })
  })
})

function PrimaryButtonProbe() {
  return <Button label="Salvar" onPress={jest.fn()} testID="primary-button" />
}

function SecondaryButtonProbe({ selected }: { selected: boolean }) {
  return <Button label="Ver roteiro" onPress={jest.fn()} variant="secondary" selected={selected} />
}
