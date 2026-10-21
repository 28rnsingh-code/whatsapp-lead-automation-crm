# Security, Integrations, and Metric Rules

## Identity and access
- Secure password hashing via maintained auth provider/library; MFA optional only if scoped.
- Reset tokens: cryptographically secure, short-lived, single-use, stored hashed where feasible; generic response to prevent account enumeration.
- Session rotation/revocation and sign-out behavior defined.
- Role checks at API/service layer and tenant-scoped object checks.
- Prevent IDOR and cross-tenant reads/writes; test guessed IDs.
- Rate-limit login, reset, invite, search, import and integration endpoints.
- Protect against CSRF/XSS/SQL injection/SSRF/file upload abuse as relevant to stack.
- Keep secrets in managed secret storage; redact logs.

## Website capture
- Verify incoming payloads; rate limit and spam protection; schema/size limits.
- API key/signature rotation, revocation, safe storage and last-used status.
- Idempotency/retry behavior; source attribution and consent capture.
- Avoid exposing internal CRM APIs or tenant identifiers unnecessarily.

## WhatsApp Business Platform/API
- Use approved official provider/API integration only.
- Secure OAuth/credential flow and webhook signature verification.
- Respect user opt-in/opt-out, template approval, supported message types, applicable messaging windows and provider rules.
- Persist provider message IDs and delivery status events idempotently.
- Display actual connection, delivery and error states from provider responses; never fake “connected”.
- Handle expired credentials, permission revocation, webhook outage, rate limits, template rejection and reconnect.
- Do not promise features that are not supported by the configured API/provider.

## CSV processing
- Validate MIME/type, extension, size, encoding, column count and row count.
- Protect against spreadsheet formula injection in exported values.
- Sanitize errors and avoid exposing another tenant's data in error files.
- Use async jobs for large files, progress polling, cancellation policy and retry-safe operations.
- Precompute row-level outcomes and make partial success explicit.

## Dashboard metric definitions (must be approved)
For each metric, record formula, numerator/denominator, inclusion/exclusion rules, date field, timezone, attribution window, currency, permission scope and comparison period.
- New leads
- Qualified leads
- Deals won/lost
- First response time (define inbound/outbound and business-hours treatment)
- Source-to-sale conversion (define cohort and attribution)
- Stage counts/value
- Follow-up completion/overdue
- Revenue/deal value and forecast (forecast model requires explicit approval)
- Team performance

Never mix counts from one date window with rates from another. Counts, charts, tables and drill-down filters must reconcile.
