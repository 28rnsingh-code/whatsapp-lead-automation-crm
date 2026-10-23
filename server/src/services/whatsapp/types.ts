export type WhatsAppProviderType = 'cloud_api' | 'gupshup' | 'twilio' | 'mock';

export interface WhatsAppCredentials {
  provider: WhatsAppProviderType;
  phoneNumberId?: string;
  businessAccountId?: string;
  accessToken?: string;
  appSecret?: string;
  webhookVerifyToken?: string;
  apiKey?: string;
  sourceNumber?: string;
  accountSid?: string;
  authToken?: string;
  [key: string]: any;
}

export interface MaskedWhatsAppCredentials {
  provider: WhatsAppProviderType;
  phoneNumberId?: string;
  businessAccountId?: string;
  accessTokenMasked?: string;
  appSecretMasked?: string;
  webhookVerifyTokenMasked?: string;
  apiKeyMasked?: string;
  sourceNumber?: string;
  status: 'connected' | 'unconfigured' | 'error';
  lastTestedAt?: string;
  errorMessage?: string;
}

export interface OutboundMessageParams {
  tenantId: string;
  recipientPhone: string;
  senderPhone?: string;
  messageType: 'text' | 'template' | 'image' | 'document';
  body: string;
  templateName?: string;
  templateLanguage?: string;
  templateParameters?: string[];
  idempotencyKey?: string;
  leadId?: string;
  credentials: WhatsAppCredentials;
}

export interface OutboundMessageResult {
  success: boolean;
  providerMessageId?: string;
  status: 'sent' | 'delivered' | 'failed' | 'queued';
  error?: string;
}

export interface InboundMessageEvent {
  provider: WhatsAppProviderType;
  providerMessageId: string;
  senderPhone: string;
  recipientPhone: string;
  body: string;
  messageType: 'text' | 'image' | 'document' | 'other';
  timestamp: Date;
  statusUpdate?: 'sent' | 'delivered' | 'read' | 'failed';
}

export interface WhatsAppTemplate {
  name: string;
  language: string;
  category: 'MARKETING' | 'UTILITY' | 'AUTHENTICATION';
  header?: string;
  body: string;
  status: 'APPROVED' | 'PENDING' | 'REJECTED';
}

export interface WhatsAppProviderAdapter {
  readonly id: WhatsAppProviderType;
  readonly name: string;

  validateCredentials(credentials: WhatsAppCredentials): Promise<{ valid: boolean; error?: string }>;
  sendMessage(params: OutboundMessageParams): Promise<OutboundMessageResult>;
  verifyWebhookSignature(payload: string | Buffer, signature: string, secret: string): boolean;
  parseWebhookEvent(body: any): InboundMessageEvent[];
}
