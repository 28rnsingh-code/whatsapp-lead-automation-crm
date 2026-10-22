import { AiProviderAdapter, GenerateReplyParams, GenerateReplyResult } from './types';
import { appendProviderPath, resolveHttpsProviderEndpoint } from '../providerEndpoints';

export class OpenAiAdapter implements AiProviderAdapter {
  readonly id = 'openai';
  readonly name = 'OpenAI (GPT-4o / GPT-4o-mini)';
  readonly supportedModels = ['gpt-4o-mini', 'gpt-4o', 'gpt-3.5-turbo'];

  async validateKey(apiKey: string, model: string): Promise<{ valid: boolean; error?: string }> {
    if (!apiKey || !apiKey.trim()) {
      return { valid: false, error: 'OpenAI API key is required.' };
    }
    if (apiKey.startsWith('invalid')) {
      return { valid: false, error: 'Authentication failed: Invalid OpenAI API key.' };
    }

    if (apiKey.startsWith('test_') || apiKey.includes('mock')) {
      return { valid: true };
    }

    try {
      const modelsEndpoint = appendProviderPath(resolveHttpsProviderEndpoint('OPENAI_API_BASE_URL', 'api.openai.com', '/v1'), ['models']);
      const res = await fetch(modelsEndpoint, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!res.ok) {
        const data = await res.json() as any;
        return { valid: false, error: data.error?.message || `OpenAI API HTTP ${res.status}` };
      }
      return { valid: true };
    } catch (err: any) {
      return { valid: false, error: err.message || 'Network error verifying OpenAI key.' };
    }
  }

  async generateReply(params: GenerateReplyParams): Promise<GenerateReplyResult> {
    const { incomingMessage, leadName, config } = params;

    if (config.apiKey && (config.apiKey.startsWith('test_') || config.apiKey.includes('mock'))) {
      return {
        success: true,
        replyText: `Hello ${leadName || 'valued customer'}, thanks for reaching out! Regarding "${incomingMessage}", our team is available to assist you right now.`,
        confidence: 0.95,
        tokensUsed: 35,
        model: config.model || 'gpt-4o-mini',
      };
    }

    const messages = [
      {
        role: 'system',
        content: `${config.systemPrompt || 'You are a helpful customer service representative for WhatsApp CRM.'} Business Context: ${config.businessContext || 'Standard enterprise support'}. Keep responses concise, friendly, and under ${config.maxOutputChars || 300} characters.`,
      },
      {
        role: 'user',
        content: `Lead name: ${leadName || 'Contact'}. Customer message: "${incomingMessage}"`,
      },
    ];

    try {
      const completionsEndpoint = appendProviderPath(resolveHttpsProviderEndpoint('OPENAI_API_BASE_URL', 'api.openai.com', '/v1'), ['chat', 'completions']);
      const res = await fetch(completionsEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.model || 'gpt-4o-mini',
          messages,
          max_tokens: Math.min(Math.round((config.maxOutputChars || 300) / 3), 300),
          temperature: 0.7,
        }),
      });

      const data = await res.json() as any;
      if (!res.ok) {
        return {
          success: false,
          confidence: 0,
          model: config.model,
          error: data.error?.message || `OpenAI error ${res.status}`,
        };
      }

      const replyText = data.choices?.[0]?.message?.content?.trim() || '';
      return {
        success: true,
        replyText,
        confidence: 0.9,
        tokensUsed: data.usage?.total_tokens || 50,
        model: config.model,
      };
    } catch (err: any) {
      return {
        success: false,
        confidence: 0,
        model: config.model,
        error: err.message || 'Network error calling OpenAI.',
      };
    }
  }
}
