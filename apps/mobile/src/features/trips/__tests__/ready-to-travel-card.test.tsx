import { act, fireEvent, render, waitFor } from '@testing-library/react-native'
import { Share } from 'react-native'

import type { LiveMember, LivePlace, SyncClient } from '@trippy/sync'
import { DesignSystemProvider } from '../../../design-system'
import * as sessionProvider from '../../auth/session-provider'
import * as healthClient from '../../diagnostics/health-client'
import * as syncProvider from '../../sync/sync-provider'
import { ReadyToTravelCard } from '../ready-to-travel-card'
import type { TripSummary } from '../trips-client'

const mockRequest = jest.fn<Promise<Response>, [string, RequestInit?]>()

jest.spyOn(sessionProvider, 'useSession').mockImplementation(
  () =>
    ({
      session: { user: { id: 'user-1' } },
      request: mockRequest,
    }) as unknown as ReturnType<typeof sessionProvider.useSession>,
)

function createTrip(overrides: Partial<TripSummary> = {}): TripSummary {
  return {
    id: 'trip-1',
    name: 'Xangai em família',
    destination: 'Xangai, China',
    startDate: '2026-11-05',
    endDate: '2026-11-12',
    timezone: 'Asia/Shanghai',
    role: 'organizer',
    phase: 'planning',
    createdAt: '2026-10-01T10:00:00.000Z',
    ...overrides,
  }
}

function createPlace(overrides: Partial<LivePlace> = {}): LivePlace {
  return {
    id: 'place-1',
    tripId: 'trip-1',
    provider: null,
    providerRef: null,
    countryCode: 'CN',
    providerDatasource: null,
    attribution: null,
    license: null,
    name: 'Templo do Jade',
    localName: null,
    address: null,
    localAddress: null,
    googlePlaceId: null,
    googleMatch: 'none',
    userLocalName: null,
    userLocalAddress: null,
    lat: null,
    lng: null,
    suggestedBy: 'user-1',
    comment: null,
    dayIndex: null,
    position: null,
    seq: '1',
    deletedAt: null,
    createdAt: '2026-10-20T12:00:00.000Z',
    visitedByMe: false,
    localNameStatus: 'missing',
    localAddressStatus: 'missing',
    ...overrides,
  }
}

const members: LiveMember[] = [
  {
    userId: 'user-1',
    role: 'organizer',
    joinedAt: '2026-10-01T10:00:00Z',
    openedAt: '2026-10-02T10:00:00Z',
  },
  { userId: 'user-2', role: 'member', joinedAt: '2026-10-01T10:00:00Z', openedAt: null },
]

function createClient({
  places = [createPlace()],
  people = members,
}: { places?: LivePlace[]; people?: LiveMember[] } = {}) {
  return {
    listPlaces: jest.fn().mockResolvedValue(places),
    listMembers: jest.fn().mockResolvedValue(people),
    subscribe: jest.fn().mockReturnValue(() => undefined),
  } as unknown as SyncClient
}

async function renderCard(client: SyncClient, trip: TripSummary = createTrip()) {
  jest.spyOn(syncProvider, 'useSync').mockImplementation(
    () =>
      ({
        client,
        status: { lastSyncedAt: null, pending: 0, notSent: 0 },
        ready: true,
        error: null,
      }) as unknown as ReturnType<typeof syncProvider.useSync>,
  )
  return await render(
    <DesignSystemProvider>
      <ReadyToTravelCard tripId="trip-1" tripName="Xangai em família" trip={trip} />
    </DesignSystemProvider>,
  )
}

describe('card Pronto para viajar', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.useFakeTimers({
      now: new Date('2026-10-30T12:00:00.000Z'),
      doNotFake: [
        'setTimeout',
        'clearTimeout',
        'setInterval',
        'clearInterval',
        'setImmediate',
        'clearImmediate',
        'nextTick',
        'queueMicrotask',
      ],
    })
    jest.spyOn(healthClient, 'getApiBaseUrl').mockReturnValue('https://api.trippy.test/')
    mockRequest.mockResolvedValue(
      new Response(JSON.stringify({ token: 'abc123' }), { status: 200 }),
    )
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('mostra pendências de endereço, recomendação para China e aberturas', async () => {
    const screen = await renderCard(createClient())

    expect(await screen.findByTestId('pronto-viajar-card')).toHaveTextContent(/Pronto para viajar/u)
    expect(screen.getByTestId('pronto-viajar-card')).toHaveTextContent(
      /1 lugar sem endereço no idioma local/u,
    )
    expect(screen.getByTestId('pronto-viajar-card')).toHaveTextContent(
      /Cadastre os endereços locais antes de embarcar: na China o mapa e a busca podem falhar./u,
    )
    expect(screen.getByTestId('pronto-viajar-card')).toHaveTextContent(
      /1 de 2 pessoas já abriram a viagem/u,
    )
    expect(screen.getByTestId('pronto-viajar-avisar')).toBeOnTheScreen()
  })

  it('Avisar cria o convite e compartilha o link sem barra dupla', async () => {
    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' } as never)
    const screen = await renderCard(createClient())

    const avisar = await screen.findByTestId('pronto-viajar-avisar')
    await act(async () => {
      fireEvent.press(avisar)
    })

    await waitFor(() =>
      expect(share).toHaveBeenCalledWith({
        message: 'Abra a viagem Xangai em família no Trippy: https://api.trippy.test/i/abc123',
      }),
    )
    expect(mockRequest).toHaveBeenCalledWith('/trips/trip-1/invites', { method: 'POST' })
  })

  it('mostra erro do convite como aviso e não compartilha', async () => {
    mockRequest.mockResolvedValue(
      new Response(JSON.stringify({ message: 'Convite indisponível.' }), { status: 500 }),
    )
    const share = jest.spyOn(Share, 'share')
    const screen = await renderCard(createClient())

    const avisar = await screen.findByTestId('pronto-viajar-avisar')
    await act(async () => {
      fireEvent.press(avisar)
    })

    expect(await screen.findByTestId('pronto-viajar-erro')).toHaveTextContent(
      'Convite indisponível.',
    )
    expect(share).not.toHaveBeenCalled()
  })

  it('some quando tudo está pronto e esconde Avisar sem pessoas pendentes', async () => {
    const screen = await renderCard(
      createClient({
        places: [createPlace({ localAddressStatus: 'ok' })],
        people: members.map((member) => ({ ...member, openedAt: '2026-10-02T10:00:00Z' })),
      }),
    )

    await waitFor(() => expect(screen.queryByTestId('pronto-viajar-card')).toBeNull())
    expect(screen.queryByTestId('pronto-viajar-avisar')).toBeNull()
  })

  it('não aparece fora da janela de 7 dias ou fora do planejamento', async () => {
    const far = await renderCard(
      createClient(),
      createTrip({ startDate: '2026-11-20', endDate: '2026-11-25' }),
    )
    await waitFor(() => expect(far.queryByTestId('pronto-viajar-card')).toBeNull())
    far.unmount()

    const traveling = await renderCard(createClient(), createTrip({ phase: 'traveling' }))
    await waitFor(() => expect(traveling.queryByTestId('pronto-viajar-card')).toBeNull())
  })
})
