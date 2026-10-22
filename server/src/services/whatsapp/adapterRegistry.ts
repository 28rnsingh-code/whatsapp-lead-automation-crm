import crypto from 'crypto';
import { WhatsAppProviderAdapter, WhatsAppProviderType, WhatsAppCredentials, MaskedWhatsAppCredentials } from './types';
import { MockWhatsAppAdapter } from './mockAdapter';
import { CloudApiWhatsAppAdapter } from './cloudApiAdapter';
import { GupshupWhatsAppAdapter } from './gupshupAdapter';

const adapters: Record<WhatsAppProviderType, WhatsAppProviderAdapter> = {
  mock: new MockWhatsAppAdapter(),
  cloud_api: new CloudApiWhatsAppAdapter(),
  gupshup: new GupshupWhatsAppAdapter(),
  twilio: new MockWhatsAppAdapter(), // fallback for twilio
};

export function getWhatsAppAdapter(provider: WhatsAppProviderType = 'cloud_api'): WhatsAppProviderAdapter {
  return adapters[provider] || adapters.mock;
}

export function getAllSupportedWhatsAppProviders(): Array<{ id: WhatsAppProviderType; name: string }> {
  return [
    { id: 'cloud_api', name: 'Meta Official WhatsApp Cloud API' },
    { id: 'gupshup', name: 'Gupshup Enterprise WhatsApp API' },
    { id: 'twilio', name: 'Twilio WhatsApp API' },
    { id: 'mock', name: 'Local Test Mock Provider' },
  ];
}

export function maskSecret(secret?: string): string {
  if (!secret) return '';
  if (secret.length <= 6) return '••••••';
  const prefix = secret.slice(0, 3);
  const suffix = secret.slice(-3);
  return `${prefix}••••••••${suffix}`;
}

export function maskCredentials(config: any): MaskedWhatsAppCredentials {
  return {
    provider: config.provider || 'cloud_api',
    phoneNumberId: config.phoneNumberId || '',
    businessAccountId: config.businessAccountId || '',
    accessTokenMasked: maskSecret(config.accessToken),
    appSecretMasked: maskSecret(config.appSecret),
    webhookVerifyTokenMasked: maskSecret(config.webhookVerifyToken),
    apiKeyMasked: maskSecret(config.apiKey),
    sourceNumber: config.sourceNumber || '',
    status: config.status || 'unconfigured',
    lastTestedAt: config.lastTestedAt,
    errorMessage: config.errorMessage,
  };
}

// AES-256-GCM encryption for provider secrets at rest.
// The static fallback exists only for isolated local/demo runs. Production must provide
// a private, high-entropy ENCRYPTION_KEY; otherwise refuse to boot rather than store secrets
// under a predictable key.
const ENCRYPTION_SECRET = process.env.ENCRYPTION_KEY;
if (process.env.NODE_ENV === 'production' && (!ENCRYPTION_SECRET || ENCRYPTION_SECRET.length < 32)) {
  throw new Error('CRITICAL SECURITY ERROR: ENCRYPTION_KEY must be configured with at least 32 characters in production.');
}
const ENCRYPTION_KEY = crypto
  .createHash('sha256')
  .update(ENCRYPTION_SECRET || 'oneclick_crm_secret_key_32bytes!')
  .digest();

export function encryptSecret(plainText: string): string {
  if (!plainText) return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
  let encrypted = cipher.update(plainText, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return `enc:${iv.toString('hex')}:${authTag}:${encrypted}`;
}

export function decryptSecret(cipherText: string): string {
  if (!cipherText) return '';
  if (!cipherText.startsWith('enc:')) return cipherText; // unencrypted legacy/plain fallback
  try {
    const [, ivHex, tagHex, encryptedHex] = cipherText.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(tagHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch {
    return '';
  }
}
