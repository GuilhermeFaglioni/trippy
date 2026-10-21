import type { SQLiteDatabase } from 'expo-sqlite'

export type PhotoQueueStatus =
  'preparing' | 'queued' | 'uploading' | 'awaiting_confirmation' | 'complete' | 'failed'

export type NewQueuedPhoto = {
  photoId: string
  tripId: string
  originalUri: string
  takenAtOriginal: string | null
  takenTz: string | null
  lat: number | null
  lng: number | null
  width: number
  height: number
}

export type QueuedPhoto = NewQueuedPhoto & {
  uploadUri: string | null
  status: PhotoQueueStatus
  attempts: number
  lastError: string | null
  createdAt: string
}

export type PhotoQueueDatabase = {
  execAsync(sql: string): Promise<void>
  runAsync(sql: string, ...values: (string | number | null)[]): Promise<{ changes: number }>
  getAllAsync<T extends object>(sql: string, ...values: (string | number | null)[]): Promise<T[]>
}

export type PhotoQueueRepository = {
  addPreparing(photo: NewQueuedPhoto): Promise<void>
  markPrepared(photoId: string, uploadUri: string): Promise<void>
  listTripPhotos(tripId: string): Promise<QueuedPhoto[]>
  listWorkItems(tripId: string): Promise<QueuedPhoto[]>
  listPendingTripIds(): Promise<string[]>
  recoverInterruptedUploads(): Promise<void>
  markUploading(photoId: string): Promise<void>
  markAwaitingConfirmation(photoId: string): Promise<void>
  markComplete(photoId: string): Promise<void>
  markFailed(photoId: string, error: unknown): Promise<void>
  recordConfirmationError(photoId: string, error: unknown): Promise<void>
}

type PhotoQueueRow = {
  photo_id: string
  trip_id: string
  original_uri: string
  upload_uri: string | null
  taken_at_original: string | null
  taken_tz: string | null
  lat: number | null
  lng: number | null
  width: number
  height: number
  status: PhotoQueueStatus
  attempts: number
  last_error: string | null
  created_at: string
}

const CREATE_QUEUE_SCHEMA = `
  CREATE TABLE IF NOT EXISTS trip_photo_uploads (
    user_id TEXT NOT NULL,
    photo_id TEXT NOT NULL,
    trip_id TEXT NOT NULL,
    original_uri TEXT NOT NULL,
    upload_uri TEXT,
    taken_at_original TEXT,
    taken_tz TEXT,
    lat REAL,
    lng REAL,
    width INTEGER NOT NULL,
    height INTEGER NOT NULL,
    status TEXT NOT NULL CHECK (status IN (
      'preparing', 'queued', 'uploading', 'awaiting_confirmation', 'complete', 'failed'
    )),
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    created_at TEXT NOT NULL,
    PRIMARY KEY (user_id, photo_id)
  );
  CREATE INDEX IF NOT EXISTS trip_photo_uploads_by_trip
    ON trip_photo_uploads (user_id, trip_id, created_at);
  CREATE INDEX IF NOT EXISTS trip_photo_uploads_pending
    ON trip_photo_uploads (user_id, status, created_at);
`

const SELECT_COLUMNS = `
  photo_id, trip_id, original_uri, upload_uri, taken_at_original, taken_tz,
  lat, lng, width, height, status, attempts, last_error, created_at
`

