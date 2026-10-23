-- Idempotency ledger for verified billing provider webhook events.
-- Event IDs are unique per provider, preventing a duplicate webhook from replaying plan changes.
CREATE TABLE IF NOT EXISTS billing_webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider VARCHAR(50) NOT NULL,
  event_id VARCHAR(255) NOT NULL,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_type VARCHAR(80) NOT NULL,
  event_timestamp TIMESTAMPTZ,
  payload_sha256 VARCHAR(64) NOT NULL,
  processing_status VARCHAR(20) NOT NULL DEFAULT 'received'
    CHECK (processing_status IN ('received', 'processed')),
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  CONSTRAINT uq_billing_provider_event UNIQUE (provider, event_id)
);

CREATE INDEX IF NOT EXISTS idx_billing_webhook_events_tenant_received
  ON billing_webhook_events(tenant_id, received_at DESC);
