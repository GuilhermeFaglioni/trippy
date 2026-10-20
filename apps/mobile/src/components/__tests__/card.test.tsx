import { fireEvent, render } from '@testing-library/react-native'
import { Text } from 'react-native'

import { DesignSystemProvider } from '../../design-system'
import { Card } from '../card'
import { colorToken, numericToken } from './test-tokens'

describe('Card', () => {
  it('renderiza conteúdo estático como superfície plana sem papel interativo', async () => {
    const utils = await render(
      <DesignSystemProvider>
        <Card testID="trip-card">
          <Text>Viagem para Recife</Text>
        </Card>
      </DesignSystemProvider>,
    )

    expect(utils.getByTestId('trip-card')).toHaveStyle({
      backgroundColor: colorToken('surface'),
      borderRadius: numericToken('radius-md'),
      padding: numericToken('space-4'),
    })
    expect(utils.queryByRole('button')).toBeNull()
    expect(utils.getByText('Viagem para Recife')).toBeOnTheScreen()
  })

  it('usa forest no destaque', async () => {
    const utils = await render(
      <DesignSystemProvider>
        <Card variant="highlight" testID="highlight-card">
          <Text>Próximo lugar</Text>
        </Card>
      </DesignSystemProvider>,
    )

    expect(utils.getByTestId('highlight-card')).toHaveStyle({
      backgroundColor: colorToken('forest'),
    })
  })

  it('torna card interativo um botão acessível com alvo e foco visíveis', async () => {
    const onPress = jest.fn()
    const utils = await render(
      <DesignSystemProvider>
        <Card accessibilityLabel="Viagem para Recife" onPress={onPress} testID="interactive-card">
          <Text>Viagem para Recife</Text>
        </Card>
      </DesignSystemProvider>,
    )

    const card = utils.getByRole('button', { name: 'Viagem para Recife' })
    expect(card).toHaveStyle({
      minHeight: numericToken('target-min'),
      minWidth: numericToken('target-min'),
    })

    await fireEvent.press(card)
    expect(onPress).toHaveBeenCalledTimes(1)

    await fireEvent(card, 'focus')
    expect(utils.getByTestId('interactive-card-focus-ring')).toHaveStyle({
      borderColor: colorToken('focus'),
      borderWidth: 2,
      padding: 2,
    })
  })
})
