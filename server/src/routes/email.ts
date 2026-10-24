import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { requireAuth } from '../middleware/auth';
import { requireTenant } from '../middleware/tenant';
import { pool } from '../db';
import { PlanQuotaExceededError, SubscriptionAccessError, getCurrentUsagePeriodKey, reserveMonthlyUsage, releaseMonthlyUsage } from '../services/billing/usageMetering';

const router = Router();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const KEY_RE = /^[a-zA-Z0-9._:-]{8,120}$/;

function fail(res: Response, status: number, code: string, message: string, requestId: string) {
  res.status(status).json({ success: false, error: { code, message, requestId } });
}

// Single-recipient transactional/test email only. No bulk/campaign endpoint is exposed.
router.post('/send', requireAuth, requireTenant(), async (req: Request, res: Response): Promise<void> => {
  const requestId = req.requestId || 'req_unknown';
  const tenantId = req.tenantContext!.tenantId;
  const role = String(req.tenantContext!.role || '');
  const demo = res.locals.demoMode === true;
  if (!demo && !['Admin', 'Sales Manager', 'Sales Executive'].includes(role)) {
    fail(res, 403, 'EMAIL_SEND_FORBIDDEN', 'Your role cannot send email from this workspace.', requestId);
    return;
  }
  const to = typeof req.body?.to === 'string' ? req.body.to.trim().toLowerCase() : '';
  const subject = typeof req.body?.subject === 'string' ? req.body.subject.trim() : '';
  const textContent = typeof req.body?.textContent === 'string' ? req.body.textContent.trim() : '';
  const key = typeof req.body?.idempotencyKey === 'string' ? req.body.idempotencyKey.trim() : '';
  if (!EMAIL_RE.test(to) || to.length > 254 || !subject || subject.length > 160 || !textContent || textContent.length > 5000 || !KEY_RE.test(key)) {
    fail(res, 400, 'EMAIL_VALIDATION_ERROR', 'Provide a valid recipient, subject, text body and idempotency key.', requestId);
    return;
  }

  try {
    const previous = await pool.query(
      'SELECT id, status, provider_message_id AS "providerMessageId", provider FROM email_delivery_logs WHERE tenant_id = $1 AND idempotency_key = $2 LIMIT 1',
      [tenantId, key],
    );
    if (previous.rows[0]) {
      const row = previous.rows[0] as { id: string; status: string; providerMessageId: string | null; provider: string };
      if (row.status === 'accepted' || row.status === 'simulated') {
        res.status(200).json({ success: true, data: { status: row.status, provider: row.provider, providerMessageId: row.providerMessageId || row.id, idempotentReplay: true, notice: row.status === 'simulated' ? 'No email was sent; this was a demo simulation.' : 'Provider previously accepted this email; no duplicate was sent.' }, meta: { requestId, demoMode: demo, providerSent: row.status === 'accepted' } });
        return;
      }
      fail(res, 409, 'EMAIL_SEND_ALREADY_ATTEMPTED', 'This request has a previous pending, failed or uncertain attempt. Check provider logs before retrying.', requestId);
      return;
    }

    if (demo) {
      const messageId = 'demo-sim-email-' + crypto.randomUUID();
      const inserted = await pool.query(
        "INSERT INTO email_delivery_logs (tenant_id, idempotency_key, recipient_email, subject, status, provider, provider_message_id) VALUES ($1, $2, $3, $4, 'simulated', 'demo', $5) ON CONFLICT (tenant_id, idempotency_key) DO NOTHING RETURNING id",
        [tenantId, key, to, subject, messageId],
      );
      if (inserted.rowCount !== 1) {
        fail(res, 409, 'EMAIL_SEND_ALREADY_ATTEMPTED', 'This demo test was already submitted. Start another test action.', requestId);
        return;
      }
      res.status(202).json({ success: true, data: { status: 'simulated', provider: 'demo', providerMessageId: messageId, notice: 'No email was sent; this was a demo simulation.' }, meta: { requestId, demoMode: true, providerSent: false } });
      return;
    }

    const apiKey = process.env.BREVO_API_KEY?.trim();
    const from = process.env.EMAIL_FROM_ADDRESS?.trim().toLowerCase();
    const fromName = process.env.EMAIL_FROM_NAME?.trim() || 'OneClick Automics';
    if (!apiKey || !from || !EMAIL_RE.test(from)) {
      fail(res, 503, 'EMAIL_PROVIDER_NOT_CONFIGURED', 'Live email is disabled until an admin configures a Brevo API key and verified sender on the server.', requestId);
      return;
    }

    const reservation = await reserveMonthlyUsage(tenantId, 'emails', 1, getCurrentUsagePeriodKey());
    const pendingId = crypto.randomUUID();
    const inserted = await pool.query(
      "INSERT INTO email_delivery_logs (id, tenant_id, idempotency_key, recipient_email, subject, status, provider) VALUES ($1, $2, $3, $4, $5, 'pending', 'brevo') ON CONFLICT (tenant_id, idempotency_key) DO NOTHING RETURNING id",
      [pendingId, tenantId, key, to, subject],
    );
    if (inserted.rowCount !== 1) {
      await releaseMonthlyUsage(reservation).catch(() => undefined);
      fail(res, 409, 'EMAIL_SEND_ALREADY_ATTEMPTED', 'This request was submitted concurrently; a second email was not started.', requestId);
      return;
    }

    let providerResponse: globalThis.Response;
    try {
      providerResponse = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json', 'api-key': apiKey },
        body: JSON.stringify({ sender: { email: from, name: fromName }, to: [{ email: to }], subject, textContent, headers: { IdempotencyKey: key } }),
        signal: AbortSignal.timeout(12000),
      });
    } catch {
      await pool.query("UPDATE email_delivery_logs SET status = 'uncertain', error_code = 'PROVIDER_TIMEOUT_OR_NETWORK', updated_at = NOW() WHERE id = $1", [pendingId]).catch(() => undefined);
      fail(res, 502, 'EMAIL_DELIVERY_UNCERTAIN', 'The provider response could not be confirmed. Check provider logs before retrying; this request cannot be sent again with the same key.', requestId);
      return;
    }

    if (!providerResponse.ok) {
      await pool.query("UPDATE email_delivery_logs SET status = 'failed', error_code = 'PROVIDER_REJECTED', updated_at = NOW() WHERE id = $1", [pendingId]).catch(() => undefined);
      await releaseMonthlyUsage(reservation).catch(() => undefined);
      fail(res, 502, 'EMAIL_PROVIDER_REJECTED', 'The provider rejected the email. Check the verified sender, recipient and provider account.', requestId);
      return;
    }

    const providerPayload = await providerResponse.json().catch(() => ({} as { messageId?: string }));
    const providerMessageId = typeof providerPayload.messageId === 'string' ? providerPayload.messageId.slice(0, 500) : '';
    await pool.query("UPDATE email_delivery_logs SET status = 'accepted', provider_message_id = $2, updated_at = NOW() WHERE id = $1", [pendingId, providerMessageId || null]);
    res.status(202).json({ success: true, data: { status: 'accepted', provider: 'brevo', providerMessageId: providerMessageId || pendingId, notice: 'The provider accepted this email. Inbox delivery is not confirmed; check provider logs.' }, meta: { requestId, demoMode: false, providerSent: true, usage: { used: reservation.usedAfter, limit: reservation.limit } } });
  } catch (error) {
    if (error instanceof PlanQuotaExceededError) {
      res.status(429).json({ success: false, error: { code: error.code, message: 'This paid plan has reached its monthly email allowance.', limit: error.limit, used: error.used, requestId } });
      return;
    }
    if (error instanceof SubscriptionAccessError) {
      fail(res, 402, error.code, 'Email is unavailable while this subscription is suspended or cancelled.', requestId);
      return;
    }
    console.error('[Email] Send request failed', { requestId, tenantId, error });
    fail(res, 503, 'EMAIL_SEND_UNAVAILABLE', 'Email service is unavailable. No successful delivery has been confirmed.', requestId);
  }
});

export default router;
