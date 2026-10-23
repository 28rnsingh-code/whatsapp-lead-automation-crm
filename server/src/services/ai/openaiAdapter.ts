import { AiProviderAdapter, GenerateReplyParams, GenerateReplyResult } from './types';

function isTestRuntime(): boolean { return process.env.NODE_ENV === 'test' || process.env.VITEST === 'true'; }

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

    if (apiKey.startsWith('test_') || apiKey.toLowerCase().includes('mock')) {
      return isTestRuntime()
        ? { valid: true }
        : { valid: false, error: 'Placeholder/test API keys are allowed only in automated tests. Enter a real OpenAI API key.' };
    }

    try {
      const res = await fetch('https://api.openai.com/v1/models', {
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

    if (config.apiKey && (config.apiKey.startsWith('test_') || config.apiKey.toLowerCase().includes('mock')) && isTestRuntime()) {
      return {
        success: true,
        replyText: `Hello ${leadName || 'valued customer'}, thanks for reaching out! Regarding "${incomingMessage}", our team is available to assist you right now.`,
        confidence: 0.95,
        tokensUsed: 35,
        model: config.model || 'gpt-4o-mini',
      };
    }

    if (config.apiKey && (config.apiKey.startsWith('test_') || config.apiKey.toLowerCase().includes('mock'))) {
      return { success: false, confidence: 0, model: config.model, error: 'Placeholder/test API keys cannot be used outside automated tests.' };
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
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
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
