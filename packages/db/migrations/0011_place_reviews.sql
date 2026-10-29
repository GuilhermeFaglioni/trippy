CREATE TABLE place_reviews (
  place_id uuid NOT NULL,
  trip_id uuid NOT NULL REFERENCES trips (id),
  user_id uuid NOT NULL REFERENCES users (id),
  favorite boolean NOT NULL DEFAULT false,
  rating smallint CHECK (rating BETWEEN 1 AND 5),
  note text CHECK (note IS NULL OR char_length(note) <= 2000),
  updated_at timestamptz NOT NULL DEFAULT now(),
  seq bigint NOT NULL,
  deleted_at timestamptz,
  PRIMARY KEY (place_id, user_id),
  FOREIGN KEY (place_id, trip_id) REFERENCES places (id, trip_id)
);

CREATE INDEX place_reviews_trip_seq_idx ON place_reviews (trip_id, seq);
