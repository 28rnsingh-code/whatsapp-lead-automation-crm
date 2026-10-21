# Proposed Data Model (Review Before Migration)

This is a starting model. Confirm relationships, retention, uniqueness and deletion behavior with product/security owners before schema implementation.

## Core entities
- `tenants`: id, name, slug, status, timezone, currency, locale, created_at, updated_at
- `users`: id, email_normalized, display_name, auth_provider_id, status, created_at, updated_at
- `memberships`: id, tenant_id, user_id, role_id, status, invited_by, invited_at, accepted_at
- `roles`: id, tenant_id/null for system roles, name, description
- `role_permissions`: role_id, permission_key
- `leads`: id, tenant_id, name, phone_raw, phone_normalized, email, company_id, source_id, stage_id, qualification_status, owner_user_id, deal_value_minor_units, currency, next_action, follow_up_at, consent_status, opted_out_at, notes, created_by, created_at, updated_at, archived_at
- `contacts`: id, tenant_id, name, phone, email, company_id, consent_status, created_at, updated_at
- `companies`: id, tenant_id, name, domain, phone, address fields, created_at, updated_at
- `lead_sources`: id, tenant_id, name, active
- `pipeline_stages`: id, tenant_id, name, sort_order, color_token, is_won, is_lost, active
- `activities`: id, tenant_id, entity_type, entity_id, activity_type, actor_user_id, summary, safe_metadata, occurred_at
- `tasks`: id, tenant_id, lead_id/contact_id, title, task_type, owner_user_id, due_at, timezone, reminder_config, priority, status, completed_at, created_by
- `notes`: id, tenant_id, entity_type, entity_id, body, created_by, created_at
- `integrations`: id, tenant_id, provider, status, external_account_id, credential_reference, last_success_at, last_error_code, created_at, updated_at
- `conversations`: id, tenant_id, integration_id, lead_id/contact_id, provider_conversation_id, status, last_message_at
- `messages`: id, tenant_id, conversation_id, provider_message_id, direction, type, status, template_id, sent_at, delivered_at, read_at, failed_at, safe_error_code
- `message_templates`: id, tenant_id, provider_template_id, name, language, approval_status, category
- `webhook_events`: id, tenant_id, provider, external_event_id, received_at, processed_at, status, safe_error
- `import_jobs`: id, tenant_id, created_by, file_reference, status, counts_json, started_at, completed_at
- `import_rows`: id, job_id, row_number, status, errors_json, target_entity_id
- `export_jobs`: id, tenant_id, created_by, filters_json, fields_json, status, file_reference, expires_at
- `audit_events`: id, tenant_id, actor_user_id, action, entity_type, entity_id, occurred_at, request_id, safe_metadata
- `notifications`: id, tenant_id, user_id, type, status, scheduled_at, delivered_at, safe_error
- `tenant_settings`: tenant_id, setting_key, setting_value, updated_by, updated_at

## Required data design notes
- All tenant-owned records carry `tenant_id` directly or are joined through a tenant-scoped parent; enforce this consistently.
- Use foreign keys and indexes for tenant_id + common filters/sorts.
- Decide soft delete vs archive and retention before implementation.
- Store money as integer minor units plus ISO currency, not floating point.
- Keep raw and normalized phone values if needed; define E.164 normalization behavior.
- Define duplicate keys and whether email/phone uniqueness is tenant-scoped, not global.
- Store secrets only as a secret-manager reference; never in normal JSON returned to clients.
- Avoid storing unnecessary WhatsApp message body content; define retention/access requirements.
- Add migration strategy and seed sample/demo data separately from production data.
