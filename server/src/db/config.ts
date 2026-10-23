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

function blocked(connectionString: string, databaseName: string, isTestEnvironment: boolean, blockReason: string): DatabaseConfig {
  return { connectionString, databaseName, isTestEnvironment, isBlocked: true, blockReason };
}

/** Fail closed when database configuration is missing, malformed, or unsafe. */
function validatePostgresUrl(connectionString: string, productionRuntime: boolean): string | undefined {
  if (!connectionString.trim()) {
    return 'DATABASE_URL is not configured. Set it in the hosting environment before starting the API.';
  }

  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    return 'DATABASE_URL is not a valid URL.';
  }

  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    return 'DATABASE_URL must use the postgres:// or postgresql:// protocol.';
  }

  const databaseName = parseDatabaseName(connectionString);
  if (!url.hostname || !databaseName) {
    return 'DATABASE_URL must include a PostgreSQL host and database name.';
  }

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  let user = '';
  let password = '';
  try {
    user = decodeURIComponent(url.username || '').toLowerCase();
    password = decodeURIComponent(url.password || '').toLowerCase();
  } catch {
    return 'DATABASE_URL contains malformed URL-encoded credentials.';
  }

  const placeholders = ['postgres_password', 'your_password', 'changeme', 'replace_me', 'your-host', 'example.invalid'];
  if (
    placeholders.some((value) => password === value || user === value || hostname === value) ||
    password.includes('replace_me') ||
    password.includes('your_password')
  ) {
    return 'DATABASE_URL contains placeholder credentials or a placeholder host. Configure real database credentials in the hosting environment.';
  }

  const localHosts = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0']);
  if (productionRuntime && (localHosts.has(hostname) || hostname.endsWith('.localhost'))) {
    return 'DATABASE_URL points to a local/loopback host in production. Configure the remote production PostgreSQL endpoint.';
  }

  return undefined;
}

/** Tests can connect only to databases whose name explicitly identifies them as isolated test databases. */
export function resolveDatabaseConfig(): DatabaseConfig {
  const isTest = process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';

  if (isTest) {
    const testDbUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_TEST_URL;
    if (testDbUrl) {
      const testDbName = parseDatabaseName(testDbUrl);
      if (isSharedDevelopmentDatabase(testDbName)) {
        return blocked(
          testDbUrl,
          testDbName,
          true,
          `Safety guard violation: TEST_DATABASE_URL points to the shared development database '${SHARED_DEV_DB_NAME}'. Automated tests must never write to or access the development database. Please specify a dedicated test database (e.g. '${DEFAULT_TEST_DB_NAME}').`,
        );
      }
      if (!isDedicatedTestDatabase(testDbName)) {
        return blocked(
          testDbUrl,
          testDbName,
          true,
          `Safety guard violation: Target database '${testDbName}' is not recognized as a dedicated test database (expected name ending with '_test'). Automated tests must use a dedicated test database.`,
        );
      }
      const validationError = validatePostgresUrl(testDbUrl, false);
      if (validationError) return blocked(testDbUrl, testDbName, true, validationError);
      return { connectionString: testDbUrl, databaseName: testDbName, isTestEnvironment: true, isBlocked: false };
    }

    const fallbackUrl = process.env.DATABASE_URL || '';
    const fallbackDbName = parseDatabaseName(fallbackUrl);
    if (!fallbackUrl || !fallbackDbName || isSharedDevelopmentDatabase(fallbackDbName)) {
      return blocked(
        fallbackUrl,
        fallbackDbName || SHARED_DEV_DB_NAME,
        true,
        `Safety guard violation: Automated tests are configured to use shared development database '${SHARED_DEV_DB_NAME}'. Tests must never write to the shared development database. Please configure a dedicated test database via TEST_DATABASE_URL (e.g. '${DEFAULT_TEST_DB_NAME}').`,
      );
    }

    if (!isDedicatedTestDatabase(fallbackDbName)) {
      return blocked(
        fallbackUrl,
        fallbackDbName,
        true,
        `Safety guard violation: Target database '${fallbackDbName}' is not recognized as a dedicated test database (expected name ending with '_test'). Automated tests must use a dedicated test database.`,
      );
    }

    const validationError = validatePostgresUrl(fallbackUrl, false);
    if (validationError) return blocked(fallbackUrl, fallbackDbName, true, validationError);
    return { connectionString: fallbackUrl, databaseName: fallbackDbName, isTestEnvironment: true, isBlocked: false };
  }

  const productionRuntime = process.env.NODE_ENV === 'production' || process.env.VERCEL === '1';
  const connectionString = process.env.DATABASE_URL || '';
  const databaseName = parseDatabaseName(connectionString);
  const validationError = validatePostgresUrl(connectionString, productionRuntime);
  if (validationError) return blocked(connectionString, databaseName, false, validationError);

  return { connectionString, databaseName, isTestEnvironment: false, isBlocked: false };
}
