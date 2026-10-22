-- Require explicit workspace locale/timezone/currency inputs from configuration.
-- Safe for existing rows: only removes defaults; existing tenant values are preserved.
ALTER TABLE public.tenants
  ALTER COLUMN timezone DROP DEFAULT,
  ALTER COLUMN currency DROP DEFAULT,
  ALTER COLUMN locale DROP DEFAULT;
