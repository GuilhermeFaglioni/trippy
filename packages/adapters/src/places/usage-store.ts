import type { ProviderCall } from './provider.ts'
import type { Pool } from 'pg'

export type PlacesUsageProvider = ProviderCall['provider']
export type PlacesUsageType = 'search' | 'google_details'

export interface ConsumePlacesUsageInput {
  userId: string
  tripId: string
  provider: PlacesUsageProvider
  usageType: PlacesUsageType
  userDailyLimit: number
  tripDailyLimit: number
}

export interface RecordPlacesProviderCallInput {
  userId: string
  tripId: string
  placeId: string | null
  touchId: string
  call: ProviderCall
}

export type ConsumePlacesUsageResult =
  { allowed: true } | { allowed: false; exceeded: 'user' | 'trip' }

export interface PlacesUsageStore {
  consume(input: ConsumePlacesUsageInput): Promise<ConsumePlacesUsageResult>
  recordCall(input: RecordPlacesProviderCallInput): Promise<void>
}

export class PostgresPlacesUsageStore implements PlacesUsageStore {
  constructor(
    private readonly pool: Pool,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async consume(input: ConsumePlacesUsageInput): Promise<ConsumePlacesUsageResult> {
    const client = await this.pool.connect()
    const windowStartedAt = utcDayStart(this.now())
    try {
      await client.query('BEGIN')
      try {
        const window = windowStartedAt.toISOString()
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))', [
          'places-user',
          `${input.userId}:${input.provider}:${input.usageType}:${window}`,
        ])
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))', [
          'places-trip',
          `${input.tripId}:${input.provider}:${input.usageType}:${window}`,
        ])

        const counts = await client.query<{ user_count: string; trip_count: string }>(
          `SELECT
             COALESCE(SUM(call_count) FILTER (WHERE user_id = $1), 0)::text AS user_count,
             COALESCE(SUM(call_count) FILTER (WHERE trip_id = $2), 0)::text AS trip_count
           FROM places_provider_usage
           WHERE provider = $3
             AND usage_type = $4
             AND window_started_at = $5
             AND (user_id = $1 OR trip_id = $2)`,
          [input.userId, input.tripId, input.provider, input.usageType, windowStartedAt],
        )
        const userCount = Number(counts.rows[0]?.user_count ?? 0)
        const tripCount = Number(counts.rows[0]?.trip_count ?? 0)
        if (userCount >= input.userDailyLimit) {
          await client.query('COMMIT')
          return { allowed: false, exceeded: 'user' }
        }
        if (tripCount >= input.tripDailyLimit) {
          await client.query('COMMIT')
          return { allowed: false, exceeded: 'trip' }
        }

        await client.query(
          `INSERT INTO places_provider_usage (
             user_id, trip_id, provider, usage_type, window_started_at, call_count
           ) VALUES ($1, $2, $3, $4, $5, 1)
           ON CONFLICT (user_id, trip_id, provider, usage_type, window_started_at)
           DO UPDATE SET call_count = places_provider_usage.call_count + 1,
                         updated_at = now()`,
          [input.userId, input.tripId, input.provider, input.usageType, windowStartedAt],
        )
        await client.query('COMMIT')
        return { allowed: true }
      } catch (error) {
        await client.query('ROLLBACK')
        throw error
      }
    } finally {
      client.release()
    }
  }

  async recordCall(input: RecordPlacesProviderCallInput): Promise<void> {
    await this.pool.query(
      `INSERT INTO places_provider_calls (
         user_id, trip_id, place_id, provider, sku, status, latency_ms, touch_id
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        input.userId,
        input.tripId,
        input.placeId,
        input.call.provider,
        input.call.sku,
        input.call.status,
        input.call.latencyMs,
        input.touchId,
      ],
    )
  }
}

function utcDayStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}
