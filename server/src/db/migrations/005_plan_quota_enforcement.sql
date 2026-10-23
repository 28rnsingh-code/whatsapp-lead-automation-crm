-- Enforce plan quotas at the database boundary and track monthly import jobs.
-- 005 is additive and safe to apply to existing tenant data.
ALTER TABLE tenant_usage
  ADD COLUMN IF NOT EXISTS imports_count INTEGER NOT NULL DEFAULT 0 CHECK (imports_count >= 0);

CREATE OR REPLACE FUNCTION enforce_active_lead_plan_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  subscription_plan TEXT;
  subscription_limits JSONB;
  max_active_leads INTEGER;
  current_active_leads INTEGER;
BEGIN
  -- Archived leads do not consume the active-lead plan allowance.
  IF TG_OP = 'INSERT' AND NEW.archived_at IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.archived_at IS NOT NULL THEN
      RETURN NEW;
    END IF;
    IF OLD.archived_at IS NULL AND NEW.tenant_id = OLD.tenant_id THEN
      RETURN NEW;
    END IF;
  END IF;

  -- Serialize inserts/unarchives for the destination workspace so concurrent
  -- requests cannot both pass the same active-lead count check.
  PERFORM 1 FROM tenants WHERE id = NEW.tenant_id FOR UPDATE;

  SELECT plan_id, limits
    INTO subscription_plan, subscription_limits
    FROM tenant_subscriptions
    WHERE tenant_id = NEW.tenant_id
    LIMIT 1;

  max_active_leads := NULLIF(subscription_limits->>'maxLeads', '')::INTEGER;
  IF max_active_leads IS NULL OR max_active_leads < 1 THEN
    max_active_leads := CASE subscription_plan
      WHEN 'growth' THEN 10000
      WHEN 'enterprise' THEN 100000
      ELSE 1000
    END;
  END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT COUNT(*)::INTEGER INTO current_active_leads
      FROM leads
      WHERE tenant_id = NEW.tenant_id AND archived_at IS NULL;
  ELSE
    SELECT COUNT(*)::INTEGER INTO current_active_leads
      FROM leads
      WHERE tenant_id = NEW.tenant_id AND archived_at IS NULL AND id <> NEW.id;
  END IF;

  IF current_active_leads >= max_active_leads THEN
    RAISE EXCEPTION 'PLAN_LEAD_LIMIT_REACHED'
      USING ERRCODE = 'P0001',
            DETAIL = format('Workspace plan allows %s active leads; current active count is %s.', max_active_leads, current_active_leads);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_active_lead_plan_limit ON leads;
CREATE TRIGGER trg_enforce_active_lead_plan_limit
  BEFORE INSERT OR UPDATE OF archived_at, tenant_id ON leads
  FOR EACH ROW
  EXECUTE FUNCTION enforce_active_lead_plan_limit();
