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

// GET /api/dashboard/stats - Tenant-scoped real KPIs from PostgreSQL
router.get('/stats', requireAuth, requireTenant(), async (req: Request, res: Response): Promise<void> => {
  const tenantId = toDbTenantId(req.tenantContext!.tenantId);
  const requestId = req.requestId || 'req_unknown';
  const dbConfig = resolveDatabaseConfig();

  if (dbConfig.isBlocked) {
    res.json({
      success: true,
      data: {
        totalLeads: 0,
        pipelineValue: 0,
        currency: 'INR',
        activeFollowups: 0,
        overdueTasks: 0,
        wonLeadsCount: 0,
        conversionRate: 0,
        stageBreakdown: [],
        sourceBreakdown: [],
      },
      meta: { requestId },
    });
    return;
  }

  try {
    // 1. Leads KPI
    const leadsKpi = await pool.query(
      `SELECT 
         COUNT(*) as total_leads,
         COALESCE(SUM(deal_value_minor_units), 0) as total_deal_value,
         COUNT(CASE WHEN ps.is_won = true THEN 1 END) as won_leads
       FROM leads l
       LEFT JOIN pipeline_stages ps ON ps.id = l.stage_id
       WHERE l.tenant_id = $1;`,
      [tenantId]
    );

    const totalLeads = parseInt(leadsKpi.rows[0].total_leads, 10) || 0;
    const totalDealValueMinor = Number(leadsKpi.rows[0].total_deal_value) || 0;
    const wonLeadsCount = parseInt(leadsKpi.rows[0].won_leads, 10) || 0;
    const conversionRate = totalLeads > 0 ? Math.round((wonLeadsCount / totalLeads) * 100) : 0;

    // 2. Tasks KPI
    const tasksKpi = await pool.query(
      `SELECT 
         COUNT(CASE WHEN status != 'Completed' THEN 1 END) as active_tasks,
         COUNT(CASE WHEN status != 'Completed' AND due_at < NOW() THEN 1 END) as overdue_tasks
       FROM tasks
       WHERE tenant_id = $1;`,
      [tenantId]
    );

    const activeFollowups = parseInt(tasksKpi.rows[0].active_tasks, 10) || 0;
    const overdueTasks = parseInt(tasksKpi.rows[0].overdue_tasks, 10) || 0;

    // 3. Stage breakdown
    const stageBreakdownResult = await pool.query(
      `SELECT 
         COALESCE(ps.name, 'Unassigned') as stage,
         COALESCE(ps.color_token, '#64748b') as color,
         COUNT(l.id) as count,
         COALESCE(SUM(l.deal_value_minor_units), 0) as total_value
       FROM pipeline_stages ps
       LEFT JOIN leads l ON l.stage_id = ps.id AND l.tenant_id = $1
       WHERE ps.tenant_id = $1
       GROUP BY ps.id, ps.name, ps.color_token, ps.sort_order
       ORDER BY ps.sort_order ASC;`,
      [tenantId]
    );

    // 4. Source breakdown
    const sourceBreakdownResult = await pool.query(
      `SELECT 
         source,
         COUNT(*) as count
       FROM leads
       WHERE tenant_id = $1
       GROUP BY source
       ORDER BY count DESC;`,
      [tenantId]
    );

    res.json({
      success: true,
      data: {
        totalLeads,
        pipelineValue: Math.round(totalDealValueMinor / 100),
        currency: 'INR',
        activeFollowups,
        overdueTasks,
        wonLeadsCount,
        conversionRate,
        stageBreakdown: stageBreakdownResult.rows.map((r: any) => ({
          stage: r.stage,
          color: r.color,
          count: parseInt(r.count, 10),
          totalValue: Math.round(Number(r.total_value) / 100),
        })),
        sourceBreakdown: sourceBreakdownResult.rows.map((r: any) => ({
          source: r.source,
          count: parseInt(r.count, 10),
        })),
      },
      meta: { requestId },
    });
  } catch (error: any) {
    res.json({
      success: true,
      data: {
        totalLeads: 0,
        pipelineValue: 0,
        currency: 'INR',
        activeFollowups: 0,
        overdueTasks: 0,
        wonLeadsCount: 0,
        conversionRate: 0,
        stageBreakdown: [],
        sourceBreakdown: [],
      },
      meta: { requestId },
    });
  }
});

export default router;
