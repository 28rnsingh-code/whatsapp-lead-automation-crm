import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { requireTenant } from '../middleware/tenant';
import { pool, resolveDatabaseConfig } from '../db';
import { DEFAULT_TENANT_ID } from '../db/seed';

const router = Router();

const TENANT_UUID_MAP: Record<string, string> = {
  tenant_bring_my_bite: DEFAULT_TENANT_ID,
  tenant_automics_labs: 'a0000000-0000-0000-0000-000000000002',
};

function toDbTenantId(id: string): string {
  if (!id) return DEFAULT_TENANT_ID;
  if (TENANT_UUID_MAP[id]) return TENANT_UUID_MAP[id];
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (uuidRegex.test(id)) return id;
  return DEFAULT_TENANT_ID;
}

// In-memory fallback
const IN_MEMORY_CONTACTS: any[] = [
  {
    id: 'c-1',
    tenantId: 'tenant_bring_my_bite',
    name: 'Amit Sharma',
    phoneRaw: '+919876543210',
    phoneNormalized: '+919876543210',
    email: 'amit@sharmaind.com',
    jobTitle: 'Managing Director',
    companyName: 'Sharma Industries',
    createdAt: new Date().toISOString(),
  },
  {
    id: 'c-2',
    tenantId: 'tenant_bring_my_bite',
    name: 'Neha Gupta',
    phoneRaw: '+919811223344',
    phoneNormalized: '+919811223344',
    email: 'neha@guptatech.io',
    jobTitle: 'Head of Procurement',
    companyName: 'Gupta Tech',
    createdAt: new Date().toISOString(),
  },
];

const IN_MEMORY_COMPANIES: any[] = [
  {
    id: 'comp-1',
    tenantId: 'tenant_bring_my_bite',
    name: 'Sharma Industries',
    domain: 'sharmaind.com',
    phone: '+919876543210',
    industry: 'Manufacturing',
    website: 'https://sharmaind.com',
  },
  {
    id: 'comp-2',
    tenantId: 'tenant_bring_my_bite',
    name: 'Gupta Tech',
    domain: 'guptatech.io',
    phone: '+919811223344',
    industry: 'Software & Cloud',
    website: 'https://guptatech.io',
  },
];

// 1. List Companies (Tenant Isolated)
router.get('/companies', requireAuth, requireTenant(), async (req: Request, res: Response): Promise<void> => {
  const tenantId = toDbTenantId(req.tenantContext!.tenantId);
  const rawTenantId = req.tenantContext!.tenantId;
  const requestId = req.requestId || 'req_unknown';
  const dbConfig = resolveDatabaseConfig();

  if (dbConfig.isBlocked) {
    const list = IN_MEMORY_COMPANIES.filter(c => c.tenantId === rawTenantId || c.tenantId === tenantId);
    res.json({ success: true, data: list, meta: { totalCount: list.length, requestId } });
    return;
  }

  try {
    const result = await pool.query(
      `SELECT id, tenant_id as "tenantId", name, domain, phone, industry, website, address, created_at as "createdAt"
       FROM companies
       WHERE tenant_id = $1
       ORDER BY name ASC;`,
      [tenantId]
    );

    res.json({ success: true, data: result.rows, meta: { totalCount: result.rows.length, requestId } });
  } catch (error: any) {
    const list = IN_MEMORY_COMPANIES.filter(c => c.tenantId === rawTenantId || c.tenantId === tenantId);
    res.json({ success: true, data: list, meta: { totalCount: list.length, requestId } });
  }
});

