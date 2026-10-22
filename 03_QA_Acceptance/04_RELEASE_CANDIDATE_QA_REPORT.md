# Release Candidate QA Report — OneClick Automics CRM

**Assessment date:** 23 October 2026  
**Candidate branch:** `qa/remediation-2026-10-22`  
**Candidate commit assessed:** `261338615dd9dce3f914659a797aae9aca5c7c04`  
**Automated CI evidence:** [GitHub Actions run 39836565736](https://github.com/rnsingh28rs-arch/oneclick-autonix-crm/actions/runs/39836565736)  
**Decision:** **CI PASS; production release remains NO-GO until environment, provider and client acceptance gates pass.**

## 1. Latest verified automated evidence

GitHub Actions run 39836565736 completed successfully on commit `261338615dd9dce3f914659a797aae9aca5c7c04`.

- Dependency installation from the lockfile: PASS.
- Server and client build: PASS.
- Source quality checks: PASS.
- Migrations against an isolated temporary PostgreSQL 16 database: PASS.
- Synthetic test fixtures seeded into that isolated database: PASS.
- Automated tests: **11 test files passed; 100 tests passed**.
- Test database persistence and tenant-isolation suite executed against the isolated PostgreSQL service.

This is meaningful code-level evidence, but it is not proof of a deployed production environment or live external provider accounts.

## 2. Remediation included in this candidate

- Database-backed authentication now uses the resolved database configuration so the dedicated `TEST_DATABASE_URL` works without requiring an unrelated `DATABASE_URL` variable.
- Isolated PostgreSQL test fixtures now exercise a user with membership in two workspaces and a separate user who lacks membership in the requested workspace.
- Billing tests now assert the intended fail-closed behavior: paid-plan changes return `BILLING_PROVIDER_NOT_CONFIGURED` until a real payment provider is configured. A mock must not activate a paid plan in a live workspace.
- WhatsApp integration tests now use the configured test phone-number ID and a persisted consented lead.
- Twilio is no longer advertised as a supported provider until a real Twilio adapter exists. Unknown/unsupported providers no longer silently fall back to a mock adapter.
- Mock WhatsApp delivery and synthetic provider-token success paths are restricted to test/development behavior and are not intended to simulate real production delivery.

## 3. Deployment architecture and access status

The repository deployment guide specifies the following architecture:

- **Frontend:** Vercel static Vite site.
- **API:** Render web service from `render.yaml`.
- **Database:** a separate Supabase PostgreSQL project dedicated to this CRM.
- **Domain registrar:** the browser context available during planning showed a BigRock account with `qualitypaan.com`. No DNS record or subdomain change has been made or verified.

Current account discovery did not find a Vercel project matching “oneclick” in either checked connected Vercel account. The checked Supabase organization currently shows Bring My Bite projects only; **do not reuse a Bring My Bite database for client CRM data**. A dedicated client-owned Supabase project and Render API service still need to be provisioned and configured.

The proposed preview hostname can be `crm.qualitypaan.com` if the project owner confirms that this domain is intended for this CRM. It is not live yet. DNS must only be changed after the frontend deployment target exists and the registrar write workflow is available.

## 4. Outstanding release gates

| Gate | Current status | Required evidence |
|---|---|---|
| Vercel frontend | Not deployed/verified | Preview URL, correct build, browser console and critical route smoke tests |
| Render API | Not deployed/verified | HTTPS URL, health endpoint, runtime logs, CORS and environment verification |
| Dedicated Supabase database | Not provisioned/verified | Client-owned project, migration logs, seed verification, backup/recovery plan |
| Production login | Not issued | Named admin account, secure password rotation and login/session/logout tests |
| Password recovery email | **Not implemented per deployment guide** | Implement the delivery flow, configure a real sender and test expiry/single-use behavior before claiming it works |
| Team invitations | Email delivery not configured | Verify invitation creation/expiry and securely share links until delivery is implemented |
| WhatsApp | Not live-verified | Choose provider, connect authorized business account/number, verify webhook, consent/opt-out, template/window and real delivery status |
| AI provider | Not live-verified | Choose provider, configure secret, test response/error handling and limits |
| Billing | Paid plan change intentionally disabled without provider | Keep disabled unless a real provider is selected, implemented and tested |
| Domain / HTTPS | Not configured | Authorized subdomain, correct DNS records, certificate and HTTPS smoke test |
| Security and roles | Automated tests pass; live acceptance pending | Admin/executive negative tests, two-workspace isolation, revocation and audit evidence |
| Responsive/browser QA | Not verified against deployment | Desktop, tablet and mobile acceptance; keyboard/focus/error states |
| Client sign-off | Pending | Written acceptance against the approved scope and recorded exceptions |

## 5. WhatsApp onboarding requirement

The product goal is a low-friction setup where the business user enters a number and is guided through connection. The implementation must not imply that a number alone authorizes messaging. The selected provider may require account linking, number verification, business permissions, approved templates or other provider-side steps.

The CRM should show a setup checklist and only enable outbound messaging after live configuration and validation. Messages must be blocked when consent cannot be verified, the recipient opted out, the 24-hour service window has expired without an approved template, or provider status is not connected.

## 6. Credentials and secrets

- No production login ID/password has been issued or verified.
- CI bootstrap credentials are synthetic test-only values and must never be reused in production.
- Never put database URLs, passwords, JWT/session secrets, encryption keys, email keys, WhatsApp tokens or webhook secrets in this report, source control, screenshots or chat.
- Use the client's approved secret manager/deployment environment settings and issue individual accounts.

## 7. Release disposition

- **Automated CI on candidate commit 261338615dd9dce3f914659a797aae9aca5c7c04:** PASS — 11 files / 100 tests.
- **Production environment and public URLs:** NOT VERIFIED.
- **Dedicated client-owned Supabase project:** NOT VERIFIED.
- **Live WhatsApp/email/AI/payment integrations:** NOT VERIFIED; paid billing remains intentionally disabled.
- **Domain/DNS/HTTPS:** NOT CONFIGURED.
- **Manual browser and client acceptance:** PENDING.
- **Production decision:** **NO-GO until all applicable P0/P1 gates pass and the client accepts the deployed candidate.**

## 8. Required release sequence

1. Keep all work on the QA branch until the candidate is approved.
2. Provision a dedicated client-owned Supabase project; verify the target before running migrations and seed.
3. Deploy the API on the documented Render architecture and frontend on Vercel using private environment settings.
4. Verify authentication, workspace membership, lead CRUD/persistence, imports/exports, permissions, audit events and error behavior.
5. Implement and test password recovery email delivery; configure invitation delivery or document a secure temporary procedure.
6. Connect the chosen WhatsApp provider and test only with opted-in recipients and approved templates.
7. Add the authorized subdomain after the deployment target is known; verify DNS and HTTPS.
8. Run full CI on the exact release candidate, capture desktop/mobile evidence, and obtain written client acceptance.
9. Promote to production only after approval. No merge to `main` or production deployment is authorized by this report alone.
