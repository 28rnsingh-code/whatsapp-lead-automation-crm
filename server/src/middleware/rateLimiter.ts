import rateLimit from 'express-rate-limit';

/**
 * Login Rate Limiter.
 * Protects against brute force and credential stuffing attacks.
 * In development/test mode, window and limit are tuned to allow automated testing while enforcing limits.
 */
export const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === 'test' ? 10 : 5, // 5 requests per 15 min (10 in test)
  standardHeaders: true, // Return standard `RateLimit-*` headers
  legacyHeaders: false,
  handler: (req, res) => {
    const requestId = req.requestId || 'req_unknown';
    res.status(429).json({
      success: false,
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many login attempts. Please try again in 15 minutes.',
        requestId,
      },
    });
  },
});
