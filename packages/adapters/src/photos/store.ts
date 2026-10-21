import pg, { type PoolClient } from 'pg'
import type { PhotoUploadMetadata } from '@trippy/domain'

type Pool = InstanceType<typeof pg.Pool>

export type PhotoStatus = 'pending' | 'uploaded' | 'ready'

export type PhotoRecord = Readonly<{
  id: string
  tripId: string
  userId: string
  s3Key: string
  takenAtOriginal: string | null
  takenTz: string | null
  lat: number | null
  lng: number | null
  status: PhotoStatus
  createdAt: Date
}>

export type TripPhoto = Readonly<{
  id: string
  status: PhotoStatus
  placeId: null
  takenAtOriginal: string | null
  takenTz: string | null
  lat: number | null
  lng: number | null
}>

export class TripPhotoNotFoundError extends Error {
  constructor() {
    super('Viagem ou foto não encontrada.')
    this.name = 'TripPhotoNotFoundError'
  }
}

export class TripPhotoConflictError extends Error {
  constructor() {
    super('O UUID da foto já foi reservado com outros dados.')
    this.name = 'TripPhotoConflictError'
  }
}

export class TripPhotoStateError extends Error {
  constructor() {
    super('A foto ainda não foi confirmada para processamento.')
    this.name = 'TripPhotoStateError'
  }
}

interface PhotoRow {
  id: string
  tripId: string
  userId: string
  s3Key: string
  takenAtOriginal: string | null
  takenTz: string | null
  lat: number | null
  lng: number | null
  status: PhotoStatus
  createdAt: Date
}

const photoColumns = `
  photos.id,
  photos.trip_id AS "tripId",
  photos.user_id AS "userId",
  photos.s3_key AS "s3Key",
  photos.taken_at_original AS "takenAtOriginal",
  photos.taken_tz AS "takenTz",
  photos.lat,
  photos.lng,
  photos.status,
  photos.created_at AS "createdAt"
`

function mapPhoto(row: PhotoRow): PhotoRecord {
  return {
    id: row.id,
    tripId: row.tripId,
    userId: row.userId,
    s3Key: row.s3Key,
    takenAtOriginal: row.takenAtOriginal,
    takenTz: row.takenTz,
    lat: row.lat,
    lng: row.lng,
    status: row.status,
    createdAt: row.createdAt,
  }
}

async function inTransaction<T>(client: PoolClient, operation: () => Promise<T>): Promise<T> {
  await client.query('BEGIN')
  try {
    const result = await operation()
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  }
}

function sameReservation(
  row: PhotoRow,
  tripId: string,
  userId: string,
  input: PhotoUploadMetadata,
) {
  return (
    row.tripId === tripId &&
    row.userId === userId &&
    row.takenAtOriginal === input.takenAtOriginal &&
    row.takenTz === input.takenTz &&
    row.lat === input.lat &&
    row.lng === input.lng
  )
}

export interface PhotoStore {
  reserveForMember(userId: string, tripId: string, input: PhotoUploadMetadata): Promise<PhotoRecord>
  getForMember(userId: string, tripId: string, photoId: string): Promise<PhotoRecord | null>
  completeForMember(userId: string, tripId: string, photoId: string): Promise<PhotoRecord>
  listForMember(userId: string, tripId: string): Promise<TripPhoto[] | null>
  getForWorker(photoId: string): Promise<PhotoRecord | null>
  markReady(photoId: string): Promise<void>
}

export class PostgresPhotoStore implements PhotoStore {
  constructor(private readonly pool: Pool) {}

  async reserveForMember(
    userId: string,
    tripId: string,
    input: PhotoUploadMetadata,
  ): Promise<PhotoRecord> {
    const client = await this.pool.connect()
    try {
      return await inTransaction(client, async () => {
        const membership = await client.query(
          `SELECT 1
           FROM trips
           JOIN trip_members ON trip_members.trip_id = trips.id
           WHERE trips.id = $1 AND trip_members.user_id = $2
             AND trip_members.left_at IS NULL AND trips.deleted_at IS NULL
           FOR SHARE OF trips, trip_members`,
          [tripId, userId],
        )
        if (membership.rowCount === 0) throw new TripPhotoNotFoundError()

        const inserted = await client.query<PhotoRow>(
          `INSERT INTO photos (
             id, trip_id, user_id, s3_key, taken_at_original, taken_tz, lat, lng
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (id) DO NOTHING
           RETURNING ${photoColumns}`,
          [
            input.id,
            tripId,
            userId,
            `photos/${tripId}/${input.id}/original.jpg`,
            input.takenAtOriginal,
            input.takenTz,
            input.lat,
            input.lng,
          ],
        )
        if (inserted.rows[0]) return mapPhoto(inserted.rows[0])

        const existing = await client.query<PhotoRow & { deletedAt: Date | null }>(
          `SELECT ${photoColumns}, deleted_at AS "deletedAt" FROM photos WHERE id = $1 FOR UPDATE`,
          [input.id],
        )
        const row = existing.rows[0]
        if (!row || row.deletedAt || !sameReservation(row, tripId, userId, input)) {
          throw new TripPhotoConflictError()
        }
        return mapPhoto(row)
      })
    } finally {
      client.release()
    }
  }

