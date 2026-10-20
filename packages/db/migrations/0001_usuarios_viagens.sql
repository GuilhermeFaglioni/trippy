CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cognito_sub text UNIQUE,
  name text,
  email text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX users_email_lower_unique_idx ON users (lower(email));

CREATE TABLE identities (
  user_id uuid NOT NULL REFERENCES users (id),
  provider text NOT NULL CHECK (provider IN ('apple', 'email', 'google')),
  provider_subject text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT identities_provider_subject_key UNIQUE (provider, provider_subject)
);

CREATE TABLE trips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text,
  destination text,
  start_date date,
  end_date date,
  timezone text NOT NULL,
  cover_key text,
  organizer_id uuid REFERENCES users (id),
  itinerary_version integer NOT NULL DEFAULT 0,
  seq_counter bigint NOT NULL DEFAULT 0,
  seq bigint NOT NULL DEFAULT 0,
  ended_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT trips_end_date_check CHECK (end_date >= start_date)
);

CREATE TABLE trip_members (
  trip_id uuid NOT NULL REFERENCES trips (id),
  user_id uuid NOT NULL REFERENCES users (id),
  role text NOT NULL CHECK (role IN ('organizer', 'coorganizer', 'member')),
  accepted_video_terms_at timestamptz,
  joined_at timestamptz NOT NULL DEFAULT now(),
  left_at timestamptz,
  seq bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (trip_id, user_id)
);

CREATE UNIQUE INDEX trip_members_one_active_organizer_per_trip_idx
  ON trip_members (trip_id)
  WHERE role = 'organizer' AND left_at IS NULL;
