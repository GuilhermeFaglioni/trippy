import { fireEvent, render, waitFor } from '@testing-library/react-native'

import * as sessionProvider from '../../auth/session-provider'
import * as syncProvider from '../../sync/sync-provider'
import { DesignSystemProvider } from '../../../design-system'
import { NewTripScreen } from '../new-trip-screen'
import type { TripSummary } from '../trips-client'

const mockReplace = jest.fn()
const mockRequest = jest.fn<Promise<Response>, [string, RequestInit?]>()
const mockSyncNow = jest.fn<Promise<void>, []>()
const mockRememberTripId = jest.fn()

jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace, back: jest.fn() }),
}))

jest
  .spyOn(sessionProvider, 'useSession')
  .mockImplementation(
    () => ({ request: mockRequest }) as unknown as ReturnType<typeof sessionProvider.useSession>,
  )
jest.spyOn(syncProvider, 'useSync').mockImplementation(
  () =>
    ({
      client: { syncNow: mockSyncNow },
      status: { lastSyncedAt: null, pending: 0, notSent: 0 },
      ready: true,
      error: null,
      rememberTripId: mockRememberTripId,
      rememberTripIds: jest.fn(),
    }) as unknown as ReturnType<typeof syncProvider.useSync>,
)

const trip: TripSummary = {
  id: '7ca841f4-1ceb-4597-b021-fbb3f80c5f9f',
  name: 'Férias em Recife',
  destination: 'Recife',
  startDate: '2027-02-10',
  endDate: '2027-02-14',
  timezone: 'America/Recife',
  role: 'organizer',
  phase: 'planning',
  createdAt: '2026-10-20T12:00:00.000Z',
}

async function renderScreen() {
  return await render(
    <DesignSystemProvider>
      <NewTripScreen />
    </DesignSystemProvider>,
  )
}

async function fillValidTrip(screen: Awaited<ReturnType<typeof renderScreen>>) {
  await fireEvent.changeText(screen.getByTestId('new-trip-name'), 'Férias em Recife')
  await fireEvent.changeText(screen.getByTestId('new-trip-destination'), 'Recife')
  await fireEvent.changeText(screen.getByTestId('new-trip-start-date'), '10 fev 2027')
  await fireEvent.changeText(screen.getByTestId('new-trip-end-date'), '14 fev 2027')
}

describe('tela Nova viagem', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('valida campos obrigatórios e datas inexistentes', async () => {
    mockRequest.mockResolvedValue(new Response(JSON.stringify({ trip }), { status: 201 }))
    const screen = await renderScreen()
    await fireEvent.changeText(screen.getByTestId('new-trip-start-date'), '31/02/2027')
    await fireEvent.press(screen.getByTestId('new-trip-submit'))

    expect(await screen.findByText('Informe o nome da viagem.')).toBeOnTheScreen()
    expect(screen.getByText('Informe o destino.')).toBeOnTheScreen()
    expect(screen.getAllByText('Informe uma data válida, como 12 out 2026.')).toHaveLength(2)
    expect(mockRequest).not.toHaveBeenCalled()
  })

  it('valida a ordem das datas', async () => {
    const screen = await renderScreen()
    await fillValidTrip(screen)
    await fireEvent.changeText(screen.getByTestId('new-trip-start-date'), '15 fev 2027')
    await fireEvent.press(screen.getByTestId('new-trip-submit'))

    expect(
      await screen.findByText('A volta deve ser no mesmo dia da ida ou depois.'),
    ).toBeOnTheScreen()
    expect(mockRequest).not.toHaveBeenCalled()
  })

  it('avisa que a capa ainda não é enviada', async () => {
    const screen = await renderScreen()

    await fireEvent.press(screen.getByTestId('new-trip-cover'))
    expect(screen.getByTestId('new-trip-cover-hint')).toBeOnTheScreen()
  })

  it('converte datas para ISO e volta à home após criar', async () => {
    mockRequest.mockResolvedValue(new Response(JSON.stringify({ trip }), { status: 201 }))
    const screen = await renderScreen()
    await fillValidTrip(screen)
    await fireEvent.changeText(screen.getByTestId('new-trip-start-date'), '27 fev 2028')
    await fireEvent.changeText(screen.getByTestId('new-trip-end-date'), '29 fev 2028')
    await fireEvent.press(screen.getByTestId('new-trip-submit'))

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/'))
    expect(mockRememberTripId).toHaveBeenCalledWith(trip.id)
    expect(mockSyncNow).toHaveBeenCalledTimes(1)
    expect(mockRequest).toHaveBeenCalledWith('/trips', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Férias em Recife',
        destination: 'Recife',
        startDate: '2028-02-27',
        endDate: '2028-02-29',
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }),
    })
  })

  it('mostra mensagem de erro retornada pela API', async () => {
    mockRequest.mockResolvedValue(
      new Response(
        JSON.stringify({ error: 'invalid_trip', message: 'Não foi possível salvar agora.' }),
        { status: 400 },
      ),
    )
    const screen = await renderScreen()
    await fillValidTrip(screen)
    await fireEvent.press(screen.getByTestId('new-trip-submit'))

    expect(await screen.findByTestId('new-trip-api-error')).toHaveAccessibleName(
      /Não foi possível salvar agora\./,
    )
    expect(mockReplace).not.toHaveBeenCalled()
  })
})
