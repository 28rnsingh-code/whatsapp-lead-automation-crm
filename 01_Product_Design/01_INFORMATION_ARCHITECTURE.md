# Information Architecture & Core Journeys

## Primary navigation
1. Dashboard
2. Lead Inbox
3. Sales Pipeline
4. Follow-ups
5. Contacts & Companies
6. Reports & Analytics
7. WhatsApp Inbox (conversation context linked to leads)
8. Integrations
9. Import / Export
10. Team & Permissions
11. Settings
12. Audit Log
13. Help / Support (product decision required)
14. Workspace switcher / workspace management (tenant and membership rules required)

## Account access
- Sign in
- Forgot password
- Reset password from a single-use expiring token
- Recovery-link sent confirmation
- Expired/invalid token state
- Password policy / validation errors
- Session expired / re-authentication
- Optional SSO/social login only if approved and implemented
- Account invitation acceptance and first-time setup
- Account creation only if self-serve signup is approved

## Primary journeys
### A. Lead capture to outcome
Website form / manual entry / CSV import / approved WhatsApp entry → deduplicate and validate → create lead → assign owner → contact/qualify → pipeline stage transitions → follow-up tasks → won/lost outcome with reason → activity/audit records → reporting attribution.

### B. Lead management
Search → filter → sort → paginate → select one/many → permitted bulk action → review success/failure result → open lead detail → edit or add activity → review timeline.

### C. Follow-up
Create task → assign owner → set due date/time and timezone → reminder → complete/reschedule/cancel → overdue behavior → task history and audit.

### D. CSV import
Upload → file checks → map source columns → preview normalized data → row-level validation → duplicate strategy → import confirmation → async progress → summary with created/updated/skipped/failed rows → downloadable error report.

### E. Integration setup
Choose integration → prerequisites and permission check → connect securely → status and last successful sync → test connection → show actionable errors → reconnect/disconnect with confirmation → audit event.

### F. Workspace administration
Invite member → assign role/permissions → invitation status → role change/deactivation → confirm high-impact actions → audit trail.

## Navigation behavior
- Desktop: collapsible left navigation; preserve selected route and workspace.
- Tablet: compact/collapsible navigation; avoid horizontal page overflow.
- Mobile: drawer or bottom navigation for top tasks; secondary/admin pages remain reachable through an accessible menu.
- Global search: define searchable entities, permission-filter results, keyboard shortcut, no-results state, and result navigation.
