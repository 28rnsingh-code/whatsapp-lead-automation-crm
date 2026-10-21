import { AiProviderAdapter, GenerateReplyParams, GenerateReplyResult } from './types';

export class MockAiAdapter implements AiProviderAdapter {
  readonly id = 'mock';
  readonly name = 'Local Mock AI (Sandbox)';
  readonly supportedModels = ['mock-fast-reply', 'mock-smart-assistant'];

  async validateKey(apiKey: string, _model: string): Promise<{ valid: boolean; error?: string }> {
    if (apiKey && apiKey.startsWith('invalid')) {
      return { valid: false, error: 'Invalid API Key provided for mock AI provider.' };
    }
    return { valid: true };
  }

  async generateReply(params: GenerateReplyParams): Promise<GenerateReplyResult> {
    const { incomingMessage, leadName, config } = params;
    const name = leadName || 'there';

    let reply = `Hello ${name}! Thank you for your inquiry about "${incomingMessage.slice(0, 30)}...". Our team is ready to assist you.`;
    if (config.businessContext) {
      reply += ` ${config.businessContext.slice(0, 80)}`;
    }

    if (config.maxOutputChars && reply.length > config.maxOutputChars) {
      reply = reply.slice(0, config.maxOutputChars - 3) + '...';
    }

    return {
      success: true,
      replyText: reply,
      confidence: 0.92,
      tokensUsed: 42,
      model: config.model || 'mock-fast-reply',
    };
  }
}
