import { fireEvent, render, waitFor } from '@testing-library/react-native'
import { Linking } from 'react-native'
import type { LivePlace, SyncClient } from '@trippy/sync'
import type { GoogleDetailsResponse } from '@trippy/domain'

import { DesignSystemProvider } from '../../../design-system'
import * as sessionProvider from '../../auth/session-provider'
import { PlaceCard } from '../place-card'

const mockRequest = jest.fn<Promise<Response>, [string, RequestInit?]>()
let mockOffline = false

jest.mock('expo-image', () => ({ Image: 'Image' }))
jest.mock('../../sync/use-network-gate', () => ({ useNetworkOffline: () => mockOffline }))

const details: GoogleDetailsResponse = {
  candidateIds: ['google-place-1', 'google-place-2'],
  current: {
    googlePlaceId: 'google-place-1',
    name: 'Nome do Google',
    type: 'Museu',
    address: 'Endereço do Google',
    photo: {
      uri: 'https://images.example/google-photo',
      widthPx: 640,
      heightPx: 480,
      authorAttributions: [
        {
          displayName: 'Autora da foto',
          uri: 'https://authors.example/profile',
          photoUri: 'https://authors.example/photo',
        },
      ],
    },
    googleMapsUri: 'https://maps.google.com/?q=place',
  },
}

function response(payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status: 200 })
}

function createPlace(overrides: Partial<LivePlace> = {}): LivePlace {
  return {
    id: 'place-1',
    tripId: 'trip-1',
    provider: 'geoapify',
    providerRef: 'geo-1',
    providerDatasource: 'openstreetmap',
    attribution: '© OpenStreetMap contributors',
    license: 'ODbL',
    name: 'Museu da Cidade',
    localName: null,
    address: 'City Museum, 1 Main Road',
    localAddress: null,
    googlePlaceId: null,
    googleMatch: 'none',
    userLocalName: null,
    userLocalAddress: null,
    lat: -23.55,
    lng: -46.63,
    suggestedBy: 'user-1',
    comment: null,
    dayIndex: null,
    position: null,
    seq: '1',
    deletedAt: null,
    createdAt: '2026-10-20T12:00:00.000Z',
    visitedByMe: false,
    wantCount: 0,
    wantedByMe: false,
    favoriteByMe: false,
    localNameStatus: 'missing',
    localAddressStatus: 'missing',
    countryCode: 'BR',
    ...overrides,
  }
}

const syncClient = {
  addPlace: jest.fn(),
  addPlaceFromCandidate: jest.fn(),
  removePlace: jest.fn(),
  linkGooglePlace: jest.fn().mockResolvedValue(undefined),
  setLocalDetails: jest.fn().mockResolvedValue(undefined),
  markVisit: jest.fn(),
  unmarkVisit: jest.fn(),
  syncNow: jest.fn(),
  listPlaces: jest.fn().mockResolvedValue([]),
  subscribe: jest.fn(() => () => undefined),
  getStatus: jest.fn(),
} as unknown as SyncClient

async function renderCard(
  place = createPlace(),
  options: { role?: 'organizer' | 'coorganizer' | 'member'; currentUserId?: string | null } = {},
) {
  jest
    .spyOn(sessionProvider, 'useSession')
    .mockImplementation(
      () =>
        ({ session: { user: { id: 'user-1' } }, request: mockRequest }) as unknown as ReturnType<
          typeof sessionProvider.useSession
        >,
    )

  return render(
    <DesignSystemProvider>
      <PlaceCard
        place={place}
        tripId="trip-1"
        currentUserId={options.currentUserId === undefined ? 'user-1' : options.currentUserId}
        role={options.role ?? 'member'}
        syncClient={syncClient}
        busy={false}
        onOpen={jest.fn()}
        onToggleVisit={jest.fn()}
        onToggleWant={jest.fn()}
        onRefresh={async () => undefined}
        testSlug="museu-da-cidade"
      />
    </DesignSystemProvider>,
  )
}

