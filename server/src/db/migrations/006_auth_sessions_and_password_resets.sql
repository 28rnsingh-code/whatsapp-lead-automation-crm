-- Authentication hardening: persistent session versioning, token revocation and password reset tokens.
-- Additive migration only. Token secrets are never stored in plaintext.
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS session_version INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS public.revoked_auth_tokens (
  jti VARCHAR(128) PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_revoked_auth_tokens_expires_at
  ON public.revoked_auth_tokens (expires_at);

CREATE INDEX IF NOT EXISTS idx_revoked_auth_tokens_user
  ON public.revoked_auth_tokens (user_id, expires_at DESC);

CREATE TABLE IF NOT EXISTS public.password_reset_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  token_hash CHAR(64) NOT NULL UNIQUE
    CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT password_reset_expires_after_creation CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_pending_user
  ON public.password_reset_tokens (user_id, created_at DESC)
  WHERE used_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_expiry
  ON public.password_reset_tokens (expires_at)
  WHERE used_at IS NULL;

-- These tables contain authentication material and must never be exposed through the Supabase Data API.
ALTER TABLE public.revoked_auth_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.password_reset_tokens ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE public.revoked_auth_tokens FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE public.password_reset_tokens FROM PUBLIC;

DO $$
DECLARE
  role_name TEXT;
  table_name TEXT;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      FOREACH table_name IN ARRAY ARRAY['revoked_auth_tokens', 'password_reset_tokens'] LOOP
        EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM %I', table_name, role_name);
      END LOOP;
    END IF;
  END LOOP;
END
$$;
