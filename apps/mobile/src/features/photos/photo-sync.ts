import type { PhotosClient, PhotoUploadMetadata } from './photo-client'
import type { PhotoQueueRepository, QueuedPhoto } from './photo-queue'

export type PhotoSyncDependencies = {
  tripId: string
  queue: PhotoQueueRepository
  client: PhotosClient
  uploadFile(signedUrl: string, uploadUri: string): Promise<void>
  preparePhoto(photo: QueuedPhoto): Promise<string>
}

export class PhotoSyncController {
  private inFlightDrain: Promise<void> | null = null
  private drainRequested = false
  private active = true

  constructor(private readonly dependencies: PhotoSyncDependencies) {}

  drain(): Promise<void> {
    if (!this.active) return this.inFlightDrain ?? Promise.resolve()
    if (this.inFlightDrain) {
      this.drainRequested = true
      return this.inFlightDrain
    }

    const pendingDrain = this.runRequestedDrains()
    this.inFlightDrain = pendingDrain
    return pendingDrain
  }

  deactivate(): void {
    this.active = false
    this.drainRequested = false
  }

  private async runRequestedDrains(): Promise<void> {
    let hasError = false
    let firstError: unknown

    try {
      do {
        this.drainRequested = false
        try {
          await this.runDrain()
        } catch (error) {
          if (!hasError) {
            hasError = true
            firstError = error
          }
        }
      } while (this.active && this.drainRequested)

      if (hasError) throw firstError
    } finally {
      this.inFlightDrain = null
    }
  }

  private async runDrain(): Promise<void> {
    const { queue, tripId } = this.dependencies
    await queue.recoverInterruptedUploads()
    const pendingPhotos = await queue.listWorkItems(tripId)

    for (const photo of pendingPhotos) {
      await this.uploadOne(photo)
    }
  }

  private async uploadOne(photo: QueuedPhoto): Promise<void> {
    const { client, queue, tripId, uploadFile, preparePhoto } = this.dependencies
    let uploaded = photo.status === 'awaiting_confirmation'

    try {
      if (uploaded) {
        await client.completeUpload(tripId, photo.photoId)
        await queue.markComplete(photo.photoId)
        return
      }

      const uploadUri = photo.uploadUri ?? (await preparePhoto(photo))
      await queue.markUploading(photo.photoId)
      const reservation = await client.reserveUpload(tripId, this.metadata(photo))
      if (reservation.id !== photo.photoId) {
        throw new Error('O servidor reservou uma foto com UUID diferente do UUID local.')
      }

      await uploadFile(reservation.uploadUrl, uploadUri)
      await queue.markAwaitingConfirmation(photo.photoId)
      uploaded = true

      await client.completeUpload(tripId, photo.photoId)
      await queue.markComplete(photo.photoId)
    } catch (error) {
      if (uploaded) {
        await queue.recordConfirmationError(photo.photoId, error)
        return
      }
      await queue.markFailed(photo.photoId, error)
    }
  }

  private metadata(photo: QueuedPhoto): PhotoUploadMetadata {
    return {
      id: photo.photoId,
      takenAtOriginal: photo.takenAtOriginal,
      takenTz: photo.takenTz,
      lat: photo.lat,
      lng: photo.lng,
    }
  }
}
