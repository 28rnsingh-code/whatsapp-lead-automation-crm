-- Invitation token data is server-owned. No public API policies are created.
DO $$
DECLARE role_name TEXT;
BEGIN
  ALTER TABLE IF EXISTS public.workspace_invitations ENABLE ROW LEVEL SECURITY;
  REVOKE ALL PRIVILEGES ON TABLE public.workspace_invitations FROM PUBLIC;
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.workspace_invitations FROM %I', role_name);
    END IF;
  END LOOP;
END
$$;
