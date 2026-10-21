import { fireEvent, render } from '@testing-library/react-native'

import { DesignSystemProvider } from '../../../design-system'
import { ApiDiagnosticsScreen } from '../api-diagnostics-screen'

const mockSetOffline = jest.fn<Promise<boolean>, [boolean]>()

jest.mock('../../sync/network-gate-runtime', () => ({
  networkGate: {
    setOffline: (offline: boolean) => mockSetOffline(offline),
  },
}))
jest.mock('../../sync/use-network-gate', () => ({
  useNetworkOffline: () => false,
}))
jest.mock('../health-client', () => ({
  checkApiHealth: jest.fn().mockResolvedValue({ status: 'available' }),
  getApiBaseUrl: () => 'http://localhost:3000',
}))

describe('interruptor de rede offline', () => {
  beforeEach(() => jest.clearAllMocks())

  it('expõe o interruptor de desenvolvimento e persiste o estado escolhido', async () => {
    const screen = await render(
      <DesignSystemProvider>
        <ApiDiagnosticsScreen />
      </DesignSystemProvider>,
    )

    const toggle = screen.getByTestId('simulate-offline-toggle')
    expect(toggle).toBeOnTheScreen()
    await fireEvent(toggle, 'valueChange', true)

    expect(mockSetOffline).toHaveBeenCalledWith(true)
  })
})
