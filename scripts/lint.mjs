import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const roots = ['client/src', 'server/src', 'shared'];
const extensions = new Set(['.ts', '.tsx', '.js', '.jsx']);
const files = [];
function walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (extensions.has(path.extname(entry.name))) files.push(full);
  }
}
for (const root of roots) walk(root);

const failures = [];
let syntaxErrors = 0;
for (const file of files) {
  const text = fs.readFileSync(file, 'utf8');
  const scriptKind = file.endsWith('.tsx') ? ts.ScriptKind.TSX
    : file.endsWith('.jsx') ? ts.ScriptKind.JSX
    : file.endsWith('.js') ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKind);
  for (const diagnostic of source.parseDiagnostics) {
    syntaxErrors++;
    const position = source.getLineAndCharacterOfPosition(diagnostic.start ?? 0);
    failures.push(`${file}:${position.line + 1}:${position.character + 1} syntax error: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')}`);
  }

  const normalized = text.replace(/\r\n/g, '\n');
  if (normalized.includes('echo "Linting clean"')) {
    failures.push(`${file}: placeholder lint success is forbidden`);
  }
  if (/\bdebugger\s*;/.test(normalized)) {
    failures.push(`${file}: debugger statement is forbidden`);
  }
  if (/\beval\s*\(/.test(normalized)) {
    failures.push(`${file}: eval() is forbidden`);
  }
  if (file.startsWith('server/src/') && /(?:AKIA[0-9A-Z]{16}|sk-[A-Za-z0-9]{20,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/.test(normalized)) {
    failures.push(`${file}: likely hard-coded secret detected`);
  }
}
if (files.length === 0) {
  console.error('Lint failed: no source files were discovered.');
  process.exit(1);
}
if (failures.length) {
  console.error(failures.join('\n'));
  console.error(`Lint failed: ${failures.length} finding(s) across ${files.length} source files (${syntaxErrors} syntax error(s)).`);
  process.exit(1);
}
console.log(`Lint passed: parsed ${files.length} source files; no syntax errors, debugger statements, eval() calls, or obvious embedded secrets.`);
