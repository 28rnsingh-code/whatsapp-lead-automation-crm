# OneClick CRM — Admin and Member Onboarding

This guide is for a customer workspace. Public-demo access and customer accounts are separate.

## Public demo

- Username: `demo`
- Password: `demo123`
- The demo is isolated from customer workspaces and has five test actions per browser ID.
- Outbound WhatsApp in demo is a simulation. It does not send a live WhatsApp message or email.
- Use sample contact details only. Do not enter real customer/patient/payment data.
- A public visitor cannot manage team members, change plans, connect providers, or enter the admin area.

## For the workspace Admin

1. Sign in to your customer workspace using your Admin account.
2. Open **Team Members & Permissions**.
3. Review the plan’s seat counter before adding people.
4. Select **Add Member**, enter the member’s name and work email, and choose the least-privileged role needed for their job.
5. Create the member account. For a new account, the system displays a temporary password once. Copy it and share it through a trusted, secure channel such as a password manager’s sharing feature. Do not send it to a group or include it in a public document.
6. The member must change the temporary password on their first login. The CRM blocks other workspace actions until the password change succeeds.
7. Use the role selector to change an existing member’s role. Use Suspend to withdraw workspace access. Keep at least one active Admin.

**Important:** The current build does not send invitation or password-reset email. The Admin must share the temporary password securely. Do not tell the member that an email was sent. Lost-password email recovery requires a verified email provider and a separate secure reset-token flow.

## Monthly plan seats

| Plan | Current configured monthly price | Maximum members |
|---|---:|---:|
| Starter | ₹2,999/month | 2 |
| Growth | ₹7,999/month | 5 |
| Enterprise | ₹19,999/month | 10 |

These are the product’s configured plan values, not confirmation that payment checkout is live. Plan change currently updates CRM entitlements; actual payment collection, verified billing webhooks, invoices, tax, renewal and cancellation are not yet verified.

## Provider integration notes

- Real WhatsApp sending requires the customer/business’s authorised Meta WhatsApp Business Platform configuration, approved templates where applicable, valid consent/opt-out handling, and server-side secrets. Demo mode never uses a live provider.
- Real email sending is intentionally not enabled by this demo change. Choose a provider, verify the sender domain, set server-only API credentials, define paid-plan email allowance and overage prices, and test delivery/bounces/unsubscribes before enabling it.
- Do not put API keys, administrator passwords or production customer information into this guide or source control.

## Release safety

Before giving clients access, configure the production database and secrets, rotate any bootstrap Admin password, review dependency security alerts, run the complete CI suite, verify the deployed login/lead/team journeys and provider webhooks, and prepare rollback. A successful CI run alone does not prove a live deployment is ready.
