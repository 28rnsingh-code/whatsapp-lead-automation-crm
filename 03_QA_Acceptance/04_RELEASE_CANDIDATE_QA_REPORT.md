# Release Candidate QA Report — OneClick Automics CRM

**Assessment date:** 22 October 2026  
**Candidate branch:** `qa/remediation-2026-10-22`  
**Candidate commit:** `1df43c12ad8676512aed45a3dcf63fb8af525ce3`  
**Automated CI evidence:** [GitHub Actions run 59](https://github.com/rnsingh28rs-arch/oneclick-autonix-crm/actions/runs/39829975989)  
**Decision:** **Automated checks green; external/live acceptance remains pending. Do not represent this as production sign-off yet.**

## 1. Evidence-backed status

The GitHub Actions run above completed successfully for the candidate commit. The workflow reports success for:
- Dependency installation using the lockfile.
- Server and client build.
- Repository code-quality checks.
- Automated server test suite.

The repository test suite includes tests covering API contracts, authentication hardening, core CRM workflows, database/migration safeguards, import/export, lead persistence, reporting/billing, tenant isolation, AI auto-reply, and WhatsApp integration/webhook behavior. The CI result proves these automated checks passed in the CI environment; it does not prove a real provider account or deployed production environment is configured.

## 2. Release gates still requiring environment access

These checks must be run against the intended staging/production candidate and their evidence attached before final acceptance:

| Gate | Required evidence | Pass condition |
|---|---|---|
| Frontend deployment | Exact deployed frontend URL and build/deployment status | Correct candidate loads; no runtime console errors |
| API deployment | Exact API URL and health response | Health endpoint responds successfully over HTTPS |
| Database | Migration and seed logs from the dedicated CRM database | Migrations complete; seed is idempotent; no writes to another project/database |
| Authentication | Screenshots/test record for valid and invalid login, session expiry, logout | Correct outcomes; no tenant or role bypass |
| Lead lifecycle | Create, read, update, search/filter, stage transition, reload | Data persists and remains tenant-scoped |
| Import/export | Representative CSV, malformed row, authorized export, unauthorized export | Validation is clear; scope and permissions enforced; spreadsheet formula payloads are safe |
| Team/permissions | Admin and restricted-role test accounts | API enforces the same restrictions as the UI |
| Audit | Corresponding event records for critical mutations | Actor, tenant, action, and timestamp are recorded without secrets |
| WhatsApp | Provider configuration, webhook verification, inbound/outbound test IDs | Signature/token checks pass; delivery status is real; opt-out blocks prohibited outbound messaging |
| Email/reset | Configured mail provider and test mailbox | Actual delivery, expiry, single-use behavior, and neutral account-enumeration response verified |
| Responsive/accessibility | Evidence at 1440×900, 1024×768, and 390×844; keyboard pass | No critical overflow; focus/labels/errors work; critical journeys remain usable |

## 3. Explicit integration constraints

The repository's deployment guide states that the following are not proven by CI and require real configuration and provider-side testing:
- Frontend and API deployments, their exact public URLs, and database migration/seed execution.
- Live Meta WhatsApp or Gupshup credentials, permissions, approved templates, webhook registration, and consent prerequisites.
- AI provider credentials and live response behavior.
- Email delivery configuration for password recovery; team invitations may require privately sharing the generated invitation link if outbound email is not configured.
- Any payment/billing provider flow; mock adapters must not be treated as a live payment integration.

Do not paste production secrets into this report, screenshots, issue comments, or client-visible evidence.

## 4. QA execution protocol

1. Test only against a dedicated staging tenant/database or an explicitly approved production test workspace.
2. Record the candidate commit SHA, environment URL, browser/device, role, test ID, expected result, actual result, and evidence link for every test.
3. Run positive, negative, permission-denied, empty-state, slow-network, and retry cases for each critical journey.
4. Verify tenant isolation with two separate test tenants and attempts to read or mutate the other tenant's record IDs.
5. Do not use real customer data or send unsolicited WhatsApp messages. Use opted-in test recipients and approved templates.
6. Classify failures using the repository severity policy: P0 data/security/core lifecycle blocker; P1 critical workflow or permission/reporting failure; P2 moderate usability issue; P3 cosmetic.
7. Any P0/P1 failure blocks acceptance. Fix it, rerun the affected test and full CI, and attach fresh evidence.
8. Obtain written client QA acceptance only after all applicable gates pass or the client explicitly signs off a documented exception.

## 5. Release disposition

- **Automated CI:** PASS for the linked candidate run.
- **Live deployment and environment smoke test:** NOT VERIFIED in this report.
- **Live provider integrations:** NOT VERIFIED in this report.
- **Manual cross-browser/responsive/accessibility acceptance:** NOT VERIFIED in this report.
- **Final production acceptance:** PENDING evidence for the environment-dependent gates above.

This report intentionally distinguishes automated code checks from real-world release readiness; a green build alone is not a production certification.
