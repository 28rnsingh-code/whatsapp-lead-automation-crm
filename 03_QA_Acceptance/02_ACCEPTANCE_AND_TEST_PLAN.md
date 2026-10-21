# Acceptance Criteria & QA Test Plan

## Definition of Ready (design)
- Every requirement has a screen/component reference and owner.
- Every field has label, type, required rule (or explicit “TBD”), validation, default, helper/error copy and persistence behavior.
- Every dropdown has exact options, stored values, default, search/clear/multi-select behavior, disabled/error behavior and permission rule.
- Every page includes relevant loading, empty, no-results, validation, API failure, success and permission-denied states.
- Desktop/tablet/mobile and light/dark variants are specified.
- Clickable prototype covers primary journeys and recovery/error paths.
- Open business rules are documented and approved or explicitly deferred.

## Definition of Done (implementation)
- UI behavior matches approved Figma specification.
- API contract and data model reviewed; migrations and rollback strategy documented.
- Server-side validation, tenant isolation and permissions enforced.
- Loading/error/empty/success states use real API outcomes.
- Keyboard, focus, screen reader, contrast, zoom/reflow and reduced motion reviewed.
- Unit/integration/E2E tests pass; no P0/P1 blockers.
- Audit events and integration failure handling verified.
- No secrets or sensitive payloads leaked into client/logs.
- Evidence (screenshots/video/test report) linked to requirement IDs.

## Test matrix
- Viewports: 1440×900, 1024×768, 390×844, plus intermediate/resized windows.
- Themes: light and dark.
- Roles: Admin, Sales Manager, Sales Executive, Read-only, unauthorized/no membership.
- Data: empty tenant, one record, typical data, large list, duplicates, malformed values, partial integration failure.
- Network: normal, slow, offline, timeout, 4xx, 5xx, retry.
- Accessibility: keyboard-only, focus visible, screen reader labels, contrast, zoom/reflow, reduced motion.
- Security: cross-tenant ID guessing, unauthorized export, role escalation, reset-token replay, webhook signature failure, CSV formula injection.

## Core E2E journeys
1. New workspace → onboarding → add first lead → dashboard non-empty.
2. Website lead received → duplicate policy → assign owner → timeline event.
3. Lead search/filter → edit → stage transition → Won/Lost with approved required fields.
4. Create follow-up → reminder job → reschedule → complete → audit history.
5. CSV upload → mapping → row validation → duplicate choice → import → error report.
6. Export filtered leads → permission check → file generation → authorized download.
7. Connect integration → test success → simulate expired credentials → reconnect.
8. WhatsApp inbound event → match/link lead → show message status → opt-out blocks prohibited outbound action.
9. Invite team member → accept invite → role restrictions enforced in API.
10. Attempt cross-tenant access → denied with no data leakage.
11. Dashboard date range change → all widgets reconcile → drill-down matches chart.
12. Password reset request → neutral confirmation → valid reset → expired/reused token denied.

## Release severity
- P0 blocker: data leak/cross-tenant access, auth bypass, loss/corruption of CRM records, unsafe/unsupported messaging, inaccessible critical flow, core lead lifecycle broken.
- P1 major: critical workflow incomplete, filters/report totals wrong, import/export unusable, permission mismatch, important state missing.
- P2 moderate: non-critical visual inconsistency or secondary interaction issue.
- P3 minor: cosmetic issue with no material usability impact.
