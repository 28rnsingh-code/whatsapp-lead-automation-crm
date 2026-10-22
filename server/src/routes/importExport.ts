import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { requireTenant } from '../middleware/tenant';
import { pool, resolveDatabaseConfig } from '../db';
import { DEFAULT_TENANT_ID, DEFAULT_USER_ID } from '../db/seed';
import {
  parseCsvText,
  parseExcelBuffer,
  autoSuggestMapping,
  validateImportRows,
  executeImportBatch,
  generateLeadsCsv,
  generateLeadsExcelBuffer,
  DuplicateStrategy,
} from '../services/importExportService';

const router = Router();

const TENANT_UUID_MAP: Record<string, string> = {
  tenant_bring_my_bite: DEFAULT_TENANT_ID,
  tenant_automics_labs: 'a0000000-0000-0000-0000-000000000002',
};

function toDbTenantId(id: string): string {
  if (!id) return DEFAULT_TENANT_ID;
  if (TENANT_UUID_MAP[id]) return TENANT_UUID_MAP[id];
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (uuidRegex.test(id)) return id;
  return DEFAULT_TENANT_ID;
}

// 1. Preview File Content & Extract Headers
router.post('/preview', requireAuth, requireTenant(), async (req: Request, res: Response): Promise<void> => {
  const { content, format, filename, base64Data } = req.body;
  const requestId = req.requestId || 'req_unknown';

  if (!content && !base64Data) {
    res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'File content is required (plain text or base64).',
        requestId,
      },
    });
    return;
  }

  try {
    let headers: string[] = [];
    let rows: Record<string, string>[] = [];

    const isExcel = format === 'xlsx' || format === 'xls' || filename?.endsWith('.xlsx') || filename?.endsWith('.xls');

    if (isExcel && base64Data) {
      const buffer = Buffer.from(base64Data, 'base64');
      const parsed = parseExcelBuffer(buffer);
      headers = parsed.headers;
      rows = parsed.rows;
    } else {
      const csvStr = content || (base64Data ? Buffer.from(base64Data, 'base64').toString('utf-8') : '');
      const parsed = parseCsvText(csvStr);
      headers = parsed.headers;
      rows = parsed.rows;
    }

    if (headers.length === 0 || rows.length === 0) {
      res.status(400).json({
        success: false,
        error: {
          code: 'EMPTY_FILE',
          message: 'The uploaded file has no headers or contains no rows.',
          requestId,
        },
      });
      return;
    }

    const suggestedMapping = autoSuggestMapping(headers);

    res.json({
      success: true,
      data: {
        filename: filename || 'import.csv',
        format: isExcel ? 'xlsx' : 'csv',
        totalRows: rows.length,
        headers,
        sampleRows: rows.slice(0, 10),
        allRows: rows,
        suggestedMapping,
      },
      meta: {
        requestId,
      },
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      error: {
        code: 'PARSE_ERROR',
        message: `Failed to parse file: ${error.message}`,
        requestId,
      },
    });
  }
});

// 2. Validate Rows & Detect Duplicates
router.post('/validate', requireAuth, requireTenant(), async (req: Request, res: Response): Promise<void> => {
  const tenantId = toDbTenantId(req.tenantContext!.tenantId);
  const { rows, mapping } = req.body;
  const requestId = req.requestId || 'req_unknown';

  if (!rows || !Array.isArray(rows) || rows.length === 0) {
    res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'An array of rows is required for validation.',
        requestId,
      },
    });
    return;
  }

  if (!mapping || !mapping.name || !mapping.phoneRaw) {
    res.status(400).json({
      success: false,
      error: {
        code: 'MISSING_MAPPING',
        message: 'Name and Phone Raw column mappings are required.',
        requestId,
      },
    });
    return;
  }

  try {
    const result = await validateImportRows(tenantId, rows, mapping);
    res.json({
      success: true,
      data: {
        totalRows: result.totalRows,
        validCount: result.validRows.length,
        duplicateCount: result.duplicates.length,
        errorCount: result.errors.length,
        duplicates: result.duplicates.slice(0, 50),
        errors: result.errors.slice(0, 50),
        sampleValidRows: result.validRows.slice(0, 10),
      },
      meta: {
        requestId,
      },
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: {
        code: 'VALIDATION_FAILED',
        message: error.message,
        requestId,
      },
    });
  }
});

