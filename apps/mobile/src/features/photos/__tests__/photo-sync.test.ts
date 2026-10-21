import { PhotoSyncController } from '../photo-sync'
import type { PhotosClient } from '../photo-client'
import type { PhotoQueueRepository, QueuedPhoto } from '../photo-queue'

const PHOTO_ID = '5d45fb88-a53a-4e8a-bdc5-fae263cff016'

class MemoryPhotoQueue implements PhotoQueueRepository {
  readonly photos: QueuedPhoto[] = [
    {
      photoId: PHOTO_ID,
      tripId: 'trip-a',
      originalUri: 'file:///documents/original.heic',
      uploadUri: 'file:///documents/upload.jpg',
      takenAtOriginal: '2026-10-20T07:06:05',
      takenTz: '+08:00',
      lat: 31.22,
      lng: 121.47,
      width: 4032,
      height: 3024,
      status: 'queued',
      attempts: 0,
      lastError: null,
      createdAt: '2026-10-20T10:00:00.000Z',
    },
  ]

  async addPreparing(): Promise<void> {}

  async markPrepared(photoId: string, uploadUri: string): Promise<void> {
    const photo = this.find(photoId)
    photo.uploadUri = uploadUri
    photo.status = 'queued'
  }

  async listTripPhotos(tripId: string): Promise<QueuedPhoto[]> {
    return this.photos.filter((photo) => photo.tripId === tripId).map((photo) => ({ ...photo }))
  }

  async listWorkItems(tripId: string): Promise<QueuedPhoto[]> {
    return this.photos
      .filter((photo) => photo.tripId === tripId && photo.status !== 'complete')
      .map((photo) => ({ ...photo }))
  }

  async listPendingTripIds(): Promise<string[]> {
    return [
      ...new Set(
        this.photos.filter((photo) => photo.status !== 'complete').map((photo) => photo.tripId),
      ),
    ].sort()
  }

  async recoverInterruptedUploads(): Promise<void> {
    for (const photo of this.photos) {
      if (photo.status === 'uploading') photo.status = 'queued'
    }
  }

  async markUploading(photoId: string): Promise<void> {
    this.find(photoId).status = 'uploading'
  }

  async markAwaitingConfirmation(photoId: string): Promise<void> {
    this.find(photoId).status = 'awaiting_confirmation'
  }

  async markComplete(photoId: string): Promise<void> {
    this.find(photoId).status = 'complete'
  }

  async markFailed(photoId: string, error: unknown): Promise<void> {
    const photo = this.find(photoId)
    photo.status = 'failed'
    photo.lastError = error instanceof Error ? error.message : String(error)
    photo.attempts += 1
  }

  async recordConfirmationError(photoId: string, error: unknown): Promise<void> {
    const photo = this.find(photoId)
    photo.lastError = error instanceof Error ? error.message : String(error)
  }

  private find(photoId: string): QueuedPhoto {
    const photo = this.photos.find((item) => item.photoId === photoId)
    if (!photo) throw new Error('Foto não encontrada na fila.')
    return photo
  }
}

function createClient(overrides: Partial<PhotosClient> = {}): PhotosClient {
  return {
    reserveUpload: jest.fn(async (tripId, photo) => ({
      id: photo.id,
      uploadUrl: `https://minio/${tripId}/${photo.id}`,
    })),
    completeUpload: jest.fn(async () => undefined),
    listTripPhotos: jest.fn(async () => []),
    ...overrides,
  }
}

