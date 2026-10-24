import express, { Express } from 'express';
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

export function createApp(): Express {
  const app = express();

  // Vercel terminates the client connection at its trusted edge proxy. Trust one
  // proxy hop so express-rate-limit can safely resolve the client IP from forwarded headers.
  app.set('trust proxy', 1);

  // Standard Middlewares
  app.use(cors());
  app.use(express.json({ limit: '15mb' }));
  app.use(express.urlencoded({ extended: true, limit: '15mb' }));
  app.use(requestIdMiddleware);

  // Send browser visitors to the CRM portal. Keep API endpoints under /api.
  // The portal URL is configured per Vercel environment, never hard-coded in app logic.
  app.get('/', (_req, res) => {
    const portalUrl = process.env.CRM_PORTAL_URL?.trim();
    if (!portalUrl) {
      res.status(503).json({
        success: false,
        error: {
          code: 'CRM_PORTAL_URL_NOT_CONFIGURED',
          message: 'The CRM portal destination is not configured for this deployment.',
        },
      });
      return;
    }
    try {
      const destination = new URL(portalUrl);
      if (destination.protocol !== 'https:' || !destination.hostname.endsWith('.vercel.app')) {
        res.status(503).json({
          success: false,
          error: {
            code: 'CRM_PORTAL_URL_INVALID',
            message: 'The CRM portal destination must be a verified HTTPS Vercel deployment URL.',
          },
        });
        return;
      }
      res.redirect(302, destination.toString());
    } catch {
      res.status(503).json({
        success: false,
        error: {
          code: 'CRM_PORTAL_URL_INVALID',
          message: 'The CRM portal destination is not a valid URL.',
        },
      });
    }
  });

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

// Vercel's Express function adapter expects a default-exported handler.
export default app;