function fromRow(row: PhotoQueueRow): QueuedPhoto {
  return {
    photoId: row.photo_id,
    tripId: row.trip_id,
    originalUri: row.original_uri,
    uploadUri: row.upload_uri,
    takenAtOriginal: row.taken_at_original,
    takenTz: row.taken_tz,
    lat: row.lat,
    lng: row.lng,
    width: row.width,
    height: row.height,
    status: row.status,
    attempts: row.attempts,
    lastError: row.last_error,
    createdAt: row.created_at,
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim()
  return 'Não foi possível enviar esta foto. Tente novamente.'
}

export async function createPhotoQueueRepository(
  database: PhotoQueueDatabase,
  userId: string,
  now: () => Date = () => new Date(),
): Promise<PhotoQueueRepository> {
  if (!userId.trim()) throw new Error('O usuário da fila de fotos é obrigatório.')
  await database.execAsync(CREATE_QUEUE_SCHEMA)

  async function updateStatus(
    photoId: string,
    status: PhotoQueueStatus,
    lastError: string | null = null,
    incrementAttempts = false,
  ): Promise<void> {
    const result = await database.runAsync(
      `UPDATE trip_photo_uploads
         SET status = ?, last_error = ?, attempts = attempts + ?
       WHERE user_id = ? AND photo_id = ?`,
      status,
      lastError,
      incrementAttempts ? 1 : 0,
      userId,
      photoId,
    )
    if (result.changes === 0) throw new Error('Foto não encontrada na fila local.')
  }

  return {
    async addPreparing(photo) {
      await database.runAsync(
        `INSERT INTO trip_photo_uploads (
           user_id, photo_id, trip_id, original_uri, upload_uri,
           taken_at_original, taken_tz, lat, lng, width, height, status, attempts, last_error, created_at
         ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, 'preparing', 0, NULL, ?)
         ON CONFLICT (user_id, photo_id) DO NOTHING`,
        userId,
        photo.photoId,
        photo.tripId,
        photo.originalUri,
        photo.takenAtOriginal,
        photo.takenTz,
        photo.lat,
        photo.lng,
        photo.width,
        photo.height,
        now().toISOString(),
      )
    },
    async markPrepared(photoId, uploadUri) {
      const result = await database.runAsync(
        `UPDATE trip_photo_uploads
           SET upload_uri = ?, status = 'queued', last_error = NULL
         WHERE user_id = ? AND photo_id = ?`,
        uploadUri,
        userId,
        photoId,
      )
      if (result.changes === 0) throw new Error('Foto não encontrada na fila local.')
    },
    async listTripPhotos(tripId) {
      const rows = await database.getAllAsync<PhotoQueueRow>(
        `SELECT ${SELECT_COLUMNS} FROM trip_photo_uploads
         WHERE user_id = ? AND trip_id = ? ORDER BY created_at, photo_id`,
        userId,
        tripId,
      )
      return rows.map(fromRow)
    },
    async listWorkItems(tripId) {
      const rows = await database.getAllAsync<PhotoQueueRow>(
        `SELECT ${SELECT_COLUMNS} FROM trip_photo_uploads
         WHERE user_id = ? AND trip_id = ?
           AND status IN ('preparing', 'queued', 'awaiting_confirmation', 'failed')
         ORDER BY created_at, photo_id`,
        userId,
        tripId,
      )
      return rows.map(fromRow)
    },
    async listPendingTripIds() {
      const rows = await database.getAllAsync<{ trip_id: string }>(
        `SELECT DISTINCT trip_id FROM trip_photo_uploads
         WHERE user_id = ?
           AND status IN ('preparing', 'queued', 'uploading', 'awaiting_confirmation', 'failed')
         ORDER BY trip_id`,
        userId,
      )
      return rows.map((row) => row.trip_id)
    },
    async recoverInterruptedUploads() {
      await database.runAsync(
        `UPDATE trip_photo_uploads
           SET status = 'queued', last_error = NULL
         WHERE user_id = ? AND status = 'uploading' AND upload_uri IS NOT NULL`,
        userId,
      )
    },
    async markUploading(photoId) {
      await updateStatus(photoId, 'uploading')
    },
    async markAwaitingConfirmation(photoId) {
      await updateStatus(photoId, 'awaiting_confirmation')
    },
    async markComplete(photoId) {
      await updateStatus(photoId, 'complete')
    },
    async markFailed(photoId, error) {
      await updateStatus(photoId, 'failed', errorMessage(error), true)
    },
    async recordConfirmationError(photoId, error) {
      const result = await database.runAsync(
        `UPDATE trip_photo_uploads SET last_error = ?
         WHERE user_id = ? AND photo_id = ? AND status = 'awaiting_confirmation'`,
        errorMessage(error),
        userId,
        photoId,
      )
      if (result.changes === 0) throw new Error('Foto aguardando confirmação não encontrada.')
    },
  }
}

let databasePromise: Promise<SQLiteDatabase> | undefined

export async function openPhotoQueueRepository(userId: string): Promise<PhotoQueueRepository> {
  databasePromise ??= import('expo-sqlite').then(({ openDatabaseAsync }) =>
    openDatabaseAsync('trippy.db'),
  )
  const database = await databasePromise
  return createPhotoQueueRepository(database, userId)
}
