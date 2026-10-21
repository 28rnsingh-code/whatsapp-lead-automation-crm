# Dropdown, Field & Control Inventory

This is a proposed inventory, not a declaration that every dropdown is already implemented. Product owner must approve final options and rules.

## Global
- Workspace switcher: workspaces user can access; loading, no workspace, access revoked.
- Date range: Today, Last 7 days, Last 30 days, This month, Previous month, Custom. Confirm business timezone and inclusive/exclusive boundaries.
- Global search: Leads, Contacts, Companies, supported message context; results permission-filtered.
- Profile menu: My profile, Preferences, Workspace settings if authorized, Sign out.
- Theme: Light, Dark, System if supported.
- Notifications: All/unread, mark read; preferences only if defined.

## Lead form
- Phone country code: supported ISO country calling codes; default policy needs approval.
- Lead source: Website, WhatsApp, Google Ads, Referral, Direct, Other + workspace-configured values.
- Pipeline stage: workspace-configured ordered stages; baseline proposed New, Contacted, Qualified, Proposal, Won, Lost.
- Qualification: Not qualified, In review, Qualified (confirm meanings).
- Owner: active members with assignment permission.
- Currency: workspace currency, default INR only if configured.
- Next action: Call, Email, WhatsApp follow-up (only if allowed), Meeting, Send proposal, Demo, Other, None.
- Follow-up date/time: date, time, timezone; reject invalid/past dates only if approved rule says so.
- Consent: Unknown, Consented, Opted out; never infer consent.
- Duplicate action: View existing; link/merge only if supported and authorized; create anyway only if policy permits.
- Tags: configured tags, create-new only if permitted.

## Lead Inbox filters
- Source; Stage; Owner; Qualification; Consent status; Created date range; Next follow-up range; Deal value range; Last activity range; Has overdue task; WhatsApp-linked if supported.
- Sort: Created newest/oldest, Name A–Z/Z–A, Deal value high/low, Next follow-up, Last activity.
- Page size: 10, 25, 50, 100 if performance and product owner approve.
- Bulk actions: Assign owner, Change stage, Export selected, Delete/archive only if approved and authorized.

## Pipeline
- View: Kanban, List (if both supported).
- Owner; date range; source; value range; sort by last activity, value, age in stage, next follow-up.
- Stage action menu: move to stage, edit, view details; Won/Lost may require reason and timestamp.

## Follow-ups
- Status: Today, Upcoming, Overdue, Completed, Cancelled.
- Type: Call, Email, WhatsApp follow-up (approved only), Meeting, Demo, Other.
- Priority: Low, Medium, High if product owner approves.
- Owner; date range; linked lead/contact; reminder channel: In-app, Email, Push/SMS only if supported/configured.
- Reschedule choices must use date/time picker; avoid fixed options that prevent arbitrary scheduling.

## CSV import/export
- Source file encoding/delimiter detection with override only if needed.
- Column mapping: source column → target field; ignore column option.
- Duplicate strategy: Skip, Update, Merge, Create new — show only approved strategies.
- Export scope: Selected rows, Current filtered results, All permitted records.
- Export format: CSV; additional formats only if supported.
- Fields: allowed export columns, with sensitive fields governed by permission.

## Team & permissions
- Role: Admin, Sales Manager, Sales Executive, Read-only as initial proposal; custom roles only if planned.
- Member status: Invited, Active, Suspended/Deactivated.
- Permission actions: View, Create, Edit, Assign, Delete/Archive, Export, Manage integrations, Manage members, Configure pipeline, View audit log.
- Never rely on client-side role dropdown alone for authorization.

## Settings
- Currency, timezone, date format, language/locale, theme, week start, notification preferences.
- Pipeline stage: name, order, color token, terminal stage flag, active/archive state.
- Lead source options and qualification options only if configurable settings are approved.
- Every select documents: option labels, stored values, default, searchable/multi-select behavior, clear behavior, required rule, disabled state, validation, persistence and permissions.
