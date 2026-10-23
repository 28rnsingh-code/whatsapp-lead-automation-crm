-- ========================================================
-- OneClick Automics CRM — Consent Evidence & WhatsApp Safety (003)
-- ========================================================
-- Do not infer WhatsApp opt-in from lead creation. Historical rows are not
-- backfilled: a previous version hard-coded consent_status='Consented' without
-- recording evidence, so outbound messaging requires an explicit re-confirmation.
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS consent_source VARCHAR(100),
  ADD COLUMN IF NOT EXISTS consent_recorded_at TIMESTAMPTZ;

ALTER TABLE leads
  ALTER COLUMN consent_status SET DEFAULT 'Unknown';

ALTER TABLE whatsapp_messages
  ADD COLUMN IF NOT EXISTS idempotency_request_hash VARCHAR(64);
