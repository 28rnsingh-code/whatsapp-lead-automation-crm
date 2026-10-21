# Antigravity Project Prompt — OneClick Automics CRM

You are implementing OneClick Automics, a multi-tenant CRM + approved WhatsApp Business Platform/API lead-management SaaS for India-first businesses.

## Read first
1. `README_START_HERE.md`
2. `01_Product_Design/01_INFORMATION_ARCHITECTURE.md`
3. `01_Product_Design/02_SCREEN_BY_SCREEN_SPEC.md`
4. `01_Product_Design/03_DESIGN_SYSTEM_AND_RESPONSIVE.md`
5. `01_Product_Design/04_DROPDOWN_AND_FIELD_INVENTORY.md`
6. All files in `02_Backend_Engineering/`
7. `03_QA_Acceptance/01_REQUIREMENT_TRACEABILITY.csv`
8. `03_QA_Acceptance/02_ACCEPTANCE_AND_TEST_PLAN.md`

## Non-negotiable rules
- Do not declare a feature complete merely because a screen or button exists.
- Do not silently invent business rules. Keep an `OPEN_QUESTIONS.md` and ask for product-owner approval when a rule affects data, permissions, reporting, messaging or destructive actions.
- Do not remove requirements to simplify the build.
- Do not build unrelated products.
- Keep visual design premium, clean, accessible and responsive; light theme default with dark theme.
- Use the supplied reference images/prototype as visual direction, not as proof of behavior.
- Clearly label mock/sample data. Never mix it with production data.
- Backend authorization and tenant isolation are mandatory.
- Use official/approved WhatsApp Business Platform/API capabilities only.
- Every dropdown needs a documented option list, default, stored value, keyboard behavior, validation and persistence.
- Every async flow needs loading, empty where applicable, success, API error, retry and permission-denied behavior.
- Keep code maintainable, modular, typed where the chosen stack supports it, and add tests.

## Execution sequence
### Phase 0 — Inspect and report
Inspect repository, prototype and references. Produce `IMPLEMENTATION_PLAN.md`, `OPEN_QUESTIONS.md`, and a requirement-to-route/component map. Do not overwrite existing code before understanding it.

### Phase 1 — Foundations
Set up app shell, routing, design tokens, light/dark themes, component primitives, responsive navigation, accessibility patterns, mock data boundaries and error handling.

### Phase 2 — P0 UI journeys
Auth/recovery; onboarding/empty states; lead inbox; create/edit/detail; pipeline transitions; follow-ups; dashboard drill-down; permission-denied and system states.

### Phase 3 — P0 backend
Auth and session; tenants/memberships; permissions; lead CRUD; stage transitions; activities/audit; tasks; tenant isolation; API schemas and tests.

### Phase 4 — Management
Contacts/companies; reports; CSV import/export jobs; team/roles; settings/pipeline configuration; audit log.

### Phase 5 — Integrations
Website lead capture and approved WhatsApp connection/conversation context, with secure credentials, webhooks, status and failure recovery.

### Phase 6 — QA
Run traceability register row by row. Attach evidence for each item. Use `Implemented` only when code exists and `Verified` only when acceptance tests pass. Run responsive, keyboard/accessibility, permissions, integration and E2E tests.

## Required deliverables
- Working app with documented run/build commands.
- Figma handoff mapping or implementation screen map.
- API/OpenAPI specification and migrations.
- Environment variable example with placeholders only.
- Automated tests and manual QA report.
- `REQUIREMENT_TRACEABILITY.csv` updated with evidence links.
- `OPEN_QUESTIONS.md` with owner and decision status.
- `KNOWN_LIMITATIONS.md` for anything not implemented.
- Final release report that explicitly lists unverified requirements. Never claim “nothing missing” without traceable evidence.