describe('ficha do lugar', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockOffline = false
    jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined)
  })

  it.each([
    ['online', false, { provider: 'geoapify', attribution: '© OpenStreetMap contributors' }],
    ['offline', true, { provider: 'geoapify', attribution: '© OpenStreetMap contributors' }],
    ['lugar manual', false, { provider: null, providerDatasource: null, attribution: null }],
    ['Google confirmado', false, { googleMatch: 'matched' }],
    ['sem correspondência', false, { googleMatch: 'no_match' }],
  ])('mostra proveniência e estado de atribuição (%s)', async (_name, offline, overrides) => {
    mockOffline = offline
    const place = createPlace(overrides as Partial<LivePlace>)
    const screen = await renderCard(place)

    if (place.provider === null) {
      expect(screen.getByTestId('place-attribution-museu-da-cidade')).toHaveTextContent(
        /cadastrado manualmente · sem fornecedor/,
      )
    } else {
      expect(screen.getByTestId('place-attribution-museu-da-cidade')).toHaveTextContent(
        /© OpenStreetMap contributors/,
      )
      expect(screen.getByTestId('place-attribution-museu-da-cidade')).toHaveTextContent(
        /Powered by Geoapify/,
      )
    }
    if (place.googleMatch === 'matched') {
      expect(screen.getByTestId('google-match-museu-da-cidade')).toHaveTextContent(
        'Correspondência do Google confirmada',
      )
    }
    if (place.googleMatch === 'no_match') {
      expect(screen.getByTestId('google-match-museu-da-cidade')).toHaveTextContent(
        'Sem correspondência no Google',
      )
    }
  })

  it('mostra o rótulo Quero ir com contagem e marca selecionado só quando já quer ir', async () => {
    const pending = await renderCard(createPlace({ wantCount: 2, wantedByMe: false }))
    expect(pending.getByTestId('place-want-museu-da-cidade')).toHaveTextContent(/^Quero ir · 2$/)
    expect(pending.getByTestId('place-want-museu-da-cidade')).not.toBeSelected()

    const wanted = await renderCard(createPlace({ wantCount: 2, wantedByMe: true }))
    expect(wanted.getByTestId('place-want-museu-da-cidade')).toHaveTextContent(/^Quero ir ✓ · 2$/)
    expect(wanted.getByTestId('place-want-museu-da-cidade')).toBeSelected()
  })

  it('mostra nome e endereço locais junto à ficha com tipografia local', async () => {
    const screen = await renderCard(
      createPlace({ localName: 'Museu local', localAddress: 'Rua local, 1' }),
    )

    expect(screen.getByTestId('place-local-name-museu-da-cidade')).toHaveTextContent('Museu local')
    expect(screen.getByTestId('place-local-address-museu-da-cidade')).toHaveTextContent(
      'Rua local, 1',
    )
  })

  it('classifica pendências locais, deixa editar e permite salvar com aviso', async () => {
    const screen = await renderCard(createPlace({ countryCode: 'CN' }))

    expect(screen.getByTestId('local-name-warning-place-1')).toHaveTextContent(/Nome local ausente/)
    expect(screen.getByTestId('local-address-warning-place-1')).toHaveTextContent(
      /Endereço local ausente/,
    )

    await fireEvent.changeText(screen.getByTestId('local-name-place-1'), 'Forbidden City')
    await fireEvent.changeText(screen.getByTestId('local-address-place-1'), 'Rua')
    expect(screen.getByTestId('local-name-warning-place-1')).toHaveTextContent(
      /pode não estar no idioma do destino/,
    )
    expect(screen.getByTestId('local-address-warning-place-1')).toHaveTextContent(
      /parece incompleto/,
    )

    await fireEvent.press(screen.getByTestId('save-local-details-place-1'))
    await waitFor(() =>
      expect(syncClient.setLocalDetails).toHaveBeenCalledWith('trip-1', 'place-1', {
        localName: 'Forbidden City',
        localAddress: 'Rua',
      }),
    )
  })

  it('exibe Google separado com marca, foto sem cache, atribuição e links', async () => {
    mockRequest.mockImplementation(async () => response(details))
    const screen = await renderCard()

    await fireEvent.press(screen.getByTestId('google-details-button-place-1'))

    expect(await screen.findByTestId('google-details-block-place-1')).toBeOnTheScreen()
    expect(screen.getByTestId('google-maps-brand')).toHaveTextContent('Google Maps')
    expect(screen.getByTestId('google-details-content-place-1')).toHaveTextContent(/Nome do Google/)
    expect(screen.getByTestId('google-details-content-place-1')).toHaveTextContent(/Museu/)
    expect(screen.getByTestId('google-details-content-place-1')).toHaveTextContent(
      /Endereço do Google/,
    )
    expect(screen.getByTestId('google-place-photo-place-1').props.cachePolicy).toBe('none')
    expect(screen.getByTestId('google-photo-author-place-1-0')).toHaveTextContent('Autora da foto')
    expect(screen.getByTestId('open-google-maps-place-1')).toHaveTextContent('Abrir no Google Maps')

    await fireEvent.press(screen.getByTestId('google-photo-author-place-1-0'))
    await waitFor(() =>
      expect(Linking.openURL).toHaveBeenCalledWith('https://authors.example/profile'),
    )
    await fireEvent.press(screen.getByTestId('open-google-maps-place-1'))
    await waitFor(() =>
      expect(Linking.openURL).toHaveBeenCalledWith('https://maps.google.com/?q=place'),
    )
    expect(screen.getByTestId('google-confirm-yes-place-1')).toBeOnTheScreen()
  })

  it('busca outro candidato e salva recusa sem correspondência', async () => {
    mockRequest.mockImplementation(async (_path, init) => {
      const body = init?.body ? JSON.parse(String(init.body)) : undefined
      return response({
        ...details,
        current: { ...details.current, googlePlaceId: body?.googlePlaceId ?? 'google-place-1' },
      })
    })
    const screen = await renderCard()

    await fireEvent.press(screen.getByTestId('google-details-button-place-1'))
    expect(await screen.findByTestId('google-next-candidate-place-1')).toBeOnTheScreen()
    await fireEvent.press(screen.getByTestId('google-next-candidate-place-1'))
    await waitFor(() =>
      expect(mockRequest).toHaveBeenLastCalledWith('/trips/trip-1/places/place-1/google-details', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ googlePlaceId: 'google-place-2' }),
      }),
    )
    await fireEvent.press(screen.getByTestId('google-confirm-no-place-1'))
    await waitFor(() =>
      expect(syncClient.linkGooglePlace).toHaveBeenCalledWith('trip-1', 'place-1', null),
    )
  })

  it('confirma correspondência salvando apenas o Google place_id', async () => {
    mockRequest.mockImplementation(async () => response(details))
    const screen = await renderCard()

    await fireEvent.press(screen.getByTestId('google-details-button-place-1'))
    expect(await screen.findByTestId('google-confirm-yes-place-1')).toBeOnTheScreen()
    await fireEvent.press(screen.getByTestId('google-confirm-yes-place-1'))

    await waitFor(() =>
      expect(syncClient.linkGooglePlace).toHaveBeenCalledWith(
        'trip-1',
        'place-1',
        'google-place-1',
      ),
    )
  })

  it('não mostra confirmação para membro que não sugeriu o lugar', async () => {
    mockRequest.mockImplementation(async () => response(details))
    const screen = await renderCard(createPlace({ suggestedBy: 'other-user' }))

    await fireEvent.press(screen.getByTestId('google-details-button-place-1'))
    expect(await screen.findByText('Nome do Google')).toBeOnTheScreen()
    expect(screen.queryByTestId('google-confirm-yes-place-1')).toBeNull()
    expect(screen.queryByTestId('google-confirm-no-place-1')).toBeNull()
  })

  it('mostra detalhes indisponíveis offline sem consultar a API ou reaproveitar a foto', async () => {
    mockOffline = true
    const screen = await renderCard()

    await fireEvent.press(screen.getByTestId('google-details-button-place-1'))
    expect(await screen.findByTestId('google-details-offline-place-1')).toHaveTextContent(
      /indisponíveis sem internet/,
    )
    expect(screen.queryByTestId('google-place-photo-place-1')).toBeNull()
    expect(mockRequest).not.toHaveBeenCalled()
  })

  it('remove detalhes e foto da tela quando conexão cai depois da resposta', async () => {
    mockRequest.mockImplementation(async () => response(details))
    const place = createPlace()
    const card = (
      <DesignSystemProvider>
        <PlaceCard
          place={place}
          tripId="trip-1"
          currentUserId="user-1"
          role="member"
          syncClient={syncClient}
          busy={false}
          onOpen={jest.fn()}
          onToggleVisit={jest.fn()}
          onToggleWant={jest.fn()}
          onRefresh={async () => undefined}
          testSlug="museu-da-cidade"
        />
      </DesignSystemProvider>
    )
    const screen = await renderCard(place)

    await fireEvent.press(screen.getByTestId('google-details-button-place-1'))
    expect(await screen.findByTestId('google-place-photo-place-1')).toBeOnTheScreen()

    mockOffline = true
    await screen.rerender(card)

    await waitFor(() => expect(screen.queryByTestId('google-place-photo-place-1')).toBeNull())
    expect(screen.getByTestId('google-details-offline-place-1')).toHaveTextContent(
      /indisponíveis sem internet/,
    )
  })
})
