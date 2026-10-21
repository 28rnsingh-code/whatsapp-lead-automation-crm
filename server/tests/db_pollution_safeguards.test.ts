import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { app } from '../src/app';
import {
  pool,
  query,
  resolveDatabaseConfig,
  DatabaseSafetyError,
  SHARED_DEV_DB_NAME,
  DEFAULT_TEST_DB_NAME,
  parseDatabaseName,
  isSharedDevelopmentDatabase,
  isDedicatedTestDatabase,
} from '../src/db';
import { verifyDatabaseConnection } from '../src/db/verifyConnection';
import { signToken } from '../src/services/authService';

describe('Database Pollution Prevention & Test Safety Safeguards', () => {
  const originalEnv = { ...process.env };

  const rohanToken = signToken({
    userId: 'user_rohan_singh',
    email: 'rohan@bringmybite.in',
    defaultTenantId: 'tenant_bring_my_bite',
  });

  beforeEach(() => {
    // Preserve base test environment
    process.env.NODE_ENV = 'test';
  });

  afterEach(() => {
    // Restore environment variables after each test case
    process.env.TEST_DATABASE_URL = originalEnv.TEST_DATABASE_URL;
    process.env.DATABASE_URL = originalEnv.DATABASE_URL;
    process.env.NODE_ENV = originalEnv.NODE_ENV;
  });

  describe('1. Database Name & Classifier Safety Invariants', () => {
    it('correctly parses target database name from PostgreSQL connection strings', () => {
      expect(parseDatabaseName('postgresql://oneclick_dev:pass@localhost:5434/oneclick_crm')).toBe('oneclick_crm');
      expect(parseDatabaseName('postgresql://postgres:pass@localhost:5432/oneclick_crm_test?sslmode=disable')).toBe('oneclick_crm_test');
      expect(parseDatabaseName('postgresql://localhost/crm_testing')).toBe('crm_testing');
      expect(parseDatabaseName('')).toBe('');
      expect(parseDatabaseName(undefined)).toBe('');
    });

    it('strictly identifies shared development database name "oneclick_crm"', () => {
      expect(isSharedDevelopmentDatabase('oneclick_crm')).toBe(true);
      expect(isSharedDevelopmentDatabase('ONECLICK_CRM')).toBe(true);
      expect(isSharedDevelopmentDatabase('oneclick_crm_test')).toBe(false);
      expect(isSharedDevelopmentDatabase('test_db')).toBe(false);
      expect(isSharedDevelopmentDatabase('')).toBe(false);
    });

    it('strictly identifies dedicated test database naming patterns', () => {
      expect(isDedicatedTestDatabase('oneclick_crm_test')).toBe(true);
      expect(isDedicatedTestDatabase('test_oneclick_crm')).toBe(true);
      expect(isDedicatedTestDatabase('crm_test_isolated')).toBe(true);
      expect(isDedicatedTestDatabase('oneclick_crm')).toBe(false);
      expect(isDedicatedTestDatabase('production_crm')).toBe(false);
    });
  });

  describe('2. Fail-Safe Guard on Test Configuration Pointing to Development Database', () => {
    it('proves normal test run with default DATABASE_URL pointing to oneclick_crm is strictly blocked', () => {
      delete process.env.TEST_DATABASE_URL;
      delete process.env.DATABASE_TEST_URL;
      process.env.DATABASE_URL = 'postgresql://oneclick_dev:DevPass2026SecureCrmKey99@localhost:5434/oneclick_crm';

      const config = resolveDatabaseConfig();
      expect(config.isTestEnvironment).toBe(true);
      expect(config.isBlocked).toBe(true);
      expect(config.databaseName).toBe(SHARED_DEV_DB_NAME);
      expect(config.blockReason).toContain(`Automated tests are configured to use shared development database '${SHARED_DEV_DB_NAME}'`);
    });

    it('proves safety guard blocks execution if TEST_DATABASE_URL points to shared development database', () => {
      process.env.TEST_DATABASE_URL = 'postgresql://oneclick_dev:DevPass2026SecureCrmKey99@localhost:5434/oneclick_crm';

      const config = resolveDatabaseConfig();
      expect(config.isTestEnvironment).toBe(true);
      expect(config.isBlocked).toBe(true);
      expect(config.databaseName).toBe(SHARED_DEV_DB_NAME);
      expect(config.blockReason).toContain('TEST_DATABASE_URL points to the shared development database');
    });

    it('proves safety guard allows execution when TEST_DATABASE_URL points to dedicated test database', () => {
      process.env.TEST_DATABASE_URL = 'postgresql://oneclick_dev:DevPass2026SecureCrmKey99@localhost:5434/oneclick_crm_test';

      const config = resolveDatabaseConfig();
      expect(config.isTestEnvironment).toBe(true);
      expect(config.isBlocked).toBe(false);
      expect(config.databaseName).toBe('oneclick_crm_test');
      expect(config.blockReason).toBeUndefined();
    });

    it('proves safety guard rejects non-test database names in test mode', () => {
      delete process.env.TEST_DATABASE_URL;
      process.env.DATABASE_URL = 'postgresql://localhost:5432/arbitrary_prod_database';

      const config = resolveDatabaseConfig();
      expect(config.isBlocked).toBe(true);
      expect(config.blockReason).toContain('not recognized as a dedicated test database');
    });
  });

  describe('3. Dynamic Query & Pool Interception Safeguards', () => {
    it('proves pool.query() rejects with DatabaseSafetyError when pointing to development database', async () => {
      delete process.env.TEST_DATABASE_URL;
      process.env.DATABASE_URL = 'postgresql://localhost:5434/oneclick_crm';

      await expect(pool.query('SELECT * FROM leads;')).rejects.toThrow(DatabaseSafetyError);
    });

    it('proves parameterized query() rejects with DatabaseSafetyError when pointing to development database', async () => {
      delete process.env.TEST_DATABASE_URL;
      process.env.DATABASE_URL = 'postgresql://localhost:5434/oneclick_crm';

      await expect(query('SELECT id FROM tenants WHERE id = $1;', ['any-id'])).rejects.toThrow(DatabaseSafetyError);
    });

    it('proves pool.connect() rejects with DatabaseSafetyError when pointing to development database', async () => {
      delete process.env.TEST_DATABASE_URL;
      process.env.DATABASE_URL = 'postgresql://localhost:5434/oneclick_crm';

      await expect(pool.connect()).rejects.toThrow(DatabaseSafetyError);
    });

    it('proves verifyDatabaseConnection() pre-flight fails safely when tests point to development database', async () => {
      delete process.env.TEST_DATABASE_URL;
      process.env.DATABASE_URL = 'postgresql://oneclick_dev:DevPass2026SecureCrmKey99@localhost:5434/oneclick_crm';

      const res = await verifyDatabaseConnection();
      expect(res.connected).toBe(false);
      expect(res.targetDatabase).toBe(SHARED_DEV_DB_NAME);
      expect(res.error).toContain('Safety guard violation');
    });
  });

  describe('4. Proof Normal "npm test" Runs Cannot Pollute oneclick_crm', () => {
    it('HTTP POST /api/leads must be blocked from writing to oneclick_crm during automated tests', async () => {
      delete process.env.TEST_DATABASE_URL;
      process.env.DATABASE_URL = 'postgresql://oneclick_dev:DevPass2026SecureCrmKey99@localhost:5434/oneclick_crm';

      const res = await request(app)
        .post('/api/leads')
        .set('Authorization', `Bearer ${rohanToken}`)
        .set('x-tenant-id', 'tenant_bring_my_bite')
        .send({
          name: 'Should Never Persist',
          phoneRaw: '+919988776655',
          companyName: 'Pollution Test Corp',
        });

      // Writes are intercepted and rejected with 503 DATABASE_SAFETY_BLOCKED
      expect(res.status).toBe(503);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('DATABASE_SAFETY_BLOCKED');
      expect(res.body.error.message).toContain('Safety guard violation');
    });

    it('HTTP GET /api/leads safely returns empty dataset without querying blocked development database', async () => {
      delete process.env.TEST_DATABASE_URL;
      process.env.DATABASE_URL = 'postgresql://oneclick_dev:DevPass2026SecureCrmKey99@localhost:5434/oneclick_crm';

      const res = await request(app)
        .get('/api/leads')
        .set('Authorization', `Bearer ${rohanToken}`)
        .set('x-tenant-id', 'tenant_bring_my_bite');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBe(0);
      expect(res.body.meta.totalCount).toBe(0);
    });
  });
});
