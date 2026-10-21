import type { PhotosClient } from './photo-client'
import { openPhotoQueueRepository, type PhotoQueueRepository } from './photo-queue'
import { expoPhotoFiles } from './expo-photo-files'
import { prepareQueuedPhoto } from './photo-preparation'
import { PhotoSyncController } from './photo-sync'
import { uploadPhotoToSignedUrl } from './photo-uploader'

type PhotoSyncCoordinatorDependencies = {
  userId: string
  queue: PhotoQueueRepository
  client: PhotosClient
}

export class PhotoSyncCoordinator {
  private readonly controllersByTrip = new Map<string, PhotoSyncController>()
  private active = true

  constructor(private readonly dependencies: PhotoSyncCoordinatorDependencies) {}

  async drainPendingTrips(): Promise<void> {
    if (!this.active) return
    const tripIds = await this.dependencies.queue.listPendingTripIds()
    if (!this.active) return
    await Promise.all(tripIds.map((tripId) => this.drainTrip(tripId)))
  }

  drainTrip(tripId: string): Promise<void> {
    if (!this.active) return Promise.resolve()

    let controller = this.controllersByTrip.get(tripId)
    if (!controller) {
      const { client, queue, userId } = this.dependencies
      controller = new PhotoSyncController({
        tripId,
        queue,
        client,
        uploadFile: uploadPhotoToSignedUrl,
        preparePhoto: (photo) => prepareQueuedPhoto(photo, userId, expoPhotoFiles, queue),
      })
      this.controllersByTrip.set(tripId, controller)
    }

    return controller.drain()
  }

  deactivate(): void {
    if (!this.active) return
    this.active = false
    for (const controller of this.controllersByTrip.values()) {
      controller.deactivate()
    }
    this.controllersByTrip.clear()
  }
}

export async function createPhotoSyncCoordinator(
  userId: string,
  client: PhotosClient,
): Promise<PhotoSyncCoordinator> {
  const queue = await openPhotoQueueRepository(userId)
  return new PhotoSyncCoordinator({ userId, queue, client })
}
