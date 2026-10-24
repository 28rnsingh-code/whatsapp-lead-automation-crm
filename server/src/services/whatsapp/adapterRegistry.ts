import crypto from 'crypto';
import { WhatsAppProviderAdapter, WhatsAppProviderType, WhatsAppCredentials, MaskedWhatsAppCredentials } from './types';
import { MockWhatsAppAdapter } from './mockAdapter';
import { CloudApiWhatsAppAdapter } from './cloudApiAdapter';
import { GupshupWhatsAppAdapter } from './gupshupAdapter';

const adapters: Partial<Record<WhatsAppProviderType, WhatsAppProviderAdapter>> = {
  mock: new MockWhatsAppAdapter(),
  cloud_api: new CloudApiWhatsAppAdapter(),
  gupshup: new GupshupWhatsAppAdapter(),
  // Twilio is intentionally not registered until a genuine Twilio adapter is implemented.
};

export function getWhatsAppAdapter(provider: WhatsAppProviderType = 'cloud_api'): WhatsAppProviderAdapter {
  const adapter = adapters[provider];
  if (!adapter) {
    throw new Error(`WhatsApp provider "${String(provider)}" is not implemented in this release.`);
  }
  if (provider === 'mock' && process.env.NODE_ENV === 'production') {
    throw new Error('The mock WhatsApp provider cannot be used in production.');
  }
  return adapter;
}

export function getAllSupportedWhatsAppProviders(): Array<{ id: WhatsAppProviderType; name: string }> {
  const providers: Array<{ id: WhatsAppProviderType; name: string }> = [
    { id: 'cloud_api', name: 'Meta Official WhatsApp Cloud API' },
  ];
  if (process.env.NODE_ENV !== 'production') {
    providers.push({ id: 'mock', name: 'Local Test Mock Provider' });
  }
  return providers;
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

// AES-256-GCM encryption for storing secrets at rest
const ENCRYPTION_SECRET = process.env.ENCRYPTION_KEY || 'oneclick_crm_secret_key_32bytes!';
const ENCRYPTION_KEY = crypto.createHash('sha256').update(ENCRYPTION_SECRET).digest();

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
