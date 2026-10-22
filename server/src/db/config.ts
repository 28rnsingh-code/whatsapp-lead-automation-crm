import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';

export const SHARED_DEV_DB_NAME = 'oneclick_crm';
export const DEFAULT_TEST_DB_NAME = 'oneclick_crm_test';

export class DatabaseSafetyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DatabaseSafetyError';
  }
}

/**
 * Extracts database name from PostgreSQL connection URL.
 * Example: 'postgresql://user:pass@localhost:5432/oneclick_crm?sslmode=disable' -> 'oneclick_crm'
 */
export function parseDatabaseName(connectionString?: string): string {
  if (!connectionString) return '';
  try {
    const url = new URL(connectionString);
    const db = url.pathname.replace(/^\//, '').split('?')[0].trim();
    return db;
  } catch {
    return '';
  }
}

/**
 * Supabase exposes one database per project named "postgres".
 * Only allow that database name when the host is clearly a Supabase direct or pooler endpoint;
 * local/default postgres databases remain blocked by the migration preflight.
 */
export function isAllowedDatabaseTarget(databaseName: string, hostname: string): boolean {
  const database = databaseName.trim().toLowerCase();
  const host = hostname.trim().toLowerCase();
  if (!database || !host) return false;
  if (database !== 'postgres') return true;
  return host.endsWith('.supabase.co') || host.endsWith('.pooler.supabase.com');
}

/**
 * Checks if target database is the shared development database.
 */
export function isSharedDevelopmentDatabase(dbName: string): boolean {
  if (!dbName) return false;
  return dbName.trim().toLowerCase() === SHARED_DEV_DB_NAME.toLowerCase();
}

/**
 * Checks if database name qualifies as a dedicated test database.
 * Rules:
 * 1. Must not be the shared development database.
 * 2. Must contain an explicit test indicator (e.g. ends with '_test' or starts with 'test_').
 */
export function isDedicatedTestDatabase(dbName: string): boolean {
  if (!dbName) return false;
  const lower = dbName.trim().toLowerCase();
  if (lower === SHARED_DEV_DB_NAME.toLowerCase()) return false;
  return lower.endsWith('_test') || lower.startsWith('test_') || lower.includes('_test_');
}

export interface DatabaseConfig {
  connectionString: string;
  databaseName: string;
  isTestEnvironment: boolean;
  isBlocked: boolean;
  blockReason?: string;
}

/**
 * Resolves active database configuration and enforces safety invariants:
 * - Tests must NEVER connect or write to the shared development database ('oneclick_crm').
 * - Prefers TEST_DATABASE_URL over DATABASE_URL in test mode.
 * - Fails safely if test configuration points to the development database.
 */
export function resolveDatabaseConfig(): DatabaseConfig {
  const isTest = process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';

  if (isTest) {
    // 1. Check for dedicated test database environment variable
    const testDbUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_TEST_URL;
    if (testDbUrl) {
      const testDbName = parseDatabaseName(testDbUrl);
      if (isSharedDevelopmentDatabase(testDbName)) {
        return {
          connectionString: testDbUrl,
          databaseName: testDbName,
          isTestEnvironment: true,
          isBlocked: true,
          blockReason: `Safety guard violation: TEST_DATABASE_URL points to the shared development database '${SHARED_DEV_DB_NAME}'. Automated tests must never write to or access the development database. Please specify a dedicated test database (e.g. '${DEFAULT_TEST_DB_NAME}').`,
        };
      }
      return {
        connectionString: testDbUrl,
        databaseName: testDbName,
        isTestEnvironment: true,
        isBlocked: false,
      };
    }

    // 2. If TEST_DATABASE_URL is not set, check fallback DATABASE_URL
    const fallbackUrl = process.env.DATABASE_URL;
    const fallbackDbName = parseDatabaseName(fallbackUrl);

    // If pointing to shared development database 'oneclick_crm' (or not configured), FAIL SAFELY!
    if (!fallbackUrl || !fallbackDbName || isSharedDevelopmentDatabase(fallbackDbName)) {
      return {
        connectionString: fallbackUrl || '',
        databaseName: fallbackDbName || SHARED_DEV_DB_NAME,
        isTestEnvironment: true,
        isBlocked: true,
        blockReason: `Safety guard violation: Automated tests are configured to use shared development database '${SHARED_DEV_DB_NAME}'. Tests must never write to the shared development database. Please configure a dedicated test database via TEST_DATABASE_URL (e.g. '${DEFAULT_TEST_DB_NAME}').`,
      };
    }

    // If fallbackUrl points to an explicit test database (e.g. oneclick_crm_test)
    if (isDedicatedTestDatabase(fallbackDbName)) {
      return {
        connectionString: fallbackUrl,
        databaseName: fallbackDbName,
        isTestEnvironment: true,
        isBlocked: false,
      };
    }

    // Any other database in test mode that is not explicitly named with a test prefix/suffix is blocked safely
    return {
      connectionString: fallbackUrl,
      databaseName: fallbackDbName,
      isTestEnvironment: true,
      isBlocked: true,
      blockReason: `Safety guard violation: Target database '${fallbackDbName}' is not recognized as a dedicated test database (expected name ending with '_test'). Automated tests must use a dedicated test database.`,
    };
  }

  // No non-test runtime may guess a database endpoint or silently connect to a shared local database.
  const configuredUrl = process.env.DATABASE_URL?.trim();
  if (!configuredUrl) {
    throw new Error('CRITICAL CONFIGURATION ERROR: Set DATABASE_URL to a newly provisioned, isolated CRM database before starting the server.');
  }
  const parsed = new URL(configuredUrl);
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !parsed.hostname || !parsed.pathname.replace(/^\//, '')) {
    throw new Error('CRITICAL CONFIGURATION ERROR: DATABASE_URL is not a valid PostgreSQL connection URL.');
  }

  return {
    connectionString: configuredUrl,
    databaseName: parseDatabaseName(configuredUrl),
    isTestEnvironment: false,
    isBlocked: false,
  };
}
