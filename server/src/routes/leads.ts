import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { requireTenant } from '../middleware/tenant';
import { Lead } from '../types';
import { pool } from '../db';
import { DEFAULT_TENANT_ID, DEFAULT_USER_ID } from '../db/seed';

const router = Router();

const TENANT_UUID_MAP: Record<string, string> = {
  tenant_bring_my_bite: DEFAULT_TENANT_ID,
  tenant_automics_labs: 'a0000000-0000-0000-0000-000000000002',
};

// Helper to normalize tenant ID to database UUID
function toDbTenantId(id: string): string {
  // Friendly tenant aliases exist only for legacy isolated test fixtures.
  if (process.env.NODE_ENV === 'test' && TENANT_UUID_MAP[id]) return TENANT_UUID_MAP[id];
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (uuidRegex.test(id)) return id;
  return '00000000-0000-0000-0000-000000000000';
}

function fromDbTenantId(id: string): string {
  if (id === DEFAULT_TENANT_ID) {
    return 'tenant_bring_my_bite';
  }
  if (id === 'a0000000-0000-0000-0000-000000000002') {
    return 'tenant_automics_labs';
  }
  return id;
}

function toDbUserId(id?: string): string | null {
  if (!id) return null;
  // Legacy identity is used only by isolated development/test fixtures.
  if (id === 'user_rohan_singh' && process.env.NODE_ENV === 'test') return DEFAULT_USER_ID;
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (uuidRegex.test(id)) return id;
  return null;
}

