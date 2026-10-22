# OneClick Autonix CRM — Free deployment checklist

This repository contains deployment configuration, not proof of a live deployment. Keep all services on free tiers; do not upgrade or add a paid resource.

## Architecture

- **Frontend:** Vercel static Vite site, rooted at `client`, build command `npm run build`, output directory `dist`.
- **API:** Render web service defined in `render.yaml`, explicitly set to the free plan.
- **Database:** A separate Supabase project on the Free plan. Existing projects are not to be paused or deleted to make room.

The API and frontend are separate services. The app is not considered live until both are deployed, the database migrations and bootstrap are applied, and smoke tests pass.

## API service setup

1. In Render, create a Blueprint from this repository and review that `oneclick-autonix-crm-api` remains on the **Free** plan. Do not approve an upgrade or paid resources.
2. Set `DATABASE_URL` to the new CRM Supabase project's Postgres connection string (use the connection method shown in that project's dashboard; keep it private). Supabase names its database `postgres`; the migration preflight allows that name only when the hostname is an explicit Supabase direct/pooler endpoint, and continues to block local/default postgres targets.
3. Set `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_PASSWORD` (unique, at least 12 characters), and optionally `BOOTSTRAP_ADMIN_NAME`.
4. Set `ENCRYPTION_KEY` to a randomly generated 32-character key or 64-character hex key. Never use a sample key or publish it.
5. Deploy the API, verify `/api/health`, and use the private environment to run database migrations, then seed the initial administrator:
   - `npm run migrate`
   - `npm run seed`
   The first deployment can be considered configured only after both commands succeed against the intended CRM database.

The seed operation is idempotent. It creates a separate `oneclick-autonix-crm` workspace and default pipeline stages. It will not overwrite an existing non-null password.

## Frontend setup

1. In Vercel, import the repository and set Root Directory to `client`.
2. Framework preset: Vite; Build Command: `npm run build`; Output Directory: `dist`.
3. Set `VITE_API_BASE_URL` in Production to the API base URL ending in `/api`, for example `https://YOUR-API.onrender.com/api`. Replace the placeholder with the actual Render URL.
4. Set the API's `CORS_ORIGINS` to the exact deployed frontend origin (scheme + hostname, no path), for example `https://YOUR-APP.vercel.app`.
5. Redeploy both services after environment variables change.

## Local development

```bash
npm ci
cp .env.example .env
# Set DATABASE_URL, JWT_SECRET, and ENCRYPTION_KEY before database-backed use
npm run build
npm test
npm run dev:all
```

To initialize a local database, run `npm run migrate`, then set `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_PASSWORD`, and optionally `BOOTSTRAP_ADMIN_NAME` in the private `.env` file and run `npm run seed`.

## Security and release gates

- Never commit `.env`, database URLs, JWT secrets, encryption keys, provider tokens, or customer data.
- Keep the backend `DATABASE_URL` private. Migration 003 enables RLS and revokes table access from Supabase `anon`/`authenticated` roles; do not add public RLS policies to customer tables unless a deliberate, tenant-scoped direct-client architecture is designed and tested.
- Production login and workspace lookup use database records; the in-memory demonstration identities are not used in production.
- Password recovery emails are not implemented yet. The app must not claim a reset email was dispatched.
- Live Meta WhatsApp, Gupshup, AI providers, payment gateway, and webhook behavior require credentials and provider-side configuration. Mock adapters are not proof of a live integration.
- Run the GitHub Actions build/test check, verify migration/seed against the new CRM database, verify login and core CRUD in the deployed app, then test WhatsApp/AI integrations only after keys and consent/template prerequisites are configured.
- Do not mark the application fully functional until these acceptance checks pass.


## Team invitations and audit
The Team screen creates a seven-day, single-use invitation link. Email delivery is not configured; copy the link and share it privately. Successful authenticated write operations are recorded in `audit_events`; only workspace administrators can read and export the workspace audit trail.
