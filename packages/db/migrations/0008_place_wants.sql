CREATE TABLE place_wants (
  place_id uuid NOT NULL,
  trip_id uuid NOT NULL REFERENCES trips (id),
  user_id uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL,
  seq bigint NOT NULL,
  deleted_at timestamptz,
  PRIMARY KEY (place_id, user_id),
  FOREIGN KEY (place_id, trip_id) REFERENCES places (id, trip_id)
);

CREATE INDEX place_wants_trip_seq_idx ON place_wants (trip_id, seq);
