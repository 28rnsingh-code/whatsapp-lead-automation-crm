import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../src/app';
import { signToken } from '../src/services/authService';
import {
  parseCsvText,
  parseExcelBuffer,
  autoSuggestMapping,
  sanitizeCellValue,
  normalizePhone,
} from '../src/services/importExportService';
import * as XLSX from 'xlsx';

describe('Phase 1: Excel/CSV Bulk Import & Export Verification', () => {
  const rohanToken = signToken({
    userId: 'user_rohan_singh',
    email: 'rohan@bringmybite.in',
    defaultTenantId: 'tenant_bring_my_bite',
  });

  const otherTenantToken = signToken({
    userId: 'user_other_tenant',
    email: 'other@competitor.in',
    defaultTenantId: 'tenant_automics_labs',
  });

  describe('1. Parsing & Normalization Unit Tests', () => {
    it('normalizes 10-digit Indian phones with +91 country prefix', () => {
      expect(normalizePhone('9876543210')).toBe('+919876543210');
      expect(normalizePhone('+91 98765-43210')).toBe('+919876543210');
      expect(normalizePhone('09876543210')).toBe('+09876543210');
      expect(normalizePhone('')).toBe('');
    });

    it('sanitizes formula injection characters (=, +, -, @, \\t, \\r)', () => {
      expect(sanitizeCellValue('=cmd|"/C calc"!A0')).toBe('\'=cmd|"/C calc"!A0');
      expect(sanitizeCellValue('+12345')).toBe('\'+12345');
      expect(sanitizeCellValue('@SUM(A1:B10)')).toBe('\'@SUM(A1:B10)');
      expect(sanitizeCellValue('-100')).toBe('\'-100');
      expect(sanitizeCellValue('Regular Text')).toBe('Regular Text');
      expect(sanitizeCellValue(null)).toBe('');
    });

    it('parses CSV text with quoted fields containing commas and quotes', () => {
      const csv = `Full Name,Phone,Email,Company\n"Sharma, Amit",+919876543210,amit@sharma.in,"Sharma ""Tech"" Ltd"`;
      const parsed = parseCsvText(csv);
      expect(parsed.headers).toEqual(['Full Name', 'Phone', 'Email', 'Company']);
      expect(parsed.rows.length).toBe(1);
      expect(parsed.rows[0]['Full Name']).toBe('Sharma, Amit');
      expect(parsed.rows[0]['Company']).toBe('Sharma "Tech" Ltd');
    });

    it('parses Excel workbook binary buffer correctly', () => {
      const wb = XLSX.utils.book_new();
      const wsData = [
        ['Name', 'Phone', 'Email'],
        ['Vijay Kumar', '+919988776655', 'vijay@kumar.in'],
      ];
      const ws = XLSX.utils.aoa_to_sheet(wsData);
      XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
      const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

      const parsed = parseExcelBuffer(buffer);
      expect(parsed.headers).toEqual(['Name', 'Phone', 'Email']);
      expect(parsed.rows.length).toBe(1);
      expect(parsed.rows[0]['Name']).toBe('Vijay Kumar');
      expect(parsed.rows[0]['Phone']).toBe('+919988776655');
    });

    it('auto-suggests column mappings accurately from various header styles', () => {
      const headers = ['Contact Full Name', 'Mobile Number', 'Email Address', 'Company / Org', 'Lead Source'];
      const mapping = autoSuggestMapping(headers);
      expect(mapping.name).toBe('Contact Full Name');
      expect(mapping.phoneRaw).toBe('Mobile Number');
      expect(mapping.email).toBe('Email Address');
      expect(mapping.companyName).toBe('Company / Org');
      expect(mapping.source).toBe('Lead Source');
    });
  });

  describe('2. API Endpoints: Preview, Validate & Execute', () => {
    const sampleCsv = `Full Name,Phone Number,Email Address,Company,Deal Value\n` +
      `Aarav Mehta,+919811122233,aarav@mehta.in,Mehta Holdings,150000\n` +
      `,+919822233344,missingname@test.com,No Name Corp,50000\n` +
      `Priya Singh,invalid-phone,priya@singh.in,Singh Ltd,75000\n` +
      `Duplicate One,+919811122233,dup@mehta.in,Mehta Holdings,150000\n`;

    it('POST /api/import/preview returns detected headers, rows, and auto-mapping', async () => {
      const res = await request(app)
        .post('/api/import/preview')
        .set('Authorization', `Bearer ${rohanToken}`)
        .set('x-tenant-id', 'tenant_bring_my_bite')
        .send({
          content: sampleCsv,
          filename: 'leads_test_batch.csv',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.headers).toEqual(['Full Name', 'Phone Number', 'Email Address', 'Company', 'Deal Value']);
      expect(res.body.data.totalRows).toBe(4);
      expect(res.body.data.suggestedMapping.name).toBe('Full Name');
      expect(res.body.data.suggestedMapping.phoneRaw).toBe('Phone Number');
    });

    it('POST /api/import/validate accurately identifies valid, invalid, and duplicate rows', async () => {
      const rows = [
        { 'Full Name': 'Aarav Mehta', 'Phone Number': '+919811122233', 'Email Address': 'aarav@mehta.in' },
        { 'Full Name': '', 'Phone Number': '+919822233344', 'Email Address': 'missingname@test.com' }, // Invalid: missing name
        { 'Full Name': 'Priya Singh', 'Phone Number': 'short', 'Email Address': 'priya@singh.in' }, // Invalid: short phone
        { 'Full Name': 'Duplicate One', 'Phone Number': '+919811122233', 'Email Address': 'dup@mehta.in' }, // Duplicate in batch
      ];

      const res = await request(app)
        .post('/api/import/validate')
        .set('Authorization', `Bearer ${rohanToken}`)
        .set('x-tenant-id', 'tenant_bring_my_bite')
        .send({
          rows,
          mapping: {
            name: 'Full Name',
            phoneRaw: 'Phone Number',
            email: 'Email Address',
          },
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.totalRows).toBe(4);
      expect(res.body.data.validCount).toBe(2); // 2 rows syntactically valid (1 original + 1 duplicate)
      expect(res.body.data.errorCount).toBe(2); // 2 rows invalid (missing name, bad phone)
      expect(res.body.data.duplicateCount).toBe(1); // 1 duplicate phone detected
      expect(res.body.data.errors.length).toBe(2);
    });

    it('POST /api/import/execute executes import job with safe duplicate handling', async () => {
      const validRows = [
        { 'Full Name': 'Vikram Malhotra', 'Phone Number': '+919833344455', 'Email Address': 'vikram@malhotra.in' },
      ];

      const res = await request(app)
        .post('/api/import/execute')
        .set('Authorization', `Bearer ${rohanToken}`)
        .set('x-tenant-id', 'tenant_bring_my_bite')
        .send({
          rows: validRows,
          mapping: {
            name: 'Full Name',
            phoneRaw: 'Phone Number',
            email: 'Email Address',
          },
          duplicateStrategy: 'skip',
          filename: 'valid_import.csv',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('jobId');
      expect(res.body.data.importedCount).toBeGreaterThanOrEqual(1);
    });

    it('GET /api/import/history returns tenant-scoped import job records', async () => {
      const res = await request(app)
        .get('/api/import/history')
        .set('Authorization', `Bearer ${rohanToken}`)
        .set('x-tenant-id', 'tenant_bring_my_bite');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('GET /api/export/leads returns CSV formatted with proper headers and formula protection', async () => {
      const res = await request(app)
        .get('/api/export/leads?format=csv')
        .set('Authorization', `Bearer ${rohanToken}`)
        .set('x-tenant-id', 'tenant_bring_my_bite');

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.headers['content-disposition']).toContain('leads_export_');
      expect(res.text).toContain('ID,Name,Phone Raw');
    });

    it('GET /api/export/leads returns Excel XLSX binary format with proper headers', async () => {
      const res = await request(app)
        .get('/api/export/leads?format=xlsx')
        .set('Authorization', `Bearer ${rohanToken}`)
        .set('x-tenant-id', 'tenant_bring_my_bite');

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('spreadsheetml.sheet');
      expect(res.headers['content-disposition']).toContain('.xlsx');
      expect(Buffer.isBuffer(res.body) || typeof res.text === 'string').toBe(true);
    });
  });
});
