import { fireEvent, render } from '@testing-library/react-native'

import { DesignSystemProvider } from '../../design-system'
import { TextField } from '../text-field'
import { colorToken, numericToken } from './test-tokens'

describe('TextField', () => {
  it('associa label, preserva escala até 200% e tem altura mínima de 44px', async () => {
    const utils = await render(
      <DesignSystemProvider>
        <TextField
          label="Nome da viagem"
          value="Recife"
          onChangeText={jest.fn()}
          testID="trip-name"
        />
      </DesignSystemProvider>,
    )

    const input = utils.getByLabelText('Nome da viagem')
    expect(input).toHaveProp('value', 'Recife')
    expect(input).toHaveProp('maxFontSizeMultiplier', 2)
    expect(input).toHaveStyle({
      minHeight: numericToken('target-min'),
      minWidth: numericToken('target-min'),
      borderColor: colorToken('line-strong'),
    })
    expect(utils.getByText('Nome da viagem')).toHaveProp('maxFontSizeMultiplier', 2)
  })

  it('aplica foco visível com borda forest e anel focus', async () => {
    const utils = await render(
      <DesignSystemProvider>
        <TextField label="Destino" value="" onChangeText={jest.fn()} testID="destination" />
      </DesignSystemProvider>,
    )

    await fireEvent(utils.getByLabelText('Destino'), 'focus')

    expect(utils.getByTestId('destination')).toHaveStyle({
      borderColor: colorToken('forest'),
      borderWidth: 2,
    })
    expect(utils.getByTestId('destination-focus-ring')).toHaveStyle({
      borderColor: colorToken('focus'),
    })
  })

  it('exibe erro com texto e semântica acessível', async () => {
    const utils = await render(
      <DesignSystemProvider>
        <TextField
          label="Data de volta"
          value=""
          onChangeText={jest.fn()}
          error="Escolha uma data depois da ida"
          testID="return-date"
        />
      </DesignSystemProvider>,
    )

    expect(utils.getByLabelText('Data de volta')).toHaveProp(
      'accessibilityHint',
      'Erro: Escolha uma data depois da ida',
    )
    expect(utils.getByTestId('return-date')).toHaveStyle({ borderColor: colorToken('danger') })
    expect(utils.getByText('Escolha uma data depois da ida')).toHaveStyle({
      color: colorToken('danger'),
    })
  })

  it('desabilita entrada e usa sand com texto ink-muted', async () => {
    const utils = await render(
      <DesignSystemProvider>
        <TextField
          label="Destino"
          value="Recife"
          onChangeText={jest.fn()}
          disabled
          testID="disabled-destination"
        />
      </DesignSystemProvider>,
    )

    const input = utils.getByLabelText('Destino')
    expect(input).toBeDisabled()
    expect(input).toHaveStyle({ backgroundColor: colorToken('sand'), borderWidth: 0 })
    expect(input).toHaveStyle({ color: colorToken('ink-muted') })
  })

  it('encaminha edição e mantém foco/blur para o consumidor', async () => {
    const onChangeText = jest.fn()
    const onFocus = jest.fn()
    const onBlur = jest.fn()
    const utils = await render(
      <DesignSystemProvider>
        <TextField
          label="Destino"
          value=""
          onChangeText={onChangeText}
          onFocus={onFocus}
          onBlur={onBlur}
        />
      </DesignSystemProvider>,
    )

    const input = utils.getByLabelText('Destino')
    await fireEvent.changeText(input, 'Recife')
    await fireEvent(input, 'focus')
    await fireEvent(input, 'blur')

    expect(onChangeText).toHaveBeenCalledWith('Recife')
    expect(onFocus).toHaveBeenCalledTimes(1)
    expect(onBlur).toHaveBeenCalledTimes(1)
  })

  it('seleciona Noto JP para valor Han-only quando o locale é japonês', async () => {
    const utils = await render(
      <DesignSystemProvider>
        <TextField label="住所" value="東京" onChangeText={jest.fn()} locale="ja-JP" />
      </DesignSystemProvider>,
    )

    expect(utils.getByLabelText('住所')).toHaveStyle({ fontFamily: 'Noto Sans JP' })
  })
})
