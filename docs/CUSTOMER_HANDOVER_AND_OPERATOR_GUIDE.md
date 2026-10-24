# OneClick Automics CRM — Customer Handover & Operator Guide

Version: 1.0 • 24 October 2026

Release status: candidate branch only; no production deployment, paid checkout or live provider credentials are claimed by this guide.

## 1. Public website demo

- Username: demo; password: demo123.
- The demo has its own sample workspace. Never enter real customer data.
- The session lasts two hours and permits five write/test actions. Creating/updating an allowed sample lead, task or contact, or running a simulated email/WhatsApp test, uses an action.
- Demo email and WhatsApp actions are simulations; no real provider is called and no recipient is contacted.
- After five actions, use a paid workspace to continue. Clearing browser storage may reset the visitor ID; configure edge/WAF abuse protection before major public promotion.

## 2. Admin and member access

- Admin credentials are separate from demo credentials. Never store the Admin password in this guide.
- A workspace Admin creates members from Team & Permissions. Seat limits come from the selected plan.
- A temporary password is displayed once at account creation; pass it privately to the intended member only.
- The member must change that temporary password at first sign-in. Passwords require at least 12 characters with uppercase, lowercase, number and symbol.
- Member invitation email and email-based password-reset links are not implemented. Do not claim an invitation or reset email was sent. Signed-in password change is supported.

## 3. Paid monthly plans

| Plan | Monthly price | Seats | Active leads | WhatsApp messages/month | Emails/month | Imports/month |
|---|---:|---:|---:|---:|---:|---:|
| Starter | ₹2,999 | 2 | 1,000 | 500 | 300 | 10 |
| Growth | ₹7,999 | 5 | 10,000 | 5,000 | 3,000 | 100 |
| Enterprise | ₹19,999 | 10 | 100,000 | 50,000 | 10,000 | 1,000 |

These are paid CRM plan allowances, not a free email-provider tier. The app blocks email sends at the configured quota; automatic overage billing is not implemented. Plan changes currently update entitlements in mock/manual mode and do not collect payment. Live checkout, renewals, invoices/tax and failed-payment handling must be completed before advertising online purchase.

## 4. Email, WhatsApp and AI setup

- Live transactional email requires a server-side Brevo API key and verified sender. Configure BREVO_API_KEY, EMAIL_FROM_ADDRESS and optionally EMAIL_FROM_NAME in hosting environment settings. Never place keys in browser code or VITE_ variables.
- Without these values the API returns a configuration error rather than a fake success.
- Provider acceptance is not proof that an email reached the inbox; check provider delivery logs.
- Live WhatsApp requires a real Meta Business account, phone ID/token, verified webhook, consent evidence and approved templates where required. Demo sends remain simulated.
- External AI features (for example ChatGPT/OpenAI API or another supported model) can be configured with the customer's own provider key. That provider may charge separately; the CRM plan does not include unlimited third-party AI usage.

## 5. Full project purchase and maintenance

A source-project buyout is a separate written commercial agreement, not a monthly SaaS tier. Quote the repository/source handover, deployment/environment transfer, domain/data ownership, support scope, response times, patch cadence, hosting/provider charges and exclusions. Maintenance starts only after scope and fee are agreed.

## 6. Release checklist

Before collecting customer payments or sharing a production URL, verify the exact deployed commit, remote DB/migration state and backup, live email acceptance and provider logs, WhatsApp signed webhooks/consent, payment webhooks, tenant isolation, member roles, account recovery and critical deployed browser journeys. CI success alone is not production sign-off.
