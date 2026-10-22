import * as XLSX from 'xlsx';
import { pool, withTransaction, resolveDatabaseConfig } from '../db';
import { DEFAULT_TENANT_ID, DEFAULT_USER_ID } from '../db/seed';

export interface RowError {
  rowNumber: number;
  field: string;
  error: string;
  rowData: Record<string, any>;
}

export interface DuplicateMatch {
  rowNumber: number;
  name: string;
  phoneNormalized: string;
  existingLeadId?: string;
}

export interface ColumnMapping {
  name: string;
  phoneRaw: string;
  email?: string;
  companyName?: string;
  source?: string;
  stageName?: string;
  dealValue?: string;
  nextAction?: string;
  notes?: string;
}

export type DuplicateStrategy = 'skip' | 'update' | 'import_non_duplicates';

// Sanitizes cell values to prevent CSV / Excel formula injection vulnerabilities (=, +, -, @)
export function sanitizeCellValue(val: any): string {
  if (val === null || val === undefined) return '';
  const str = String(val).trim();
  if (/^[=+\-@\t\r]/.test(str)) {
    return `'${str}`;
  }
  return str;
}

/**
 * Normalizes phone numbers for India-first CRM (+91 standard, strips symbols).
 */
export function normalizePhone(raw: string): string {
  if (!raw) return '';
  const digits = raw.replace(/\D/g, '');
  if (raw.trim().startsWith('+')) {
    return `+${digits}`;
  }
  if (digits.length === 10) {
    return `+91${digits}`;
  }
  if (digits.length === 12 && digits.startsWith('91')) {
    return `+${digits}`;
  }
  return digits ? `+${digits}` : '';
}

/**
 * Parses raw CSV content safely into rows and columns.
 */
export function parseCsvText(csvText: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = csvText.split(/\r?\n/).filter(line => line.trim().length > 0);
  if (lines.length === 0) {
    return { headers: [], rows: [] };
  }

  // Basic robust CSV line parser respecting quotes
  function parseLine(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current.trim());
    return result;
  }

  const rawHeaders = parseLine(lines[0]);
  const headers = rawHeaders.map(h => h.replace(/^["']|["']$/g, '').trim());

  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseLine(lines[i]);
    const rowObj: Record<string, string> = {};
    headers.forEach((header, index) => {
      rowObj[header] = values[index] !== undefined ? values[index] : '';
    });
    rows.push(rowObj);
  }

  return { headers, rows };
}

/**
 * Parses Excel / spreadsheet binary buffer.
 */
export function parseExcelBuffer(buffer: Buffer): { headers: string[]; rows: Record<string, string>[] } {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const firstSheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[firstSheetName];
  if (!worksheet) {
    return { headers: [], rows: [] };
  }

  const jsonData: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
  if (jsonData.length === 0) {
    return { headers: [], rows: [] };
  }

  const headers = jsonData[0].map(h => String(h).trim()).filter(Boolean);
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < jsonData.length; i++) {
    const rawRow = jsonData[i];
    if (!rawRow || rawRow.every((val: any) => val === '' || val === null || val === undefined)) {
      continue;
    }
    const rowObj: Record<string, string> = {};
    headers.forEach((header, colIndex) => {
      rowObj[header] = rawRow[colIndex] !== undefined ? String(rawRow[colIndex]).trim() : '';
    });
    rows.push(rowObj);
  }

  return { headers, rows };
}

/**
 * Auto-suggests column mappings based on common header names.
 */
export function autoSuggestMapping(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {
    name: '',
    phoneRaw: '',
  };

  for (const h of headers) {
    const lower = h.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!mapping.name && (lower.includes('name') || lower === 'fullname' || lower === 'leadname' || lower === 'contact')) {
      mapping.name = h;
    } else if (!mapping.phoneRaw && (lower.includes('phone') || lower.includes('mobile') || lower.includes('whatsapp') || lower.includes('contactno') || lower.includes('cell'))) {
      mapping.phoneRaw = h;
    } else if (!mapping.email && (lower.includes('email') || lower.includes('mail'))) {
      mapping.email = h;
    } else if (!mapping.companyName && (lower.includes('company') || lower.includes('business') || lower.includes('organization') || lower.includes('org'))) {
      mapping.companyName = h;
    } else if (!mapping.source && (lower.includes('source') || lower.includes('channel') || lower.includes('campaign'))) {
      mapping.source = h;
    } else if (!mapping.dealValue && (lower.includes('value') || lower.includes('amount') || lower.includes('budget') || lower.includes('deal'))) {
      mapping.dealValue = h;
    } else if (!mapping.notes && (lower.includes('note') || lower.includes('comment') || lower.includes('remark') || lower.includes('desc'))) {
      mapping.notes = h;
    }
  }

  return mapping;
}

