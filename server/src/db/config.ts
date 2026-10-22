export const SHARED_DEV_DB_NAME = 'oneclick_crm';
export const DEFAULT_TEST_DB_NAME = 'oneclick_crm_test';

export class DatabaseSafetyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DatabaseSafetyError';
  }
}

export function parseDatabaseName(connectionString?: string): string {
  if (!connectionString) return '';
  try {
    const url = new URL(connectionString);
    if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') return '';
    return decodeURIComponent(url.pathname.replace(/^\//, '').split('?')[0].trim());
  } catch {
    return '';
  }
}

export function isSharedDevelopmentDatabase(dbName: string): boolean {
  return Boolean(dbName) && dbName.trim().toLowerCase() === SHARED_DEV_DB_NAME.toLowerCase();
}

export function isDedicatedTestDatabase(dbName: string): boolean {
  if (!dbName) return false;
  const lower = dbName.trim().toLowerCase();
  if (isSharedDevelopmentDatabase(lower)) return false;
  return lower.endsWith('_test') || lower.startsWith('test_') || lower.includes('_test_');
}

export interface DatabaseConfig {
  connectionString: string;
  databaseName: string;
  isTestEnvironment: boolean;
  isBlocked: boolean;
  blockReason?: string;
}

function blocked(
  connectionString: string,
  databaseName: string,
  isTestEnvironment: boolean,
  blockReason: string,
): DatabaseConfig {
  return { connectionString, databaseName, isTestEnvironment, isBlocked: true, blockReason };
}

function validateConnectionString(connectionString: string): string | undefined {
  if (!connectionString.trim()) return 'DATABASE_URL is not set. Configure it in the runtime environment.';
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    return 'DATABASE_URL is not a valid URL.';
  }

  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    return 'DATABASE_URL must use the postgres:// or postgresql:// protocol.';
  }
  if (!url.hostname || !url.username || !url.password) {
    return 'DATABASE_URL must include a database host, username, and password.';
  }

  const placeholderValues = [
    'postgres_password',
    'your_password',
    'password',
    'changeme',
    'replace_me',
    'your-host',
    'localhost',
  ];
  const user = decodeURIComponent(url.username).toLowerCase();
  const password = decodeURIComponent(url.password).toLowerCase();
  const host = url.hostname.toLowerCase();

  if (
    placeholderValues.some((value) => password === value || user === value || host === value) ||
    password.includes('replace_me') ||
    password.includes('your_password')
  ) {
    return 'DATABASE_URL contains placeholder credentials or a placeholder host. Set real credentials in your secret environment configuration.';
  }

  if (!parseDatabaseName(connectionString)) {
    return 'DATABASE_URL must include a database name in its path.';
  }

  return undefined;
}

/**
 * Resolve database settings without silently falling back to shared or fake credentials.
 * Automated tests must use a database explicitly named as a test database.
 */
export function resolveDatabaseConfig(): DatabaseConfig {
  const isTest = process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';
  const configuredUrl = isTest
    ? (process.env.TEST_DATABASE_URL || process.env.DATABASE_TEST_URL || process.env.DATABASE_URL || '')
    : (process.env.DATABASE_URL || '');

  const databaseName = parseDatabaseName(configuredUrl);
  const validationError = validateConnectionString(configuredUrl);

  if (validationError) {
    return blocked(configuredUrl, databaseName, isTest, validationError);
  }

  if (isTest) {
    if (isSharedDevelopmentDatabase(databaseName)) {
      return blocked(
        configuredUrl,
        databaseName,
        true,
        `Safety guard: automated tests must never use the shared development database '${SHARED_DEV_DB_NAME}'. Set TEST_DATABASE_URL to a dedicated test database such as '${DEFAULT_TEST_DB_NAME}'.`,
      );
    }

    if (!isDedicatedTestDatabase(databaseName)) {
      return blocked(
        configuredUrl,
        databaseName,
        true,
        `Safety guard: test database '${databaseName}' is not clearly marked as a test database. Use a database name ending in '_test' or starting with 'test_'.`,
      );
    }
  }

  return {
    connectionString: configuredUrl,
    databaseName,
    isTestEnvironment: isTest,
    isBlocked: false,
  };
}
