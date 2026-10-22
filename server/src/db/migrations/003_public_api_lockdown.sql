-- Defense-in-depth lockdown for the server-owned CRM schema.
-- The Express API uses the private DATABASE_URL and applies tenant scoping itself.
-- These tables must not be queryable through the public Supabase REST API using anon/authenticated keys.
-- We intentionally create no RLS policies for those client roles; only explicitly authorized backend DB roles may access them.

DO $$
DECLARE
  table_name TEXT;
  role_name TEXT;
  app_tables TEXT[] := ARRAY[
    '_migrations',
    'tenants',
    'users',
    'roles',
    'role_permissions',
    'memberships',
    'pipeline_stages',
    'leads',
    'tasks',
    'activities',
    'audit_events',
    'integrations',
    'import_jobs',
    'companies',
    'contacts',
    'tenant_settings',
    'whatsapp_messages',
    'tenant_subscriptions',
    'tenant_usage'
  ];
BEGIN
  FOREACH table_name IN ARRAY app_tables LOOP
    EXECUTE format('ALTER TABLE IF EXISTS public.%I ENABLE ROW LEVEL SECURITY', table_name);

    FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
        EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM %I', table_name, role_name);
      END IF;
    END LOOP;
  END LOOP;
END
$$;