// 1. List Leads (Strictly Tenant-Isolated from PostgreSQL)
router.get('/', requireAuth, requireTenant(), async (req: Request, res: Response): Promise<void> => {
  const tenantId = toDbTenantId(req.tenantContext!.tenantId);
  const { q, stage, source, owner, page = '1', pageSize = '10' } = req.query;

  try {
    const params: any[] = [tenantId];
    let whereClauses = ['l.tenant_id = $1'];

    // Search query filter
    if (q && typeof q === 'string' && q.trim()) {
      params.push(`%${q.trim()}%`);
      const qIndex = params.length;
      whereClauses.push(
        `(l.name ILIKE $${qIndex} OR l.phone_raw ILIKE $${qIndex} OR l.email ILIKE $${qIndex} OR l.company_name ILIKE $${qIndex})`
      );
    }

    // Stage filter
    if (stage && typeof stage === 'string' && stage !== 'All') {
      params.push(stage);
      const sIndex = params.length;
      whereClauses.push(`(ps.name = $${sIndex} OR l.stage_id::text = $${sIndex})`);
    }

    // Source filter
    if (source && typeof source === 'string' && source !== 'All') {
      params.push(source);
      const srcIndex = params.length;
      whereClauses.push(`l.source = $${srcIndex}`);
    }

    const whereSql = whereClauses.join(' AND ');

    // Total Count Query
    const countResult = await pool.query<{ count: string }>(
      `SELECT COUNT(*) as count 
       FROM leads l
       LEFT JOIN pipeline_stages ps ON ps.id = l.stage_id
       WHERE ${whereSql};`,
      params
    );
    const totalCount = parseInt(countResult.rows[0].count, 10);

    // Pagination
    const p = Math.max(1, parseInt(page as string, 10) || 1);
    const ps = Math.min(Math.max(1, parseInt(pageSize as string, 10) || 10), 100);
    const offset = (p - 1) * ps;
    const totalPages = Math.ceil(totalCount / ps) || 1;

    // Fetch Page
    params.push(ps, offset);
    const limitIndex = params.length - 1;
    const offsetIndex = params.length;

    const listResult = await pool.query(
      `SELECT 
         l.id,
         l.tenant_id as "tenantIdRaw",
         l.name,
         l.phone_raw as "phoneRaw",
         l.phone_normalized as "phoneNormalized",
         l.email,
         l.company_name as "companyName",
         l.source,
         l.stage_id as "stageId",
         COALESCE(ps.name, 'New') as "stageName",
         COALESCE(ps.color_token, '#155eef') as "stageColor",
         l.qualification_status as "qualificationStatus",
         l.owner_user_id as "ownerUserId",
         COALESCE(u.display_name, 'Unassigned') as "ownerName",
         l.deal_value_minor_units as "dealValueMinorUnits",
         l.currency,
         l.next_action as "nextAction",
         l.follow_up_at as "followUpAt",
         l.consent_status as "consentStatus",
         l.notes,
         l.created_at as "createdAt",
         l.updated_at as "updatedAt"
       FROM leads l
       LEFT JOIN pipeline_stages ps ON ps.id = l.stage_id
       LEFT JOIN users u ON u.id = l.owner_user_id
       WHERE ${whereSql}
       ORDER BY l.created_at DESC
       LIMIT $${limitIndex} OFFSET $${offsetIndex};`,
      params
    );

    const formattedRows = listResult.rows.map((row: any) => ({
      ...row,
      tenantId: fromDbTenantId(row.tenantIdRaw),
      dealValueMinorUnits: Number(row.dealValueMinorUnits),
    }));

    res.json({
      success: true,
      data: formattedRows,
      meta: {
        page: p,
        pageSize: ps,
        totalCount,
        totalPages,
        requestId: req.requestId,
      },
    });
  } catch (error: any) {
    const requestId = req.requestId || 'req_unknown';
    if (error?.name === 'DatabaseSafetyError') {
      res.status(503).json({
        success: false,
        error: {
          code: 'DATABASE_SAFETY_BLOCKED',
          message: 'Database access is blocked by the active safety policy.',
          requestId,
        },
      });
      return;
    }
    const unavailable = typeof error?.code === 'string'
      && (/^08/.test(error.code) || ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EHOSTUNREACH', '57P01', '57P02', '57P03', '53300'].includes(error.code));
    if (unavailable) {
      res.status(503).json({
        success: false,
        error: {
          code: 'DATABASE_UNAVAILABLE',
          message: 'The database is temporarily unavailable. Please retry shortly.',
          requestId,
        },
      });
      return;
    }
    console.error('[Leads API] Error fetching leads from PostgreSQL:', error?.message || 'Unknown error');
    res.status(500).json({
      success: false,
      error: {
        code: 'DATABASE_ERROR',
        message: 'Failed to retrieve leads from database.',
        requestId,
      },
    });
  }
});

// 2. Create Lead (Direct Parameterized INSERT into PostgreSQL)
router.post('/', requireAuth, requireTenant(), async (req: Request, res: Response): Promise<void> => {
  const tenantId = toDbTenantId(req.tenantContext!.tenantId);
  const { name, phoneRaw, email, companyName, source, stageId, dealValue, notes, nextAction } = req.body;
  const requestId = req.requestId || 'req_unknown';

  // Validation
  const errors: Record<string, string[]> = {};
  if (!name || !name.trim()) errors.name = ['Name is required.'];
  if (!phoneRaw || !phoneRaw.trim()) errors.phoneRaw = ['Phone number is required.'];

  if (Object.keys(errors).length > 0) {
    res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid lead payload. Please correct the highlighted fields.',
        details: errors,
        requestId,
      },
    });
    return;
  }

  // Normalize phone (prepend +91 if missing international prefix)
  const digits = phoneRaw.replace(/\D/g, '');
  const phoneNormalized = phoneRaw.trim().startsWith('+') ? `+${digits}` : `+91${digits}`;

  try {
    // Duplicate detection check within the tenant
    const duplicateCheck = await pool.query<{ id: string; name: string }>(
      `SELECT id, name FROM leads WHERE tenant_id = $1 AND phone_normalized = $2 LIMIT 1;`,
      [tenantId, phoneNormalized]
    );

    if (duplicateCheck.rows.length > 0 && !req.query.allowDuplicate) {
      const dup = duplicateCheck.rows[0];
      res.status(409).json({
        success: false,
        error: {
          code: 'DUPLICATE_LEAD',
          message: `A lead with phone number ${phoneRaw} already exists (${dup.name}).`,
          details: { existingLeadId: dup.id },
          requestId,
        },
      });
      return;
    }

    // Resolve stage_id to a valid UUID from pipeline_stages
    let targetStageId: string | null = null;
    let targetStageName = 'New';
    let targetStageColor = '#155eef';
    if (stageId) {
      const stageLookup = await pool.query<{ id: string; name: string; color_token: string }>(
        `SELECT id, name, color_token FROM pipeline_stages WHERE tenant_id = $1 AND (id::text = $2 OR name = $2) LIMIT 1;`,
        [tenantId, stageId]
      );
      if (stageLookup.rows.length > 0) {
        targetStageId = stageLookup.rows[0].id;
        targetStageName = stageLookup.rows[0].name;
        targetStageColor = stageLookup.rows[0].color_token;
      }
    }

    // Fall back to first stage for tenant if not resolved
    if (!targetStageId) {
      const defaultStage = await pool.query<{ id: string; name: string; color_token: string }>(
        `SELECT id, name, color_token FROM pipeline_stages WHERE tenant_id = $1 ORDER BY sort_order ASC LIMIT 1;`,
        [tenantId]
      );
      if (defaultStage.rows.length > 0) {
        targetStageId = defaultStage.rows[0].id;
        targetStageName = defaultStage.rows[0].name;
        targetStageColor = defaultStage.rows[0].color_token;
      }
    }

    const ownerUserId = toDbUserId(req.userId);
    const dealValueMinorUnits = dealValue ? Math.round(Number(dealValue) * 100) : 0;

    // Parameterized INSERT into PostgreSQL
    const insertResult = await pool.query(
      `INSERT INTO leads (
         tenant_id, name, phone_raw, phone_normalized, email, company_name,
         source, stage_id, qualification_status, owner_user_id,
         deal_value_minor_units, currency, next_action, consent_status, notes,
         created_by
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, 'In Review', $9, $10, 'INR', $11, 'Consented', $12, $13
       )
       RETURNING *;`,
      [
        tenantId,
        name.trim(),
        phoneRaw.trim(),
        phoneNormalized,
        email?.trim() || null,
        companyName?.trim() || null,
        source || 'Website',
        targetStageId,
        ownerUserId,
        dealValueMinorUnits,
        nextAction || 'Call',
        notes?.trim() || '',
        ownerUserId,
      ]
    );

    const created = insertResult.rows[0];

    // Record initial lead creation activity
    await pool.query(
      `INSERT INTO activities (
         tenant_id, entity_type, entity_id, activity_type, actor_user_id, summary
       ) VALUES (
         $1, 'lead', $2, 'lead_created', $3, $4
       );`,
      [
        tenantId,
        created.id,
        ownerUserId,
        `Lead created via ${created.source} with initial stage "${targetStageName}".`,
      ]
    ).catch((err) => {
      console.warn('[Leads API] Activity logging skipped:', err.message);
    });

    // Format response to match shared Lead contract
    const formattedLead: Lead = {
      id: created.id,
      tenantId: fromDbTenantId(created.tenant_id),
      name: created.name,
      phoneRaw: created.phone_raw,
      phoneNormalized: created.phone_normalized,
      email: created.email || undefined,
      companyName: created.company_name || undefined,
      source: created.source,
      stageId: created.stage_id,
      stageName: targetStageName,
      stageColor: targetStageColor,
      qualificationStatus: created.qualification_status,
      ownerUserId: created.owner_user_id || undefined,
      ownerName: req.userEmail || 'Unassigned',
      dealValueMinorUnits: Number(created.deal_value_minor_units),
      currency: created.currency,
      nextAction: created.next_action,
      consentStatus: created.consent_status,
      notes: created.notes || '',
      createdAt: created.created_at,
      updatedAt: created.updated_at,
      activities: [
        {
          id: 'act-initial',
          activityType: 'lead_created',
          summary: `Lead created via ${created.source} with initial stage "${targetStageName}".`,
          occurredAt: created.created_at,
          actorName: req.userEmail || 'System',
        },
      ],
    };

    res.status(201).json({
      success: true,
      data: formattedLead,
      meta: {
        requestId,
      },
    });
  } catch (error: any) {
    if (error.name === 'DatabaseSafetyError') {
      res.status(503).json({
        success: false,
        error: {
          code: 'DATABASE_SAFETY_BLOCKED',
          message: error.message,
          requestId,
        },
      });
      return;
    }
    console.error('[Leads API] Error creating lead in PostgreSQL:', error.message);
    res.status(500).json({
      success: false,
      error: {
        code: 'DATABASE_ERROR',
        message: 'Failed to create lead in PostgreSQL database.',
        requestId,
      },
    });
  }
});