// In-memory fallback job store for test or offline environments
const IN_MEMORY_JOBS: any[] = [];

/**
 * Validates mapped rows against tenant data.
 */
export async function validateImportRows(
  tenantId: string,
  rows: Record<string, any>[],
  mapping: ColumnMapping
): Promise<{
  totalRows: number;
  validRows: any[];
  duplicates: DuplicateMatch[];
  errors: RowError[];
}> {
  const validRows: any[] = [];
  const duplicates: DuplicateMatch[] = [];
  const errors: RowError[] = [];

  const dbConfig = resolveDatabaseConfig();
  const existingPhoneMap = new Map<string, string>(); // phoneNormalized -> existingLeadId

  if (!dbConfig.isBlocked) {
    try {
      const existing = await pool.query<{ id: string; phone_normalized: string }>(
        `SELECT id, phone_normalized FROM leads WHERE tenant_id = $1;`,
        [tenantId]
      );
      for (const row of existing.rows) {
        existingPhoneMap.set(row.phone_normalized, row.id);
      }
    } catch {
      // offline fallback
    }
  }

  const seenInBatch = new Set<string>();

  rows.forEach((row, idx) => {
    const rowNumber = idx + 2; // 1-indexed, accounting for header
    const nameVal = row[mapping.name]?.trim();
    const phoneVal = row[mapping.phoneRaw]?.trim();
    const emailVal = mapping.email ? row[mapping.email]?.trim() : undefined;
    const companyVal = mapping.companyName ? row[mapping.companyName]?.trim() : undefined;
    const sourceVal = mapping.source ? row[mapping.source]?.trim() : 'Website';
    const dealVal = mapping.dealValue ? row[mapping.dealValue]?.trim() : '0';
    const notesVal = mapping.notes ? row[mapping.notes]?.trim() : '';

    if (!nameVal) {
      errors.push({
        rowNumber,
        field: 'name',
        error: 'Name is required.',
        rowData: row,
      });
      return;
    }

    if (!phoneVal) {
      errors.push({
        rowNumber,
        field: 'phoneRaw',
        error: 'Phone number is required.',
        rowData: row,
      });
      return;
    }

    const phoneNormalized = normalizePhone(phoneVal);
    if (!phoneNormalized || phoneNormalized.length < 8) {
      errors.push({
        rowNumber,
        field: 'phoneRaw',
        error: `Invalid phone number format: "${phoneVal}". Must have at least 8 digits.`,
        rowData: row,
      });
      return;
    }

    // Check email format if provided
    if (emailVal && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailVal)) {
      errors.push({
        rowNumber,
        field: 'email',
        error: `Invalid email address format: "${emailVal}".`,
        rowData: row,
      });
      return;
    }

    // Check duplicate in DB or within current batch
    if (existingPhoneMap.has(phoneNormalized) || seenInBatch.has(phoneNormalized)) {
      duplicates.push({
        rowNumber,
        name: nameVal,
        phoneNormalized,
        existingLeadId: existingPhoneMap.get(phoneNormalized),
      });
    }

    seenInBatch.add(phoneNormalized);

    validRows.push({
      rowNumber,
      name: nameVal,
      phoneRaw: phoneVal,
      phoneNormalized,
      email: emailVal,
      companyName: companyVal,
      source: sourceVal || 'Website',
      dealValueMinorUnits: Math.round(Number(dealVal || 0) * 100),
      notes: notesVal,
      isDuplicate: existingPhoneMap.has(phoneNormalized),
      existingLeadId: existingPhoneMap.get(phoneNormalized),
    });
  });

  return {
    totalRows: rows.length,
    validRows,
    duplicates,
    errors,
  };
}

/**
 * Batched execution of validated import rows into PostgreSQL.
 */
