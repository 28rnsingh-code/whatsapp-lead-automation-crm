import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { requireTenant } from '../middleware/tenant';
import { Tenant } from '../types';

const router = Router();

const WORKSPACES: Tenant[] = [
  {
    id: 'tenant_bring_my_bite',
    name: 'Bring My Bite',
    slug: 'bring-my-bite',
    status: 'active',
    timezone: 'Asia/Kolkata',
    currency: 'INR',
    locale: 'en-IN',
    createdAt: '2026-01-15T09:00:00Z',
    updatedAt: '2026-01-15T09:00:00Z',
  },
  {
    id: 'tenant_automics_labs',
    name: 'Automics Labs',
    slug: 'automics-labs',
    status: 'active',
    timezone: 'Asia/Kolkata',
    currency: 'INR',
    locale: 'en-IN',
    createdAt: '2026-02-01T10:00:00Z',
    updatedAt: '2026-02-01T10:00:00Z',
  },
];

// List user's available workspaces
router.get('/', requireAuth, (req: Request, res: Response) => {
  res.json({
    success: true,
    data: WORKSPACES,
    meta: {
      totalCount: WORKSPACES.length,
      requestId: req.requestId,
    },
  });
});

// Get current workspace details (enforcing tenant isolation)
router.get('/current', requireAuth, requireTenant(), (req: Request, res: Response) => {
  const currentTenant = WORKSPACES.find(w => w.id === req.tenantContext?.tenantId) || WORKSPACES[0];
  res.json({
    success: true,
    data: currentTenant,
    meta: {
      requestId: req.requestId,
    },
  });
});

export default router;
