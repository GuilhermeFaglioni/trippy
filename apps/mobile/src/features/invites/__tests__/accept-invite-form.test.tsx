import { fireEvent, render, waitFor } from '@testing-library/react-native'

import { RECAP_SHARING_TERMS_VERSION, type SyncClient } from '@trippy/sync'
import { DesignSystemProvider } from '../../../design-system'
import * as sessionProvider from '../../auth/session-provider'
import * as syncProvider from '../../sync/sync-provider'
import { AcceptInviteForm } from '../accept-invite-form'
import type { TripSummary } from '../../trips/trips-client'

const mockPush = jest.fn()
const mockRequest = jest.fn<Promise<Response>, [string, RequestInit?]>()
const mockSyncNow = jest.fn<Promise<void>, []>()

jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }))

jest
  .spyOn(sessionProvider, 'useSession')
  .mockImplementation(
    () => ({ request: mockRequest }) as unknown as ReturnType<typeof sessionProvider.useSession>,
  )
jest.spyOn(syncProvider, 'useSync').mockImplementation(
  () =>
    ({
      client: { syncNow: mockSyncNow } as unknown as SyncClient,
      status: { lastSyncedAt: null, pending: 0, notSent: 0 },
      ready: true,
      error: null,
      rememberTripId: jest.fn(),
      rememberTripIds: jest.fn(),
    }) as unknown as ReturnType<typeof syncProvider.useSync>,
)

const trip: TripSummary = {
  id: '58f75ed5-b524-46f8-b387-650d9b43ee36',
  name: 'Fim de semana',
  destination: 'Paraty',
  startDate: '2027-03-14',
  endDate: '2027-03-16',
  timezone: 'America/Sao_Paulo',
  role: 'member',
  phase: 'planning',
  createdAt: '2026-10-20T12:00:00.000Z',
}

describe('formulário de entrada por convite', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockSyncNow.mockResolvedValue(undefined)
  })

  it('aceita o código, sincroniza a nova viagem e abre a tela da viagem', async () => {
    mockRequest.mockResolvedValue(new Response(JSON.stringify({ trip }), { status: 200 }))
    const screen = await render(
      <DesignSystemProvider>
        <AcceptInviteForm />
      </DesignSystemProvider>,
    )

    await fireEvent.changeText(screen.getByTestId('accept-invite-code'), ' código-123 ')
    await fireEvent.press(screen.getByTestId('accept-invite-button'))
    await fireEvent.press(screen.getByTestId('accept-invite-terms-accept'))

    await waitFor(() => {
      expect(mockRequest).toHaveBeenCalledWith(
        '/invites/accept',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ token: 'código-123', termsVersion: RECAP_SHARING_TERMS_VERSION }),
        }),
      )
      expect(mockSyncNow).toHaveBeenCalledTimes(1)
      expect(mockPush).toHaveBeenCalledWith({
        pathname: '/trips/[id]',
        params: { id: trip.id, tripName: trip.name, role: trip.role },
      })
    })
  })

  it('ao recusar o aviso, fecha-o e limpa o código sem chamar a API', async () => {
    const screen = await render(
      <DesignSystemProvider>
        <AcceptInviteForm />
      </DesignSystemProvider>,
    )

    await fireEvent.changeText(screen.getByTestId('accept-invite-code'), 'código-123')
    await fireEvent.press(screen.getByTestId('accept-invite-button'))
    expect(screen.getByTestId('accept-invite-terms')).toBeTruthy()

    await fireEvent.press(screen.getByTestId('accept-invite-terms-decline'))

    expect(screen.queryByTestId('accept-invite-terms')).toBeNull()
    expect(screen.getByTestId('accept-invite-code').props.value).toBe('')
    expect(mockRequest).not.toHaveBeenCalled()
  })
})
