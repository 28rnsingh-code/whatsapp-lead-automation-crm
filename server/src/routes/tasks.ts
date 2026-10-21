import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { requireTenant } from '../middleware/tenant';
import { pool, resolveDatabaseConfig } from '../db';
import { DEFAULT_TENANT_ID, DEFAULT_USER_ID } from '../db/seed';

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

// In-memory task store for fallback and tests
const IN_MEMORY_TASKS: any[] = [
  {
    id: 't-default-1',
    tenantId: 'tenant_bring_my_bite',
    leadName: 'Amit Sharma',
    company: 'Sharma Industries',
    title: 'Initial Discovery Call',
    taskType: 'Call',
    dueAt: new Date(Date.now() + 2 * 3600 * 1000).toISOString(),
    priority: 'High',
    status: 'Pending',
    completed: false,
    ownerName: 'Rohan Singh',
    createdAt: new Date().toISOString(),
  },
  {
    id: 't-default-2',
    tenantId: 'tenant_bring_my_bite',
    leadName: 'Neha Gupta',
    company: 'Gupta Tech',
    title: 'WhatsApp Follow-up on Proposal',
    taskType: 'WhatsApp follow-up',
    dueAt: new Date(Date.now() + 5 * 3600 * 1000).toISOString(),
    priority: 'Medium',
    status: 'Pending',
    completed: false,
    ownerName: 'Rohan Singh',
    createdAt: new Date().toISOString(),
  },
  {
    id: 't-default-3',
    tenantId: 'tenant_bring_my_bite',
    leadName: 'Sanjay Kumar',
    company: 'SK Retail',
    title: 'Overdue Follow-up Call',
    taskType: 'Call',
    dueAt: new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
    priority: 'High',
    status: 'Pending',
    completed: false,
    ownerName: 'Rohan Singh',
    createdAt: new Date().toISOString(),
  },
];

// Helper to determine task category based on due date
function categorizeTask(dueAt: string, status: string): 'Overdue' | 'Today' | 'Upcoming' {
  if (status === 'Completed') return 'Upcoming';
  const dueDate = new Date(dueAt);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

  if (dueDate < startOfToday) {
    return 'Overdue';
  } else if (dueDate <= endOfToday) {
    return 'Today';
  }
  return 'Upcoming';
}

// 1. List Tasks (Tenant Isolated)
router.get('/', requireAuth, requireTenant(), async (req: Request, res: Response): Promise<void> => {
  const tenantId = toDbTenantId(req.tenantContext!.tenantId);
  const rawTenantId = req.tenantContext!.tenantId;
  const dbConfig = resolveDatabaseConfig();

  if (dbConfig.isBlocked) {
    const filtered = IN_MEMORY_TASKS
      .filter(t => t.tenantId === rawTenantId || t.tenantId === tenantId)
      .map(t => ({
        ...t,
        category: categorizeTask(t.dueAt, t.status),
      }));

    res.json({
      success: true,
      data: filtered,
      meta: { totalCount: filtered.length, requestId: req.requestId },
    });
    return;
  }

  try {
    const result = await pool.query(
      `SELECT 
        t.id, t.tenant_id as "tenantId", t.lead_id as "leadId", t.title,
        t.task_type as "taskType", t.due_at as "dueAt", t.priority, t.status,
        t.completed_at as "completedAt", t.created_at as "createdAt",
        COALESCE(l.name, 'Unlinked Contact') as "leadName",
        COALESCE(l.company_name, '') as "company",
        COALESCE(u.display_name, 'Rohan Singh') as "ownerName"
      FROM tasks t
      LEFT JOIN leads l ON l.id = t.lead_id
      LEFT JOIN users u ON u.id = t.owner_user_id
      WHERE t.tenant_id = $1
      ORDER BY t.due_at ASC;`,
      [tenantId]
    );

    const formatted = result.rows.map((row: any) => ({
      ...row,
      completed: row.status === 'Completed',
      category: categorizeTask(row.dueAt, row.status),
    }));

    res.json({
      success: true,
      data: formatted,
      meta: {
        totalCount: formatted.length,
        requestId: req.requestId,
      },
    });
  } catch (error: any) {
    const filtered = IN_MEMORY_TASKS.filter(t => t.tenantId === rawTenantId || t.tenantId === tenantId);
    res.json({
      success: true,
      data: filtered,
      meta: { totalCount: filtered.length, requestId: req.requestId },
    });
  }
});

