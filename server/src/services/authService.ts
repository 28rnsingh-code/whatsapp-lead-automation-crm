import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

// If no JWT_SECRET is configured in environment, generate an in-memory 64-byte random key
// This guarantees signatures cannot be forged using default/empty secrets.
const FALLBACK_SECRET = crypto.randomBytes(64).toString('hex');
const JWT_SECRET = process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 32
  ? process.env.JWT_SECRET
  : FALLBACK_SECRET;

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('CRITICAL SECURITY ERROR: JWT_SECRET environment variable must be at least 32 characters long in production.');
  }
}

export interface AuthTokenPayload {
  userId: string;
  email: string;
  defaultTenantId?: string;
  iat?: number;
  exp?: number;
}

/**
 * Hash a plain text password using bcrypt with standard work factor 12.
 */
export async function hashPassword(plainText: string): Promise<string> {
  const salt = await bcrypt.genSalt(12);
  return bcrypt.hash(plainText, salt);
}

/**
 * Compare plain text password against a bcrypt hash.
 * Resistant to timing attacks.
 */
export async function verifyPassword(plainText: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plainText, hash);
}

/**
 * Sign a cryptographic JWT with explicit algorithm, expiration, and payload.
 */
export function signToken(
  payload: Omit<AuthTokenPayload, 'iat' | 'exp'>,
  expiresIn: string = process.env.JWT_EXPIRES_IN || '24h'
): string {
  return jwt.sign(payload, JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: expiresIn as any,
  });
}

/**
 * Verify and decode a JWT token.
 * Throws JsonWebTokenError or TokenExpiredError on invalid signature or expiration.
 */
export function verifyToken(token: string): AuthTokenPayload {
  return jwt.verify(token, JWT_SECRET, {
    algorithms: ['HS256'],
  }) as AuthTokenPayload;
}
