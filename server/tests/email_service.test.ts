import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isPasswordResetDeliveryConfigured,
  sendPasswordResetEmail,
} from '../src/services/emailService';

function stubValidEmailConfiguration(): void {
  vi.stubEnv('RESEND_API_URL', 'https://api.resend.com/emails');
  vi.stubEnv('RESEND_API_KEY', 'test-resend-api-key');
  vi.stubEnv('EMAIL_FROM', 'CRM QA <qa@example.com>');
  vi.stubEnv('APP_PUBLIC_URL', 'https://crm.example.com');
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Password reset email provider configuration', () => {
  it('requires explicit credentials, sender, application origin, and endpoint configuration', () => {
    expect(isPasswordResetDeliveryConfigured()).toBe(false);

    stubValidEmailConfiguration();
    expect(isPasswordResetDeliveryConfigured()).toBe(true);
  });

  it.each([
    'http://api.resend.com/emails',
    'https://evil.example/emails',
    'https://api.resend.com/other',
    'https://user:pass@api.resend.com/emails',
    'https://api.resend.com/emails?redirect=https://evil.example',
  ])('rejects unsafe or unsupported provider endpoint %s', (endpoint) => {
    stubValidEmailConfiguration();
    vi.stubEnv('RESEND_API_URL', endpoint);

    expect(isPasswordResetDeliveryConfigured()).toBe(false);
  });

  it('sends only to the validated Resend endpoint with server-side authorization', async () => {
    stubValidEmailConfiguration();
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => (
      new Response(null, { status: 202 })
    ));
    vi.stubGlobal('fetch', fetchMock);

    await sendPasswordResetEmail(
      'person@example.com',
      'Ada Lovelace',
      'https://crm.example.com/reset-password?token=synthetic-one-time-token',
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    const firstCall = fetchMock.mock.calls[0];
    expect(String(firstCall[0])).toBe('https://api.resend.com/emails');
    const options = firstCall[1] as RequestInit;
    expect(new Headers(options.headers).get('Authorization')).toBe('Bearer test-resend-api-key');

    const payload = JSON.parse(String(options.body)) as { to: string[]; html: string; text: string };
    expect(payload.to).toEqual(['person@example.com']);
    expect(payload.html).toContain('synthetic-one-time-token');
    expect(payload.text).toContain('synthetic-one-time-token');
  });

  it('rejects a reset link on another origin before contacting the email provider', async () => {
    stubValidEmailConfiguration();
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => (
      new Response(null, { status: 202 })
    ));
    vi.stubGlobal('fetch', fetchMock);

    await expect(sendPasswordResetEmail(
      'person@example.com',
      'Ada',
      'https://evil.example/reset-password?token=synthetic',
    )).rejects.toThrow('Reset URL origin does not match the configured application origin.');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
