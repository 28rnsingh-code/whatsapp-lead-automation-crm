# Backend Engineering Scope & Architecture

## Responsibility boundary
Backend owns data integrity, authentication, tenant isolation, authorization, persistence, integration credentials, webhooks/jobs, audit events and API contracts. Frontend must not be treated as a security boundary.

## Recommended logical modules
1. Identity & sessions
2. Tenants/workspaces and memberships
3. Leads
4. Contacts and companies
5. Pipeline configuration and stage transitions
6. Activities and notes
7. Follow-up tasks and reminder delivery
8. Dashboard/report aggregation
9. CSV import/export jobs
10. Website capture integration
11. WhatsApp provider integration and conversation/message metadata
12. Team/roles/permissions
13. Workspace settings
14. Audit log
15. Notifications and operational health

## Non-functional requirements
- Tenant isolation enforced at every query and background job.
- Authorization checked on every API operation and object identifier.
- Server-side validation and normalized phone/email/currency/date values.
- Transactions for multi-record operations where needed.
- Idempotency for webhook and import retry paths.
- Rate limiting, abuse protection and safe error responses.
- Secrets stored in secret manager/environment, never returned to browser.
- Structured logs without passwords, reset tokens, access tokens, message content unless approved and necessary.
- Audit important changes with actor, tenant, action, target, time and safe metadata.
- Backups, retention/deletion policy, monitoring and alerting defined before production.
- Timezone-aware dates; timestamps stored consistently (normally UTC) and rendered in workspace/user timezone.
- Pagination limits and query performance budgets.
- API versioning/error contract and OpenAPI documentation.
- India-first data protection/privacy requirements reviewed by qualified legal/security owners; do not treat this spec as legal advice.

## Suggested service pattern
UI → authenticated API → tenant/permission middleware → domain service → database.
External provider webhooks → signature verification → idempotency store/queue → domain service → database/audit → UI updates.
Long-running CSV import/export and reminder delivery should use job/queue patterns, not long synchronous HTTP requests.

## Backend release gates
- Cross-tenant access tests pass.
- Unauthorized role tests pass for every protected route.
- Reset tokens expire, are single-use and cannot reveal account existence.
- Webhook signature/replay/idempotency tests pass.
- Import limits, row errors, retry and partial-success behavior pass.
- Audit events exist for security-sensitive and business-critical mutations.
- No production secrets in client bundle, source control or logs.
