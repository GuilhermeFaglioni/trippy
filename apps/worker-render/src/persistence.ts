import { buildRecapSnapshot, type RecapPlaceInput, type RecapPhotoInput } from '@trippy/domain'
import pg from 'pg'

type Pool = InstanceType<typeof pg.Pool>

const renderVariants = ['clean', 'watermarked'] as const

type CreateRecapInput = Readonly<{
  tripId: string
  idempotencyKey: string
  createdAt?: string
  content: Readonly<{
    places: readonly RecapPlaceInput[]
    photos: readonly RecapPhotoInput[]
  }>
}>

export type CreateRecapResult = Readonly<{
  recapId: string
  version: number
  reused: boolean
}>

type TripRow = {
  id: string
  name: string | null
  destination: string | null
  timezone: string
  startDate: string | null
  endDate: string | null
}

export async function createRecap(pool: Pool, input: CreateRecapInput): Promise<CreateRecapResult> {
  if (input.idempotencyKey.trim().length === 0) {
    throw new Error('A chave de idempotência do recap não pode ser vazia')
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const tripResult = await client.query<TripRow>(
      `SELECT id, name, destination, timezone,
              start_date::text AS "startDate", end_date::text AS "endDate"
       FROM trips WHERE id = $1 FOR UPDATE`,
      [input.tripId],
    )
    const trip = tripResult.rows[0]
    if (!trip) throw new Error(`Viagem não encontrada: ${input.tripId}`)
    if (!trip.startDate || !trip.endDate) {
      throw new Error(`Viagem sem datas completas: ${input.tripId}`)
    }

    const existing = await client.query<{ id: string; version: number }>(
      `SELECT id, version FROM recaps WHERE trip_id = $1 AND idempotency_key = $2`,
      [input.tripId, input.idempotencyKey],
    )
    if (existing.rows[0]) {
      await client.query('COMMIT')
      return {
        recapId: existing.rows[0].id,
        version: existing.rows[0].version,
        reused: true,
      }
    }

    const versionResult = await client.query<{ version: number }>(
      'SELECT COALESCE(max(version), 0) + 1 AS version FROM recaps WHERE trip_id = $1',
      [input.tripId],
    )
    const version = versionResult.rows[0]!.version
    const createdAt = input.createdAt ?? new Date().toISOString()
    const snapshot = buildRecapSnapshot({
      trip: {
        id: trip.id,
        name: trip.name ?? 'Viagem em grupo',
        destination: trip.destination ?? 'Destino não informado',
        timezone: trip.timezone,
        startDate: trip.startDate,
        endDate: trip.endDate,
      },
      createdAt,
      places: input.content.places,
      photos: input.content.photos,
    })

    const recapResult = await client.query<{ id: string }>(
      `INSERT INTO recaps (trip_id, version, idempotency_key, snapshot, created_at)
       VALUES ($1, $2, $3, $4::jsonb, $5::timestamptz)
       RETURNING id`,
      [input.tripId, version, input.idempotencyKey, JSON.stringify(snapshot), createdAt],
    )
    const recapId = recapResult.rows[0]!.id

    for (const variant of renderVariants) {
      const jobResult = await client.query<{ id: string; generation: number }>(
        `INSERT INTO render_jobs (recap_id, variant)
         VALUES ($1, $2)
         RETURNING id, generation`,
        [recapId, variant],
      )
      const job = jobResult.rows[0]!
      await client.query(
        `INSERT INTO render_outbox (job_id, generation, payload)
         VALUES ($1, $2, $3::jsonb)`,
        [job.id, job.generation, JSON.stringify({ jobId: job.id, generation: job.generation })],
      )
    }

    await client.query('COMMIT')
    return { recapId, version, reused: false }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}
