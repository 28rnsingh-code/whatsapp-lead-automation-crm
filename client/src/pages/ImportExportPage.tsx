import React, { useState, useEffect, useRef } from 'react';
import {
  previewImportFileApi,
  validateImportRowsApi,
  executeImportJobApi,
  getImportHistoryApi,
  downloadLeadsExportApi,
  ImportPreviewResponse,
  ImportValidateResponse,
  ImportJobRecord,
} from '../services/api';

const TARGET_FIELDS = [
  { key: 'name', label: 'Name (Required)', required: true },
  { key: 'phoneRaw', label: 'Phone Number (Required)', required: true },
  { key: 'email', label: 'Email Address', required: false },
  { key: 'companyName', label: 'Company Name', required: false },
  { key: 'source', label: 'Lead Source', required: false },
  { key: 'dealValue', label: 'Deal Value (INR)', required: false },
  { key: 'notes', label: 'Notes / Remarks', required: false },
];

export const ImportExportPage: React.FC = () => {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);

  // File Upload State
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileFormat, setFileFormat] = useState<'csv' | 'xlsx' | 'xls'>('csv');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Preview & Mapping State
  const [previewData, setPreviewData] = useState<ImportPreviewResponse | null>(null);
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>({});

  // Validation State
  const [validationData, setValidationData] = useState<ImportValidateResponse | null>(null);
  const [duplicateStrategy, setDuplicateStrategy] = useState<'skip' | 'update' | 'import_non_duplicates'>('skip');

  // Execution & History State
  const [executionResult, setExecutionResult] = useState<any>(null);
  const [importHistory, setImportHistory] = useState<ImportJobRecord[]>([]);

  // Export State
  const [exportScope, setExportScope] = useState('All');
  const [exportFormat, setExportFormat] = useState<'csv' | 'xlsx'>('csv');
  const [isExporting, setIsExporting] = useState(false);

  useEffect(() => {
    loadHistory();
  }, []);

  const loadHistory = async () => {
    try {
      const history = await getImportHistoryApi();
      setImportHistory(history || []);
    } catch {
      // safe fallback
    }
  };

  // Step 1: File selection & upload
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processSelectedFile(file);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) {
      processSelectedFile(file);
    }
  };

  const processSelectedFile = (file: File) => {
    setErrorMessage(null);
    if (file.size > 10 * 1024 * 1024) {
      setErrorMessage('File size exceeds the 10MB limit. Please upload a smaller file.');
      return;
    }

    const name = file.name.toLowerCase();
    let format: 'csv' | 'xlsx' | 'xls' = 'csv';
    if (name.endsWith('.xlsx')) format = 'xlsx';
    else if (name.endsWith('.xls')) format = 'xls';
    else if (!name.endsWith('.csv')) {
      setErrorMessage('Unsupported file format. Please upload a .csv, .xlsx, or .xls file.');
      return;
    }

    setSelectedFile(file);
    setFileFormat(format);
  };

  const handleContinueToMapping = async () => {
    if (!selectedFile) {
      setErrorMessage('Please select a file to upload first.');
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);

    try {
      let previewRes: ImportPreviewResponse;

      if (fileFormat === 'xlsx' || fileFormat === 'xls') {
        const buffer = await selectedFile.arrayBuffer();
        const base64 = btoa(
          new Uint8Array(buffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
        );
        previewRes = await previewImportFileApi({
          base64Data: base64,
          filename: selectedFile.name,
          format: fileFormat,
        });
      } else {
        const text = await selectedFile.text();
        previewRes = await previewImportFileApi({
          content: text,
          filename: selectedFile.name,
          format: 'csv',
        });
      }

      setPreviewData(previewRes);

      // Initialize mapping with auto-suggestions or first matching columns
      const initialMapping: Record<string, string> = {};
      TARGET_FIELDS.forEach(tf => {
        initialMapping[tf.key] = previewRes.suggestedMapping[tf.key] || '';
      });
      setColumnMapping(initialMapping);

      setStep(2);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to parse file.');
    } finally {
      setIsLoading(false);
    }
  };

  // Step 2: Validate Column Mapping
  const handleValidateMapping = async () => {
    if (!previewData) return;
    if (!columnMapping.name || !columnMapping.phoneRaw) {
      setErrorMessage('Please map both Name and Phone Number fields before proceeding.');
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);

    try {
      const validateRes = await validateImportRowsApi({
        rows: previewData.allRows,
        mapping: columnMapping,
      });

      setValidationData(validateRes);
      setStep(3);
    } catch (err: any) {
      setErrorMessage(err.message || 'Validation failed.');
    } finally {
      setIsLoading(false);
    }
  };

  // Step 3: Execute Import
  const handleExecuteImport = async () => {
    if (!previewData) return;

    setIsLoading(true);
    setErrorMessage(null);

    try {
      const execRes = await executeImportJobApi({
        rows: previewData.allRows,
        mapping: columnMapping,
        duplicateStrategy,
        filename: previewData.filename,
        format: previewData.format,
      });

      setExecutionResult(execRes);
      setSuccessMessage(
        `Import completed successfully! ${execRes.importedCount} leads imported, ${execRes.updatedCount} updated, ${execRes.skippedCount} skipped.`
      );
      setStep(4);
      loadHistory();
    } catch (err: any) {
      setErrorMessage(err.message || 'Import execution failed.');
    } finally {
      setIsLoading(false);
    }
  };

  // Reset Stepper
  const handleReset = () => {
    setStep(1);
    setSelectedFile(null);
    setPreviewData(null);
    setValidationData(null);
    setExecutionResult(null);
    setErrorMessage(null);
    setSuccessMessage(null);
  };

  // Download Failed Rows CSV Report
  const handleDownloadErrorReport = () => {
    if (!validationData || validationData.errors.length === 0) return;

    const headers = ['Row Number', 'Field', 'Error Reason', 'Row Content'];
    const rows = validationData.errors.map(e => [
      e.rowNumber,
      `"${e.field}"`,
      `"${e.error.replace(/"/g, '""')}"`,
      `"${JSON.stringify(e.rowData || {}).replace(/"/g, '""')}"`,
    ].join(','));

    const csvContent = [headers.join(','), ...rows].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `import_errors_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Export Leads
  const handleExport = async () => {
    setIsExporting(true);
    setErrorMessage(null);

    try {
      const blob = await downloadLeadsExportApi({
        format: exportFormat,
        stage: exportScope === 'Won' ? 'Won' : undefined,
      });

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `leads_export_${Date.now()}.${exportFormat}`;
      a.click();
      URL.revokeObjectURL(url);
      setSuccessMessage(`Leads successfully exported as .${exportFormat}`);
    } catch (err: any) {
      setErrorMessage(err.message || 'Export failed.');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>CSV & Excel Lead Management</h1>
          <div className="page-header-sub">
            Batch import leads from CSV/Excel spreadsheets, validate records, detect duplicates, and export filtered lists.
          </div>
        </div>
      </div>

      {/* Notifications */}
      {errorMessage && (
        <div style={{ background: '#fef3f2', border: '1px solid #fecdca', color: '#b42318', padding: '12px 16px', borderRadius: '8px', marginBottom: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>⚠️ {errorMessage}</span>
          <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#b42318', fontWeight: 'bold' }} onClick={() => setErrorMessage(null)}>✕</button>
        </div>
      )}

      {successMessage && (
        <div style={{ background: '#ecfdf3', border: '1px solid #a6f4c5', color: '#027a48', padding: '12px 16px', borderRadius: '8px', marginBottom: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>✓ {successMessage}</span>
          <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#027a48', fontWeight: 'bold' }} onClick={() => setSuccessMessage(null)}>✕</button>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: '20px' }}>
        {/* Bulk Lead Importer Stepper */}
        <div className="card">
          <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h2 style={{ margin: 0 }}>Batch Lead Importer</h2>
              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                {step === 1 && 'Step 1: Upload File'}
                {step === 2 && 'Step 2: Map Columns'}
                {step === 3 && 'Step 3: Validate & Select Duplicate Policy'}
                {step === 4 && 'Step 4: Import Complete'}
              </span>
            </div>
            {step > 1 && (
              <button className="btn" style={{ padding: '4px 10px', fontSize: '12px' }} onClick={handleReset}>
                Reset
              </button>
            )}
          </div>

          {/* STEP 1: Upload */}
          {step === 1 && (
            <div style={{ padding: '20px 0' }}>
              <input
                type="file"
                ref={fileInputRef}
                style={{ display: 'none' }}
                accept=".csv, .xlsx, .xls"
                onChange={handleFileChange}
              />
              <div
                style={{
                  border: '2px dashed var(--line-strong)',
                  borderRadius: 'var(--radius-card)',
                  padding: '36px 20px',
                  textAlign: 'center',
                  background: 'var(--surface-secondary)',
                  cursor: 'pointer',
                }}
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleDrop}
              >
                <div style={{ fontSize: '36px', marginBottom: '8px' }}>📁</div>
                <strong style={{ display: 'block', fontSize: '15px', marginBottom: '6px' }}>
                  {selectedFile ? selectedFile.name : 'Click or drag CSV / Excel file here to upload'}
                </strong>
                <small style={{ color: 'var(--text-muted)' }}>
                  Supports .csv, .xlsx, and .xls files up to 10MB (max 10,000 rows per batch)
                </small>
                {selectedFile && (
                  <div style={{ marginTop: '10px', color: 'var(--brand-primary)', fontWeight: 600, fontSize: '13px' }}>
                    ✓ Ready: {(selectedFile.size / 1024).toFixed(1)} KB ({fileFormat.toUpperCase()})
                  </div>
                )}
              </div>

              <div style={{ marginTop: '20px', display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  className="btn btn-primary"
                  disabled={!selectedFile || isLoading}
                  onClick={handleContinueToMapping}
                >
                  {isLoading ? 'Parsing file...' : 'Continue to Column Mapping →'}
                </button>
              </div>
            </div>
          )}

          {/* STEP 2: Map Columns */}
          {step === 2 && previewData && (
            <div style={{ padding: '10px 0' }}>
              <div style={{ background: 'var(--surface-secondary)', padding: '10px 14px', borderRadius: '6px', fontSize: '12px', marginBottom: '14px' }}>
                <strong>File Preview:</strong> {previewData.filename} ({previewData.totalRows} detected rows, {previewData.headers.length} headers)
              </div>

              <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '14px' }}>
                Match your spreadsheet columns with CRM lead properties:
              </p>

              <div style={{ display: 'grid', gap: '10px', maxHeight: '340px', overflowY: 'auto' }}>
                {TARGET_FIELDS.map((tf) => (
                  <div key={tf.key} style={{ display: 'grid', gridTemplateColumns: '1.2fr 20px 1.5fr', gap: '10px', alignItems: 'center' }}>
                    <div style={{ fontSize: '13px', fontWeight: 600 }}>
                      {tf.label} {tf.required && <span style={{ color: '#d92d20' }}>*</span>}
                    </div>
                    <div style={{ textAlign: 'center', color: 'var(--text-muted)' }}>→</div>
                    <select
                      className="select-control"
                      value={columnMapping[tf.key] || ''}
                      onChange={(e) => setColumnMapping({ ...columnMapping, [tf.key]: e.target.value })}
                    >
                      <option value="">-- Do Not Import --</option>
                      {previewData.headers.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>

              <div style={{ marginTop: '20px', display: 'flex', justifyContent: 'space-between' }}>
                <button className="btn" onClick={() => setStep(1)}>
                  ← Back
                </button>
                <button
                  className="btn btn-primary"
                  disabled={isLoading || !columnMapping.name || !columnMapping.phoneRaw}
                  onClick={handleValidateMapping}
                >
                  {isLoading ? 'Validating...' : 'Validate & Review Duplicates →'}
                </button>
              </div>
            </div>
          )}

          {/* STEP 3: Validate & Duplicate Policy */}
          {step === 3 && validationData && (
            <div style={{ padding: '10px 0' }}>
              {/* Validation Summary Cards */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px', marginBottom: '16px' }}>
                <div style={{ background: '#ecfdf3', border: '1px solid #a6f4c5', borderRadius: '8px', padding: '12px', textAlign: 'center' }}>
                  <div style={{ fontSize: '20px', fontWeight: 700, color: '#027a48' }}>{validationData.validCount}</div>
                  <div style={{ fontSize: '11px', color: '#027a48', fontWeight: 600 }}>Valid Rows</div>
                </div>
                <div style={{ background: '#fffaeb', border: '1px solid #fedf89', borderRadius: '8px', padding: '12px', textAlign: 'center' }}>
                  <div style={{ fontSize: '20px', fontWeight: 700, color: '#b54708' }}>{validationData.duplicateCount}</div>
                  <div style={{ fontSize: '11px', color: '#b54708', fontWeight: 600 }}>Duplicate Phones</div>
                </div>
                <div style={{ background: '#fef3f2', border: '1px solid #fecdca', borderRadius: '8px', padding: '12px', textAlign: 'center' }}>
                  <div style={{ fontSize: '20px', fontWeight: 700, color: '#b42318' }}>{validationData.errorCount}</div>
                  <div style={{ fontSize: '11px', color: '#b42318', fontWeight: 600 }}>Invalid Rows</div>
                </div>
              </div>

              {/* Duplicate Strategy Option */}
              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '6px' }}>
                  Duplicate Contact Handling Rule:
                </label>
                <select
                  className="select-control"
                  style={{ width: '100%' }}
                  value={duplicateStrategy}
                  onChange={(e: any) => setDuplicateStrategy(e.target.value)}
                >
                  <option value="skip">Skip duplicates (Safest — leave existing workspace leads untouched)</option>
                  <option value="update">Update existing leads with fresh spreadsheet details</option>
                  <option value="import_non_duplicates">Import only new non-conflicting records</option>
                </select>
              </div>

              {/* Error details if any */}
              {validationData.errorCount > 0 && (
                <div style={{ marginBottom: '16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                    <span style={{ fontSize: '12px', fontWeight: 600, color: '#b42318' }}>
                      Row Errors Detected ({validationData.errorCount}):
                    </span>
                    <button className="btn" style={{ padding: '2px 8px', fontSize: '11px' }} onClick={handleDownloadErrorReport}>
                      📥 Download Error Report (CSV)
                    </button>
                  </div>
                  <div style={{ maxHeight: '110px', overflowY: 'auto', background: 'var(--surface-secondary)', borderRadius: '6px', padding: '8px 12px', fontSize: '11px' }}>
                    {validationData.errors.slice(0, 5).map((e, idx) => (
                      <div key={idx} style={{ color: '#b42318', marginBottom: '3px' }}>
                        • Row {e.rowNumber}: <strong>{e.field}</strong> — {e.error}
                      </div>
                    ))}
                    {validationData.errors.length > 5 && (
                      <div style={{ color: 'var(--text-muted)' }}>...and {validationData.errors.length - 5} more errors.</div>
                    )}
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '20px' }}>
                <button className="btn" onClick={() => setStep(2)}>
                  ← Adjust Mapping
                </button>
                <button
                  className="btn btn-primary"
                  disabled={isLoading || validationData.validCount === 0}
                  onClick={handleExecuteImport}
                >
                  {isLoading ? 'Executing import...' : `Commit Import (${validationData.validCount} rows) →`}
                </button>
              </div>
            </div>
          )}

          {/* STEP 4: Complete */}
          {step === 4 && executionResult && (
            <div style={{ padding: '24px 0', textAlign: 'center' }}>
              <div style={{ fontSize: '44px', marginBottom: '10px', color: 'var(--green-text)' }}>✓</div>
              <h3 style={{ margin: '0 0 6px 0' }}>Import Completed Successfully</h3>
              <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '18px' }}>
                Batch {executionResult.jobId} processed: {executionResult.importedCount} created, {executionResult.updatedCount} updated, {executionResult.skippedCount} skipped.
              </p>
              <button className="btn btn-primary" onClick={handleReset}>
                Import Another Spreadsheet
              </button>
            </div>
          )}
        </div>

        {/* Export Card & History */}
        <div style={{ display: 'grid', gap: '20px' }}>
          {/* Export Card */}
          <div className="card">
            <div className="card-header">
              <h2>Export Leads</h2>
            </div>
            <div style={{ display: 'grid', gap: '14px', margin: '14px 0' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px', fontWeight: 600 }}>Export Filter</label>
                <select
                  className="select-control"
                  style={{ width: '100%' }}
                  value={exportScope}
                  onChange={(e) => setExportScope(e.target.value)}
                >
                  <option value="All">All Workspace Leads</option>
                  <option value="Won">Only Closed Won Deals</option>
                </select>
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px', fontWeight: 600 }}>File Format</label>
                <select
                  className="select-control"
                  style={{ width: '100%' }}
                  value={exportFormat}
                  onChange={(e: any) => setExportFormat(e.target.value)}
                >
                  <option value="csv">CSV (Comma Separated Values - RFC 4180)</option>
                  <option value="xlsx">Excel Spreadsheet (.xlsx)</option>
                </select>
              </div>
            </div>
            <button
              className="btn btn-primary"
              style={{ width: '100%', justifyContent: 'center' }}
              disabled={isExporting}
              onClick={handleExport}
            >
              {isExporting ? 'Generating Export...' : `Download ${exportFormat.toUpperCase()} Export File`}
            </button>
          </div>

          {/* Import History */}
          <div className="card">
            <div className="card-header">
              <h2>Recent Import Jobs</h2>
            </div>
            {importHistory.length === 0 ? (
              <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
                No past import history found in this workspace.
              </div>
            ) : (
              <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
                {importHistory.map((job) => (
                  <div key={job.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--line-subtle)', fontSize: '12px', display: 'flex', justifyContent: 'space-between' }}>
                    <div>
                      <strong style={{ display: 'block' }}>{job.filename}</strong>
                      <span style={{ color: 'var(--text-muted)' }}>
                        {job.importedCount} imported • {job.duplicateCount} dupes • {job.failedCount} errors
                      </span>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <span style={{ color: job.status === 'completed' ? '#027a48' : '#b42318', fontWeight: 600 }}>
                        {job.status}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