export async function executeImportBatch(
  tenantId: string,
  userId: string,
  filename: string,
  fileFormat: string,
  validRows: any[],
  duplicates: DuplicateMatch[],
  errors: RowError[],
  strategy: DuplicateStrategy
): Promise<{
  jobId: string;
  totalRows: number;
  importedCount: number;
  updatedCount: number;
  skippedCount: number;
  failedCount: number;
}> {
  const dbConfig = resolveDatabaseConfig();
  const jobId = `job-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
  let importedCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;
  const failedCount = errors.length;

  // Resolve the tenant-owned currency and default stage from PostgreSQL.
  let defaultStageId: string | null = null;
  let tenantCurrency: string | null = null;
  if (!dbConfig.isBlocked) {
    const tenantResult = await pool.query<{ currency: string }>(
      'SELECT currency FROM tenants WHERE id = $1::uuid LIMIT 1;',
      [tenantId]
    );
    tenantCurrency = tenantResult.rows[0]?.currency || null;
    if (!tenantCurrency) {
      throw new Error('The selected CRM workspace has no configured currency.');
    }

    const stageRes = await pool.query<{ id: string }>(
      'SELECT id FROM pipeline_stages WHERE tenant_id = $1::uuid ORDER BY sort_order ASC LIMIT 1;',
      [tenantId]
    );
    if (stageRes.rows.length > 0) defaultStageId = stageRes.rows[0].id;
  }

  // Filter and process rows according to duplicate strategy
  const rowsToInsert: any[] = [];
  const rowsToUpdate: any[] = [];

  for (const item of validRows) {
    if (item.isDuplicate) {
      if (strategy === 'skip') {
        skippedCount++;
        continue;
      } else if (strategy === 'update' && item.existingLeadId) {
        rowsToUpdate.push(item);
        continue;
      } else if (strategy === 'import_non_duplicates') {
        skippedCount++;
        continue;
      }
    }
    rowsToInsert.push(item);
  }

  if (!dbConfig.isBlocked) {
    // 1. Batched INSERT using withTransaction
    if (rowsToInsert.length > 0) {
      const BATCH_SIZE = 50;
      for (let i = 0; i < rowsToInsert.length; i += BATCH_SIZE) {
        const chunk = rowsToInsert.slice(i, i + BATCH_SIZE);
        await withTransaction(async (client) => {
          for (const row of chunk) {
            await client.query(
              `INSERT INTO leads (
                tenant_id, name, phone_raw, phone_normalized, email, company_name,
                source, stage_id, deal_value_minor_units, currency, next_action,
                consent_status, notes, created_by
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'Call', 'Consented', $11, $12);`,
              [
                tenantId,
                row.name,
                row.phoneRaw,
                row.phoneNormalized,
                row.email || null,
                row.companyName || null,
                row.source,
                defaultStageId,
                row.dealValueMinorUnits || 0,
                tenantCurrency,
                row.notes || '',
                userId || DEFAULT_USER_ID,
              ]
            );
            importedCount++;
          }
        });
      }
    }

    // 2. Handle updates
    if (rowsToUpdate.length > 0) {
      for (const row of rowsToUpdate) {
        await pool.query(
          `UPDATE leads SET
            name = COALESCE($1, name),
            email = COALESCE($2, email),
            company_name = COALESCE($3, company_name),
            deal_value_minor_units = CASE WHEN $4::bigint > 0 THEN $4::bigint ELSE deal_value_minor_units END,
            notes = CASE WHEN $5 != '' THEN notes || E'\n' || $5 ELSE notes END,
            updated_at = NOW()
          WHERE id = $6 AND tenant_id = $7;`,
          [
            row.name,
            row.email || null,
            row.companyName || null,
            row.dealValueMinorUnits || 0,
            row.notes || '',
            row.existingLeadId,
            tenantId,
          ]
        );
        updatedCount++;
      }
    }

    // 3. Record import job in import_jobs table
    try {
      await pool.query(
        `INSERT INTO import_jobs (
          id, tenant_id, filename, file_format, status, total_rows,
          imported_count, duplicate_count, failed_count, duplicate_strategy,
          error_details, created_by, completed_at
        ) VALUES (
          gen_random_uuid(), $1, $2, $3, 'completed', $4, $5, $6, $7, $8, $9, $10, NOW()
        );`,
        [
          tenantId,
          filename,
          fileFormat,
          validRows.length + failedCount,
          importedCount + updatedCount,
          duplicates.length,
          failedCount,
          strategy,
          JSON.stringify(errors.slice(0, 100)),
          userId || DEFAULT_USER_ID,
        ]
      );
    } catch {}

    // 4. Record audit event
    try {
      await pool.query(
        `INSERT INTO audit_events (
          tenant_id, actor_user_id, action, entity_type, entity_id, safe_metadata
        ) VALUES ($1, $2, 'leads_bulk_imported', 'import_job', gen_random_uuid(), $3);`,
        [
          tenantId,
          userId || DEFAULT_USER_ID,
          JSON.stringify({
            filename,
            importedCount,
            updatedCount,
            skippedCount,
            failedCount,
          }),
        ]
      );
    } catch {}
  } else {
    // Safe memory mock for test/offline
    importedCount = rowsToInsert.length;
    updatedCount = rowsToUpdate.length;
    IN_MEMORY_JOBS.unshift({
      id: jobId,
      tenantId,
      filename,
      fileFormat,
      status: 'completed',
      totalRows: validRows.length + failedCount,
      importedCount: importedCount + updatedCount,
      duplicateCount: duplicates.length,
      failedCount,
      duplicateStrategy: strategy,
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    });
  }

  return {
    jobId,
    totalRows: validRows.length + failedCount,
    importedCount,
    updatedCount,
    skippedCount,
    failedCount,
  };
}

/**
 * Generates an RFC 4180 CSV export string.
 */
export function generateLeadsCsv(leads: any[]): string {
  const headers = [
    'ID',
    'Name',
    'Phone Raw',
    'Phone Normalized',
    'Email',
    'Company',
    'Source',
    'Stage',
    'Deal Value (INR)',
    'Next Action',
    'Consent Status',
    'Created At',
  ];

  const escapeCsv = (str: any) => {
    if (str === null || str === undefined) return '';
    const safeStr = sanitizeCellValue(str);
    if (safeStr.includes(',') || safeStr.includes('"') || safeStr.includes('\n')) {
      return `"${safeStr.replace(/"/g, '""')}"`;
    }
    return safeStr;
  };

  const rows = leads.map(l => [
    escapeCsv(l.id),
    escapeCsv(l.name),
    escapeCsv(l.phoneRaw || l.phone_raw),
    escapeCsv(l.phoneNormalized || l.phone_normalized),
    escapeCsv(l.email),
    escapeCsv(l.companyName || l.company_name),
    escapeCsv(l.source),
    escapeCsv(l.stageName || l.stage_id),
    escapeCsv(((Number(l.dealValueMinorUnits || l.deal_value_minor_units || 0)) / 100).toFixed(2)),
    escapeCsv(l.nextAction || l.next_action),
    escapeCsv(l.consentStatus || l.consent_status),
    escapeCsv(l.createdAt || l.created_at),
  ].join(','));

  return [headers.join(','), ...rows].join('\r\n');
}

/**
 * Generates an Excel (.xlsx) binary buffer for lead export.
 */
export function generateLeadsExcelBuffer(leads: any[]): Buffer {
  const formatted = leads.map(l => ({
    'ID': sanitizeCellValue(l.id),
    'Name': sanitizeCellValue(l.name),
    'Phone Raw': sanitizeCellValue(l.phoneRaw || l.phone_raw),
    'Phone Normalized': sanitizeCellValue(l.phoneNormalized || l.phone_normalized),
    'Email': sanitizeCellValue(l.email),
    'Company': sanitizeCellValue(l.companyName || l.company_name),
    'Source': sanitizeCellValue(l.source),
    'Stage': sanitizeCellValue(l.stageName || l.stage_id),
    'Deal Value (INR)': (Number(l.dealValueMinorUnits || l.deal_value_minor_units || 0)) / 100,
    'Next Action': sanitizeCellValue(l.nextAction || l.next_action),
    'Consent Status': sanitizeCellValue(l.consentStatus || l.consent_status),
    'Created At': sanitizeCellValue(l.createdAt || l.created_at),
  }));

  const worksheet = XLSX.utils.json_to_sheet(formatted);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Leads Export');
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  return buffer;
}