describe('PhotoSyncController', () => {
  it('renews an expired signed URL and retries with the same UUID', async () => {
    const queue = new MemoryPhotoQueue()
    const client = createClient({
      reserveUpload: jest
        .fn()
        .mockResolvedValueOnce({
          id: PHOTO_ID,
          uploadUrl: 'http://localhost:59000/expired?sig=old',
        })
        .mockResolvedValueOnce({ id: PHOTO_ID, uploadUrl: 'http://localhost:59000/new?sig=new' }),
    })
    const uploadFile = jest
      .fn()
      .mockRejectedValueOnce(new Error('URL pré-assinada expirada.'))
      .mockResolvedValueOnce(undefined)
    const controller = new PhotoSyncController({
      tripId: 'trip-a',
      queue,
      client,
      uploadFile,
      preparePhoto: async (photo) => photo.uploadUri ?? 'file:///documents/upload.jpg',
    })

    await controller.drain()
    expect(queue.photos[0]).toMatchObject({ status: 'failed', attempts: 1, photoId: PHOTO_ID })
    expect(uploadFile).toHaveBeenCalledTimes(1)
    await controller.drain()

    expect(client.reserveUpload).toHaveBeenCalledTimes(2)
    expect(client.reserveUpload).toHaveBeenNthCalledWith(
      2,
      'trip-a',
      expect.objectContaining({ id: PHOTO_ID }),
    )
    expect(uploadFile.mock.calls).toEqual([
      ['http://localhost:59000/expired?sig=old', 'file:///documents/upload.jpg'],
      ['http://localhost:59000/new?sig=new', 'file:///documents/upload.jpg'],
    ])
    expect(queue.photos[0].status).toBe('complete')
  })

  it('retries confirmation after a successful PUT without sending the JPEG again', async () => {
    const queue = new MemoryPhotoQueue()
    const client = createClient({
      completeUpload: jest
        .fn()
        .mockRejectedValueOnce(new Error('Confirmação temporariamente indisponível.'))
        .mockResolvedValueOnce(undefined),
    })
    const uploadFile = jest.fn(async () => undefined)
    const controller = new PhotoSyncController({
      tripId: 'trip-a',
      queue,
      client,
      uploadFile,
      preparePhoto: async (photo) => photo.uploadUri ?? 'file:///documents/upload.jpg',
    })

    await controller.drain()
    expect(queue.photos[0]).toMatchObject({
      status: 'awaiting_confirmation',
      lastError: 'Confirmação temporariamente indisponível.',
    })
    await controller.drain()

    expect(client.reserveUpload).toHaveBeenCalledTimes(1)
    expect(uploadFile).toHaveBeenCalledTimes(1)
    expect(client.completeUpload).toHaveBeenCalledTimes(2)
    expect(queue.photos[0].status).toBe('complete')
  })

  it('serializes concurrent drains of the same trip', async () => {
    const queue = new MemoryPhotoQueue()
    const client = createClient()
    let releaseUpload!: () => void
    let announceUploadStarted!: () => void
    const uploadStarted = new Promise<void>((resolve) => {
      announceUploadStarted = resolve
    })
    const uploadFile = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          releaseUpload = resolve
          announceUploadStarted()
        }),
    )
    const controller = new PhotoSyncController({
      tripId: 'trip-a',
      queue,
      client,
      uploadFile,
      preparePhoto: async (photo) => photo.uploadUri ?? 'file:///documents/upload.jpg',
    })

    const firstDrain = controller.drain()
    const secondDrain = controller.drain()
    expect(secondDrain).toBe(firstDrain)
    await uploadStarted
    releaseUpload()
    await firstDrain

    expect(client.reserveUpload).toHaveBeenCalledTimes(1)
    expect(uploadFile).toHaveBeenCalledTimes(1)
    expect(queue.photos[0].status).toBe('complete')
  })

  it('retries after reconnection requested before the interrupted PUT rejects', async () => {
    const queue = new MemoryPhotoQueue()
    const client = createClient()
    let rejectFirstUpload!: (error: Error) => void
    let announceFirstUpload!: () => void
    const firstUploadStarted = new Promise<void>((resolve) => {
      announceFirstUpload = resolve
    })
    let activeUploads = 0
    let maxActiveUploads = 0
    const uploadFile = jest
      .fn()
      .mockImplementationOnce(() =>
        new Promise<void>((_, reject) => {
          rejectFirstUpload = reject
          activeUploads += 1
          maxActiveUploads = Math.max(maxActiveUploads, activeUploads)
          announceFirstUpload()
        }).finally(() => {
          activeUploads -= 1
        }),
      )
      .mockImplementation(async () => {
        activeUploads += 1
        maxActiveUploads = Math.max(maxActiveUploads, activeUploads)
        activeUploads -= 1
      })
    const controller = new PhotoSyncController({
      tripId: 'trip-a',
      queue,
      client,
      uploadFile,
      preparePhoto: async (photo) => photo.uploadUri ?? 'file:///documents/upload.jpg',
    })

    const firstDrain = controller.drain()
    await firstUploadStarted
    const reconnectDrain = controller.drain()
    rejectFirstUpload(new Error('Network request failed'))
    await Promise.all([firstDrain, reconnectDrain])

    expect(reconnectDrain).toBe(firstDrain)
    expect(client.reserveUpload).toHaveBeenNthCalledWith(
      1,
      'trip-a',
      expect.objectContaining({ id: PHOTO_ID }),
    )
    expect(client.reserveUpload).toHaveBeenNthCalledWith(
      2,
      'trip-a',
      expect.objectContaining({ id: PHOTO_ID }),
    )
    expect(uploadFile).toHaveBeenCalledTimes(2)
    expect(maxActiveUploads).toBe(1)
    expect(queue.photos[0]).toMatchObject({ photoId: PHOTO_ID, status: 'complete', attempts: 1 })
  })

  it('sends a photo added during an active drain without another caller action', async () => {
    const queue = new MemoryPhotoQueue()
    const secondPhotoId = 'ac5ddfb0-95cb-47b7-b9ac-64423875e8bc'
    const client = createClient()
    let releaseFirstUpload!: () => void
    let announceFirstUpload!: () => void
    const firstUploadStarted = new Promise<void>((resolve) => {
      announceFirstUpload = resolve
    })
    let activeUploads = 0
    let maxActiveUploads = 0
    const uploadFile = jest.fn(async () => {
      activeUploads += 1
      maxActiveUploads = Math.max(maxActiveUploads, activeUploads)
      if (uploadFile.mock.calls.length === 1) {
        await new Promise<void>((resolve) => {
          releaseFirstUpload = resolve
          announceFirstUpload()
        })
      }
      activeUploads -= 1
    })
    const controller = new PhotoSyncController({
      tripId: 'trip-a',
      queue,
      client,
      uploadFile,
      preparePhoto: async (photo) => photo.uploadUri ?? 'file:///documents/upload.jpg',
    })

    const firstDrain = controller.drain()
    await firstUploadStarted
    queue.photos.push({ ...queue.photos[0], photoId: secondPhotoId, status: 'queued' })
    const photoAddedDrain = controller.drain()
    releaseFirstUpload()
    await Promise.all([firstDrain, photoAddedDrain])

    expect(client.reserveUpload).toHaveBeenCalledTimes(2)
    expect(client.reserveUpload).toHaveBeenNthCalledWith(
      2,
      'trip-a',
      expect.objectContaining({ id: secondPhotoId }),
    )
    expect(uploadFile).toHaveBeenCalledTimes(2)
    expect(maxActiveUploads).toBe(1)
    expect(queue.photos.map(({ photoId, status }) => ({ photoId, status }))).toEqual([
      { photoId: PHOTO_ID, status: 'complete' },
      { photoId: secondPhotoId, status: 'complete' },
    ])
  })

  it('cancels a queued follow-up when the session is deactivated', async () => {
    const queue = new MemoryPhotoQueue()
    const client = createClient()
    let rejectUpload!: (error: Error) => void
    let announceUploadStarted!: () => void
    const uploadStarted = new Promise<void>((resolve) => {
      announceUploadStarted = resolve
    })
    const uploadFile = jest.fn(
      () =>
        new Promise<void>((_, reject) => {
          rejectUpload = reject
          announceUploadStarted()
        }),
    )
    const controller = new PhotoSyncController({
      tripId: 'trip-a',
      queue,
      client,
      uploadFile,
      preparePhoto: async (photo) => photo.uploadUri ?? 'file:///documents/upload.jpg',
    })

    const firstDrain = controller.drain()
    await uploadStarted
    controller.drain()
    controller.deactivate()
    rejectUpload(new Error('Network request failed'))
    await firstDrain

    expect(uploadFile).toHaveBeenCalledTimes(1)
    expect(queue.photos[0]).toMatchObject({ photoId: PHOTO_ID, status: 'failed' })
  })
})
