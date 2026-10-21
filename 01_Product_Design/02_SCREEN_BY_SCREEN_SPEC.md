# Screen-by-Screen UI/UX Specification

For every screen, the designer must deliver: default state, loading, empty, no-results, validation error, API error, success, disabled, permission-denied, destructive confirmation where applicable, keyboard/focus behavior, responsive variants, and realistic labeled sample data.

## 01. Login & Account Recovery
**Required screens/states**
- Sign in: email, password, show/hide password, remember-me policy if approved, submit/loading, invalid credentials, locked/rate-limited state, network/server failure.
- Forgot password: email input, submit, neutral confirmation that avoids account enumeration.
- Reset password: new password, confirm password, show/hide, policy hints, mismatch, expired/used token, success.
- Invite acceptance / first login: invite status, workspace identity, set password if required.
- Optional social login: show only if provider and backend flow are actually supported.
**Design checks:** labels remain visible; errors are associated with fields; password manager/autofill support; focus order; no password/token in logs or URLs beyond the reset token flow requirements.

## 02. Onboarding & Empty Dashboard
**Required**
- First login, no leads, no contacts, no tasks, no integrations connected, no team members beyond owner.
- Progress checklist with steps: workspace profile; invite team (optional); connect website capture; connect WhatsApp (optional); add/import first leads; schedule first follow-up.
- Each step has status, CTA, skip/optional label, help link, and return-later behavior.
- Empty dashboard explains what data will appear and avoids misleading zero-value charts.
- Separate empty states for each widget/module; no leads, no pipeline items, no activity, no follow-ups, no reports, no WhatsApp conversations.
- Loading skeleton and first-load failure/retry.
**Business rule open question:** which onboarding steps block access, which are skippable, and whether setup completion is per user or per workspace.

## 03. Main Dashboard
**KPI cards:** new leads, qualified leads, deals won/lost, average first-response time, source-to-sale conversion. Define exact formulas, date windows, comparison period and role scope.
**Widgets:** leads trend; pipeline stage overview; lead source; recent leads; upcoming/overdue follow-ups; recent activity; deal value trend/forecast if approved; team performance; WhatsApp integration status and recent message context.
**Interactions:** date range filters; consistent filters across widgets; click-through to filtered records; accessible chart summaries; export if authorized.
**States:** no data; partial data; loading; one widget failed; whole dashboard API failure; stale data indication if needed.
**Design checks:** avoid contradictory totals/percentages; currency formatted in INR by default if workspace setting says INR; label sample data in prototype.

## 04. Lead Inbox
**Table fields (configurable):** select, lead name, company, phone, email, source, stage, qualification, owner, deal value, next follow-up, last activity, consent/opt-out indicator, created date, actions.
**Controls:** global/module search, source/stage/owner/qualification/date filters, advanced filters, sorting, pagination/page size, column visibility if approved, saved views if approved, row actions, bulk assign/change stage/export/delete subject to permission.
**States:** empty workspace, no search results, no filter results, loading skeleton, API failure/retry, partial bulk action failure, permission denied.
**Mobile:** switch to compact cards; expose essential data and row actions without requiring horizontal scrolling.

## 05. Add/Edit Lead
**Fields**
- Name (exact required rule to be approved)
- Phone with country code; validate normalized format
- Email
- Company
- Lead source
- Creation timestamp (system-controlled; display read-only unless approved)
- Assigned owner
- Pipeline stage
- Qualification status
- Deal value and currency
- Next action
- Follow-up date/time and timezone
- Consent status / opt-out
- Notes
- Tags (if approved)
**Behavior:** field-level validation; preserve entered values on server failure; duplicate detection by configurable match rules; duplicate warning with view-existing/merge/create-anyway only where policy allows; unsaved-changes guard; save/cancel; save-and-create-another if approved; success/error feedback.
**Important:** do not silently enable WhatsApp messaging for a lead who opted out or lacks required permission/consent.

## 06. Lead Details & Activity Timeline
**Header:** name, company, stage, owner, qualification, deal value, edit, assign, more actions.
**Sections/tabs:** Activity, Details, Tasks, Deals, WhatsApp, Emails only if supported.
**Timeline events:** lead created/updated, assignment, stage changes, notes, follow-up created/completed/rescheduled, import, website submission, inbound/outbound message status, won/lost, consent/opt-out changes.
**States:** no history, failed timeline load, partial integration event unavailable, restricted field/permission.
**Actions:** log activity; add note; create task; change stage; view linked conversation; confirm destructive operations.

