# Design vs Frontend vs Backend Responsibility Matrix

| Concern | Designer/Figma | Frontend | Backend | QA |
|---|---|---|---|---|
| Visual hierarchy, spacing, typography, color | Own | Implement | — | Visual review |
| Responsive layout and component variants | Specify | Implement | API supports pagination | Viewport tests |
| Dropdown labels/options/defaults | Specify approved behavior | Render and validate UX | Validate allowed values | Verify options and saved result |
| Field validation copy and placement | Specify | Immediate client feedback | Authoritative validation | Test both layers |
| Authentication screens | Specify all states | Implement forms/routing | Identity/session/reset tokens | Security and flow tests |
| Empty/loading/error states | Specify | Select/render based on API state | Return correct empty/error contract | Verify every state |
| Tenant isolation | Show workspace context/denied state | Send authenticated requests | Enforce on every query/mutation | Cross-tenant tests |
| Permissions | Document role matrix and affordances | Hide/disable/handle 403 | Enforce authorization | Role-route matrix |
| Lead CRUD and stage changes | Specify interaction and confirmation | Call API and update UI | Validate/persist/audit | Lifecycle tests |
| Reports and KPIs | Define visualizations and approved formulas | Render/filter/drill-down | Compute consistent metrics | Reconcile totals |
| CSV import/export | Design steps, progress and errors | Upload/map/progress/download | Parse, validate, queue, persist | Large/malformed/permission tests |
| WhatsApp/website integration | Design setup/status/error recovery | Display actual provider state | Credentials/webhooks/retries | Provider and failure tests |
| Audit log | Specify readable immutable log view | Filters/pagination | Append server-side events | Event integrity tests |
| Figma handoff | Own | Reference spec | API contract dependency | Coverage review |
| Production readiness | Not solely designer-owned | Not solely frontend-owned | Not solely backend-owned | Evidence-based release gate |

**Principle:** design defines how states and controls should appear and behave; frontend implements the interaction; backend enforces data/security/business rules; QA verifies the complete contract.
