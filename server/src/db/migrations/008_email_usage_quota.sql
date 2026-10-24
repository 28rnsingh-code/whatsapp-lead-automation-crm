-- Email usage is tracked separately from WhatsApp messages.
-- Historical email totals cannot be backfilled because they were not persisted.
ALTER TABLE tenant_usage
  ADD COLUMN IF NOT EXISTS emails_count INTEGER NOT NULL DEFAULT 0 CHECK (emails_count >= 0);

CREATE TABLE IF NOT EXISTS email_delivery_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  idempotency_key VARCHAR(120) NOT NULL,
  recipient_email VARCHAR(254) NOT NULL,
  subject VARCHAR(160) NOT NULL,
  status VARCHAR(24) NOT NULL CHECK (status IN ('pending', 'accepted', 'failed', 'uncertain', 'simulated')),
  provider VARCHAR(24) NOT NULL CHECK (provider IN ('brevo', 'demo')),
  provider_message_id TEXT,
  error_code VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_email_delivery_logs_tenant_created
  ON email_delivery_logs (tenant_id, created_at DESC);