// 2. Create Company
router.post('/companies', requireAuth, requireTenant(), async (req: Request, res: Response): Promise<void> => {
  const tenantId = toDbTenantId(req.tenantContext!.tenantId);
  const rawTenantId = req.tenantContext!.tenantId;
  const requestId = req.requestId || 'req_unknown';
  const { name, domain, phone, industry, website, address } = req.body;

  if (!name || !name.trim()) {
    res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'Company name is required.', requestId },
    });
    return;
  }

  const dbConfig = resolveDatabaseConfig();
  if (dbConfig.isBlocked) {
    const comp = {
      id: `comp-${Date.now()}`,
      tenantId: rawTenantId,
      name: name.trim(),
      domain: domain || null,
      phone: phone || null,
      industry: industry || 'General',
      website: website || null,
      address: address || null,
      createdAt: new Date().toISOString(),
    };
    IN_MEMORY_COMPANIES.push(comp);
    res.status(201).json({ success: true, data: comp, meta: { requestId } });
    return;
  }

  try {
    const result = await pool.query(
      `INSERT INTO companies (tenant_id, name, domain, phone, industry, website, address)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, tenant_id as "tenantId", name, domain, phone, industry, website, address, created_at as "createdAt";`,
      [tenantId, name.trim(), domain || null, phone || null, industry || null, website || null, address || null]
    );

    res.status(201).json({ success: true, data: result.rows[0], meta: { requestId } });
  } catch (error: any) {
    if (error.name === 'DatabaseSafetyError') {
      res.status(503).json({ success: false, error: { code: 'DATABASE_SAFETY_BLOCKED', message: error.message, requestId } });
      return;
    }
    res.status(500).json({ success: false, error: { code: 'DATABASE_ERROR', message: error.message, requestId } });
  }
});

// 3. List Contacts (Tenant Isolated)
router.get('/', requireAuth, requireTenant(), async (req: Request, res: Response): Promise<void> => {
  const tenantId = toDbTenantId(req.tenantContext!.tenantId);
  const rawTenantId = req.tenantContext!.tenantId;
  const requestId = req.requestId || 'req_unknown';
  const { q } = req.query;
  const dbConfig = resolveDatabaseConfig();

  if (dbConfig.isBlocked) {
    let list = IN_MEMORY_CONTACTS.filter(c => c.tenantId === rawTenantId || c.tenantId === tenantId);
    if (q && typeof q === 'string' && q.trim()) {
      const qLower = q.toLowerCase();
      list = list.filter(c =>
        c.name.toLowerCase().includes(qLower) ||
        c.phoneRaw.includes(qLower) ||
        (c.email && c.email.toLowerCase().includes(qLower)) ||
        (c.companyName && c.companyName.toLowerCase().includes(qLower))
      );
    }
    res.json({ success: true, data: list, meta: { totalCount: list.length, requestId } });
    return;
  }

  try {
    let querySql = `
      SELECT 
        c.id, c.tenant_id as "tenantId", c.name, c.phone_raw as "phoneRaw",
        c.phone_normalized as "phoneNormalized", c.email, c.job_title as "jobTitle",
        c.company_id as "companyId", COALESCE(comp.name, '') as "companyName",
        c.lead_id as "leadId", c.notes, c.created_at as "createdAt", c.updated_at as "updatedAt"
      FROM contacts c
      LEFT JOIN companies comp ON comp.id = c.company_id
      WHERE c.tenant_id = $1
    `;
    const params: any[] = [tenantId];

    if (q && typeof q === 'string' && q.trim()) {
      params.push(`%${q.trim()}%`);
      querySql += ` AND (c.name ILIKE $2 OR c.phone_raw ILIKE $2 OR c.email ILIKE $2 OR comp.name ILIKE $2)`;
    }

    querySql += ` ORDER BY c.created_at DESC;`;

    const result = await pool.query(querySql, params);
    res.json({ success: true, data: result.rows, meta: { totalCount: result.rows.length, requestId } });
  } catch (error: any) {
    let list = IN_MEMORY_CONTACTS.filter(c => c.tenantId === rawTenantId || c.tenantId === tenantId);
    res.json({ success: true, data: list, meta: { totalCount: list.length, requestId } });
  }
});

