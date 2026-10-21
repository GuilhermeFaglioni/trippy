import pg, { type PoolClient } from 'pg'
import type { CreateTripInput, Role } from '@trippy/domain'

type Pool = InstanceType<typeof pg.Pool>

export interface CreateTripRecord extends CreateTripInput {
  organizerId: string
}

export interface TripRecord extends CreateTripInput {
  id: string
  role: Role
  createdAt: Date
  endedAt: Date | null
}

export interface TripStore {
  createTrip(input: CreateTripRecord): Promise<TripRecord>
  listTripsForUser(userId: string): Promise<TripRecord[]>
  getTripForMember(userId: string, tripId: string): Promise<TripRecord | null>
}

interface TripRow {
  id: string
  name: string
  destination: string
  start_date: string
  end_date: string
  timezone: string
  role: Role
  created_at: Date
  ended_at: Date | null
}

function mapTripRow(row: TripRow): TripRecord {
  return {
    id: row.id,
    name: row.name,
    destination: row.destination,
    startDate: row.start_date,
    endDate: row.end_date,
    timezone: row.timezone,
    role: row.role,
    createdAt: row.created_at,
    endedAt: row.ended_at,
  }
}

async function inTransaction<T>(client: PoolClient, operation: () => Promise<T>): Promise<T> {
  await client.query('BEGIN')
  try {
    const value = await operation()
    await client.query('COMMIT')
    return value
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  }
}

const tripColumns = `
  trips.id,
  trips.name,
  trips.destination,
  to_char(trips.start_date, 'YYYY-MM-DD') AS start_date,
  to_char(trips.end_date, 'YYYY-MM-DD') AS end_date,
  trips.timezone,
  trip_members.role,
  trips.created_at,
  trips.ended_at
`

export class PostgresTripStore implements TripStore {
  constructor(private readonly pool: Pool) {}

  async createTrip(input: CreateTripRecord): Promise<TripRecord> {
    const client = await this.pool.connect()
    try {
      return await inTransaction(client, async () => {
        const inserted = await client.query<TripRow>(
          `INSERT INTO trips (
             name, destination, start_date, end_date, timezone, organizer_id, seq, seq_counter
           ) VALUES ($1, $2, $3, $4, $5, $6, 1, 1)
           RETURNING id, name, destination, to_char(start_date, 'YYYY-MM-DD') AS start_date,
                     to_char(end_date, 'YYYY-MM-DD') AS end_date, timezone, created_at, ended_at`,
          [
            input.name,
            input.destination,
            input.startDate,
            input.endDate,
            input.timezone,
            input.organizerId,
          ],
        )
        const trip = inserted.rows[0]!

        const nextSequence = await client.query<{ seq_counter: string }>(
          'UPDATE trips SET seq_counter = seq_counter + 1 WHERE id = $1 RETURNING seq_counter',
          [trip.id],
        )
        const memberSequence = nextSequence.rows[0]!.seq_counter

        await client.query(
          `INSERT INTO trip_members (trip_id, user_id, role, seq)
           VALUES ($1, $2, 'organizer', $3)`,
          [trip.id, input.organizerId, memberSequence],
        )

        return mapTripRow({ ...trip, role: 'organizer' })
      })
    } finally {
      client.release()
    }
  }

  async listTripsForUser(userId: string): Promise<TripRecord[]> {
    const result = await this.pool.query<TripRow>(
      `SELECT ${tripColumns}
       FROM trips
       JOIN trip_members ON trip_members.trip_id = trips.id
       WHERE trip_members.user_id = $1
         AND trip_members.left_at IS NULL
         AND trips.deleted_at IS NULL
       ORDER BY trips.start_date ASC, trips.created_at ASC`,
      [userId],
    )
    return result.rows.map(mapTripRow)
  }

  async getTripForMember(userId: string, tripId: string): Promise<TripRecord | null> {
    const result = await this.pool.query<TripRow>(
      `SELECT ${tripColumns}
       FROM trips
       JOIN trip_members ON trip_members.trip_id = trips.id
       WHERE trips.id = $1
         AND trip_members.user_id = $2
         AND trip_members.left_at IS NULL
         AND trips.deleted_at IS NULL`,
      [tripId, userId],
    )
    const trip = result.rows[0]
    return trip ? mapTripRow(trip) : null
  }
}
