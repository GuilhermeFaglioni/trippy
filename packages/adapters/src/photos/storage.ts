import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

export type S3PhotoStorageConfig = Readonly<{
  bucket: string
  region: string
  endpoint?: string
  forcePathStyle: boolean
  accessKeyId?: string
  secretAccessKey?: string
}>

export interface PhotoStorage {
  createUploadUrl(key: string): Promise<string>
  hasJpeg(key: string): Promise<boolean>
  promoteUpload(sourceKey: string, targetKey: string): Promise<void>
  deleteUpload(key: string): Promise<void>
  createThumbnailUrl(key: string): Promise<string>
  readObject(key: string): Promise<Uint8Array>
  writeThumbnail(key: string, body: Uint8Array): Promise<void>
}

export function photoUploadKey(tripId: string, photoId: string): string {
  return `photos/${tripId}/${photoId}/upload.jpg`
}

function clientConfig(config: S3PhotoStorageConfig): S3ClientConfig {
  const credentials =
    config.accessKeyId && config.secretAccessKey
      ? { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }
      : undefined
  return {
    region: config.region,
    forcePathStyle: config.forcePathStyle,
    ...(config.endpoint ? { endpoint: config.endpoint } : {}),
    ...(credentials ? { credentials } : {}),
  }
}

function isNotFound(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  if ('name' in error && (error.name === 'NotFound' || error.name === 'NoSuchKey')) return true
  if ('$metadata' in error && typeof error.$metadata === 'object' && error.$metadata !== null) {
    return 'httpStatusCode' in error.$metadata && error.$metadata.httpStatusCode === 404
  }
  return false
}

export class S3PhotoStorage implements PhotoStorage {
  private readonly s3: S3Client

  constructor(
    private readonly config: S3PhotoStorageConfig,
    s3?: S3Client,
  ) {
    this.s3 = s3 ?? new S3Client(clientConfig(config))
  }

  createUploadUrl(key: string): Promise<string> {
    return getSignedUrl(
      this.s3,
      new PutObjectCommand({ Bucket: this.config.bucket, Key: key, ContentType: 'image/jpeg' }),
      { expiresIn: 300 },
    )
  }

  async promoteUpload(sourceKey: string, targetKey: string): Promise<void> {
    await this.s3.send(
      new CopyObjectCommand({
        Bucket: this.config.bucket,
        Key: targetKey,
        CopySource: `${this.config.bucket}/${sourceKey
          .split('/')
          .map(encodeURIComponent)
          .join('/')}`,
        ContentType: 'image/jpeg',
        MetadataDirective: 'REPLACE',
      }),
    )
  }

  async deleteUpload(key: string): Promise<void> {
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }))
  }

  async hasJpeg(key: string): Promise<boolean> {
    try {
      const result = await this.s3.send(
        new HeadObjectCommand({ Bucket: this.config.bucket, Key: key }),
      )
      return (
        result.ContentLength !== undefined &&
        result.ContentLength > 0 &&
        result.ContentType === 'image/jpeg'
      )
    } catch (error) {
      if (isNotFound(error)) return false
      throw error
    }
  }

  createThumbnailUrl(key: string): Promise<string> {
    return getSignedUrl(this.s3, new GetObjectCommand({ Bucket: this.config.bucket, Key: key }), {
      expiresIn: 900,
    })
  }

  async readObject(key: string): Promise<Uint8Array> {
    const result = await this.s3.send(
      new GetObjectCommand({ Bucket: this.config.bucket, Key: key }),
    )
    if (!result.Body) throw new Error(`Objeto de foto sem conteúdo: ${key}`)
    return result.Body.transformToByteArray()
  }

  async writeThumbnail(key: string, body: Uint8Array): Promise<void> {
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        Body: body,
        ContentType: 'image/jpeg',
      }),
    )
  }

  close(): void {
    this.s3.destroy()
  }
}
