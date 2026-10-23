CREATE TABLE photos (
  id uuid PRIMARY KEY,
  trip_id uuid NOT NULL REFERENCES trips (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users (id),
  s3_key text NOT NULL UNIQUE,
  taken_at_original text,
  taken_tz text,
  lat double precision,
  lng double precision,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'uploaded', 'ready')),
  created_at timestamptz NOT NULL DEFAULT now(),
  uploaded_at timestamptz,
  ready_at timestamptz,
  deleted_at timestamptz,
  CONSTRAINT photos_coordinates_pair CHECK ((lat IS NULL) = (lng IS NULL)),
  CONSTRAINT photos_lat_range CHECK (lat IS NULL OR (lat >= -90 AND lat <= 90)),
  CONSTRAINT photos_lng_range CHECK (lng IS NULL OR (lng >= -180 AND lng <= 180)),
  CONSTRAINT photos_upload_timestamp CHECK ((status = 'pending') = (uploaded_at IS NULL)),
  CONSTRAINT photos_ready_timestamp CHECK ((status = 'ready') = (ready_at IS NOT NULL))
);

CREATE INDEX photos_trip_created_idx ON photos (trip_id, created_at DESC, id)
  WHERE deleted_at IS NULL;

CREATE TABLE photo_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  photo_id uuid NOT NULL REFERENCES photos (id) ON DELETE CASCADE,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error text,
  available_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT photo_outbox_photo_key UNIQUE (photo_id)
);

CREATE INDEX photo_outbox_unpublished_idx ON photo_outbox (available_at, created_at, id)
  WHERE published_at IS NULL;
