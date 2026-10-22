# OneClick Autonix CRM — Free deployment checklist

This repository contains deployment configuration, not proof of a live deployment. Keep all services on free tiers; do not upgrade or add a paid resource.

## Architecture

- **Frontend:** Vercel static Vite site using root-level `vercel.json`; build command `npm run build:client`, output `client/dist`.
- **API:** Render web service defined in `render.yaml`, explicitly set to the free plan.
- **Database:** A separate Supabase project on the Free plan. Existing projects are not to be paused or deleted to make room.

The API and frontend are separate services. The app is not considered live until both are deployed, the database migrations and bootstrap are applied, and smoke tests pass.

## API service setup

1. In Render, create a Blueprint from this repository and review that `oneclick-autonix-crm-api` remains on the **Free** plan. Do not approve an upgrade or paid resources.
2. Set `DATABASE_URL` to the new CRM Supabase project's Postgres connection string (use the connection method shown in that project's dashboard; keep it private). Supabase names its database `postgres`; the migration preflight allows that name only when the hostname is an explicit Supabase direct/pooler endpoint, and continues to block local/default postgres targets.
3. Set `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_PASSWORD` (unique, at least 12 characters), and optionally `BOOTSTRAP_ADMIN_NAME`.
4. Set `ENCRYPTION_KEY` to a randomly generated 32-character key or 64-character hex key. Never use a sample key or publish it.
5. In the Render service shell, run `npm run migrate` and then `npm run seed` against the intended CRM database. Do this only once the separate Free Supabase project exists and `DATABASE_URL` has been checked. Confirm both commands succeed before treating the backend as configured.
6. Set `CORS_ORIGINS` and `FRONTEND_URL` to the exact deployed frontend origin (scheme + hostname, no path), for example `https://YOUR-APP.vercel.app`. Set `PUBLIC_API_BASE_URL` to the public Render API origin (for example `https://YOUR-API.onrender.com`, without `/api`) so webhook and invitation URLs use HTTPS.

The seed operation is idempotent. It creates a separate `oneclick-autonix-crm` workspace and default pipeline stages. It will not overwrite an existing non-null password.

## Frontend setup

1. In Vercel, import the repository and leave **Root Directory** at the repository root (`.`) so the root monorepo lockfile and `vercel.json` are used.
2. Vercel uses `npm ci --no-audit --fund=false`, `npm run build:client`, and output directory `client/dist` from `vercel.json`.
3. Set `VITE_API_BASE_URL` in Production to the deployed API base URL ending in `/api`, for example `https://YOUR-API.onrender.com/api`. Replace the placeholder with the actual Render URL.
4. After both URLs are correct, redeploy API and frontend on the free plans only. No paid upgrade is part of this process.

## Local development

```bash
npm ci --no-audit --fund=false
cp .env.example .env
# Set DATABASE_URL, JWT_SECRET, ENCRYPTION_KEY and bootstrap admin variables before database-backed use
npm run build
npm test
npm run dev:all
```

To initialize a local database, run `npm run migrate`, set `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_PASSWORD` and optionally `BOOTSTRAP_ADMIN_NAME` in private `.env`, then run `npm run seed`.

## Security and release gates

- Never commit `.env`, database URLs, JWT secrets, encryption keys, provider tokens, or customer data.
- Keep the backend `DATABASE_URL` private. Migration 003 enables RLS and revokes table access from Supabase `anon`/`authenticated` roles; do not add public RLS policies to customer tables unless a deliberate, tenant-scoped direct-client architecture is designed and tested.
- Production login and workspace lookup use database records; the in-memory demonstration identities are not used in production.
- Password recovery emails are not implemented yet. The app must not claim a reset email was dispatched.
- Live Meta WhatsApp, Gupshup, AI providers, payment gateway, and webhook behavior require credentials and provider-side configuration. Mock adapters are not proof of a live integration.
- Run the GitHub Actions build/test check, verify migrations and seeding against the new CRM database, verify login and core CRUD in the deployed app, then test WhatsApp/AI integrations only after keys and consent/template prerequisites are configured.
- Do not mark the application fully functional until these acceptance checks pass.

## Team invitations and audit

The Team screen creates a seven-day, single-use invitation link. Email delivery is not configured; copy the link and share it privately. Successful authenticated write operations are recorded in `audit_events`; only workspace administrators can read and export the workspace audit trail.
