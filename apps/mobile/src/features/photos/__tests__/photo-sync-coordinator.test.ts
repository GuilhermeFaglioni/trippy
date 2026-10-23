import type { PhotosClient } from '../photo-client'
import { openPhotoQueueRepository, type PhotoQueueRepository } from '../photo-queue'
import { PhotoSyncCoordinator, createPhotoSyncCoordinator } from '../photo-sync-coordinator'

jest.mock('../photo-queue', () => ({
  openPhotoQueueRepository: jest.fn(),
}))

const mockOpenPhotoQueueRepository = jest.mocked(openPhotoQueueRepository)

function createQueue(tripIds: string[]): PhotoQueueRepository {
  return {
    listPendingTripIds: jest.fn(async () => tripIds),
    recoverInterruptedUploads: jest.fn(async () => undefined),
    listWorkItems: jest.fn(async () => []),
  } as unknown as PhotoQueueRepository
}

describe('PhotoSyncCoordinator', () => {
  beforeEach(() => {
    mockOpenPhotoQueueRepository.mockReset()
  })

  it('keeps user queues and trip drains isolated', async () => {
    const queueA = createQueue(['trip-a', 'trip-shared'])
    const queueB = createQueue(['trip-b', 'trip-shared'])
    mockOpenPhotoQueueRepository.mockImplementation(async (userId) =>
      userId === 'user-a' ? queueA : queueB,
    )
    const client = {} as PhotosClient

    const coordinatorA = await createPhotoSyncCoordinator('user-a', client)
    const coordinatorB = await createPhotoSyncCoordinator('user-b', client)
    await Promise.all([coordinatorA.drainPendingTrips(), coordinatorB.drainPendingTrips()])

    expect(mockOpenPhotoQueueRepository).toHaveBeenNthCalledWith(1, 'user-a')
    expect(mockOpenPhotoQueueRepository).toHaveBeenNthCalledWith(2, 'user-b')
    expect((queueA.listWorkItems as jest.Mock).mock.calls.map(([tripId]) => tripId).sort()).toEqual(
      ['trip-a', 'trip-shared'],
    )
    expect((queueB.listWorkItems as jest.Mock).mock.calls.map(([tripId]) => tripId).sort()).toEqual(
      ['trip-b', 'trip-shared'],
    )
  })

  it('cancels pending trip passes when the coordinator is deactivated', async () => {
    let resolvePendingTrips!: (tripIds: string[]) => void
    const queue = createQueue([])
    ;(queue.listPendingTripIds as jest.Mock).mockImplementation(
      () => new Promise((resolve) => (resolvePendingTrips = resolve)),
    )
    const coordinator = new PhotoSyncCoordinator({
      userId: 'user-a',
      queue,
      client: {} as PhotosClient,
    })

    const pendingDrain = coordinator.drainPendingTrips()
    coordinator.deactivate()
    resolvePendingTrips(['trip-a'])
    await pendingDrain

    expect(queue.listWorkItems).not.toHaveBeenCalled()
  })
})
