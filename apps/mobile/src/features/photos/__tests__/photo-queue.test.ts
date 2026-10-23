import { createPhotoQueueRepository, type PhotoQueueDatabase } from '../photo-queue'

type StoredRow = {
  user_id: string
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
  status: string
  attempts: number
  last_error: string | null
  created_at: string
}

class MemoryPhotoQueueDatabase implements PhotoQueueDatabase {
  readonly rows: StoredRow[] = []

  async execAsync(): Promise<void> {}

  async runAsync(sql: string, ...values: (string | number | null)[]): Promise<{ changes: number }> {
    if (sql.includes('INSERT INTO trip_photo_uploads')) {
      const [
        userId,
        photoId,
        tripId,
        originalUri,
        takenAt,
        takenTz,
        lat,
        lng,
        width,
        height,
        createdAt,
      ] = values as [
        string,
        string,
        string,
        string,
        string | null,
        string | null,
        number | null,
        number | null,
        number,
        number,
        string,
      ]
      const exists = this.rows.some((row) => row.user_id === userId && row.photo_id === photoId)
      if (exists) return { changes: 0 }
      this.rows.push({
        user_id: userId,
        photo_id: photoId,
        trip_id: tripId,
        original_uri: originalUri,
        upload_uri: null,
        taken_at_original: takenAt,
        taken_tz: takenTz,
        lat,
        lng,
        width,
        height,
        status: 'preparing',
        attempts: 0,
        last_error: null,
        created_at: createdAt,
      })
      return { changes: 1 }
    }

    if (sql.includes('SET upload_uri = ?')) {
      const [uploadUri, userId, photoId] = values as [string, string, string]
      const row = this.rows.find(
        (candidate) => candidate.user_id === userId && candidate.photo_id === photoId,
      )
      if (!row) return { changes: 0 }
      row.upload_uri = uploadUri
      row.status = 'queued'
      return { changes: 1 }
    }

    if (sql.includes('SET status = ?')) {
      const [status, error, incrementAttempts, userId, photoId] = values as [
        string,
        string | null,
        number,
        string,
        string,
      ]
      const row = this.rows.find(
        (candidate) => candidate.user_id === userId && candidate.photo_id === photoId,
      )
      if (!row) return { changes: 0 }
      row.status = status
      row.last_error = error
      row.attempts += incrementAttempts
      return { changes: 1 }
    }

    if (sql.includes("SET status = 'queued'")) {
      const [userId] = values as [string]
      for (const row of this.rows) {
        if (row.user_id === userId && row.status === 'uploading') row.status = 'queued'
      }
      return { changes: 1 }
    }

    if (sql.includes('SET last_error = ?')) {
      const [error, userId, photoId] = values as [string, string, string]
      const row = this.rows.find(
        (candidate) => candidate.user_id === userId && candidate.photo_id === photoId,
      )
      if (!row) return { changes: 0 }
      row.last_error = error
      return { changes: 1 }
    }

    throw new Error(`SQL de escrita não suportado pelo fake: ${sql}`)
  }

  async getAllAsync<T extends object>(
    sql: string,
    ...values: (string | number | null)[]
  ): Promise<T[]> {
    const [userId, tripId] = values as [string, string?]
    if (sql.includes('SELECT DISTINCT trip_id')) {
      const trips = this.rows
        .filter((row) => row.user_id === userId && row.status !== 'complete')
        .map((row) => row.trip_id)
      return [...new Set(trips)].sort().map((trip_id) => ({ trip_id }) as T)
    }
    const rows = this.rows.filter((row) => row.user_id === userId && row.trip_id === tripId)
    if (sql.includes('status IN')) {
      return rows.filter((row) => row.status !== 'complete') as T[]
    }
    return rows as T[]
  }
}

describe('PhotoQueueRepository', () => {
  it('keeps a stable photo UUID across duplicate inserts and repository reopen', async () => {
    const database = new MemoryPhotoQueueDatabase()
    const firstSession = await createPhotoQueueRepository(database, 'user-a')
    const photo = {
      photoId: '5d45fb88-a53a-4e8a-bdc5-fae263cff016',
      tripId: 'trip-a',
      originalUri: 'file:///documents/original.heic',
      takenAtOriginal: '2026-10-20T07:06:05',
      takenTz: null,
      lat: null,
      lng: null,
      width: 4032,
      height: 3024,
    }

    await firstSession.addPreparing(photo)
    await firstSession.addPreparing(photo)
    await firstSession.markPrepared(photo.photoId, 'file:///documents/upload.jpg')

    const reopenedSession = await createPhotoQueueRepository(database, 'user-a')
    const restored = await reopenedSession.listTripPhotos('trip-a')
    expect(restored).toHaveLength(1)
    expect(restored[0]).toMatchObject({
      photoId: photo.photoId,
      originalUri: photo.originalUri,
      uploadUri: 'file:///documents/upload.jpg',
      takenAtOriginal: photo.takenAtOriginal,
      takenTz: null,
      status: 'queued',
      width: 4032,
      height: 3024,
    })
  })

  it('isolates photo records by authenticated user and recovers an interrupted upload', async () => {
    const database = new MemoryPhotoQueueDatabase()
    const userA = await createPhotoQueueRepository(database, 'user-a')
    const userB = await createPhotoQueueRepository(database, 'user-b')

    await userA.addPreparing({
      photoId: '5d45fb88-a53a-4e8a-bdc5-fae263cff016',
      tripId: 'trip-a',
      originalUri: 'file:///documents/a.heic',
      takenAtOriginal: null,
      takenTz: null,
      lat: null,
      lng: null,
      width: 4032,
      height: 3024,
    })
    await userA.markPrepared('5d45fb88-a53a-4e8a-bdc5-fae263cff016', 'file:///documents/a.jpg')
    await userA.markUploading('5d45fb88-a53a-4e8a-bdc5-fae263cff016')
    await userA.recoverInterruptedUploads()

    expect(await userA.listTripPhotos('trip-a')).toHaveLength(1)
    expect(await userB.listTripPhotos('trip-a')).toEqual([])
    expect((await userA.listWorkItems('trip-a'))[0].status).toBe('queued')
  })

  it('lists only pending trips for the active user', async () => {
    const database = new MemoryPhotoQueueDatabase()
    const userA = await createPhotoQueueRepository(database, 'user-a')
    const userB = await createPhotoQueueRepository(database, 'user-b')

    await userA.addPreparing({
      photoId: '5d45fb88-a53a-4e8a-bdc5-fae263cff016',
      tripId: 'trip-a',
      originalUri: 'file:///documents/a.heic',
      takenAtOriginal: null,
      takenTz: null,
      lat: null,
      lng: null,
      width: 2048,
      height: 1536,
    })
    await userA.addPreparing({
      photoId: '1cc62e20-aa7c-4480-bdd0-e45fd129abc8',
      tripId: 'trip-b',
      originalUri: 'file:///documents/b.jpg',
      takenAtOriginal: null,
      takenTz: null,
      lat: null,
      lng: null,
      width: 2048,
      height: 1536,
    })
    await userB.addPreparing({
      photoId: 'a100112e-b640-49dd-a564-233ef05c0703',
      tripId: 'trip-c',
      originalUri: 'file:///documents/c.jpg',
      takenAtOriginal: null,
      takenTz: null,
      lat: null,
      lng: null,
      width: 2048,
      height: 1536,
    })

    await expect(userA.listPendingTripIds()).resolves.toEqual(['trip-a', 'trip-b'])
    await expect(userB.listPendingTripIds()).resolves.toEqual(['trip-c'])
  })
})