// 4. Create Contact
router.post('/', requireAuth, requireTenant(), async (req: Request, res: Response): Promise<void> => {
  const tenantId = toDbTenantId(req.tenantContext!.tenantId);
  const rawTenantId = req.tenantContext!.tenantId;
  const requestId = req.requestId || 'req_unknown';
  const { name, phoneRaw, email, jobTitle, companyId, companyName, leadId, notes } = req.body;

  if (!name || !name.trim()) {
    res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Name is required.', requestId } });
    return;
  }
  if (!phoneRaw || !phoneRaw.trim()) {
    res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Phone is required.', requestId } });
    return;
  }

  const digits = phoneRaw.replace(/\D/g, '');
  const phoneNormalized = phoneRaw.trim().startsWith('+') ? `+${digits}` : `+91${digits}`;

  const dbConfig = resolveDatabaseConfig();
  if (dbConfig.isBlocked) {
    const contact = {
      id: `c-${Date.now()}`,
      tenantId: rawTenantId,
      name: name.trim(),
      phoneRaw: phoneRaw.trim(),
      phoneNormalized,
      email: email?.trim() || null,
      jobTitle: jobTitle || null,
      companyId: companyId || null,
      companyName: companyName || '',
      leadId: leadId || null,
      notes: notes || null,
      createdAt: new Date().toISOString(),
    };
    IN_MEMORY_CONTACTS.unshift(contact);
    res.status(201).json({ success: true, data: contact, meta: { requestId } });
    return;
  }

  try {
    const result = await pool.query(
      `INSERT INTO contacts (tenant_id, company_id, lead_id, name, phone_raw, phone_normalized, email, job_title, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, tenant_id as "tenantId", company_id as "companyId", lead_id as "leadId", name, phone_raw as "phoneRaw",
                 phone_normalized as "phoneNormalized", email, job_title as "jobTitle", notes, created_at as "createdAt";`,
      [
        tenantId,
        companyId || null,
        leadId || null,
        name.trim(),
        phoneRaw.trim(),
        phoneNormalized,
        email?.trim() || null,
        jobTitle?.trim() || null,
        notes?.trim() || null,
      ]
    );

    res.status(201).json({
      success: true,
      data: {
        ...result.rows[0],
        companyName: companyName || '',
      },
      meta: { requestId },
    });
  } catch (error: any) {
    if (error.name === 'DatabaseSafetyError') {
      res.status(503).json({ success: false, error: { code: 'DATABASE_SAFETY_BLOCKED', message: error.message, requestId } });
      return;
    }
    res.status(500).json({ success: false, error: { code: 'DATABASE_ERROR', message: error.message, requestId } });
  }
});

// 5. Delete Contact
router.delete('/:id', requireAuth, requireTenant(), async (req: Request, res: Response): Promise<void> => {
  const tenantId = toDbTenantId(req.tenantContext!.tenantId);
  const rawTenantId = req.tenantContext!.tenantId;
  const contactId = req.params.id;
  const requestId = req.requestId || 'req_unknown';

  const dbConfig = resolveDatabaseConfig();
  if (dbConfig.isBlocked) {
    const idx = IN_MEMORY_CONTACTS.findIndex(c => c.id === contactId && (c.tenantId === rawTenantId || c.tenantId === tenantId));
    if (idx !== -1) {
      IN_MEMORY_CONTACTS.splice(idx, 1);
      res.json({ success: true, data: { id: contactId, deleted: true }, meta: { requestId } });
      return;
    }
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Contact not found.', requestId } });
    return;
  }

  try {
    const result = await pool.query(
      `DELETE FROM contacts WHERE id::text = $1 AND tenant_id = $2 RETURNING id;`,
      [contactId, tenantId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Contact not found.', requestId } });
      return;
    }

    res.json({ success: true, data: { id: contactId, deleted: true }, meta: { requestId } });
  } catch (error: any) {
    if (error.name === 'DatabaseSafetyError') {
      res.status(503).json({ success: false, error: { code: 'DATABASE_SAFETY_BLOCKED', message: error.message, requestId } });
      return;
    }
    res.status(500).json({ success: false, error: { code: 'DATABASE_ERROR', message: error.message, requestId } });
  }
});

export default router;