// 2. Create Task (Tenant Isolated)
router.post('/', requireAuth, requireTenant(), async (req: Request, res: Response): Promise<void> => {
  const tenantId = toDbTenantId(req.tenantContext!.tenantId);
  const rawTenantId = req.tenantContext!.tenantId;
  const userId = req.userId || DEFAULT_USER_ID;
  const { title, leadId, leadName, company, taskType = 'Call', dueAt, priority = 'Medium' } = req.body;
  const requestId = req.requestId || 'req_unknown';

  if (!title || !title.trim()) {
    res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Task title is required.',
        requestId,
      },
    });
    return;
  }

  const resolvedDueAt = dueAt || new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  const dbConfig = resolveDatabaseConfig();

  if (dbConfig.isBlocked) {
    const newTask = {
      id: `task-${Date.now()}`,
      tenantId: rawTenantId,
      title: title.trim(),
      leadId: leadId || undefined,
      leadName: leadName || 'Direct Task',
      company: company || '',
      taskType,
      dueAt: resolvedDueAt,
      priority,
      status: 'Pending',
      completed: false,
      ownerName: 'Rohan Singh',
      createdAt: new Date().toISOString(),
      category: categorizeTask(resolvedDueAt, 'Pending'),
    };
    IN_MEMORY_TASKS.unshift(newTask);
    res.status(201).json({ success: true, data: newTask, meta: { requestId } });
    return;
  }

  try {
    const result = await pool.query(
      `INSERT INTO tasks (
        tenant_id, lead_id, title, task_type, owner_user_id, due_at, priority, status, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'Pending', $8)
      RETURNING *;`,
      [
        tenantId,
        leadId || null,
        title.trim(),
        taskType,
        userId,
        resolvedDueAt,
        priority,
        userId,
      ]
    );

    const row = result.rows[0];

    // Log activity on lead if leadId present
    if (leadId) {
      await pool.query(
        `INSERT INTO activities (tenant_id, entity_type, entity_id, activity_type, actor_user_id, summary)
         VALUES ($1, 'lead', $2, 'task_scheduled', $3, $4);`,
        [tenantId, leadId, userId, `Scheduled follow-up ${taskType}: "${title}" due on ${new Date(resolvedDueAt).toLocaleString()}`]
      ).catch(() => {});
    }

    res.status(201).json({
      success: true,
      data: {
        ...row,
        leadName: leadName || 'Linked Lead',
        company: company || '',
        completed: false,
        category: categorizeTask(row.due_at, row.status),
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
      error: { code: 'DATABASE_ERROR', message: error.message, requestId },
    });
  }
});

// 3. Update Task Status (Complete / Toggle / Reschedule)
router.patch('/:id', requireAuth, requireTenant(), async (req: Request, res: Response): Promise<void> => {
  const tenantId = toDbTenantId(req.tenantContext!.tenantId);
  const taskId = req.params.id;
  const { status, dueAt, priority, title, completed } = req.body;
  const requestId = req.requestId || 'req_unknown';
  const dbConfig = resolveDatabaseConfig();

  const effectiveStatus = status !== undefined 
    ? status 
    : (completed !== undefined ? (completed ? 'Completed' : 'Pending') : undefined);

  if (dbConfig.isBlocked) {
    const match = IN_MEMORY_TASKS.find(t => t.id === taskId);
    if (!match) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Task not found', requestId } });
      return;
    }
    if (effectiveStatus !== undefined) {
      match.status = effectiveStatus;
      match.completed = effectiveStatus === 'Completed';
    }
    if (dueAt !== undefined) match.dueAt = dueAt;
    if (priority !== undefined) match.priority = priority;
    if (title !== undefined) match.title = title;
    match.category = categorizeTask(match.dueAt, match.status);
    res.json({ success: true, data: match, meta: { requestId } });
    return;
  }

  try {
    const completedAt = effectiveStatus === 'Completed' ? new Date().toISOString() : null;
    const result = await pool.query(
      `UPDATE tasks SET
        status = COALESCE($1, status),
        completed_at = CASE WHEN $1 = 'Completed' THEN NOW() ELSE completed_at END,
        due_at = COALESCE($2, due_at),
        priority = COALESCE($3, priority),
        title = COALESCE($4, title)
      WHERE id = $5 AND tenant_id = $6
      RETURNING *;`,
      [effectiveStatus || null, dueAt || null, priority || null, title || null, taskId, tenantId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Task not found in this workspace.', requestId },
      });
      return;
    }

    const row = result.rows[0];
    res.json({
      success: true,
      data: {
        ...row,
        completed: row.status === 'Completed',
        category: categorizeTask(row.due_at, row.status),
      },
      meta: { requestId },
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: { code: 'DATABASE_ERROR', message: error.message, requestId },
    });
  }
});

// 4. Delete Task
router.delete('/:id', requireAuth, requireTenant(), async (req: Request, res: Response): Promise<void> => {
  const tenantId = toDbTenantId(req.tenantContext!.tenantId);
  const taskId = req.params.id;
  const requestId = req.requestId || 'req_unknown';
  const dbConfig = resolveDatabaseConfig();

  if (dbConfig.isBlocked) {
    const idx = IN_MEMORY_TASKS.findIndex(t => t.id === taskId);
    if (idx !== -1) IN_MEMORY_TASKS.splice(idx, 1);
    res.json({ success: true, data: { message: 'Task removed.' }, meta: { requestId } });
    return;
  }

  try {
    await pool.query(`DELETE FROM tasks WHERE id = $1 AND tenant_id = $2;`, [taskId, tenantId]);
    res.json({
      success: true,
      data: { message: 'Task successfully removed.' },
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
