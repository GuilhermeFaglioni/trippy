import { fireEvent, render, waitFor } from '@testing-library/react-native'

import * as sessionProvider from '../../auth/session-provider'
import { DesignSystemProvider } from '../../../design-system'
import { NewTripScreen } from '../new-trip-screen'
import type { TripSummary } from '../trips-client'

const mockReplace = jest.fn()
const mockRequest = jest.fn<Promise<Response>, [string, RequestInit?]>()

jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace }),
}))

jest
  .spyOn(sessionProvider, 'useSession')
  .mockImplementation(
    () => ({ request: mockRequest }) as unknown as ReturnType<typeof sessionProvider.useSession>,
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
  await fireEvent.changeText(screen.getByTestId('new-trip-start-date'), '10/02/2027')
  await fireEvent.changeText(screen.getByTestId('new-trip-end-date'), '14/02/2027')
  await fireEvent.changeText(screen.getByTestId('new-trip-timezone'), 'America/Recife')
}

describe('tela Nova viagem', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('pré-preenche o fuso do aparelho', async () => {
    const screen = await renderScreen()

    expect(screen.getByTestId('new-trip-timezone').props.value).toBe(
      Intl.DateTimeFormat().resolvedOptions().timeZone,
    )
  })

  it('valida campos obrigatórios e datas no formato DD/MM/AAAA', async () => {
    mockRequest.mockResolvedValue(new Response(JSON.stringify({ trip }), { status: 201 }))
    const screen = await renderScreen()
    await fireEvent.changeText(screen.getByTestId('new-trip-start-date'), '31/02/2027')
    await fireEvent.press(screen.getByTestId('new-trip-submit'))

    expect(await screen.findByText('Informe o nome da viagem.')).toBeOnTheScreen()
    expect(screen.getByText('Informe o destino.')).toBeOnTheScreen()
    expect(screen.getAllByText('Informe uma data válida no formato DD/MM/AAAA.')).toHaveLength(2)
    expect(mockRequest).not.toHaveBeenCalled()
  })

  it('valida ordem das datas e fuso IANA', async () => {
    const screen = await renderScreen()
    await fillValidTrip(screen)
    await fireEvent.changeText(screen.getByTestId('new-trip-start-date'), '15/02/2027')
    await fireEvent.changeText(screen.getByTestId('new-trip-timezone'), 'Mars/Olympus')
    await fireEvent.press(screen.getByTestId('new-trip-submit'))

    expect(
      await screen.findByText('A data de volta deve ser igual ou posterior à data de ida.'),
    ).toBeOnTheScreen()
    expect(screen.getByText('Informe um fuso horário IANA válido.')).toBeOnTheScreen()
    expect(mockRequest).not.toHaveBeenCalled()
  })

  it('converte datas para ISO e volta à home após criar', async () => {
    mockRequest.mockResolvedValue(new Response(JSON.stringify({ trip }), { status: 201 }))
    const screen = await renderScreen()
    await fillValidTrip(screen)
    await fireEvent.changeText(screen.getByTestId('new-trip-start-date'), '27/02/2028')
    await fireEvent.changeText(screen.getByTestId('new-trip-end-date'), '29/02/2028')
    await fireEvent.press(screen.getByTestId('new-trip-submit'))

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/'))
    expect(mockRequest).toHaveBeenCalledWith('/trips', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Férias em Recife',
        destination: 'Recife',
        startDate: '2028-02-27',
        endDate: '2028-02-29',
        timezone: 'America/Recife',
      }),
    })
  })

  it('mostra mensagem de erro retornada pela API', async () => {
    mockRequest.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: 'invalid_trip',
          message: 'O fuso horário informado não é válido.',
          fields: { timezone: 'Fuso inválido.' },
        }),
        { status: 400 },
      ),
    )
    const screen = await renderScreen()
    await fillValidTrip(screen)
    await fireEvent.press(screen.getByTestId('new-trip-submit'))

    expect(await screen.findByText('O fuso horário informado não é válido.')).toBeOnTheScreen()
    expect(mockReplace).not.toHaveBeenCalled()
  })
})
