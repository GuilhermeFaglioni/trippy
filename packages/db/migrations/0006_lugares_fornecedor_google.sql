ALTER TABLE places
  ADD COLUMN provider_datasource text,
  ADD COLUMN attribution text,
  ADD COLUMN license text,
  ADD COLUMN google_place_id text,
  ADD COLUMN google_match text NOT NULL DEFAULT 'none'
    CHECK (google_match IN ('none', 'matched', 'no_match')),
  ADD COLUMN user_local_name text,
  ADD COLUMN user_local_address text;

CREATE TABLE places_provider_usage (
  user_id uuid NOT NULL REFERENCES users (id),
  trip_id uuid NOT NULL REFERENCES trips (id),
  provider text NOT NULL,
  usage_type text NOT NULL,
  window_started_at timestamptz NOT NULL,
  call_count integer NOT NULL DEFAULT 0 CHECK (call_count >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, trip_id, provider, usage_type, window_started_at)
);

CREATE INDEX places_provider_usage_user_idx
  ON places_provider_usage (user_id, provider, usage_type, window_started_at);
CREATE INDEX places_provider_usage_trip_idx
  ON places_provider_usage (trip_id, provider, usage_type, window_started_at);

CREATE TABLE places_provider_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id),
  trip_id uuid NOT NULL REFERENCES trips (id),
  place_id uuid REFERENCES places (id),
  provider text NOT NULL,
  sku text NOT NULL,
  status text NOT NULL,
  latency_ms integer CHECK (latency_ms IS NULL OR latency_ms >= 0),
  touch_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX places_provider_calls_user_created_idx
  ON places_provider_calls (user_id, created_at);
CREATE INDEX places_provider_calls_trip_created_idx
  ON places_provider_calls (trip_id, created_at);
CREATE INDEX places_provider_calls_touch_idx
  ON places_provider_calls (touch_id);
