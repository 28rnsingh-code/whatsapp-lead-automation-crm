# Open Product Decisions — Must Resolve Before Relevant Build

Assign an owner and target decision date for each item. If not resolved, implement no invented behavior; mark the dependency clearly.

1. Which lead fields are mandatory? Is phone, email, or either required?
2. What defines a duplicate: normalized phone, email, company+name, or configurable rules?
3. Is “Create anyway” allowed after a duplicate warning? Is merge supported?
4. Which pipeline stages are default and which transitions are blocked?
5. Which fields/reasons are required when moving to Won or Lost?
6. How are source-to-sale conversion and attribution calculated?
7. How is first-response time calculated, including business hours and unanswered inbound messages?
8. Which onboarding steps are required, optional, skippable, or resumable?
9. Which roles ship in MVP and what exact actions can each perform?
10. Can custom roles be created in MVP?
11. What are CSV file size/row limits, duplicate strategy, and partial-success semantics?
12. Which fields can be exported by each role? How long are generated files retained?
13. Which website form provider/protocol is used? How are keys signed/rotated?
14. Which approved WhatsApp provider/API, permissions, templates and supported message types are in scope?
15. How is opt-in evidence stored and how is opt-out enforced across all outbound surfaces?
16. Which reminder channels are supported and what is the retry/escalation policy?
17. What is the deletion/archival policy for leads, contacts, messages and audit events?
18. What timezone is used for reports and reminders: workspace, user, or record?
19. Which currencies/locales ship in MVP? Is INR the workspace default or merely India-first guidance?
20. Are social login, self-serve signup, MFA, SSO, billing and subscription/upgrade screens in MVP?
21. Which notification preferences are configurable?
22. What chart/report drill-down behavior is required for each KPI?
23. Which audit metadata is retained, and who can view/export it?
24. What are intermediate responsive breakpoints and supported browser versions?
25. What are the approved API latency/performance budgets and operational SLAs?
