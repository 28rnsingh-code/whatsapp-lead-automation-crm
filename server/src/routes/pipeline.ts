import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { requireTenant } from '../middleware/tenant';
import { PipelineStage } from '../types';
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

const DEFAULT_STAGES: PipelineStage[] = [
  { id: 'stage-new', tenantId: 'tenant_bring_my_bite', name: 'New', sortOrder: 1, colorToken: '#155eef', isWon: false, isLost: false, active: true },
  { id: 'stage-contacted', tenantId: 'tenant_bring_my_bite', name: 'Contacted', sortOrder: 2, colorToken: '#2e90fa', isWon: false, isLost: false, active: true },
  { id: 'stage-qualified', tenantId: 'tenant_bring_my_bite', name: 'Qualified', sortOrder: 3, colorToken: '#7a5af8', isWon: false, isLost: false, active: true },
  { id: 'stage-proposal', tenantId: 'tenant_bring_my_bite', name: 'Proposal', sortOrder: 4, colorToken: '#f79009', isWon: false, isLost: false, active: true },
  { id: 'stage-won', tenantId: 'tenant_bring_my_bite', name: 'Won', sortOrder: 5, colorToken: '#12b76a', isWon: true, isLost: false, active: true },
  { id: 'stage-lost', tenantId: 'tenant_bring_my_bite', name: 'Lost', sortOrder: 6, colorToken: '#f04438', isWon: false, isLost: true, active: true },
];

// GET /api/pipeline/stages - Load dynamically from tenant database configuration
router.get('/stages', requireAuth, requireTenant(), async (req: Request, res: Response): Promise<void> => {
  const tenantId = toDbTenantId(req.tenantContext!.tenantId);
  const rawTenantId = req.tenantContext!.tenantId;
  const requestId = req.requestId || 'req_unknown';
  const dbConfig = resolveDatabaseConfig();

  if (dbConfig.isBlocked) {
    res.json({
      success: true,
      data: DEFAULT_STAGES.map(s => ({ ...s, tenantId: rawTenantId })),
      meta: { totalCount: DEFAULT_STAGES.length, requestId },
    });
    return;
  }

  try {
    const result = await pool.query(
      `SELECT 
         id, tenant_id as "tenantId", name, sort_order as "sortOrder",
         color_token as "colorToken", is_won as "isWon", is_lost as "isLost", active
       FROM pipeline_stages
       WHERE tenant_id = $1 AND active = true
       ORDER BY sort_order ASC;`,
      [tenantId]
    );

    if (result.rows.length === 0) {
      res.json({
        success: true,
        data: DEFAULT_STAGES.map(s => ({ ...s, tenantId: rawTenantId })),
        meta: { totalCount: DEFAULT_STAGES.length, requestId },
      });
      return;
    }

    res.json({
      success: true,
      data: result.rows,
      meta: { totalCount: result.rows.length, requestId },
    });
  } catch (error: any) {
    res.json({
      success: true,
      data: DEFAULT_STAGES.map(s => ({ ...s, tenantId: rawTenantId })),
      meta: { totalCount: DEFAULT_STAGES.length, requestId },
    });
  }
});

// POST /api/pipeline/stages - Add custom stage
router.post('/stages', requireAuth, requireTenant(), async (req: Request, res: Response): Promise<void> => {
  const tenantId = toDbTenantId(req.tenantContext!.tenantId);
  const { name, colorToken = '#155eef', sortOrder, isWon = false, isLost = false } = req.body;
  const requestId = req.requestId || 'req_unknown';

  if (!name || !name.trim()) {
    res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'Stage name is required.', requestId },
    });
    return;
  }

  const dbConfig = resolveDatabaseConfig();
  if (dbConfig.isBlocked) {
    res.status(503).json({
      success: false,
      error: { code: 'DATABASE_SAFETY_BLOCKED', message: 'Test database safety block active.', requestId },
    });
    return;
  }

  try {
    const maxOrder = sortOrder !== undefined ? sortOrder : 99;
    const result = await pool.query(
      `INSERT INTO pipeline_stages (tenant_id, name, color_token, sort_order, is_won, is_lost, active)
       VALUES ($1, $2, $3, $4, $5, $6, true)
       RETURNING id, tenant_id as "tenantId", name, sort_order as "sortOrder", color_token as "colorToken", is_won as "isWon", is_lost as "isLost", active;`,
      [tenantId, name.trim(), colorToken, maxOrder, isWon, isLost]
    );

    res.status(201).json({
      success: true,
      data: result.rows[0],
      meta: { requestId },
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: { code: 'DATABASE_ERROR', message: error.message, requestId },
    });
  }
});

export default router;
