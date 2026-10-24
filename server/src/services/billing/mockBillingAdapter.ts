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
      return false;
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
      const timestampText = elements.find(e => e.startsWith('t='))?.slice(2);
      const signatureHex = elements.find(e => e.startsWith('v1='))?.slice(3);
      const timestamp = Number(timestampText);
      if (!timestampText || !signatureHex || !Number.isFinite(timestamp)) return false;

      // Stripe signs each delivery attempt; reject stale signed payloads and replayed requests.
      const nowSeconds = Math.floor(Date.now() / 1000);
      if (Math.abs(nowSeconds - timestamp) > 300) return false;

      const signedPayload = `${timestampText}.${payload.toString()}`;
      const expected = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');
      const actualBuffer = Buffer.from(signatureHex, 'hex');
      const expectedBuffer = Buffer.from(expected, 'hex');
      return actualBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
    } catch {
      return false;
    }
  }

  parseWebhookEvent(body: any): BillingWebhookEvent | null {
    if (!body || typeof body.id !== 'string' || !body.id || typeof body.type !== 'string') return null;
    const object = body.data?.object;
    if (!object || typeof object !== 'object') return null;

    const metadata = object.metadata || object.subscription_details?.metadata || object.parent?.subscription_details?.metadata;
    const tenantId = typeof metadata?.tenantId === 'string' ? metadata.tenantId : '';
    const planId = typeof metadata?.planId === 'string' ? metadata.planId : '';
    const supportedPlans = ['starter', 'growth', 'enterprise'];
    if (!tenantId || !supportedPlans.includes(planId)) return null;

    let eventType: BillingWebhookEvent['eventType'];
    let status: BillingWebhookEvent['status'];
    switch (body.type) {
      case 'customer.subscription.created':
        eventType = 'subscription.created';
        status = object.status === 'past_due' ? 'past_due' : object.status === 'canceled' ? 'cancelled' : 'active';
        break;
      case 'customer.subscription.updated':
      case 'invoice.payment_succeeded':
        eventType = 'subscription.renewed';
        status = object.status === 'past_due' ? 'past_due' : object.status === 'canceled' ? 'cancelled' : 'active';
        break;
      case 'customer.subscription.deleted':
        eventType = 'subscription.cancelled';
        status = 'cancelled';
        break;
      case 'invoice.payment_failed':
        eventType = 'payment.failed';
        status = 'past_due';
        break;
      default:
        return null;
    }

    const createdAt = Number(body.created);
    return {
      provider: 'stripe',
      eventId: body.id,
      eventType,
      tenantId,
      planId: planId as BillingWebhookEvent['planId'],
      status,
      timestamp: Number.isFinite(createdAt) && createdAt > 0 ? new Date(createdAt * 1000) : new Date(),
    };
  }
}

const adapters: Partial<Record<BillingProviderType, BillingProviderAdapter>> = {
  mock: new MockBillingAdapter(),
  stripe: new StripeBillingAdapter(),
  // Razorpay is deliberately unavailable until a real signature-verifying adapter is implemented.
};

export function getBillingAdapter(provider: BillingProviderType = 'mock'): BillingProviderAdapter {
  const adapter = adapters[provider];
  if (!adapter) throw new Error(`Billing provider "${String(provider)}" is not implemented in this release.`);
  return adapter;
}