// 3. Get Lead by ID (Strict Tenant Isolation from PostgreSQL)
router.get('/:id', requireAuth, requireTenant(), async (req: Request, res: Response): Promise<void> => {
  const tenantId = toDbTenantId(req.tenantContext!.tenantId);
  const leadId = req.params.id;

  try {
    const result = await pool.query(
      `SELECT 
         l.id,
         l.tenant_id as "tenantIdRaw",
         l.name,
         l.phone_raw as "phoneRaw",
         l.phone_normalized as "phoneNormalized",
         l.email,
         l.company_name as "companyName",
         l.source,
         l.stage_id as "stageId",
         COALESCE(ps.name, 'New') as "stageName",
         COALESCE(ps.color_token, '#155eef') as "stageColor",
         l.qualification_status as "qualificationStatus",
         l.owner_user_id as "ownerUserId",
         COALESCE(u.display_name, 'Rohan Singh') as "ownerName",
         l.deal_value_minor_units as "dealValueMinorUnits",
         l.currency,
         l.next_action as "nextAction",
         l.follow_up_at as "followUpAt",
         l.consent_status as "consentStatus",
         l.notes,
         l.created_at as "createdAt",
         l.updated_at as "updatedAt"
       FROM leads l
       LEFT JOIN pipeline_stages ps ON ps.id = l.stage_id
       LEFT JOIN users u ON u.id = l.owner_user_id
       WHERE l.id::text = $1 AND l.tenant_id = $2
       LIMIT 1;`,
      [leadId, tenantId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Lead not found in this workspace.',
          requestId: req.requestId || 'req_unknown',
        },
      });
      return;
    }

    const row = result.rows[0];

    // Fetch activities for this lead if available
    const activityResult = await pool.query(
      `SELECT 
         a.id,
         a.activity_type as "activityType",
         a.summary,
         a.occurred_at as "occurredAt",
         COALESCE(u.display_name, 'System') as "actorName"
       FROM activities a
       LEFT JOIN users u ON u.id = a.actor_user_id
       WHERE a.entity_id::text = $1 AND a.tenant_id = $2
       ORDER BY a.occurred_at DESC
       LIMIT 20;`,
      [leadId, tenantId]
    ).catch(() => ({ rows: [] }));

    const formattedLead: Lead = {
      ...row,
      tenantId: fromDbTenantId(row.tenantIdRaw),
      dealValueMinorUnits: Number(row.dealValueMinorUnits),
      activities: activityResult.rows,
    };

    res.json({
      success: true,
      data: formattedLead,
      meta: {
        requestId: req.requestId,
      },
    });
  } catch (error: any) {
    if (error?.name === 'DatabaseSafetyError') {
      res.status(503).json({
        success: false,
        error: {
          code: 'DATABASE_SAFETY_BLOCKED',
          message: 'Database access is blocked by the active safety policy.',
          requestId: req.requestId || 'req_unknown',
        },
      });
      return;
    }
    const unavailable = typeof error?.code === 'string'
      && (/^08/.test(error.code) || ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EHOSTUNREACH', '57P01', '57P02', '57P03', '53300'].includes(error.code));
    if (unavailable) {
      res.status(503).json({
        success: false,
        error: {
          code: 'DATABASE_UNAVAILABLE',
          message: 'The database is temporarily unavailable. Please retry shortly.',
          requestId: req.requestId || 'req_unknown',
        },
      });
      return;
    }
    console.error('[Leads API] Error fetching lead by id from PostgreSQL:', error?.message || 'Unknown error');
    res.status(500).json({
      success: false,
      error: {
        code: 'DATABASE_ERROR',
        message: 'Failed to retrieve lead.',
        requestId: req.requestId || 'req_unknown',
      },
    });
  }
});

