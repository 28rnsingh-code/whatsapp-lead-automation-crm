-- Security remediation 006: reset-token lifecycle and persisted session revocation.
-- Store only hashes for one-time reset secrets; plaintext tokens are never persisted.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_pending
  ON password_reset_tokens(user_id, expires_at)
  WHERE used_at IS NULL;

CREATE TABLE IF NOT EXISTS revoked_auth_tokens (
  jti VARCHAR(128) PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_revoked_auth_tokens_expiry ON revoked_auth_tokens(expires_at);

-- Keep these server-owned auth tables out of any public/anonymous REST surface.
DO $$
DECLARE role_name TEXT;
BEGIN
  ALTER TABLE public.password_reset_tokens ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.revoked_auth_tokens ENABLE ROW LEVEL SECURITY;
  REVOKE ALL PRIVILEGES ON TABLE public.password_reset_tokens FROM PUBLIC;
  REVOKE ALL PRIVILEGES ON TABLE public.revoked_auth_tokens FROM PUBLIC;
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.password_reset_tokens FROM %I', role_name);
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.revoked_auth_tokens FROM %I', role_name);
    END IF;
  END LOOP;
END
$$;
