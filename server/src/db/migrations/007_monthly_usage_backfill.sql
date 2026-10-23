-- Backfill current-month message/import usage before hard quota enforcement begins.
-- Do not decrement counters already written by the new reservation service.
DO $$
DECLARE
  v_period_key TEXT := to_char(NOW() AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM');
  v_month_start TIMESTAMPTZ := date_trunc('month', NOW() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata';
BEGIN
  WITH current_usage AS (
    SELECT
      t.id AS tenant_id,
      COALESCE((
        SELECT COUNT(*)::INTEGER
        FROM whatsapp_messages wm
        WHERE wm.tenant_id = t.id
          AND wm.direction = 'outbound'
          AND wm.status NOT IN ('failed', 'simulated')
          AND wm.created_at >= v_month_start
      ), 0) AS messages_count,
      COALESCE((
        SELECT COUNT(*)::INTEGER
        FROM import_jobs ij
        WHERE ij.tenant_id = t.id
          AND ij.status = 'completed'
          AND ij.created_at >= v_month_start
      ), 0) AS imports_count,
      COALESCE((
        SELECT SUM(ij.imported_count)::INTEGER
        FROM import_jobs ij
        WHERE ij.tenant_id = t.id
          AND ij.status = 'completed'
          AND ij.created_at >= v_month_start
      ), 0) AS import_rows_count
    FROM tenants t
  )
  INSERT INTO tenant_usage (
    tenant_id, period_key, messages_count, imports_count, import_rows_count, updated_at
  )
  SELECT tenant_id, v_period_key, messages_count, imports_count, import_rows_count, NOW()
  FROM current_usage
  ON CONFLICT (tenant_id, period_key) DO UPDATE SET
    messages_count = GREATEST(tenant_usage.messages_count, EXCLUDED.messages_count),
    imports_count = GREATEST(tenant_usage.imports_count, EXCLUDED.imports_count),
    import_rows_count = GREATEST(tenant_usage.import_rows_count, EXCLUDED.import_rows_count),
    updated_at = NOW();
END $$;

-- Historical AI token consumption cannot be reconstructed reliably because prior
-- calls were not persisted with provider-reported token counts. ai_tokens_count
-- starts tracking on first metered AI request after this release.
