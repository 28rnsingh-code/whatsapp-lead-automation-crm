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

const isProductionRuntime = () => process.env.NODE_ENV === 'production' || process.env.VERCEL === '1';

export function getWhatsAppAdapter(provider: WhatsAppProviderType = 'cloud_api'): WhatsAppProviderAdapter {
  if (isProductionRuntime() && provider !== 'cloud_api') {
    throw new Error(`WhatsApp provider "${String(provider)}" is not enabled for production delivery in this release.`);
  }
  const adapter = adapters[provider];
  if (!adapter) {
    throw new Error(`WhatsApp provider "${String(provider)}" is not implemented in this release.`);
  }
  return adapter;
}

export function getAllSupportedWhatsAppProviders(): Array<{ id: WhatsAppProviderType; name: string }> {
  const providers: Array<{ id: WhatsAppProviderType; name: string }> = [
    { id: 'cloud_api', name: 'Meta Official WhatsApp Cloud API' },
  ];
  if (!isProductionRuntime()) {
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

// AES-256-GCM encryption for provider secrets. Production must never encrypt
// customer credentials with the historical hard-coded development key.
const LEGACY_DEVELOPMENT_ENCRYPTION_SECRET = 'oneclick_crm_secret_key_32bytes!';

export function hasSecureEncryptionKey(): boolean {
  const secret = process.env.ENCRYPTION_KEY || '';
  const knownInsecureKeys = new Set([
    LEGACY_DEVELOPMENT_ENCRYPTION_SECRET,
    '0123456789abcdef0123456789abcdef',
  ]);
  return secret.length >= 32 &&
    !knownInsecureKeys.has(secret) &&
    !/^(replace|placeholder|changeme|example|your_)/i.test(secret);
}

function getEncryptionKey(forEncryption: boolean): Buffer {
  const configured = process.env.ENCRYPTION_KEY || '';
  if (isProductionRuntime() && !hasSecureEncryptionKey()) {
    if (forEncryption) {
      throw new Error('ENCRYPTION_KEY must be configured with a unique random value of at least 32 characters before saving or sending with provider secrets.');
    }
    // Read-only compatibility for settings encrypted by the previous hard-coded
    // key. Production sends remain disabled until a secure key is configured.
    return crypto.createHash('sha256').update(configured || LEGACY_DEVELOPMENT_ENCRYPTION_SECRET).digest();
  }
  return crypto.createHash('sha256').update(configured || LEGACY_DEVELOPMENT_ENCRYPTION_SECRET).digest();
}

export function encryptSecret(plainText: string): string {
  if (!plainText) return '';
  const key = getEncryptionKey(true);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(plainText, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return `enc:${iv.toString('hex')}:${authTag}:${encrypted}`;
}

export function decryptSecret(cipherText: string): string {
  if (!cipherText) return '';
  if (!cipherText.startsWith('enc:')) return cipherText; // Compatibility with older plaintext records.
  const key = getEncryptionKey(false);
  try {
    const [, ivHex, tagHex, encryptedHex] = cipherText.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(tagHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch {
    return '';
  }
}
