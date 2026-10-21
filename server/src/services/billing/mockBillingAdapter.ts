import crypto from 'crypto';
import {
  BillingProviderAdapter,
  BillingProviderType,
  BillingWebhookEvent,
} from './types';

export class MockBillingAdapter implements BillingProviderAdapter {
  readonly id: BillingProviderType = 'mock';
  readonly name = 'Mock Subscription & Billing Provider';

  verifyWebhookSignature(payload: string | Buffer, signature: string, secret: string): boolean {
    if (!signature || !secret) return false;
    try {
      const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
      return crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'));
    } catch {
      return signature === secret;
    }
  }

  parseWebhookEvent(body: any): BillingWebhookEvent | null {
    if (!body || !body.eventId || !body.tenantId) return null;

    return {
      provider: 'mock',
      eventId: body.eventId,
      eventType: body.eventType || 'subscription.renewed',
      tenantId: body.tenantId,
      planId: body.planId || 'growth',
      status: body.status || 'active',
      timestamp: body.timestamp ? new Date(body.timestamp) : new Date(),
    };
  }
}

export class StripeBillingAdapter implements BillingProviderAdapter {
  readonly id: BillingProviderType = 'stripe';
  readonly name = 'Stripe Subscriptions';

  verifyWebhookSignature(payload: string | Buffer, signature: string, secret: string): boolean {
    if (!signature || !secret) return false;
    try {
      const elements = signature.split(',');
      const timestamp = elements.find(e => e.startsWith('t='))?.slice(2);
      const sig = elements.find(e => e.startsWith('v1='))?.slice(3);
      if (!timestamp || !sig) return false;
      const signedPayload = `${timestamp}.${payload.toString()}`;
      const expected = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');
      return crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'));
    } catch {
      return false;
    }
  }

  parseWebhookEvent(body: any): BillingWebhookEvent | null {
    if (!body || !body.id) return null;
    const type = body.type;
    const obj = body.data?.object;
    if (!obj) return null;

    let eventType: BillingWebhookEvent['eventType'] = 'subscription.renewed';
    let status: BillingWebhookEvent['status'] = 'active';

    if (type === 'customer.subscription.deleted') {
      eventType = 'subscription.cancelled';
      status = 'cancelled';
    } else if (type === 'invoice.payment_failed') {
      eventType = 'payment.failed';
      status = 'past_due';
    }

    return {
      provider: 'stripe',
      eventId: body.id,
      eventType,
      tenantId: obj.metadata?.tenantId || 'tenant_bring_my_bite',
      planId: (obj.metadata?.planId as any) || 'growth',
      status,
      timestamp: new Date(body.created * 1000),
    };
  }
}

const adapters: Record<BillingProviderType, BillingProviderAdapter> = {
  mock: new MockBillingAdapter(),
  stripe: new StripeBillingAdapter(),
  razorpay: new MockBillingAdapter(), // graceful adapter for razorpay
};

export function getBillingAdapter(provider: BillingProviderType = 'mock'): BillingProviderAdapter {
  return adapters[provider] || adapters.mock;
}
