import { fireEvent, render, waitFor } from '@testing-library/react-native'

import type { LivePlace, SyncClient } from '@trippy/sync'
import { DesignSystemProvider } from '../../../design-system'
import * as sessionProvider from '../../auth/session-provider'
import { SyncProvider } from '../../sync/sync-provider'
import { TodayScreen } from '../today-screen'

const DAY_MS = 86_400_000

function isoDayOffset(offset: number): string {
  const today = Date.UTC(
    new Date().getUTCFullYear(),
    new Date().getUTCMonth(),
    new Date().getUTCDate(),
  )
  return new Date(today + offset * DAY_MS).toISOString().slice(0, 10)
}

jest
  .spyOn(sessionProvider, 'useSession')
  .mockImplementation(
    () =>
      ({ session: { user: { id: 'user-1' } }, request: jest.fn() }) as unknown as ReturnType<
        typeof sessionProvider.useSession
      >,
  )

function place(overrides: Partial<LivePlace>): LivePlace {
  return {
    id: 'place-1',
    tripId: 'trip-1',
    name: 'Mercado Central',
    localName: null,
    dayIndex: 1,
    position: 0,
    visitedByMe: false,
    deletedAt: null,
    createdAt: new Date().toISOString(),
    localNameStatus: 'none',
    ...overrides,
  } as unknown as LivePlace
}

function createClient(places: LivePlace[], notSent = 0) {
  const client = {
    listPlaces: jest.fn().mockResolvedValue(places),
    markVisit: jest.fn().mockResolvedValue(undefined),
    unmarkVisit: jest.fn().mockResolvedValue(undefined),
    setFavorite: jest.fn().mockResolvedValue(undefined),
    listRemovedTrips: jest.fn().mockResolvedValue([]),
    countNotSent: jest.fn().mockResolvedValue(0),
    syncNow: jest.fn().mockResolvedValue(undefined),
    subscribe: jest.fn().mockReturnValue(() => undefined),
    getStatus: jest.fn().mockReturnValue({ lastSyncedAt: null, pending: 0, notSent }),
  }
  return client as unknown as SyncClient & typeof client
}

async function renderToday(
  client: SyncClient,
  startDate: string,
  endDate: string,
  onShowAddress?: (placeId: string) => void,
) {
  return await render(
    <DesignSystemProvider>
      <SyncProvider client={client}>
        <TodayScreen
          tripId="trip-1"
          tripName="Fim de semana"
          timezone="UTC"
          startDate={startDate}
          endDate={endDate}
          onOpenPhotos={jest.fn()}
          onShowAddress={onShowAddress}
        />
      </SyncProvider>
    </DesignSystemProvider>,
  )
}

describe('tela Hoje', () => {
  // Viagem de três dias que inclui hoje (dia 2 de 3).
  const start = isoDayOffset(-1)
  const end = isoDayOffset(1)

  it('mostra o dia da viagem, o próximo lugar e marca presença', async () => {
    const client = createClient([
      place({ id: 'place-1', name: 'Mercado Central', position: 0 }),
      place({ id: 'place-2', name: 'Feira Livre', position: 1 }),
    ])
    const screen = await renderToday(client, start, end)

    expect(await screen.findByTestId('hoje-dia')).toHaveTextContent(/Dia 2 de 3/u)
    expect(screen.getByTestId('hoje-proximo-lugar')).toHaveTextContent('Mercado Central')

    await fireEvent.press(screen.getByTestId('hoje-eu-fui-mercado-central'))
    // Pessoa local: o wrapper de escrita repassa o userId ausente como undefined.
    await waitFor(() =>
      expect(client.markVisit).toHaveBeenCalledWith('trip-1', 'place-1', undefined),
    )
  })

  it('marca e desmarca favorito pelo botão do lugar', async () => {
    const client = createClient([
      place({ id: 'place-1', name: 'Mercado Central', favoriteByMe: false }),
      place({ id: 'place-2', name: 'Feira Livre', position: 1, favoriteByMe: true }),
    ])
    const screen = await renderToday(client, start, end)

    expect(await screen.findByTestId('hoje-favorito-mercado-central')).toHaveTextContent('Favorito')
    expect(screen.getByTestId('hoje-favorito-feira-livre')).toHaveTextContent('Favorito ✓')

    await fireEvent.press(screen.getByTestId('hoje-favorito-mercado-central'))
    await waitFor(() => expect(client.setFavorite).toHaveBeenCalledWith('trip-1', 'place-1', true))

    await fireEvent.press(screen.getByTestId('hoje-favorito-feira-livre'))
    await waitFor(() => expect(client.setFavorite).toHaveBeenCalledWith('trip-1', 'place-2', false))
  })

  it('mostra o botão Mostrar endereço em cada lugar do dia', async () => {
    const onShowAddress = jest.fn()
    const client = createClient([place({ id: 'place-1', name: 'Mercado Central' })])
    const screen = await renderToday(client, start, end, onShowAddress)

    await fireEvent.press(await screen.findByTestId('hoje-mostrar-endereco-mercado-central'))
    expect(onShowAddress).toHaveBeenCalledWith('place-1')
  })

  it('mostra alterações não enviadas no banner de desatualização', async () => {
    const screen = await renderToday(createClient([], 2), start, end)

    expect(await screen.findByTestId('hoje-banner-desatualizacao')).toHaveTextContent(
      /2 registros não enviados/u,
    )
  })

  it('antes da viagem mostra a contagem e não lista lugares', async () => {
    const client = createClient([place({ dayIndex: 0 })])
    const screen = await renderToday(client, isoDayOffset(2), isoDayOffset(4))

    expect(await screen.findByTestId('hoje-dia')).toHaveTextContent(/A viagem começa em 2 dias/u)
    expect(screen.queryByTestId('hoje-proximo-lugar')).toBeNull()
    expect(screen.queryByTestId('hoje-lugar-mercado-central')).toBeNull()
  })

  it('mostra o cartão Estamos aqui durante a viagem', async () => {
    const screen = await renderToday(createClient([]), start, end)
    expect(await screen.findByTestId('hoje-estamos-aqui')).toBeOnTheScreen()
  })

  it('não mostra o cartão Estamos aqui antes da viagem', async () => {
    const screen = await renderToday(createClient([]), isoDayOffset(2), isoDayOffset(4))
    expect(await screen.findByTestId('hoje-dia')).toBeOnTheScreen()
    expect(screen.queryByTestId('hoje-estamos-aqui')).toBeNull()
  })
})
