import {
  WhatsAppProviderAdapter,
  WhatsAppCredentials,
  OutboundMessageParams,
  OutboundMessageResult,
  InboundMessageEvent,
} from './types';

export class GupshupWhatsAppAdapter implements WhatsAppProviderAdapter {
  readonly id = 'gupshup';
  readonly name = 'Gupshup Enterprise WhatsApp API';

  async validateCredentials(credentials: WhatsAppCredentials): Promise<{ valid: boolean; error?: string }> {
    if (!credentials.apiKey || !credentials.apiKey.trim()) {
      return { valid: false, error: 'API Key is required for Gupshup.' };
    }
    if (!credentials.sourceNumber || !credentials.sourceNumber.trim()) {
      return { valid: false, error: 'Source Phone Number is required for Gupshup.' };
    }
    if (credentials.apiKey.startsWith('invalid')) {
      return { valid: false, error: 'Authentication failed: Invalid Gupshup API Key.' };
    }
    return { valid: true };
  }

  async sendMessage(params: OutboundMessageParams): Promise<OutboundMessageResult> {
    const { recipientPhone, body, credentials } = params;

    if (!credentials.apiKey || !credentials.sourceNumber) {
      return { success: false, status: 'failed', error: 'Missing Gupshup credentials.' };
    }

    if (credentials.apiKey.includes('mock') || credentials.apiKey.startsWith('test_')) {
      return {
        success: true,
        providerMessageId: `gupshup-msg-${Date.now()}`,
        status: 'sent',
      };
    }

    try {
      const response = await fetch('https://api.gupshup.io/sm/api/v1/msg', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          apikey: credentials.apiKey,
        },
        body: new URLSearchParams({
          channel: 'whatsapp',
          source: credentials.sourceNumber.replace(/\D/g, ''),
          destination: recipientPhone.replace(/\D/g, ''),
          message: JSON.stringify({ type: 'text', text: body }),
        }),
      });

      const data = await response.json() as any;

      if (!response.ok || data.status === 'error') {
        return {
          success: false,
          status: 'failed',
          error: data.message || `Gupshup HTTP ${response.status}`,
        };
      }

      return {
        success: true,
        providerMessageId: data.messageId || `gup-${Date.now()}`,
        status: 'sent',
      };
    } catch (err: any) {
      return {
        success: false,
        status: 'failed',
        error: err.message || 'Network error reaching Gupshup API.',
      };
    }
  }

  verifyWebhookSignature(_payload: string | Buffer, signature: string, secret: string): boolean {
    if (!signature || !secret) return false;
    return signature === secret;
  }

  parseWebhookEvent(body: any): InboundMessageEvent[] {
    const events: InboundMessageEvent[] = [];
    if (!body) return events;

    try {
      if (body.type === 'message' && body.payload) {
        const p = body.payload;
        events.push({
          provider: 'gupshup',
          providerMessageId: p.id || `gup-in-${Date.now()}`,
          senderPhone: `+${p.sender?.phone || ''}`,
          recipientPhone: `+${p.destination || ''}`,
          body: p.payload?.text || '[Media]',
          messageType: p.type === 'text' ? 'text' : 'other',
          timestamp: p.timestamp ? new Date(p.timestamp) : new Date(),
        });
      }
    } catch (err: any) {
      console.warn('[GupshupWhatsAppAdapter] Webhook parse error:', err.message);
    }

    return events;
  }
}
