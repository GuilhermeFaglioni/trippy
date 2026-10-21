import { fireEvent, render } from '@testing-library/react-native'

import { DesignSystemProvider } from '../../../design-system'
import {
  toTripPhotoRows,
  TripPhotosScreenView,
  type TripPhotosScreenViewProps,
} from '../trip-photos-screen'

const mockBack = jest.fn()

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: mockBack }),
  useFocusEffect: () => undefined,
}))

const baseProps: TripPhotosScreenViewProps = {
  tripName: 'Fim de semana em Paraty',
  photos: [
    {
      id: 'photo-a',
      uri: 'file:///documents/photo-a.jpg',
      locationLabel: 'Sem lugar',
      statusLabel: 'Enviando',
    },
  ],
  isLoading: false,
  isAdding: false,
  isRetrying: false,
  loadError: null,
  remoteError: null,
  actionError: null,
  onBack: jest.fn(),
  onAddPhotos: jest.fn(),
  onRetryUploads: jest.fn(),
}

async function renderScreen(props: TripPhotosScreenViewProps = baseProps) {
  return await render(
    <DesignSystemProvider>
      <TripPhotosScreenView {...props} />
    </DesignSystemProvider>,
  )
}

describe('TripPhotosScreenView', () => {
  beforeEach(() => jest.clearAllMocks())

  it('shows each photo with an accessible location and upload state', async () => {
    const screen = await renderScreen()

    expect(screen.getByText('Fim de semana em Paraty')).toBeOnTheScreen()
    expect(screen.getByTestId('trip-photo-photo-a')).toBeOnTheScreen()
    expect(screen.getByLabelText('Foto da viagem. Sem lugar. Enviando.')).toBeOnTheScreen()
    expect(screen.getByText('1 foto')).toBeOnTheScreen()
  })

  it('exposes selection, retry, and back controls', async () => {
    const screen = await renderScreen()

    await fireEvent.press(screen.getByTestId('trip-photos-add'))
    await fireEvent.press(screen.getByTestId('trip-photos-retry'))
    await fireEvent.press(screen.getByTestId('trip-photos-back'))

    expect(baseProps.onAddPhotos).toHaveBeenCalledTimes(1)
    expect(baseProps.onRetryUploads).toHaveBeenCalledTimes(1)
    expect(baseProps.onBack).toHaveBeenCalledTimes(1)
  })

  it('shows an empty state and separates unavailable server photos from local storage', async () => {
    const screen = await renderScreen({
      ...baseProps,
      photos: [],
      remoteError: 'offline',
    })

    expect(screen.getByText('As fotos da viagem aparecem aqui.')).toBeOnTheScreen()
    expect(screen.getByTestId('trip-photos-remote-error')).toBeOnTheScreen()
  })

  it('shows remote thumbnails for photos shared by the trip', () => {
    expect(
      toTripPhotoRows(
        [],
        [
          {
            id: 'remote-photo',
            status: 'ready',
            placeId: null,
            thumbnailUrl: 'https://photos.example.test/thumb.jpg',
            takenAtOriginal: null,
            takenTz: null,
            lat: null,
            lng: null,
          },
        ],
      ),
    ).toEqual([
      {
        id: 'remote-photo',
        uri: 'https://photos.example.test/thumb.jpg',
        locationLabel: 'Sem lugar',
        statusLabel: 'Pronta',
      },
    ])
  })
})
