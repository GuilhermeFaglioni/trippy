CREATE TABLE email_login_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  code_hmac char(64) NOT NULL CHECK (code_hmac ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz NOT NULL,
  attempts smallint NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  invalidated_at timestamptz,
  invalidation_reason text CHECK (invalidation_reason IN ('superseded', 'expired', 'too_many_attempts')),
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((invalidated_at IS NULL) = (invalidation_reason IS NULL)),
  CHECK (invalidated_at IS NULL OR consumed_at IS NULL)
);

CREATE INDEX email_login_codes_email_created_at_idx
  ON email_login_codes (email, created_at DESC);

CREATE TABLE refresh_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id),
  family_id uuid NOT NULL DEFAULT gen_random_uuid(),
  token_hash char(64) NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX refresh_tokens_family_idx ON refresh_tokens (family_id);
