# API Contract Outline

Final paths and schemas must be published in OpenAPI before frontend integration. Use consistent pagination, validation errors, authorization errors and request IDs.

## Standard response/error contract
- Success: resource or `{ data, meta }`.
- Validation: HTTP 400/422 with field-keyed errors and stable error codes.
- Unauthenticated: 401.
- Forbidden: 403 (avoid leaking cross-tenant object existence where policy requires).
- Not found: 404.
- Conflict/duplicate: 409 with safe conflict details.
- Rate limit: 429 with retry guidance.
- Server: 5xx with request ID; no stack traces/secrets to client.
- List endpoints: cursor or page pagination, page-size cap, stable sorting.

## Endpoint groups (proposed)
### Auth
- `POST /auth/login`
- `POST /auth/logout`
- `POST /auth/forgot-password`
- `POST /auth/reset-password`
- `POST /auth/accept-invite`
- `GET /auth/session`

### Workspace / members / permissions
- `GET /workspaces`
- `GET /workspaces/{id}`
- `PATCH /workspaces/{id}`
- `GET /workspaces/{id}/members`
- `POST /workspaces/{id}/invitations`
- `POST /invitations/{token}/resend`
- `PATCH /workspaces/{id}/members/{memberId}`
- `DELETE /workspaces/{id}/members/{memberId}` (policy-controlled)
- `GET /permissions/me`

### Leads / pipeline / activity
- `GET /leads` (q, filters, sort, pagination)
- `POST /leads`
- `GET /leads/{id}`
- `PATCH /leads/{id}`
- `POST /leads/{id}/assign`
- `POST /leads/{id}/stage-transitions`
- `POST /leads/{id}/activities`
- `GET /leads/{id}/timeline`
- `POST /leads/bulk-actions`
- `GET /pipeline/stages`
- `POST /pipeline/stages`
- `PATCH /pipeline/stages/{id}`
- `POST /pipeline/stages/reorder`

### Contacts / companies / tasks
- CRUD endpoints for contacts and companies with tenant-scoped search/filter/pagination.
- `GET/POST/PATCH /tasks`, `POST /tasks/{id}/complete`, `POST /tasks/{id}/reschedule`, `POST /tasks/{id}/cancel`.
- Define reminder delivery job status and idempotency.

### Dashboard / reports
- `GET /dashboard/summary?from=&to=&timezone=`
- `GET /dashboard/trends`
- `GET /reports/source-conversion`
- `GET /reports/pipeline-conversion`
- `GET /reports/response-time`
- `GET /reports/team-performance`
- Every report must define metric formulas, time window, attribution, permission scope and drill-down filter mapping.

### CSV
- `POST /imports` (upload/initiate)
- `POST /imports/{jobId}/mapping`
- `POST /imports/{jobId}/validate`
- `POST /imports/{jobId}/confirm`
- `GET /imports/{jobId}`
- `GET /imports/{jobId}/errors`
- `POST /exports`
- `GET /exports/{jobId}`
- `GET /exports/{jobId}/download` (authorized, expiring URL or stream)

### Integrations
- `GET /integrations`
- `POST /integrations/website/test`
- `POST /integrations/website/rotate-key`
- `POST /integrations/whatsapp/connect` (provider-specific secure flow)
- `POST /integrations/{id}/test`
- `POST /integrations/{id}/reconnect`
- `POST /integrations/{id}/disconnect`
- Provider webhook endpoints with signature verification and idempotency.

### Settings / audit / notifications
- Settings read/update endpoints with schema validation.
- `GET /audit-events` with permission-controlled filters and pagination.
- `GET /notifications`, `POST /notifications/{id}/read`.
- Audit events generated server-side for sensitive mutations.

## Contract requirements
- Document request/response schemas, permissions, rate limits, idempotency, validation and example errors.
- Use stable enums for source/stage/status or provide tenant-configured options endpoint.
- Never accept `tenant_id` from the client as authoritative; derive/verify from authenticated membership context.
