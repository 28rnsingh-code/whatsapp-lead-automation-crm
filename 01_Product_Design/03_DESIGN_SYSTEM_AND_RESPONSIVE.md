# Design System, Responsive & Accessibility Specification

## Visual direction
Premium, restrained B2B SaaS. Light theme default; complete dark theme. Use glassmorphism only as a limited accent (e.g., overlay, popover, onboarding hero), not behind dense tables/forms. Kinetic motion should be subtle and nonessential; no animation that obscures data or delays task completion.

## Token baseline (proposed; validate in Figma)
- Primary: accessible blue family; use semantic tokens, not raw colors in components.
- Secondary accent: restrained violet.
- Success: green; warning: amber; danger: red; info: blue.
- Light: app background near cool off-white, surface white, border cool gray, text deep navy.
- Dark: app background deep navy, elevated surface lighter navy, border slate, text near-white.
- Status always uses text/icon as well as color.
- Typography: Inter or a licensed/product-approved equivalent. Establish display, page title, section title, body, small, caption and numeric styles.
- Spacing: 4px base; documented scale 4/8/12/16/20/24/32/40/48.
- Radius: small controls 6–8px; cards 10–12px; dialogs 12–16px. Avoid excessive nested cards.
- Borders: subtle 1px; shadows low contrast and reserved for elevation.
- Focus ring: clearly visible in both themes.
- Motion: brief and reduced-motion-aware; never convey status through motion alone.

## Core component inventory
- App shell, sidebar (expanded/collapsed), mobile nav/drawer, top bar, workspace switcher, global search/command menu.
- Button variants: primary, secondary, tertiary/ghost, destructive, icon-only; default/hover/focus/pressed/loading/disabled.
- Text input, email, password with show/hide, phone/country code, currency, date picker, time picker, select, searchable select, multi-select, checkbox, radio, toggle, textarea, file upload.
- Field label/help/error/success/required indicator.
- Badge/status pill, avatar, tooltip, popover, dropdown menu, tabs, breadcrumb, pagination, filter chips, table, bulk-action bar.
- KPI card, chart shell, legend, data table, empty state, skeleton, inline alert, toast, dialog/drawer, confirmation dialog.
- Timeline item, activity composer, lead card, pipeline column, task row, integration status panel, progress stepper, import mapping row, permission matrix.
- Audit table, onboarding checklist, retry/error panel.

## Component state contract
Every interactive component defines:
1. Default
2. Hover (pointer only)
3. Focus-visible
4. Pressed/selected
5. Disabled
6. Loading where asynchronous
7. Error/invalid where relevant
8. Empty/no option where relevant
9. Success/confirmation where relevant
10. Dark theme
11. Responsive behavior
12. Keyboard and screen-reader behavior

## Responsive targets
- Desktop reference: 1440×900. Persistent sidebar; dense tables; dashboard multi-column layout.
- Tablet reference: 1024×768. Compact sidebar; collapse low-priority dashboard widgets; tables use controlled horizontal scroll or card alternative.
- Mobile reference: 390×844. Drawer/bottom navigation; one-column dashboard; cards instead of wide tables; filter drawer; full-screen form/drawer; minimum comfortable touch target 44×44 CSS px where practical.
- Do not merely scale desktop down. Prioritize primary actions and reduce columns while preserving access to data/actions.
- Define intermediate breakpoints and exact hide/reflow rules in Figma; proposed initial breakpoints: 1200, 1024, 768, 480 CSS px (finalize after layout testing).

## WCAG 2.2 AA design checks
- Text and meaningful UI contrast meet AA.
- Keyboard-only navigation and visible focus.
- Logical focus order; dialogs trap/restore focus appropriately.
- Inputs have persistent labels; errors are identified in text and programmatically associated.
- Do not use color alone for state.
- Charts have textual summary/table alternative.
- Reduced motion preference supported.
- Touch targets and spacing support motor accessibility.
- Zoom/reflow without loss of content or function.
- Accessible names for icon-only buttons; tooltip is not the only label for critical action.
- Status updates announced appropriately; avoid focus jumps after save/errors.

## Figma deliverables
- Pages: 00 Cover & Index; 01 Foundations; 02 Components; 03 Auth & Onboarding; 04 Dashboard; 05 Leads; 06 Pipeline; 07 Follow-ups; 08 Contacts; 09 Reports; 10 Import Export; 11 Integrations; 12 Team & Settings; 13 Audit; 14 System States; 15 Responsive; 16 Prototype Flows; 17 Handoff & Open Questions.
- Components use variants and properties; name layers semantically; document spacing/typography/color tokens.
- Provide clickable prototype for sign-in/recovery, onboarding to first lead, lead create/edit/detail, stage change to won/lost, schedule/complete follow-up, CSV import, integration failure/reconnect, permission denied.
