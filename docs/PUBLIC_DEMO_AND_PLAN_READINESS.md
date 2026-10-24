# Public Demo, Usage Limits, Plans and Integration Readiness

Updated: 24 October 2026

## Public demo behavior

- Sign-in username: `demo`; password: `demo123` (intentionally public credentials).
- The demo uses its own PostgreSQL tenant (`public-demo`), user and `Read-only` role. Do not put customer data in this tenant.
- Demo access tokens expire after two hours.
- Five write-action attempts are enforced atomically on the server and tied to a persistent browser-generated UUID retained in local storage. The browser sees the count through `GET /api/demo/usage`.
- Allowed demo writes are create lead, create task, create contact, update a lead/task and a simulated WhatsApp message. Other mutation paths are blocked; module navigation is also restricted.
- Demo outbound WhatsApp and email actions are explicitly simulated. They do not call Meta, Brevo or another provider and never contact the entered recipient/phone.
- The client instructs visitors not to use production customer data. Demo quota is a product guard, not an anti-fraud guarantee: a visitor who clears site storage or uses another browser can create a new visitor identity. Add edge/WAF/IP-based abuse protection before a high-traffic public launch.
- Demo messages/usage require the database and migrations. Failures are returned as errors; the quota is not silently bypassed.

## Environment

Required for a production deployment:
- `DATABASE_URL`: actual remote PostgreSQL connection string.
- `JWT_SECRET`: strong secret of at least 32 characters.
- `PUBLIC_DEMO_ENABLED`: set `false` to disable public demo login.
- `PUBLIC_DEMO_PASSWORD`: optional override for the public password. Because a shared demo password is disclosed in the site UI, this is not a secret and does not protect admin functions.

The public demo account is created/updated by `server/src/db/seed.ts`. The DB migrations `003_demo_usage_sessions.sql` through `007_monthly_usage_backfill.sql` must run before demo quotas, plan usage and billing idempotency are fully available. Never copy demo credentials into the admin or customer account.

## Current monthly tiers in code

These are the values currently defined in `server/src/services/billing/types.ts`; seat caps are also enforced by the tenant-scoped team API. They are not a payment checkout confirmation.

| Plan | Current price/month | Team seats | Active leads | WhatsApp messages/month | Emails/month | Imports/month |
|---|---:|---:|---:|---:|---:|
| Starter | ₹2,999 | 2 | 1,000 | 500 | 300 | 10 |
| Growth | ₹7,999 | 5 | 10,000 | 5,000 | 3,000 | 100 |
| Enterprise | ₹19,999 | 10 | 100,000 | 50,000 | 10,000 | 1,000 |

Current subscription controls update CRM entitlements in sandbox/mock mode only. They do not collect payment. Stripe webhooks now require signature verification and are idempotent, but a real checkout/session creator, provider account, live event mapping and signed staging verification are not configured. Razorpay is not implemented. Invoice/tax handling, renewal/cancellation and delinquency suspension must be configured and tested before selling subscriptions. Email sends have explicit paid-plan allowances: Starter 300, Growth 3,000 and Enterprise 10,000 emails/month. This is not a free customer CRM plan; the public demo is limited to five simulated write/test actions. Live email uses Brevo only when a verified sender and server-side API key are configured. Sends are blocked at the quota; automatic overage billing is not implemented.


Historical AI token usage cannot be reconstructed because prior AI calls did not persist provider token counts. The `ai_tokens_count` counter begins from the first metered request after this release; do not treat its initial value as historical lifetime usage.

## Billing webhooks

- Stripe webhook delivery requires the server-side `STRIPE_WEBHOOK_SECRET`, validates the signed raw request body and a five-minute signature timestamp tolerance, and records provider event IDs to block duplicate replay.
- Mock billing webhooks are test-only; Razorpay is not implemented and must not be connected.
- Real payment checkout is still absent, so signed Stripe webhook processing does not mean subscriptions can be sold yet.

## Email

Controlled test-email sending is wired through the server-side Brevo API, with per-plan quotas, persistent attempt records, idempotency and demo-only simulation. This change does not configure a provider key or verified sender. Forgot-password still does not send reset links; a one-time expiring reset-token workflow and verified sender must be completed before advertising self-service account recovery. Provider free tiers are not customer plan tiers.

## Deployment release gate

Before production:
1. Merge/rebase this feature only after its base hardening PR is accepted and the full CI run passes.
2. Apply migrations to the verified target database only after backup/rollback review.
3. Configure and verify remote DB, JWT secret, frontend API URL, allowed origins and public demo toggle.
4. Change the bootstrap admin password; no default admin credential may remain in production.
5. Configure real Meta credentials and webhook verification; perform an opt-in test delivery with a controlled recipient.
6. Configure `STRIPE_WEBHOOK_SECRET` only if Stripe is selected; mock billing webhooks are test-only and Razorpay remains unsupported. Verify real signed Stripe test events before enabling any production webhook.
7. Configure Brevo server-side credentials and a verified sender; verify email acceptance and provider logs. Member-invitation and password-recovery emails remain separate release gates. Confirm platform-level plan-change authorization before live checkout.
8. Test end-to-end browser journeys and tenant isolation in a deployed preview. A successful build alone is not a production sign-off.
