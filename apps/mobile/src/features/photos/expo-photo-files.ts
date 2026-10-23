import * as Crypto from 'expo-crypto'
import { Directory, File, Paths } from 'expo-file-system'
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator'

import { getResizeTarget, type PhotoFileService } from './photo-preparation'

const FILES_ROOT = 'trip-photos'
const JPEG_QUALITY = 0.84

async function privatePathSegment(value: string): Promise<string> {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, value)
}

async function photoDirectory(
  userId: string,
  tripId: string,
  kind: 'originals' | 'uploads',
): Promise<Directory> {
  const userSegment = await privatePathSegment(userId)
  const tripSegment = await privatePathSegment(tripId)
  const directory = new Directory(Paths.document, FILES_ROOT, userSegment, tripSegment, kind)
  directory.create({ intermediates: true, idempotent: true })
  return directory
}

function originalExtension(
  fileName?: string | null,
  mimeType?: string | null,
  uri?: string,
): string {
  const source = `${fileName ?? ''} ${uri?.split(/[?#]/, 1)[0] ?? ''}`
  const match = /\.([a-z0-9]{2,8})(?:\s|$)/i.exec(source)
  if (match) return match[1].toLowerCase() === 'jpeg' ? 'jpg' : match[1].toLowerCase()

  if (mimeType === 'image/heic') return 'heic'
  if (mimeType === 'image/heif') return 'heif'
  if (mimeType === 'image/png') return 'png'
  if (mimeType === 'image/webp') return 'webp'
  if (mimeType === 'image/jpeg') return 'jpg'
  return 'image'
}

export const expoPhotoFiles: PhotoFileService = {
  async copyOriginal(sourceUri, userId, tripId, photoId, fileName, mimeType) {
    const directory = await photoDirectory(userId, tripId, 'originals')
    const target = new File(
      directory,
      `${photoId}.${originalExtension(fileName, mimeType, sourceUri)}`,
    )
    await new File(sourceUri).copy(target, { overwrite: true })
    if (!target.exists) throw new Error('Não foi possível guardar a foto original no dispositivo.')
    return target.uri
  },
  async createUploadJpeg(originalUri, userId, tripId, photoId, width, height) {
    const directory = await photoDirectory(userId, tripId, 'uploads')
    const target = new File(directory, `${photoId}.jpg`)
    const context = ImageManipulator.manipulate(originalUri)
    const resize = getResizeTarget(width, height)
    if (resize) context.resize(resize)

    const image = await context.renderAsync()
    const temporary = await image.saveAsync({ format: SaveFormat.JPEG, compress: JPEG_QUALITY })
    const temporaryFile = new File(temporary.uri)
    try {
      await temporaryFile.copy(target, { overwrite: true })
    } finally {
      if (temporaryFile.exists) temporaryFile.delete()
    }

    if (!target.exists) throw new Error('Não foi possível preparar a versão JPEG da foto.')
    return target.uri
  },
}