// 4. Update Lead (PATCH /api/leads/:id)
router.patch('/:id', requireAuth, requireTenant(), async (req: Request, res: Response): Promise<void> => {
  const tenantId = toDbTenantId(req.tenantContext!.tenantId);
  const leadId = req.params.id;
  const requestId = req.requestId || 'req_unknown';
  const userId = toDbUserId(req.userId);

  try {
    // Check lead exists in tenant
    const existingResult = await pool.query(
      `SELECT * FROM leads WHERE id::text = $1 AND tenant_id = $2 LIMIT 1;`,
      [leadId, tenantId]
    );

    if (existingResult.rows.length === 0) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Lead not found in this workspace.', requestId },
      });
      return;
    }

    const current = existingResult.rows[0];
    const {
      name,
      phoneRaw,
      email,
      companyName,
      stageId,
      ownerUserId,
      qualificationStatus,
      dealValue,
      dealValueMinorUnits,
      nextAction,
      notes,
      followUpAt,
    } = req.body;

    // Build dynamic UPDATE fields
    const updates: string[] = ['updated_at = NOW()'];
    const values: any[] = [leadId, tenantId];

    if (name !== undefined) {
      values.push(name.trim());
      updates.push(`name = $${values.length}`);
    }

    if (phoneRaw !== undefined) {
      values.push(phoneRaw.trim());
      updates.push(`phone_raw = $${values.length}`);
      const digits = phoneRaw.replace(/\D/g, '');
      const phoneNorm = phoneRaw.trim().startsWith('+') ? `+${digits}` : `+91${digits}`;
      values.push(phoneNorm);
      updates.push(`phone_normalized = $${values.length}`);
    }

    if (email !== undefined) {
      values.push(email ? email.trim() : null);
      updates.push(`email = $${values.length}`);
    }

    if (companyName !== undefined) {
      values.push(companyName ? companyName.trim() : null);
      updates.push(`company_name = $${values.length}`);
    }

    let targetStageName: string | null = null;
    let targetStageColor: string | null = null;
    if (stageId !== undefined) {
      const stageLookup = await pool.query<{ id: string; name: string; color_token: string }>(
        `SELECT id, name, color_token FROM pipeline_stages WHERE tenant_id = $1 AND (id::text = $2 OR name = $2) LIMIT 1;`,
        [tenantId, stageId]
      );
      if (stageLookup.rows.length > 0) {
        values.push(stageLookup.rows[0].id);
        updates.push(`stage_id = $${values.length}`);
        targetStageName = stageLookup.rows[0].name;
        targetStageColor = stageLookup.rows[0].color_token;
      }
    }

    if (ownerUserId !== undefined) {
      values.push(toDbUserId(ownerUserId));
      updates.push(`owner_user_id = $${values.length}`);
    }

    if (qualificationStatus !== undefined) {
      values.push(qualificationStatus);
      updates.push(`qualification_status = $${values.length}`);
    }

    if (dealValue !== undefined || dealValueMinorUnits !== undefined) {
      const minor = dealValue !== undefined ? Math.round(Number(dealValue) * 100) : Number(dealValueMinorUnits);
      values.push(isNaN(minor) ? 0 : minor);
      updates.push(`deal_value_minor_units = $${values.length}`);
    }

    if (nextAction !== undefined) {
      values.push(nextAction);
      updates.push(`next_action = $${values.length}`);
    }

    if (notes !== undefined) {
      values.push(notes);
      updates.push(`notes = $${values.length}`);
    }

    if (followUpAt !== undefined) {
      values.push(followUpAt ? new Date(followUpAt) : null);
      updates.push(`follow_up_at = $${values.length}`);
    }

    const updateQuery = `
      UPDATE leads
      SET ${updates.join(', ')}
      WHERE id::text = $1 AND tenant_id = $2
      RETURNING *;
    `;

    const updateResult = await pool.query(updateQuery, values);
    const updated = updateResult.rows[0];

    // Log activity if stage changed
    if (targetStageName && targetStageName !== current.stage_name) {
      await pool.query(
        `INSERT INTO activities (tenant_id, entity_type, entity_id, activity_type, actor_user_id, summary)
         VALUES ($1, 'lead', $2, 'stage_changed', $3, $4);`,
        [tenantId, leadId, userId, `Stage transitioned to "${targetStageName}".`]
      ).catch(() => {});
    }

    // Format response
    const formattedLead: Lead = {
      id: updated.id,
      tenantId: fromDbTenantId(updated.tenant_id),
      name: updated.name,
      phoneRaw: updated.phone_raw,
      phoneNormalized: updated.phone_normalized,
      email: updated.email || undefined,
      companyName: updated.company_name || undefined,
      source: updated.source,
      stageId: updated.stage_id,
      stageName: targetStageName || 'New',
      stageColor: targetStageColor || '#155eef',
      qualificationStatus: updated.qualification_status,
      ownerUserId: updated.owner_user_id || undefined,
      ownerName: 'Rohan Singh',
      dealValueMinorUnits: Number(updated.deal_value_minor_units),
      currency: updated.currency,
      nextAction: updated.next_action,
      consentStatus: updated.consent_status,
      notes: updated.notes || '',
      createdAt: updated.created_at,
      updatedAt: updated.updated_at,
    };

    res.json({
      success: true,
      data: formattedLead,
      meta: { requestId },
    });
  } catch (error: any) {
    if (error.name === 'DatabaseSafetyError') {
      res.status(503).json({
        success: false,
        error: { code: 'DATABASE_SAFETY_BLOCKED', message: error.message, requestId },
      });
      return;
    }
    console.error('[Leads API] Error updating lead:', error.message);
    res.status(500).json({
      success: false,
      error: { code: 'DATABASE_ERROR', message: 'Failed to update lead.', requestId },
    });
  }
});

