import crypto from 'crypto';
import {
  WhatsAppProviderAdapter,
  WhatsAppCredentials,
  OutboundMessageParams,
  OutboundMessageResult,
  InboundMessageEvent,
} from './types';

export class MockWhatsAppAdapter implements WhatsAppProviderAdapter {
  readonly id = 'mock';
  readonly name = 'Local Mock Provider (Simulated)';

  async validateCredentials(credentials: WhatsAppCredentials): Promise<{ valid: boolean; error?: string }> {
    if (process.env.NODE_ENV === 'production') {
      return { valid: false, error: 'The mock WhatsApp provider is disabled in production.' };
    }
    if (credentials.apiKey && credentials.apiKey.startsWith('invalid')) {
      return { valid: false, error: 'Invalid API Key provided for mock provider.' };
    }
    return { valid: true };
  }

  async sendMessage(params: OutboundMessageParams): Promise<OutboundMessageResult> {
    if (process.env.NODE_ENV === 'production') {
      return { success: false, status: 'failed', error: 'The mock WhatsApp provider is disabled in production.' };
    }
    if (params.recipientPhone.includes('0000000000')) {
      return {
        success: false,
        status: 'failed',
        error: 'Recipient phone number is invalid or disconnected.',
      };
    }

    const providerMessageId = `mock-msg-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    return {
      success: true,
      providerMessageId,
      status: 'sent',
    };
  }

  verifyWebhookSignature(payload: string | Buffer, signature: string, secret: string): boolean {
    if (!signature || !secret) return false;
    const cleanSignature = signature.replace(/^sha256=/, '');
    const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    return crypto.timingSafeEqual(Buffer.from(cleanSignature, 'hex'), Buffer.from(expected, 'hex'));
  }

  parseWebhookEvent(body: any): InboundMessageEvent[] {
    const events: InboundMessageEvent[] = [];
    if (!body) return events;

    // Support direct mock event payload
    if (body.senderPhone && body.body) {
      events.push({
        provider: 'mock',
        providerMessageId: body.providerMessageId || `mock-in-${Date.now()}`,
        senderPhone: body.senderPhone,
        recipientPhone: body.recipientPhone || '+919999988888',
        body: body.body,
        messageType: body.messageType || 'text',
        timestamp: new Date(),
      });
    }

    return events;
  }
}
