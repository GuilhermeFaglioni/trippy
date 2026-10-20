CREATE TABLE recaps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL REFERENCES trips (id),
  version integer NOT NULL CHECK (version > 0),
  idempotency_key text NOT NULL,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'rendering', 'ready', 'failed')),
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  video_keys jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(video_keys) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  CONSTRAINT recaps_trip_version_key UNIQUE (trip_id, version),
  CONSTRAINT recaps_trip_idempotency_key UNIQUE (trip_id, idempotency_key)
);

CREATE INDEX recaps_trip_created_idx ON recaps (trip_id, created_at DESC);

CREATE FUNCTION reject_recap_snapshot_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.snapshot IS DISTINCT FROM OLD.snapshot THEN
    RAISE EXCEPTION 'recap snapshot is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER recaps_snapshot_immutable_trigger
BEFORE UPDATE ON recaps
FOR EACH ROW EXECUTE FUNCTION reject_recap_snapshot_update();

CREATE TABLE render_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recap_id uuid NOT NULL REFERENCES recaps (id) ON DELETE CASCADE,
  variant text NOT NULL CHECK (variant IN ('clean', 'watermarked')),
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
  generation integer NOT NULL DEFAULT 1 CHECK (generation > 0),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts integer NOT NULL DEFAULT 3 CHECK (max_attempts > 0),
  fencing_token bigint NOT NULL DEFAULT 0 CHECK (fencing_token >= 0),
  lease_until timestamptz,
  execution_id text,
  last_error text,
  video_key text,
  render_milliseconds bigint CHECK (render_milliseconds >= 0),
  cpu_milliseconds bigint CHECK (cpu_milliseconds >= 0),
  peak_memory_bytes bigint CHECK (peak_memory_bytes >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  CONSTRAINT render_jobs_recap_variant_key UNIQUE (recap_id, variant),
  CONSTRAINT render_jobs_attempt_limit CHECK (attempts <= max_attempts),
  CONSTRAINT render_jobs_running_lease CHECK ((status = 'running') = (lease_until IS NOT NULL)),
  CONSTRAINT render_jobs_running_execution CHECK ((status = 'running') = (execution_id IS NOT NULL)),
  CONSTRAINT render_jobs_success_video CHECK ((status = 'succeeded') = (video_key IS NOT NULL)),
  CONSTRAINT render_jobs_terminal_timestamp
    CHECK ((status IN ('succeeded', 'failed')) = (finished_at IS NOT NULL))
);

CREATE INDEX render_jobs_reconcile_idx ON render_jobs (lease_until)
  WHERE status = 'running';
CREATE INDEX render_jobs_recap_status_idx ON render_jobs (recap_id, status);

CREATE TABLE render_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES render_jobs (id) ON DELETE CASCADE,
  generation integer NOT NULL CHECK (generation > 0),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  CONSTRAINT render_outbox_job_generation_key UNIQUE (job_id, generation)
);

CREATE INDEX render_outbox_unpublished_idx ON render_outbox (created_at)
  WHERE published_at IS NULL;
