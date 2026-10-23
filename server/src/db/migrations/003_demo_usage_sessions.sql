-- Public demo: per-session atomic usage cap.
-- Applying this migration is safe and does not alter customer data.
CREATE TABLE IF NOT EXISTS demo_usage_sessions (
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  session_id UUID NOT NULL,
  action_count INTEGER NOT NULL DEFAULT 0 CHECK (action_count >= 0 AND action_count <= 5),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, session_id)
);

CREATE INDEX IF NOT EXISTS idx_demo_usage_sessions_updated_at
  ON demo_usage_sessions(updated_at);