// 3. Execute Bulk Import Job
router.post('/execute', requireAuth, requireTenant(), async (req: Request, res: Response): Promise<void> => {
  const tenantId = toDbTenantId(req.tenantContext!.tenantId);
  const userId = req.userId || DEFAULT_USER_ID;
  const { rows, mapping, duplicateStrategy = 'skip', filename = 'import.csv', format = 'csv' } = req.body;
  const requestId = req.requestId || 'req_unknown';

  if (!rows || !Array.isArray(rows) || rows.length === 0) {
    res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Rows array is required for execution.',
        requestId,
      },
    });
    return;
  }

  try {
    // 1. Run validation
    const validation = await validateImportRows(tenantId, rows, mapping);

    // 2. Execute batch inserts/updates
    const result = await executeImportBatch(
      tenantId,
      userId,
      filename,
      format,
      validation.validRows,
      validation.duplicates,
      validation.errors,
      duplicateStrategy as DuplicateStrategy
    );

    res.json({
      success: true,
      data: result,
      meta: {
        requestId,
      },
    });
  } catch (error: any) {
    if (error.name === 'DatabaseSafetyError') {
      res.status(503).json({
        success: false,
        error: {
          code: 'DATABASE_SAFETY_BLOCKED',
          message: error.message,
          requestId,
        },
      });
      return;
    }
    res.status(500).json({
      success: false,
      error: {
        code: 'IMPORT_EXECUTION_ERROR',
        message: `Failed to execute import: ${error.message}`,
        requestId,
      },
    });
  }
});

// 4. Import History
router.get('/history', requireAuth, requireTenant(), async (req: Request, res: Response): Promise<void> => {
  const tenantId = toDbTenantId(req.tenantContext!.tenantId);
  const dbConfig = resolveDatabaseConfig();

  if (dbConfig.isBlocked) {
    res.json({
      success: true,
      data: [],
      meta: { totalCount: 0, requestId: req.requestId },
    });
    return;
  }

  try {
    const result = await pool.query(
      `SELECT id, filename, file_format as "fileFormat", status, total_rows as "totalRows",
              imported_count as "importedCount", duplicate_count as "duplicateCount",
              failed_count as "failedCount", duplicate_strategy as "duplicateStrategy",
              created_at as "createdAt", completed_at as "completedAt"
       FROM import_jobs
       WHERE tenant_id = $1
       ORDER BY created_at DESC
       LIMIT 50;`,
      [tenantId]
    );

    res.json({
      success: true,
      data: result.rows,
      meta: {
        totalCount: result.rows.length,
        requestId: req.requestId,
      },
    });
  } catch (error: any) {
    res.status(503).json({
      success: false,
      error: {
        code: 'DATABASE_UNAVAILABLE',
        message: 'Database is temporarily unavailable. Please retry shortly.',
        requestId: req.requestId || 'req_unknown',
      },
    });
    return;
  }
});

// 5. Export Leads (CSV or Excel with Tenant Isolation & Formula Injection Protection)
router.get('/export/leads', requireAuth, requireTenant(), async (req: Request, res: Response): Promise<void> => {
  const tenantId = toDbTenantId(req.tenantContext!.tenantId);
  const { format = 'csv', stage, source, q } = req.query;

  try {
    let leads: any[] = [];
    const dbConfig = resolveDatabaseConfig();

    if (!dbConfig.isBlocked) {
      const params: any[] = [tenantId];
      let whereClauses = ['l.tenant_id = $1'];

      if (q && typeof q === 'string' && q.trim()) {
        params.push(`%${q.trim()}%`);
        whereClauses.push(`(l.name ILIKE $${params.length} OR l.phone_raw ILIKE $${params.length} OR l.email ILIKE $${params.length})`);
      }

      if (stage && typeof stage === 'string' && stage !== 'All') {
        params.push(stage);
        whereClauses.push(`(ps.name = $${params.length} OR l.stage_id::text = $${params.length})`);
      }

      if (source && typeof source === 'string' && source !== 'All') {
        params.push(source);
        whereClauses.push(`l.source = $${params.length}`);
      }

      const querySql = `
        SELECT 
          l.id, l.name, l.phone_raw as "phoneRaw", l.phone_normalized as "phoneNormalized",
          l.email, l.company_name as "companyName", l.source,
          COALESCE(ps.name, 'New') as "stageName",
          l.deal_value_minor_units as "dealValueMinorUnits",
          l.next_action as "nextAction",
          l.consent_status as "consentStatus",
          l.created_at as "createdAt"
        FROM leads l
        LEFT JOIN pipeline_stages ps ON ps.id = l.stage_id
        WHERE ${whereClauses.join(' AND ')}
        ORDER BY l.created_at DESC
        LIMIT 10000;
      `;

      const result = await pool.query(querySql, params);
      leads = result.rows;
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

    if (format === 'xlsx') {
      const excelBuffer = generateLeadsExcelBuffer(leads);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="leads_export_${timestamp}.xlsx"`);
      res.send(excelBuffer);
      return;
    }

    const csvContent = generateLeadsCsv(leads);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="leads_export_${timestamp}.csv"`);
    res.send(csvContent);
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: {
        code: 'EXPORT_ERROR',
        message: `Failed to export leads: ${error.message}`,
        requestId: req.requestId || 'req_unknown',
      },
    });
  }
});

export default router;
