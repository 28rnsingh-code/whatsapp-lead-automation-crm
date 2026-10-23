# Public Demo, Usage Limits, Plans and Integration Readiness

Updated: 23 October 2026

## Public demo behavior

- Sign-in username: `demo`; password: `demo123` (intentionally public credentials).
- The demo uses its own PostgreSQL tenant (`public-demo`), user and `Read-only` role. Do not put customer data in this tenant.
- Demo access tokens expire after two hours.
- Five write-action attempts are enforced atomically on the server and tied to a persistent browser-generated UUID retained in local storage. The browser sees the count through `GET /api/demo/usage`.
- Allowed demo writes are create lead, create task, create contact, update a lead/task and a simulated WhatsApp message. Other mutation paths are blocked; module navigation is also restricted.
- Demo outbound WhatsApp writes a record marked `simulated`; it does not call Meta or another provider. Demo template names are sample fixtures, not live WhatsApp templates.
- The client instructs visitors not to use production customer data. Demo quota is a product guard, not an anti-fraud guarantee: a visitor who clears site storage or uses another browser can create a new visitor identity. Add edge/WAF/IP-based abuse protection before a high-traffic public launch.
- Demo messages/usage require the database and migrations. Failures are returned as errors; the quota is not silently bypassed.

## Environment

Required for a production deployment:
- `DATABASE_URL`: actual remote PostgreSQL connection string.
- `JWT_SECRET`: strong secret of at least 32 characters.
- `PUBLIC_DEMO_ENABLED`: set `false` to disable public demo login.
- `PUBLIC_DEMO_PASSWORD`: optional override for the public password. Because a shared demo password is disclosed in the site UI, this is not a secret and does not protect admin functions.

The public demo account is created/updated by `server/src/db/seed.ts`. The DB migration `003_demo_usage_sessions.sql` must run before the demo can track usage. Never copy demo credentials into the admin or customer account.

## Current monthly tiers in code

These are the values currently defined in `server/src/services/billing/types.ts`; seat caps are also enforced by the tenant-scoped team API. They are not a payment checkout confirmation.

| Plan | Current price/month | Current lead limit | Current WhatsApp message quota | Current imports/month |
|---|---:|---:|---:|---:|
| Starter | ₹2,999 | 2 | 1,000 | 500 | 10 |
| Growth | ₹7,999 | 5 | 10,000 | 5,000 | 100 |
| Enterprise | ₹19,999 | 10 | 100,000 | 50,000 | 1,000 |

Current subscription controls update CRM entitlements in sandbox/mock mode only. They do not collect payment. Live checkout, verified payment webhooks, invoice/tax handling, renewal/cancellation and delinquency suspension must be configured and tested before selling subscriptions. An email allowance/rate is not part of the current plan schema. Do not advertise a free customer email allowance: demo sends are simulated, and real email sends should remain disabled until the business defines included volume/overage charging and configures a verified provider. The free tiers from email providers are development/operational constraints, not a customer-facing product plan.

## Email

There is currently no verified transactional-email sender integrated into the password-recovery flow. The API intentionally returns a generic confirmation and does not send an email. Do not show a “reset link sent” success message until a real token is generated, persisted safely, sent through a verified provider, expired, consumed once and tested. No email API key is set by this change. Choose a provider and configure sender/domain authentication and secret storage before enabling email delivery. Provider free tiers must not be advertised as the customer plan; set the product's included email quota and overage policy as paid-plan terms.

## Deployment release gate

Before production:
1. Merge/rebase this feature only after its base hardening PR is accepted and the full CI run passes.
2. Apply migrations to the verified target database only after backup/rollback review.
3. Configure and verify remote DB, JWT secret, frontend API URL, allowed origins and public demo toggle.
4. Change the bootstrap admin password; no default admin credential may remain in production.
5. Configure real Meta credentials and webhook verification; perform an opt-in test delivery with a controlled recipient.
6. Add/verify real team invitation, password reset email, seat enforcement and plan change permissions.
7. Test end-to-end browser journeys and tenant isolation in a deployed preview. A successful build alone is not a production sign-off.