// 5. Delete / Archive Lead (DELETE /api/leads/:id)
router.delete('/:id', requireAuth, requireTenant(), async (req: Request, res: Response): Promise<void> => {
  const tenantId = toDbTenantId(req.tenantContext!.tenantId);
  const leadId = req.params.id;
  const requestId = req.requestId || 'req_unknown';

  try {
    const deleteResult = await pool.query(
      `DELETE FROM leads WHERE id::text = $1 AND tenant_id = $2 RETURNING id;`,
      [leadId, tenantId]
    );

    if (deleteResult.rows.length === 0) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Lead not found or already deleted.', requestId },
      });
      return;
    }

    res.json({
      success: true,
      data: { id: leadId, deleted: true },
      meta: { requestId },
    });
  } catch (error: any) {
    if (error.name === 'DatabaseSafetyError') {
      res.status(503).json({
        success: false,
        error: { code: 'DATABASE_SAFETY_BLOCKED', message: error.message, requestId },
      });
      return;
    }
    console.error('[Leads API] Error deleting lead:', error.message);
    res.status(500).json({
      success: false,
      error: { code: 'DATABASE_ERROR', message: 'Failed to delete lead.', requestId },
    });
  }
});

// 6. Add Activity / Note (POST /api/leads/:id/activities)
router.post('/:id/activities', requireAuth, requireTenant(), async (req: Request, res: Response): Promise<void> => {
  const tenantId = toDbTenantId(req.tenantContext!.tenantId);
  const leadId = req.params.id;
  const requestId = req.requestId || 'req_unknown';
  const userId = toDbUserId(req.userId);
  const { activityType = 'note_added', summary } = req.body;

  if (!summary || !summary.trim()) {
    res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'Activity summary or note content is required.', requestId },
    });
    return;
  }

  try {
    // Verify lead exists
    const leadCheck = await pool.query(
      `SELECT id FROM leads WHERE id::text = $1 AND tenant_id = $2;`,
      [leadId, tenantId]
    );

    if (leadCheck.rows.length === 0) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Lead not found in this workspace.', requestId },
      });
      return;
    }

    const insertResult = await pool.query(
      `INSERT INTO activities (tenant_id, entity_type, entity_id, activity_type, actor_user_id, summary)
       VALUES ($1, 'lead', $2, $3, $4, $5)
       RETURNING id, activity_type as "activityType", summary, occurred_at as "occurredAt";`,
      [tenantId, leadId, activityType, userId, summary.trim()]
    );

    res.status(201).json({
      success: true,
      data: {
        ...insertResult.rows[0],
        actorName: 'Rohan Singh',
      },
      meta: { requestId },
    });
  } catch (error: any) {
    if (error.name === 'DatabaseSafetyError') {
      res.status(503).json({
        success: false,
        error: { code: 'DATABASE_SAFETY_BLOCKED', message: error.message, requestId },
      });
      return;
    }
    res.status(500).json({
      success: false,
      error: { code: 'DATABASE_ERROR', message: 'Failed to add activity.', requestId },
    });
  }
});

export default router;
