import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

/**
 * Request ID Middleware.
 * Generates an immutable, traceable request ID for every incoming request.
 */
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incomingId = req.headers['x-request-id'] as string;
  const requestId = incomingId || `req_${crypto.randomBytes(8).toString('hex')}`;
  req.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);
  next();
}

/**
 * Standard Error Handling Middleware.
 * Prevents stack trace / secret leakage and ensures uniform JSON error structure.
 */
export function errorHandler(
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const requestId = req.requestId || 'req_unknown';
  const statusCode = err.status || err.statusCode || 500;
  
  // Safe error logging
  console.error(`[API Error] [${requestId}] ${err.message}`, {
    url: req.originalUrl,
    method: req.method,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
  });

  res.status(statusCode).json({
    success: false,
    error: {
      code: err.code || (statusCode === 500 ? 'INTERNAL_SERVER_ERROR' : 'API_ERROR'),
      message: err.message || 'An unexpected error occurred. Please try again.',
      details: err.details || undefined,
      requestId,
    },
  });
}
