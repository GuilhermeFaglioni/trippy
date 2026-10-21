import { act, fireEvent, render, waitFor } from '@testing-library/react-native'
import { useEffect as reactUseEffect } from 'react'

import * as sessionProvider from '../../auth/session-provider'
import * as syncProvider from '../../sync/sync-provider'
import { DesignSystemProvider } from '../../../design-system'
import { MyTripsScreen } from '../my-trips-screen'
import type { TripSummary } from '../trips-client'

const mockPush = jest.fn()
const mockRequest = jest.fn<Promise<Response>, [string, RequestInit?]>()
const mockRememberTripIds = jest.fn()
const mockSyncNow = jest.fn<Promise<void>, []>()
const mockSyncClient = { syncNow: mockSyncNow }
const mockUseEffect = reactUseEffect
let mockFocusCallback: (() => void | (() => void)) | undefined

jest.mock('expo-router', () => {
  return {
    useRouter: () => ({ push: mockPush }),
    useFocusEffect: (callback: () => void | (() => void)) => {
      mockFocusCallback = callback
      mockUseEffect(() => callback(), [callback])
    },
  }
})

jest
  .spyOn(sessionProvider, 'useSession')
  .mockImplementation(
    () => ({ request: mockRequest }) as unknown as ReturnType<typeof sessionProvider.useSession>,
  )
jest.spyOn(syncProvider, 'useSync').mockImplementation(
  () =>
    ({
      client: mockSyncClient,
      status: { lastSyncedAt: null, pending: 0, notSent: 0 },
      ready: true,
      error: null,
      rememberTripId: jest.fn(),
      rememberTripIds: mockRememberTripIds,
    }) as unknown as ReturnType<typeof syncProvider.useSync>,
)

const trip: TripSummary = {
  id: '58f75ed5-b524-46f8-b387-650d9b43ee36',
  name: 'Fim de semana',
  destination: 'Paraty',
  startDate: '2027-03-14',
  endDate: '2027-03-16',
  timezone: 'America/Sao_Paulo',
  role: 'organizer',
  phase: 'planning',
  createdAt: '2026-10-20T12:00:00.000Z',
}

function response(trips: TripSummary[]) {
  return new Response(JSON.stringify({ trips }), { status: 200 })
}

async function renderScreen() {
  return await render(
    <DesignSystemProvider>
      <MyTripsScreen />
    </DesignSystemProvider>,
  )
}

describe('tela Minhas viagens', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockSyncNow.mockResolvedValue(undefined)
    mockFocusCallback = undefined
  })

  it('mostra carregamento enquanto busca as viagens', async () => {
    mockRequest.mockReturnValue(new Promise(() => undefined))

    const screen = await renderScreen()

    expect(screen.getByTestId('my-trips-loading')).toBeOnTheScreen()
  })

  it('mantém estado vazio e abre Nova viagem', async () => {
    mockRequest.mockResolvedValue(response([]))
    const screen = await renderScreen()

    expect(screen.getByTestId('trippy-wordmark')).toBeOnTheScreen()
    expect(screen.getByTestId('my-trips-screen')).toBeOnTheScreen()
    expect(screen.getByText('Minhas viagens')).toBeOnTheScreen()
    expect(await screen.findByText('Você ainda não tem viagens.')).toBeOnTheScreen()
    expect(screen.getByTestId('accept-invite-code')).toBeOnTheScreen()
    expect(screen.getByTestId('accept-invite-button')).toBeOnTheScreen()

    const createTripButton = screen.getByTestId('my-trips-empty-create')
    expect(createTripButton).toHaveTextContent('Criar minha primeira viagem')
    await fireEvent.press(createTripButton)
    expect(mockPush).toHaveBeenCalledWith('/trips/new')
  })

  it('lista cards, datas formatadas, fase e ação de criar outra viagem', async () => {
    mockRequest.mockResolvedValue(
      response([
        trip,
        {
          ...trip,
          id: '7ca841f4-1ceb-4597-b021-fbb3f80c5f9f',
          name: 'Viagem em curso',
          destination: 'Brasília',
          phase: 'traveling',
        },
        {
          ...trip,
          id: '88362a44-f59f-437e-a682-79966a68650a',
          name: 'Viagem encerrada',
          destination: 'Ouro Preto',
          phase: 'ended',
        },
      ]),
    )
    const screen = await renderScreen()

    expect(
      await screen.findByTestId('trip-card-58f75ed5-b524-46f8-b387-650d9b43ee36'),
    ).toBeOnTheScreen()
    expect(screen.getByTestId('trip-card-7ca841f4-1ceb-4597-b021-fbb3f80c5f9f')).toBeOnTheScreen()
    expect(screen.getByTestId('trip-card-88362a44-f59f-437e-a682-79966a68650a')).toBeOnTheScreen()
    expect(screen.getByText('Fim de semana')).toBeOnTheScreen()
    expect(screen.getByText('Paraty')).toBeOnTheScreen()
    expect(screen.getAllByText('14/03/2027 – 16/03/2027')).toHaveLength(3)
    expect(screen.getAllByTestId('trip-card-phase')).toHaveLength(3)
    expect(screen.getByText('Planejando')).toBeOnTheScreen()
    expect(screen.getByText('Em viagem')).toBeOnTheScreen()
    expect(screen.getByText('Encerrada')).toBeOnTheScreen()

    await fireEvent.press(screen.getByTestId('trip-card-58f75ed5-b524-46f8-b387-650d9b43ee36'))
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/trips/[id]',
      params: { id: trip.id, tripName: trip.name, role: trip.role },
    })
    expect(mockRememberTripIds).toHaveBeenCalledWith([
      trip.id,
      '7ca841f4-1ceb-4597-b021-fbb3f80c5f9f',
      '88362a44-f59f-437e-a682-79966a68650a',
    ])
    expect(mockSyncNow).toHaveBeenCalledTimes(1)
    expect(mockRememberTripIds.mock.invocationCallOrder[0]).toBeLessThan(
      mockSyncNow.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    )
    mockPush.mockClear()

    await fireEvent.press(screen.getByTestId('my-trips-new-trip'))
    expect(mockPush).toHaveBeenCalledWith('/trips/new')
  })

  it('exibe falha de rede e permite tentar novamente', async () => {
    mockRequest.mockRejectedValueOnce(new Error('Falha de rede.'))
    mockRequest.mockResolvedValueOnce(response([]))
    const screen = await renderScreen()

    expect(await screen.findByText('Falha de rede.')).toBeOnTheScreen()
    await fireEvent.press(screen.getByTestId('my-trips-retry'))
    expect(await screen.findByText('Você ainda não tem viagens.')).toBeOnTheScreen()
  })

  it('recarrega as viagens quando a tela volta ao foco', async () => {
    mockRequest.mockResolvedValue(response([trip]))
    await renderScreen()

    await waitFor(() => expect(mockRequest).toHaveBeenCalledTimes(1))
    await act(async () => {
      mockFocusCallback?.()
    })

    await waitFor(() => expect(mockRequest).toHaveBeenCalledTimes(2))
  })
})
