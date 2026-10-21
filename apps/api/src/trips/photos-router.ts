import { Hono, type Context } from 'hono'
import pg from 'pg'
import { validatePhotoUploadInput } from '@trippy/domain'
import {
  PostgresPhotoStore,
  photoUploadKey,
  S3PhotoStorage,
  TripPhotoConflictError,
  TripPhotoNotFoundError,
  TripPhotoStateError,
  type PhotoStorage,
  type PhotoStore,
} from '@trippy/adapters/photos'
import type { AccessTokenVerifier } from '@trippy/adapters/auth'
import type { ApiConfig } from '../config.ts'
import { authenticate, type AuthEnvironment } from '../auth/authenticate.ts'
import { handleApiError } from '../auth/errors.ts'

type Pool = InstanceType<typeof pg.Pool>

type PhotosRouterConfig = Pick<
  ApiConfig,
  | 'databaseUrl'
  | 'awsRegion'
  | 'awsAccessKeyId'
  | 'awsSecretAccessKey'
  | 's3Endpoint'
  | 's3ForcePathStyle'
  | 's3BucketPhotos'
>

export interface PhotosRouterOptions {
  accessTokenVerifier: AccessTokenVerifier
  photoStore?: PhotoStore
  photoStorage?: PhotoStorage
}

const uuidPattern = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/iu

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function readBody(request: Request): Promise<unknown> {
  try {
    const value: unknown = await request.json()
    return isRecord(value) ? value : null
  } catch {
    return null
  }
}

function notFound(context: Context<AuthEnvironment>) {
  return context.json({ error: 'trip_not_found', message: 'Viagem ou foto não encontrada.' }, 404)
}

function conflict(context: Context<AuthEnvironment>) {
  return context.json(
    { error: 'photo_conflict', message: 'A foto não está pronta para esta operação.' },
    409,
  )
}

function photoNotUploaded(context: Context<AuthEnvironment>) {
  return context.json(
    { error: 'photo_not_uploaded', message: 'O arquivo JPEG ainda não está disponível.' },
    409,
  )
}

export function createPhotosRouter(config: PhotosRouterConfig, options: PhotosRouterOptions) {
  const pool: Pool | undefined = options.photoStore
    ? undefined
    : new pg.Pool({ connectionString: config.databaseUrl, max: 5 })
  const store = options.photoStore ?? new PostgresPhotoStore(pool!)
  const storage =
    options.photoStorage ??
    new S3PhotoStorage({
      bucket: config.s3BucketPhotos,
      region: config.awsRegion,
      forcePathStyle: config.s3ForcePathStyle,
      ...(config.s3Endpoint ? { endpoint: config.s3Endpoint } : {}),
      ...(config.awsAccessKeyId ? { accessKeyId: config.awsAccessKeyId } : {}),
      ...(config.awsSecretAccessKey ? { secretAccessKey: config.awsSecretAccessKey } : {}),
    })
  const authenticateRequest = authenticate(options.accessTokenVerifier)
  const router = new Hono<AuthEnvironment>()

  router.post('/trips/:tripId/photos/uploads', authenticateRequest, async (context) => {
    const tripId = context.req.param('tripId')
    if (!uuidPattern.test(tripId)) return notFound(context)

    const validation = validatePhotoUploadInput(await readBody(context.req.raw))
    if (!validation.success) {
      return context.json(
        {
          error: 'invalid_photo',
          message: 'Confira os dados originais informados para a foto.',
          fields: validation.fields,
        },
        400,
      )
    }

    try {
      const photo = await store.reserveForMember(context.get('userId'), tripId, validation.value)
      const uploadUrl = await storage.createUploadUrl(photoUploadKey(tripId, photo.id))
      return context.json({ id: photo.id, uploadUrl }, 201)
    } catch (error) {
      if (error instanceof TripPhotoNotFoundError) return notFound(context)
      if (error instanceof TripPhotoConflictError) return conflict(context)
      throw error
    }
  })

  router.post('/trips/:tripId/photos/:photoId/complete', authenticateRequest, async (context) => {
    const tripId = context.req.param('tripId')
    const photoId = context.req.param('photoId')
    if (!uuidPattern.test(tripId) || !uuidPattern.test(photoId)) return notFound(context)

    try {
      const userId = context.get('userId')
      const uploadKey = photoUploadKey(tripId, photoId)
      const completed = await store.completeForMember(userId, tripId, photoId, async (photo) => {
        if (!(await storage.hasJpeg(uploadKey))) throw new PhotoUploadMissingError()
        await storage.promoteUpload(uploadKey, photo.s3Key)
      })
      await storage.deleteUpload(uploadKey)
      return context.json({ id: completed.id })
    } catch (error) {
      if (error instanceof TripPhotoNotFoundError) return notFound(context)
      if (error instanceof PhotoUploadMissingError) return photoNotUploaded(context)
      if (error instanceof TripPhotoConflictError || error instanceof TripPhotoStateError) {
        return conflict(context)
      }
      throw error
    }
  })

  router.get('/trips/:tripId/photos', authenticateRequest, async (context) => {
    const tripId = context.req.param('tripId')
    if (!uuidPattern.test(tripId)) return notFound(context)

    try {
      const photos = await store.listForMember(context.get('userId'), tripId)
      if (!photos) return notFound(context)
      const withThumbnailUrls = await Promise.all(
        photos.map(async (photo) => ({
          ...photo,
          thumbnailUrl:
            photo.status === 'ready'
              ? await storage.createThumbnailUrl(`photos/${tripId}/${photo.id}/thumb.jpg`)
              : null,
        })),
      )
      return context.json({ photos: withThumbnailUrls })
    } catch (error) {
      if (error instanceof TripPhotoNotFoundError) return notFound(context)
      throw error
    }
  })

  router.onError(handleApiError)

  return {
    router,
    close: async () => {
      if (pool) await pool.end()
      if (storage instanceof S3PhotoStorage) storage.close()
    },
  }
}

class PhotoUploadMissingError extends Error {}
