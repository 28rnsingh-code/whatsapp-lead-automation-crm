import { afterEach, describe, expect, it, vi } from 'vitest';
import { appendProviderPath, resolveHttpsProviderEndpoint } from '../src/services/providerEndpoints';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('Provider endpoint configuration', () => {
  it('resolves an approved HTTPS provider endpoint from the environment', () => {
    vi.stubEnv('OPENAI_API_BASE_URL', 'https://api.openai.com/v1');

    const base = resolveHttpsProviderEndpoint('OPENAI_API_BASE_URL', 'api.openai.com', '/v1');
    const endpoint = appendProviderPath(base, ['chat', 'completions']);

    expect(endpoint.toString()).toBe('https://api.openai.com/v1/chat/completions');
  });

  it.each([
    'http://api.openai.com/v1',
    'https://evil.example/v1',
    'https://api.openai.com/v2',
    'https://user:pass@api.openai.com/v1',
    'https://api.openai.com/v1?redirect=https://evil.example',
    'https://api.openai.com:8443/v1',
  ])('rejects an unsafe or unsupported endpoint: %s', (value) => {
    vi.stubEnv('OPENAI_API_BASE_URL', value);

    expect(() => resolveHttpsProviderEndpoint('OPENAI_API_BASE_URL', 'api.openai.com', '/v1'))
      .toThrow('OPENAI_API_BASE_URL must use HTTPS and the approved provider host and path.');
  });

  it('rejects missing endpoint configuration instead of guessing an endpoint', () => {
    vi.stubEnv('GUPSHUP_API_ENDPOINT', '');

    expect(() => resolveHttpsProviderEndpoint('GUPSHUP_API_ENDPOINT', 'api.gupshup.io', '/sm/api/v1/msg'))
      .toThrow('GUPSHUP_API_ENDPOINT must be configured before using this provider.');
  });

  it('accepts a provider-specific versioned Graph API path', () => {
    vi.stubEnv('WHATSAPP_API_ENDPOINT', 'https://graph.facebook.com/v20.0');

    const endpoint = resolveHttpsProviderEndpoint('WHATSAPP_API_ENDPOINT', 'graph.facebook.com', /^\/v\d+\.\d+$/);
    expect(appendProviderPath(endpoint, ['123456789', 'messages']).toString())
      .toBe('https://graph.facebook.com/v20.0/123456789/messages');
  });
});
