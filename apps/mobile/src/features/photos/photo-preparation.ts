import { normalizePhotoExif } from './photo-exif'
import type { NewQueuedPhoto, PhotoQueueRepository, QueuedPhoto } from './photo-queue'

export type SelectedPhotoAsset = {
  uri: string
  fileName?: string | null
  mimeType?: string | null
  width: number
  height: number
  exif?: Record<string, unknown> | null
}

export type PhotoFileService = {
  copyOriginal(
    sourceUri: string,
    userId: string,
    tripId: string,
    photoId: string,
    fileName?: string | null,
    mimeType?: string | null,
  ): Promise<string>
  createUploadJpeg(
    originalUri: string,
    userId: string,
    tripId: string,
    photoId: string,
    width: number,
    height: number,
  ): Promise<string>
}

export type PhotoPreparationDependencies = {
  createId(): string
  files: PhotoFileService
  queue: Pick<PhotoQueueRepository, 'addPreparing' | 'markPrepared' | 'markFailed'>
}

export type PhotoForPreparation = Pick<
  QueuedPhoto,
  'photoId' | 'tripId' | 'originalUri' | 'uploadUri' | 'width' | 'height'
>

export async function prepareQueuedPhoto(
  photo: PhotoForPreparation,
  userId: string,
  files: PhotoFileService,
  queue: Pick<PhotoQueueRepository, 'markPrepared' | 'markFailed'>,
): Promise<string> {
  if (photo.uploadUri !== null) return photo.uploadUri

  const uploadUri = await files.createUploadJpeg(
    photo.originalUri,
    userId,
    photo.tripId,
    photo.photoId,
    photo.width,
    photo.height,
  )
  await queue.markPrepared(photo.photoId, uploadUri)
  return uploadUri
}

export async function enqueueSelectedPhoto(
  asset: SelectedPhotoAsset,
  userId: string,
  tripId: string,
  dependencies: PhotoPreparationDependencies,
): Promise<string> {
  if (!Number.isFinite(asset.width) || asset.width <= 0) {
    throw new Error('A foto não informou uma largura válida.')
  }
  if (!Number.isFinite(asset.height) || asset.height <= 0) {
    throw new Error('A foto não informou uma altura válida.')
  }

  const photoId = dependencies.createId()
  const originalUri = await dependencies.files.copyOriginal(
    asset.uri,
    userId,
    tripId,
    photoId,
    asset.fileName,
    asset.mimeType,
  )
  const photo: NewQueuedPhoto = {
    photoId,
    tripId,
    originalUri,
    ...normalizePhotoExif(asset.exif),
    width: asset.width,
    height: asset.height,
  }

  await dependencies.queue.addPreparing(photo)
  try {
    await prepareQueuedPhoto(
      { ...photo, uploadUri: null },
      userId,
      dependencies.files,
      dependencies.queue,
    )
  } catch (error) {
    await dependencies.queue.markFailed(photoId, error)
    throw error
  }

  return photoId
}

export function getResizeTarget(
  width: number,
  height: number,
  maximumEdge = 2048,
): { width: number } | { height: number } | null {
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
    throw new Error('A foto precisa ter largura e altura válidas.')
  }
  if (!Number.isFinite(maximumEdge) || maximumEdge <= 0) {
    throw new Error('O limite de redimensionamento precisa ser positivo.')
  }
  if (Math.max(width, height) <= maximumEdge) return null
  return width >= height ? { width: maximumEdge } : { height: maximumEdge }
}
