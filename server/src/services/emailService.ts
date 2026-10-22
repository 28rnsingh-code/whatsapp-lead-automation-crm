const RESEND_API_HOST = 'api.resend.com';
const RESEND_API_PATH = '/emails';

function getValidatedResendApiUrl(): string | null {
  const configuredUrl = process.env.RESEND_API_URL?.trim();
  if (!configuredUrl) return null;

  try {
    const url = new URL(configuredUrl);
    if (
      url.protocol !== 'https:'
      || url.hostname.toLowerCase() !== RESEND_API_HOST
      || url.pathname !== RESEND_API_PATH
      || url.username
      || url.password
      || url.port
      || url.search
      || url.hash
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

export function isPasswordResetDeliveryConfigured(): boolean {
  return Boolean(
    process.env.RESEND_API_KEY?.trim()
    && process.env.EMAIL_FROM?.trim()
    && process.env.APP_PUBLIC_URL?.trim()
    && getValidatedResendApiUrl()
  );
}

/**
 * Send recovery mail via the Resend HTTPS API. Credentials remain server-only.
 * Error messages intentionally omit response bodies, recipient addresses, and tokens.
 */
export async function sendPasswordResetEmail(
  recipient: string,
  displayName: string,
  resetUrl: string,
  signal?: AbortSignal,
): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.EMAIL_FROM?.trim();
  const apiUrl = getValidatedResendApiUrl();
  if (!apiKey || !from || !apiUrl) {
    throw new Error('Password reset email delivery is not configured with a valid Resend endpoint.');
  }

  const publicOrigin = process.env.APP_PUBLIC_URL?.trim();
  if (!publicOrigin) {
    throw new Error('APP_PUBLIC_URL is required for password reset delivery.');
  }
  const base = new URL(publicOrigin);
  const destination = new URL(resetUrl);
  if (base.origin !== destination.origin) {
    throw new Error('Reset URL origin does not match the configured application origin.');
  }
  if (process.env.NODE_ENV === 'production' && base.protocol !== 'https:') {
    throw new Error('Password reset URLs must use HTTPS in production.');
  }

  const safeName = displayName.replace(/[<>"'&]/g, '').slice(0, 120) || 'there';
  const timeoutSignal = signal ? undefined : AbortSignal.timeout(10000);
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [recipient],
      subject: 'Reset your OneClick Automics CRM password',
      text: `Hello ${safeName},\n\nUse this one-time link to reset your password. It expires shortly:\n${destination.toString()}\n\nIf you did not request this, you can ignore this email.`,
      html: `<p>Hello ${safeName},</p><p>Use this one-time link to reset your password. It expires shortly:</p><p><a href="${destination.toString()}">Reset password</a></p><p>If you did not request this, you can ignore this email.</p>`,
    }),
    signal: signal || timeoutSignal,
  });

  if (!response.ok) {
    throw new Error(`Password reset email provider returned HTTP ${response.status}.`);
  }
}
