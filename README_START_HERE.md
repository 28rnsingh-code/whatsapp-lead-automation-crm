# OneClick Automics — CRM + WhatsApp Lead Management
## Design, Backend & QA Handoff Pack

**Purpose:** A durable, shareable handoff package for the designer, frontend developer, backend developer, QA, and the Antigravity implementation workflow.

**Product scope:** Multi-tenant CRM SaaS for India-first teams. Lead capture, lead management, sales pipeline, follow-ups, contacts/companies, reports, CSV import/export, team permissions, settings, audit logs, website integration, and approved WhatsApp Business Platform/API capabilities.

**Not in scope:** Restaurant, gym, clinic, or unrelated AI workflow products.

## Important status statement
This package is a **requirements and implementation specification**, not proof that every item has already been designed, coded, integrated, or tested. Treat the supplied dashboard/reference images and HTML prototype as visual references/baselines, not as verified production behavior. Mark each requirement in the traceability register as `Not started`, `In design`, `In development`, `Implemented`, or `Verified` only when evidence supports that status.

## Folder guide
- `01_Product_Design/`: information architecture, screen-by-screen design requirements, design system, interaction/state matrix, responsive and accessibility rules.
- `02_Backend_Engineering/`: architecture boundaries, entities/data model, API contract outline, validation/security/integration requirements, implementation notes.
- `03_QA_Acceptance/`: requirement traceability register, acceptance criteria, test plan and release gate checklist.
- `04_Antigravity_Handoff/`: ready-to-use project prompt and implementation sequence.
- `05_Assets_and_Prototype/`: place reference images and the current HTML prototype here. The ZIP may include a prototype if it is available at packaging time.

## Role separation
- **Designer:** define visual layout, components, responsive variants, states, labels, dropdown options, focus/keyboard behavior, error/help content and Figma prototype flows.
- **Frontend:** implement UI states, routing, client-side interaction, accessibility, API loading/error/success handling.
- **Backend:** own persistence, tenant isolation, authorization, validation, audit trail, jobs/webhooks, integration credentials and API behavior.
- **QA:** verify each requirement against the acceptance criteria on supported viewport sizes and roles.

## Rules of engagement
1. Do not infer missing business rules. Record them as open questions and obtain product-owner approval.
2. Never treat a visible dropdown or button as implemented functionality by itself.
3. Every interactive control must have defined options, default, behavior, disabled/loading/error states, keyboard support and save semantics.
4. Use sample data only in explicitly labeled prototype/demo mode.
5. Never expose secrets, access tokens, or private integration credentials in the client.
6. WhatsApp behavior must be limited to supported, approved WhatsApp Business Platform/API capabilities and applicable consent/template/messaging rules.
7. “Complete” means requirements have evidence and pass acceptance tests; it does not mean a screen merely exists.
