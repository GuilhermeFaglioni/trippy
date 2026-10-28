import type { Role } from '@trippy/domain'
import pg, { type PoolClient } from 'pg'

type Pool = InstanceType<typeof pg.Pool>
import type { TripRecord } from '../trips/store.ts'

export interface CreateInviteRecord {
  tripId: string
  createdBy: string
  tokenHash: string
}

export interface InviteStore {
  createInvite(input: CreateInviteRecord): Promise<'created' | 'not_found' | 'forbidden'>
  acceptInvite(userId: string, tokenHash: string): Promise<TripRecord | null>
}

interface TripIdRow {
  id: string
}

interface RoleRow {
  role: Role
}

interface MembershipRow {
  left_at: Date | null
}

interface TripSummaryRow {
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

async function nextSequence(client: PoolClient, tripId: string): Promise<string> {
  const result = await client.query<{ seq_counter: string }>(
    'UPDATE trips SET seq_counter = seq_counter + 1 WHERE id = $1 RETURNING seq_counter::text AS seq_counter',
    [tripId],
  )
  return result.rows[0]!.seq_counter
}

async function getTripSummary(
  client: PoolClient,
  tripId: string,
  userId: string,
): Promise<TripRecord | null> {
  const result = await client.query<TripSummaryRow>(
    `SELECT trips.id, trips.name, trips.destination,
            to_char(trips.start_date, 'YYYY-MM-DD') AS start_date,
            to_char(trips.end_date, 'YYYY-MM-DD') AS end_date,
            trips.timezone, trip_members.role, trips.created_at, trips.ended_at
     FROM trips
     JOIN trip_members ON trip_members.trip_id = trips.id
     WHERE trips.id = $1
       AND trip_members.user_id = $2
       AND trip_members.left_at IS NULL
       AND trips.deleted_at IS NULL`,
    [tripId, userId],
  )
  const row = result.rows[0]
  if (!row) return null
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

export class PostgresInviteStore implements InviteStore {
  constructor(private readonly pool: Pool) {}

  async createInvite(input: CreateInviteRecord): Promise<'created' | 'not_found' | 'forbidden'> {
    const client = await this.pool.connect()
    try {
      return await inTransaction(client, async () => {
        const trip = await client.query<TripIdRow>(
          'SELECT id FROM trips WHERE id = $1 AND deleted_at IS NULL FOR UPDATE',
          [input.tripId],
        )
        if (!trip.rows[0]) return 'not_found'

        const member = await client.query<RoleRow>(
          `SELECT role FROM trip_members
           WHERE trip_id = $1 AND user_id = $2 AND left_at IS NULL
           FOR UPDATE`,
          [input.tripId, input.createdBy],
        )
        const role = member.rows[0]?.role
        if (!role) return 'not_found'
        if (role !== 'organizer' && role !== 'coorganizer') return 'forbidden'

        await client.query(
          'INSERT INTO invites (trip_id, token_hash, created_by) VALUES ($1, $2, $3)',
          [input.tripId, input.tokenHash, input.createdBy],
        )
        return 'created'
      })
    } finally {
      client.release()
    }
  }

  async acceptInvite(userId: string, tokenHash: string): Promise<TripRecord | null> {
    const inviteResult = await this.pool.query<{ trip_id: string }>(
      'SELECT trip_id FROM invites WHERE token_hash = $1 AND revoked_at IS NULL',
      [tokenHash],
    )
    const invite = inviteResult.rows[0]
    if (!invite) return null

    const client = await this.pool.connect()
    try {
      return await inTransaction(client, async () => {
        const trip = await client.query<TripIdRow>(
          'SELECT id FROM trips WHERE id = $1 AND deleted_at IS NULL FOR UPDATE',
          [invite.trip_id],
        )
        if (!trip.rows[0]) return null

        const activeInvite = await client.query<{ trip_id: string }>(
          `SELECT trip_id FROM invites
           WHERE token_hash = $1 AND trip_id = $2 AND revoked_at IS NULL
           FOR UPDATE`,
          [tokenHash, invite.trip_id],
        )
        if (!activeInvite.rows[0]) return null

        const activeMember = await client.query<RoleRow>(
          `SELECT role FROM trip_members
           WHERE trip_id = $1 AND user_id = $2 AND left_at IS NULL
           FOR UPDATE`,
          [invite.trip_id, userId],
        )
        if (activeMember.rows[0]) return getTripSummary(client, invite.trip_id, userId)

        const priorMember = await client.query<MembershipRow>(
          'SELECT left_at FROM trip_members WHERE trip_id = $1 AND user_id = $2 FOR UPDATE',
          [invite.trip_id, userId],
        )
        const sequence = await nextSequence(client, invite.trip_id)
        if (priorMember.rows[0]) {
          await client.query(
            `UPDATE trip_members
             SET role = 'member', joined_at = now(), left_at = NULL, seq = $3
             WHERE trip_id = $1 AND user_id = $2`,
            [invite.trip_id, userId, sequence],
          )
        } else {
          await client.query(
            `INSERT INTO trip_members (trip_id, user_id, role, seq)
             VALUES ($1, $2, 'member', $3)`,
            [invite.trip_id, userId, sequence],
          )
        }
        return getTripSummary(client, invite.trip_id, userId)
      })
    } finally {
      client.release()
    }
  }
}
