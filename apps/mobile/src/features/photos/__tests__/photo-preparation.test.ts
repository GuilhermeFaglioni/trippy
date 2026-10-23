import { enqueueSelectedPhoto, getResizeTarget, type PhotoFileService } from '../photo-preparation'
import type { PhotoQueueRepository } from '../photo-queue'

describe('enqueueSelectedPhoto', () => {
  it('copies the original before reading metadata and converting to a JPEG', async () => {
    const events: string[] = []
    const photoId = '5d45fb88-a53a-4e8a-bdc5-fae263cff016'
    const files: PhotoFileService = {
      copyOriginal: jest.fn(async (_uri, _userId, _tripId, id) => {
        events.push('copy-original')
        expect(id).toBe(photoId)
        return 'file:///documents/original.heic'
      }),
      createUploadJpeg: jest.fn(async (_originalUri, _userId, _tripId, id) => {
        events.push('convert-jpeg')
        expect(id).toBe(photoId)
        return 'file:///documents/upload.jpg'
      }),
    }
    const queue = {
      addPreparing: jest.fn(async (photo) => {
        events.push('save-original-metadata')
        expect(photo).toMatchObject({
          photoId,
          originalUri: 'file:///documents/original.heic',
          takenAtOriginal: '2026-10-20T07:06:05',
          takenTz: '+08:00',
          lat: 31.22,
          lng: 121.47,
          width: 4032,
          height: 3024,
        })
      }),
      markPrepared: jest.fn(async () => {
        events.push('save-upload-uri')
      }),
      markFailed: jest.fn(),
    } as unknown as Pick<PhotoQueueRepository, 'addPreparing' | 'markPrepared' | 'markFailed'>

    await enqueueSelectedPhoto(
      {
        uri: 'ph://picker-asset.heic',
        fileName: 'trip.heic',
        mimeType: 'image/heic',
        width: 4032,
        height: 3024,
        exif: {
          DateTimeOriginal: '2026:10:20 07:06:05',
          OffsetTimeOriginal: '+08:00',
          GPSLatitude: [31, 13, 12],
          GPSLatitudeRef: 'N',
          GPSLongitude: [121, 28, 12],
          GPSLongitudeRef: 'E',
        },
      },
      'user-a',
      'trip-a',
      {
        createId: () => photoId,
        files,
        queue,
      },
    )

    expect(events).toEqual([
      'copy-original',
      'save-original-metadata',
      'convert-jpeg',
      'save-upload-uri',
    ])
    expect(queue.markPrepared).toHaveBeenCalledWith(photoId, 'file:///documents/upload.jpg')
    expect(queue.markFailed).not.toHaveBeenCalled()
  })

  it('keeps the local UUID and marks the row retryable when conversion fails', async () => {
    const photoId = '5d45fb88-a53a-4e8a-bdc5-fae263cff016'
    const conversionError = new Error('Formato de foto não suportado.')
    const queue = {
      addPreparing: jest.fn(),
      markPrepared: jest.fn(),
      markFailed: jest.fn(),
    } as unknown as Pick<PhotoQueueRepository, 'addPreparing' | 'markPrepared' | 'markFailed'>
    const files: PhotoFileService = {
      copyOriginal: jest.fn(async () => 'file:///documents/original.heic'),
      createUploadJpeg: jest.fn(async () => {
        throw conversionError
      }),
    }

    await expect(
      enqueueSelectedPhoto(
        {
          uri: 'ph://picker-asset.heic',
          fileName: 'trip.heic',
          mimeType: 'image/heic',
          width: 2048,
          height: 1536,
          exif: null,
        },
        'user-a',
        'trip-a',
        { createId: () => photoId, files, queue },
      ),
    ).rejects.toBe(conversionError)

    expect(queue.addPreparing).toHaveBeenCalledWith(
      expect.objectContaining({ photoId, originalUri: 'file:///documents/original.heic' }),
    )
    expect(queue.markFailed).toHaveBeenCalledWith(photoId, conversionError)
  })
})

describe('getResizeTarget', () => {
  it('limits the longest edge to 2048 pixels without enlarging smaller photos', () => {
    expect(getResizeTarget(4032, 3024)).toEqual({ width: 2048 })
    expect(getResizeTarget(3024, 4032)).toEqual({ height: 2048 })
    expect(getResizeTarget(2048, 1536)).toBeNull()
  })
})
