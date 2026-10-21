-- ========================================================
-- OneClick Automics CRM — Initial Database Migration (001)
-- PostgreSQL DDL with Multi-Tenant Scoping and Indexes
-- ========================================================

-- Ensure migration tracker table exists
CREATE TABLE IF NOT EXISTS _migrations (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL UNIQUE,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 1. Tenants (Workspaces)
CREATE TABLE IF NOT EXISTS tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(100) NOT NULL UNIQUE,
    status VARCHAR(50) NOT NULL DEFAULT 'active',
    timezone VARCHAR(50) NOT NULL DEFAULT 'Asia/Kolkata',
    currency VARCHAR(10) NOT NULL DEFAULT 'INR',
    locale VARCHAR(20) NOT NULL DEFAULT 'en-IN',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Users
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email_normalized VARCHAR(255) NOT NULL UNIQUE,
    display_name VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255),
    status VARCHAR(50) NOT NULL DEFAULT 'active',
    avatar_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Roles
CREATE TABLE IF NOT EXISTS roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    is_system BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Role Permissions
CREATE TABLE IF NOT EXISTS role_permissions (
    role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    permission_key VARCHAR(100) NOT NULL,
    PRIMARY KEY (role_id, permission_key)
);

-- 5. Memberships (Tenant-User association with Role)
CREATE TABLE IF NOT EXISTS memberships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id UUID NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
    status VARCHAR(50) NOT NULL DEFAULT 'active',
    invited_by UUID REFERENCES users(id) ON DELETE SET NULL,
    invited_at TIMESTAMPTZ,
    accepted_at TIMESTAMPTZ,
    CONSTRAINT uq_tenant_user UNIQUE (tenant_id, user_id)
);

-- 6. Pipeline Stages
CREATE TABLE IF NOT EXISTS pipeline_stages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    sort_order INT NOT NULL DEFAULT 0,
    color_token VARCHAR(50) NOT NULL DEFAULT '#155eef',
    is_won BOOLEAN NOT NULL DEFAULT FALSE,
    is_lost BOOLEAN NOT NULL DEFAULT FALSE,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 7. Leads (Strict Tenant Scoping)
CREATE TABLE IF NOT EXISTS leads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    phone_raw VARCHAR(50) NOT NULL,
    phone_normalized VARCHAR(50) NOT NULL,
    email VARCHAR(255),
    company_name VARCHAR(255),
    source VARCHAR(50) NOT NULL DEFAULT 'Website',
    stage_id UUID REFERENCES pipeline_stages(id) ON DELETE SET NULL,
    qualification_status VARCHAR(50) NOT NULL DEFAULT 'In Review',
    owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    deal_value_minor_units BIGINT NOT NULL DEFAULT 0,
    currency VARCHAR(10) NOT NULL DEFAULT 'INR',
    next_action VARCHAR(50) NOT NULL DEFAULT 'Call',
    follow_up_at TIMESTAMPTZ,
    consent_status VARCHAR(50) NOT NULL DEFAULT 'Consented',
    opted_out_at TIMESTAMPTZ,
    notes TEXT,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    archived_at TIMESTAMPTZ
);

-- 8. Tasks & Follow-ups
CREATE TABLE IF NOT EXISTS tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    task_type VARCHAR(50) NOT NULL DEFAULT 'Call',
    owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    due_at TIMESTAMPTZ NOT NULL,
    timezone VARCHAR(50) NOT NULL DEFAULT 'Asia/Kolkata',
    priority VARCHAR(20) NOT NULL DEFAULT 'Medium',
    status VARCHAR(50) NOT NULL DEFAULT 'Pending',
    completed_at TIMESTAMPTZ,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 9. Activities & Notes Timeline
CREATE TABLE IF NOT EXISTS activities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    entity_type VARCHAR(50) NOT NULL,
    entity_id UUID NOT NULL,
    activity_type VARCHAR(50) NOT NULL,
    actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    summary TEXT NOT NULL,
    safe_metadata JSONB,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 10. Immutable Audit Events
CREATE TABLE IF NOT EXISTS audit_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(50) NOT NULL,
    entity_id UUID NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    request_id VARCHAR(100),
    safe_metadata JSONB
);

-- 11. Integrations (Website, WhatsApp, etc.)
CREATE TABLE IF NOT EXISTS integrations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    provider VARCHAR(50) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'Disconnected',
    external_account_id VARCHAR(255),
    credential_reference VARCHAR(255),
    last_success_at TIMESTAMPTZ,
    last_error_code VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Optimization & Multi-Tenant Performance Indexes
CREATE INDEX IF NOT EXISTS idx_memberships_tenant_user ON memberships(tenant_id, user_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_stages_tenant_order ON pipeline_stages(tenant_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_leads_tenant_stage ON leads(tenant_id, stage_id);
CREATE INDEX IF NOT EXISTS idx_leads_tenant_owner ON leads(tenant_id, owner_user_id);
CREATE INDEX IF NOT EXISTS idx_leads_tenant_created ON leads(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_tenant_owner_status ON tasks(tenant_id, owner_user_id, status);
CREATE INDEX IF NOT EXISTS idx_activities_tenant_entity ON activities(tenant_id, entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_events_tenant_time ON audit_events(tenant_id, occurred_at DESC);
