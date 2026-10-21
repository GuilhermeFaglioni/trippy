ALTER TABLE trips
  ADD COLUMN sync_floor_seq bigint NOT NULL DEFAULT 0
    CHECK (sync_floor_seq >= 0);

CREATE TABLE invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL REFERENCES trips (id),
  token_hash text NOT NULL UNIQUE,
  created_by uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

CREATE TABLE places (
  id uuid PRIMARY KEY,
  trip_id uuid NOT NULL REFERENCES trips (id),
  provider text,
  provider_ref text,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  local_name text,
  address text,
  local_address text,
  lat double precision,
  lng double precision,
  suggested_by uuid NOT NULL REFERENCES users (id),
  comment text,
  day_index integer,
  position integer,
  seq bigint NOT NULL,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, trip_id)
);

CREATE INDEX places_trip_seq_idx ON places (trip_id, seq);

CREATE TABLE visits (
  place_id uuid NOT NULL,
  trip_id uuid NOT NULL REFERENCES trips (id),
  user_id uuid NOT NULL REFERENCES users (id),
  marked_by uuid NOT NULL REFERENCES users (id),
  visited_at timestamptz NOT NULL,
  visited_tz text NOT NULL,
  seq bigint NOT NULL,
  deleted_at timestamptz,
  PRIMARY KEY (place_id, user_id),
  FOREIGN KEY (place_id, trip_id) REFERENCES places (id, trip_id)
);

CREATE INDEX visits_trip_seq_idx ON visits (trip_id, seq);

CREATE TABLE applied_ops (
  op_id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id),
  trip_id uuid NOT NULL REFERENCES trips (id),
  result jsonb NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX trip_members_trip_seq_idx ON trip_members (trip_id, seq);

WITH legacy_members AS (
  SELECT trip_members.trip_id,
         trip_members.user_id,
         trips.seq_counter + row_number() OVER (
           PARTITION BY trip_members.trip_id
           ORDER BY trip_members.joined_at, trip_members.user_id
         ) AS next_seq
  FROM trip_members
  JOIN trips ON trips.id = trip_members.trip_id
  WHERE trip_members.seq = 0
), updated_members AS (
  UPDATE trip_members
  SET seq = legacy_members.next_seq
  FROM legacy_members
  WHERE trip_members.trip_id = legacy_members.trip_id
    AND trip_members.user_id = legacy_members.user_id
  RETURNING trip_members.trip_id
), backfilled_counts AS (
  SELECT trip_id, count(*) AS member_count
  FROM updated_members
  GROUP BY trip_id
)
UPDATE trips
SET seq_counter = trips.seq_counter + backfilled_counts.member_count
FROM backfilled_counts
WHERE trips.id = backfilled_counts.trip_id;