  async completeForMember(userId: string, tripId: string, photoId: string): Promise<PhotoRecord> {
    const client = await this.pool.connect()
    try {
      return await inTransaction(client, async () => {
        const selected = await client.query<PhotoRow>(
          `SELECT ${photoColumns}
           FROM photos
           JOIN trips ON trips.id = photos.trip_id
           JOIN trip_members ON trip_members.trip_id = trips.id
           WHERE photos.id = $1 AND photos.trip_id = $2 AND trip_members.user_id = $3
             AND trip_members.left_at IS NULL AND trips.deleted_at IS NULL
             AND photos.deleted_at IS NULL
           FOR UPDATE OF photos`,
          [photoId, tripId, userId],
        )
        const row = selected.rows[0]
        if (!row) throw new TripPhotoNotFoundError()
        if (row.status !== 'pending') return mapPhoto(row)

        const updated = await client.query<PhotoRow>(
          `UPDATE photos SET status = 'uploaded', uploaded_at = clock_timestamp()
           WHERE id = $1 AND status = 'pending'
           RETURNING ${photoColumns}`,
          [photoId],
        )
        await client.query(
          `INSERT INTO photo_outbox (photo_id, payload)
           VALUES ($1, $2::jsonb)
           ON CONFLICT (photo_id) DO NOTHING`,
          [photoId, JSON.stringify({ photoId })],
        )
        return mapPhoto(updated.rows[0]!)
      })
    } finally {
      client.release()
    }
  }

  async getForMember(userId: string, tripId: string, photoId: string): Promise<PhotoRecord | null> {
    const result = await this.pool.query<PhotoRow>(
      `SELECT ${photoColumns}
       FROM photos
       JOIN trips ON trips.id = photos.trip_id
       JOIN trip_members ON trip_members.trip_id = trips.id
       WHERE photos.id = $1 AND photos.trip_id = $2 AND trip_members.user_id = $3
         AND trip_members.left_at IS NULL AND trips.deleted_at IS NULL
         AND photos.deleted_at IS NULL`,
      [photoId, tripId, userId],
    )
    return result.rows[0] ? mapPhoto(result.rows[0]) : null
  }

  async listForMember(userId: string, tripId: string): Promise<TripPhoto[] | null> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
      const membership = await client.query(
        `SELECT 1 FROM trips
         JOIN trip_members ON trip_members.trip_id = trips.id
         WHERE trips.id = $1 AND trip_members.user_id = $2
           AND trip_members.left_at IS NULL AND trips.deleted_at IS NULL`,
        [tripId, userId],
      )
      if (membership.rowCount === 0) {
        await client.query('COMMIT')
        return null
      }
      const result = await client.query<TripPhoto>(
        `SELECT id, status, NULL::uuid AS "placeId",
                taken_at_original AS "takenAtOriginal", taken_tz AS "takenTz", lat, lng
         FROM photos
         WHERE trip_id = $1 AND deleted_at IS NULL
         ORDER BY created_at, id`,
        [tripId],
      )
      await client.query('COMMIT')
      return result.rows
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async getForWorker(photoId: string): Promise<PhotoRecord | null> {
    const result = await this.pool.query<PhotoRow>(
      `SELECT ${photoColumns} FROM photos WHERE id = $1 AND deleted_at IS NULL`,
      [photoId],
    )
    return result.rows[0] ? mapPhoto(result.rows[0]) : null
  }

  async markReady(photoId: string): Promise<void> {
    const updated = await this.pool.query(
      `UPDATE photos SET status = 'ready', ready_at = clock_timestamp()
       WHERE id = $1 AND status = 'uploaded' AND deleted_at IS NULL`,
      [photoId],
    )
    if (updated.rowCount === 1) return

    const existing = await this.pool.query<{ status: PhotoStatus }>(
      'SELECT status FROM photos WHERE id = $1 AND deleted_at IS NULL',
      [photoId],
    )
    if (existing.rows[0]?.status === 'ready') return
    if (!existing.rows[0]) throw new TripPhotoNotFoundError()
    throw new TripPhotoStateError()
  }
}

export type PhotoQueueMessage = Readonly<{ photoId: string }>

export interface PhotoMessagePublisher {
  publish(message: PhotoQueueMessage): Promise<void>
}

function errorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 2048)
}

export async function publishPhotoOutboxBatch(
  pool: Pool,
  publisher: PhotoMessagePublisher,
  limit = 10,
): Promise<number> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error('O limite de publicação da outbox de fotos deve ficar entre 1 e 100')
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const rows = await client.query<{ id: string; photoId: string }>(
      `SELECT id, photo_id AS "photoId" FROM photo_outbox
       WHERE published_at IS NULL AND available_at <= clock_timestamp()
       ORDER BY available_at, created_at, id
       LIMIT $1 FOR UPDATE SKIP LOCKED`,
      [limit],
    )
    let published = 0

    for (const row of rows.rows) {
      try {
        await publisher.publish({ photoId: row.photoId })
        await client.query(
          `UPDATE photo_outbox
           SET published_at = clock_timestamp(), attempts = attempts + 1, last_error = NULL
           WHERE id = $1`,
          [row.id],
        )
        published += 1
      } catch (error) {
        await client.query(
          `UPDATE photo_outbox
           SET attempts = attempts + 1,
               last_error = $2,
               available_at = clock_timestamp() +
                 (LEAST(300, power(2, LEAST(attempts, 8))) * interval '1 second')
           WHERE id = $1`,
          [row.id, errorMessage(error)],
        )
      }
    }

    await client.query('COMMIT')
    return published
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}
