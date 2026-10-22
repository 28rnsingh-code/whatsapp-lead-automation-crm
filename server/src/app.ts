import express, { Express, Request } from 'express';
import cors from 'cors';
import { requestIdMiddleware, errorHandler } from './middleware/errorHandler';
import healthRoutes from './routes/health';
import authRoutes from './routes/auth';
import workspaceRoutes from './routes/workspaces';
import leadRoutes from './routes/leads';
import pipelineRoutes from './routes/pipeline';
import importExportRoutes from './routes/importExport';
import taskRoutes from './routes/tasks';
import contactRoutes from './routes/contacts';
import dashboardRoutes from './routes/dashboard';
import whatsappRoutes from './routes/whatsapp';
import aiRoutes from './routes/ai';
import reportRoutes from './routes/reports';
import billingRoutes from './routes/billing';
import teamRoutes from './routes/team';
import auditRoutes from './routes/audit';
import { auditMutationMiddleware } from './middleware/audit';
import integrationsRoutes from './routes/integrations';

export function createApp(): Express {
  const app = express();
  app.set('trust proxy', 1);

  // In production, browsers may call the API only from explicitly configured frontend origins.
  // Local development keeps the Vite proxy convenient; non-browser clients need no Origin header.
  const allowedOrigins = (process.env.CORS_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.use(cors({
    origin(origin, callback) {
      if (!origin || process.env.NODE_ENV !== 'production') {
        callback(null, true);
        return;
      }
      callback(null, allowedOrigins.includes(origin));
    },
  }));
  app.use(express.json({
    limit: '15mb',
    verify: (req, _res, buffer) => {
      // Meta webhook signatures are calculated over the exact bytes sent by Meta.
      (req as Request & { rawBody?: Buffer }).rawBody = Buffer.from(buffer);
    },
  }));
  app.use(express.urlencoded({ extended: true, limit: '15mb' }));
  app.use(requestIdMiddleware);
  app.use(auditMutationMiddleware);

  // Mount API Routes
  app.use('/api', healthRoutes);
  app.use('/api/auth', authRoutes);
  app.use('/api/workspaces', workspaceRoutes);
  app.use('/api/leads', leadRoutes);
  app.use('/api/pipeline', pipelineRoutes);
  app.use('/api/tasks', taskRoutes);
  app.use('/api/contacts', contactRoutes);
  app.use('/api/dashboard', dashboardRoutes);
  app.use('/api/whatsapp', whatsappRoutes);
  app.use('/api/ai', aiRoutes);
  app.use('/api/reports', reportRoutes);
  app.use('/api/billing', billingRoutes);
  app.use('/api/integrations', integrationsRoutes);
  app.use('/api/team', teamRoutes);
  app.use('/api/audit', auditRoutes);
  app.use('/api/import', importExportRoutes);
  app.use('/api', importExportRoutes); // also mounts /api/export/leads

  // 404 handler for unknown API routes
  app.use('/api/*', (req, res) => {
    res.status(404).json({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: `Endpoint ${req.method} ${req.originalUrl} not found.`,
        requestId: req.requestId || 'req_unknown',
      },
    });
  });

  // Central Error Handler
  app.use(errorHandler);

  return app;
}

export const app = createApp();
