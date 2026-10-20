import { fireEvent, render } from '@testing-library/react-native'

import { DesignSystemProvider } from '../../../design-system'
import { MyTripsScreen } from '../my-trips-screen'

describe('tela Minhas viagens', () => {
  it('mostra estado vazio e CTA sem navegar para destino ainda inexistente', async () => {
    const screen = await render(
      <DesignSystemProvider>
        <MyTripsScreen />
      </DesignSystemProvider>,
    )

    expect(screen.getByTestId('trippy-wordmark')).toBeOnTheScreen()
    expect(screen.getByTestId('my-trips-screen')).toBeOnTheScreen()
    expect(screen.getByText('Minhas viagens')).toBeOnTheScreen()
    expect(screen.getByText('Você ainda não tem viagens.')).toBeOnTheScreen()

    const createTripButton = screen.getByTestId('my-trips-empty-create')
    expect(createTripButton).toHaveTextContent('Criar minha primeira viagem')
    await fireEvent.press(createTripButton)
    expect(screen.getByText('Minhas viagens')).toBeOnTheScreen()
  })
})
