import crypto from 'crypto';

/**
 * Verify Meta's X-Hub-Signature-256 over the original raw HTTP request body.
 * Missing, malformed, or incorrectly signed requests fail closed.
 */
export function verifyMetaWebhookSignature(
  rawBody: Buffer | string | undefined,
  signatureHeader: string | undefined,
  appSecret: string | undefined,
): boolean {
  if (!rawBody || !signatureHeader || !appSecret) return false;
  if (!signatureHeader.startsWith('sha256=')) return false;

  const supplied = signatureHeader.slice('sha256='.length).trim();
  if (!/^[a-f0-9]{64}$/i.test(supplied)) return false;

  const expected = crypto
    .createHmac('sha256', appSecret)
    .update(rawBody)
    .digest();

  const actual = Buffer.from(supplied, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

/** Constant-time compare for verification tokens when their byte lengths match. */
export function secureTokenEquals(expected: string | undefined, supplied: string | undefined): boolean {
  if (!expected || !supplied) return false;
  const expectedBytes = Buffer.from(expected, 'utf8');
  const suppliedBytes = Buffer.from(supplied, 'utf8');
  return expectedBytes.length === suppliedBytes.length &&
    crypto.timingSafeEqual(expectedBytes, suppliedBytes);
}

/** Find the single Meta phone-number ID represented by a webhook event envelope. */
export function getMetaPhoneNumberId(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const entries = (body as { entry?: unknown }).entry;
  if (!Array.isArray(entries)) return null;

  const ids = new Set<string>();
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    const changes = (entry as { changes?: unknown }).changes;
    if (!Array.isArray(changes)) continue;
    for (const change of changes) {
      if (!change || typeof change !== 'object') continue;
      const value = (change as { value?: unknown }).value;
      if (!value || typeof value !== 'object') continue;
      const metadata = (value as { metadata?: unknown }).metadata;
      if (!metadata || typeof metadata !== 'object') continue;
      const id = (metadata as { phone_number_id?: unknown }).phone_number_id;
      if (typeof id === 'string' && id.trim()) ids.add(id.trim());
    }
  }
  return ids.size === 1 ? [...ids][0] : null;
}