## 07. Sales Pipeline
- Configurable columns/stages and order; stage colors/icons must not be the only status cue.
- Card shows lead, company, value, owner, next follow-up, age in stage, last activity.
- Drag/drop plus accessible alternative action menu for keyboard/touch.
- Confirm or explain transition constraints; record stage-change history.
- Won/Lost capture required fields/reason according to approved rules.
- Filters by owner, date, value, source and stage; count/value summaries must reconcile.
- Loading, empty, no-results, error and permission states.
- Mobile: stage selector/list view instead of narrow multi-column board.

## 08. Follow-ups & Reminders
- Views: Today, Upcoming, Overdue, Completed; filters by owner/type/status/date.
- Task form: title/type, linked lead/contact, owner, due date/time, timezone, reminder channel, notes, priority, status.
- Actions: complete, reschedule, cancel; show confirmation where data is discarded.
- Define reminder delivery channels and retry behavior; never imply a reminder was sent until backend confirms it.
- Empty, loading, error, overdue, completed and permission states.

## 09. Contacts & Companies
- Separate Contacts and Companies views, search, filters, sorting, pagination.
- Contact fields and company fields require product-owner approval; support linked leads and relationship context.
- Duplicate detection, merge policy, import/export permissions, empty/error states.
- Show lead/contact/company relationships without creating ambiguous duplicate records.

## 10. Reports & Analytics
- Lead source, stage conversion, response time, team performance, won/lost and revenue/deal-value reports.
- Date range, timezone, attribution model, owner/team scope and currency rules.
- Chart/table alternate view; accessible textual summary; drill-down to underlying records.
- Empty data, insufficient permissions, partial failures, export states.
- All report formulas must be documented and approved before build; do not invent conversion formulas.

## 11. CSV Import / Export
**Import steps:** upload, map columns, validate, duplicates, confirmation, progress, results.
- File type/size/encoding limits, required column checks, sample preview, date/phone/currency normalization.
- Row-level errors with line numbers and downloadable error report.
- Duplicate strategy: skip/update/merge/create-new only as approved; show impact counts before confirm.
- Async progress, cancel behavior, retry/idempotency, partial failure summary.
**Export:** current filtered vs selected vs all permitted records; field selection if approved; format; PII warning if needed; progress/success/failure. Do not claim a file is ready before it is generated.

## 12. WhatsApp Inbox & Integration
- Connection status: not connected, connecting, connected, degraded, expired credentials, disconnected, reconnecting, failed.
- Business account/number identity, permission/scopes status, last connection/test time, webhook status if relevant.
- Conversation list and message context linked to lead; message timestamps, delivery/read/failure state when available.
- Template management and approval status only if supported by configured provider/API.
- Respect approved WhatsApp Business Platform/API capabilities, opt-in/opt-out, templates and applicable messaging windows/policies.
- Error codes translated into actionable messages; retry/reconnect only when safe.
- No unsupported “unlimited automation”, personal WhatsApp scraping, or unofficial sending features.

## 13. Website Integration
- Setup instructions, form/source identifier, field mapping, required fields, consent capture, secure endpoint/key handling.
- Test submission, connected/last event status, error logs and reconnect/rotate credentials flow.
- Never display full secret keys after creation; redact secrets.
- Duplicate policy, spam/rate-limit behavior, webhook retries and lead attribution must be specified.

## 14. Team & Permissions
- Members: name/email, role, invitation status, active/suspended status, last active if available.
- Invite, resend invitation, change role, deactivate/reactivate, remove member with confirmation.
- Permission matrix by module and action (view/create/edit/delete/export/manage integration/manage users).
- Server is source of truth; UI hiding controls is not authorization.
- Handle last-admin protection and pending invite expiry as approved rules.

## 15. Settings & Pipeline Configuration
- Workspace name/profile, timezone, currency, date format, locale, theme preference.
- Pipeline stage create/edit/reorder/archive; stage deletion with leads attached requires migration/reassignment policy.
- Lead source and qualification option configuration if approved.
- Notification/reminder settings and retention/export settings only when defined.
- Save/cancel, unsaved changes, validation, success and API error states.

## 16. Audit Log
- Timestamp, actor, action, target entity, result, metadata summary, source/IP only if policy-approved.
- Search/filter by date, actor, action, entity, result.
- Pagination and export permission.
- Immutable server-generated events; do not allow ordinary users to edit/delete audit records.
- Define retention and access policy with product/security owner.

## 17. Cross-cutting system states
- Loading skeletons, empty state, no search results, validation errors, API/network failure, retry, permission denied, session expired, success toast/page, destructive confirmation, unsaved changes, disabled controls, offline/timeout if supported, partial success.
- Each state needs title, explanation, action, focus behavior, and screen-reader announcement where appropriate.
