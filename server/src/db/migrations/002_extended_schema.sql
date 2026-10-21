-- ========================================================
-- OneClick Automics CRM — Extended Features Migration (002)
-- Tables for Import/Export, Contacts, Companies, WhatsApp,
-- AI Settings, Subscriptions & Usage Metering
-- ========================================================

-- 1. Import Jobs & Bulk Processing History
CREATE TABLE IF NOT EXISTS import_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    filename VARCHAR(255) NOT NULL,
    file_format VARCHAR(20) NOT NULL DEFAULT 'csv',
    status VARCHAR(50) NOT NULL DEFAULT 'pending', -- pending, processing, completed, failed
    total_rows INT NOT NULL DEFAULT 0,
    imported_count INT NOT NULL DEFAULT 0,
    duplicate_count INT NOT NULL DEFAULT 0,
    failed_count INT NOT NULL DEFAULT 0,
    duplicate_strategy VARCHAR(50) NOT NULL DEFAULT 'skip', -- skip, update, import_non_duplicates
    error_details JSONB,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

-- 2. Companies
CREATE TABLE IF NOT EXISTS companies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    domain VARCHAR(255),
    phone VARCHAR(50),
    industry VARCHAR(100),
    website VARCHAR(255),
    address TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Contacts
CREATE TABLE IF NOT EXISTS contacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
    lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
    name VARCHAR(255) NOT NULL,
    phone_raw VARCHAR(50) NOT NULL,
    phone_normalized VARCHAR(50) NOT NULL,
    email VARCHAR(255),
    job_title VARCHAR(100),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Tenant Settings (Encrypted Provider Keys, Auto-Reply, General Preferences)
CREATE TABLE IF NOT EXISTS tenant_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    category VARCHAR(50) NOT NULL, -- 'whatsapp', 'ai', 'general', 'billing'
    config_data JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_tenant_setting_category UNIQUE (tenant_id, category)
);

-- 5. WhatsApp & Omnichannel Messages
CREATE TABLE IF NOT EXISTS whatsapp_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
    contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
    direction VARCHAR(20) NOT NULL, -- 'inbound', 'outbound'
    sender_phone VARCHAR(50) NOT NULL,
    recipient_phone VARCHAR(50) NOT NULL,
    message_type VARCHAR(50) NOT NULL DEFAULT 'text', -- 'text', 'template', 'image', 'document'
    body TEXT NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'sent', -- 'queued', 'sent', 'delivered', 'read', 'failed'
    idempotency_key VARCHAR(255),
    provider_message_id VARCHAR(255),
    ai_generated BOOLEAN NOT NULL DEFAULT FALSE,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_whatsapp_idempotency UNIQUE (tenant_id, idempotency_key)
);

-- 6. Tenant Subscriptions & Plans
CREATE TABLE IF NOT EXISTS tenant_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE UNIQUE,
    plan_id VARCHAR(50) NOT NULL DEFAULT 'starter',
    plan_name VARCHAR(100) NOT NULL DEFAULT 'Starter Plan',
    status VARCHAR(50) NOT NULL DEFAULT 'trial', -- 'trial', 'active', 'past_due', 'cancelled', 'suspended'
    billing_provider VARCHAR(50) NOT NULL DEFAULT 'mock', -- 'razorpay', 'stripe', 'mock'
    external_customer_id VARCHAR(255),
    external_subscription_id VARCHAR(255),
    limits JSONB NOT NULL DEFAULT '{"maxLeads": 1000, "maxImportsPerMonth": 10, "maxMessagesPerMonth": 500, "maxAiTokens": 50000}'::jsonb,
    trial_ends_at TIMESTAMPTZ,
    current_period_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    current_period_end TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '30 days',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 7. Tenant Usage Metering
CREATE TABLE IF NOT EXISTS tenant_usage (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    period_key VARCHAR(20) NOT NULL, -- e.g. '2026-10'
    leads_count INT NOT NULL DEFAULT 0,
    messages_count INT NOT NULL DEFAULT 0,
    import_rows_count INT NOT NULL DEFAULT 0,
    ai_requests_count INT NOT NULL DEFAULT 0,
    ai_tokens_count INT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_tenant_usage_period UNIQUE (tenant_id, period_key)
);

-- Indexes for performance and multi-tenant isolation
CREATE INDEX IF NOT EXISTS idx_import_jobs_tenant ON import_jobs(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_companies_tenant ON companies(tenant_id, name);
CREATE INDEX IF NOT EXISTS idx_contacts_tenant ON contacts(tenant_id, phone_normalized);
CREATE INDEX IF NOT EXISTS idx_contacts_lead ON contacts(tenant_id, lead_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_tenant_lead ON whatsapp_messages(tenant_id, lead_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_idempotency ON whatsapp_messages(tenant_id, idempotency_key);
CREATE INDEX IF NOT EXISTS idx_tenant_usage_tenant_period ON tenant_usage(tenant_id, period_key);
