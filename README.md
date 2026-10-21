# OneClick Automics — CRM + WhatsApp Lead Management SaaS

A multi-tenant, India-first CRM and WhatsApp lead management platform built with React, TypeScript, Node.js/Express, and PostgreSQL migrations.

---

## 🚀 Quick Start Guide

### Prerequisites
- **Node.js**: v18.0.0+ (Tested on v24.19.0)
- **npm**: v9.0.0+ (Tested on v11.17.0)
- **PostgreSQL**: v14+ (Optional for mock/demo development mode; required for persistent database mode)

### 1. Installation
Install all root, client, and server dependencies:
```bash
npm install
```

### 2. Environment Configuration
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```
Configure your PostgreSQL connection string in `.env` if using a live database:
```env
DATABASE_URL=postgresql://postgres:password@localhost:5432/oneclick_crm
PORT=4000
VITE_API_URL=http://localhost:4000/api
```

### 3. Database Migrations
Apply the initial schema migration defining multi-tenant tables, indexes, and relations:
```bash
npm run migrate --workspace=server
```
*(Migration files are located in `server/src/db/migrations/001_initial_schema.sql`)*

### 4. Running the Application

- **Run Both Client & Server Concurrently:**
  ```bash
  npm run dev:all
  ```
- **Run Frontend Client Only (Vite SPA on http://localhost:3000):**
  ```bash
  npm run dev:client
  ```
- **Run Backend API Only (Express on http://localhost:4000):**
  ```bash
  npm run dev:server
  ```

### 5. Running Automated Tests
Run backend API contract and tenant isolation test suites:
```bash
npm test
```

---

## 🏛️ System Architecture

### Multi-Tenant Isolation Model
1. **Tenant Context Derivation**: The tenant context (`tenantId`) is **never** accepted from the client request body or query parameter as authoritative.
2. **Middleware Boundary**: The `requireTenant()` middleware verifies the user's active membership against the requested workspace and attaches an immutable `req.tenantContext = { tenantId, role, permissions }`.
3. **Database Scoping**: All relational tables (`leads`, `pipeline_stages`, `tasks`, `activities`, `audit_events`, `integrations`) carry a mandatory `tenant_id` foreign key with composite indexes (e.g. `(tenant_id, stage_id)`).
4. **IDOR & Cross-Tenant Protection**: Queries strictly filter by `tenant_id = req.tenantContext.tenantId`, preventing cross-workspace data leakage.

### Standard API Response Envelope
All API endpoints return a predictable JSON envelope:
- **Success:**
  ```json
  {
    "success": true,
    "data": { ... },
    "meta": { "page": 1, "pageSize": 10, "totalCount": 24, "requestId": "req_8a92f0" }
  }
  ```
- **Error:**
  ```json
  {
    "success": false,
    "error": {
      "code": "VALIDATION_ERROR",
      "message": "Field errors occurred.",
      "details": { "phoneRaw": ["Phone number is required."] },
      "requestId": "req_8a92f0"
    }
  }
  ```

---

## 📁 Repository Structure

```
├── .env.example                     # Environment template with placeholders
├── README.md                        # Setup and developer documentation
├── package.json                     # Monorepo workspaces config
├── shared/                          # Shared TypeScript contracts
│   └── types.ts                     # Lead, Tenant, User, Pipeline, Task types
├── client/                          # React + Vite Frontend SPA (Port 3000)
│   ├── index.html
│   ├── vite.config.ts
│   └── src/
│       ├── main.tsx
│       ├── App.tsx                  # Router & state manager
│       ├── index.css                # Full design token system (Light/Dark themes)
│       ├── components/              # Reusable UI primitives
│       │   ├── AppShell.tsx         # Responsive layout shell
│       │   ├── Sidebar.tsx          # Collapsible navigation (14 routes)
│       │   ├── Topbar.tsx           # Global search (Ctrl+K), theme toggle, date filter
│       │   ├── Modal.tsx            # Accessible dialog with focus trap
│       │   ├── Toast.tsx            # Notification container
│       │   ├── StatusPill.tsx       # Semantic status badges
│       │   ├── KpiCard.tsx          # Metric cards
│       │   └── EmptyState.tsx       # Standard empty state
│       └── pages/                   # 14 Screen Views
│           ├── DashboardPage.tsx
│           ├── LeadsPage.tsx
│           ├── PipelinePage.tsx
│           ├── FollowupsPage.tsx
│           ├── ContactsPage.tsx
│           ├── ReportsPage.tsx
│           ├── WhatsAppPage.tsx
│           ├── IntegrationsPage.tsx
│           ├── ImportExportPage.tsx
│           ├── TeamPage.tsx
│           ├── SettingsPage.tsx
│           ├── AuditPage.tsx
│           ├── AuthPage.tsx
│           └── OnboardingPage.tsx
├── server/                          # Node.js + Express Backend (Port 4000)
│   ├── src/
│   │   ├── app.ts                   # Express app configuration
│   │   ├── index.ts                 # HTTP server entrypoint
│   │   ├── middleware/              # Auth, Tenant isolation, Error handling
│   │   ├── routes/                  # API endpoints (/auth, /leads, /pipeline, /workspaces)
│   │   └── db/                      # PostgreSQL pool & migrations
│   │       ├── index.ts
│   │       ├── migrate.ts
│   │       └── migrations/
│   │           └── 001_initial_schema.sql
│   └── tests/                       # Automated API & security tests
└── 01_Product_Design/               # Preserved specifications
└── 02_Backend_Engineering/          # Preserved specifications
└── 03_QA_Acceptance/                # Preserved specifications
└── 04_Antigravity_Handoff/          # Preserved specifications
└── 05_Assets_and_Prototype/         # Preserved prototypes
```
