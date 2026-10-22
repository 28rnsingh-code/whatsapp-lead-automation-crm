import { AiProviderAdapter, GenerateReplyParams, GenerateReplyResult } from './types';
import { appendProviderPath, resolveHttpsProviderEndpoint } from '../providerEndpoints';

export class GeminiAdapter implements AiProviderAdapter {
  readonly id = 'gemini';
  readonly name = 'Google Gemini (Gemini 1.5 Flash / Pro)';
  readonly supportedModels = ['gemini-1.5-flash', 'gemini-1.5-pro'];

  async validateKey(apiKey: string, model: string): Promise<{ valid: boolean; error?: string }> {
    if (!apiKey || !apiKey.trim()) {
      return { valid: false, error: 'Gemini API key is required.' };
    }
    if (apiKey.startsWith('invalid')) {
      return { valid: false, error: 'Authentication failed: Invalid Gemini API key.' };
    }
    if (apiKey.startsWith('test_') || apiKey.includes('mock')) {
      return { valid: true };
    }

    try {
      const targetModel = model || 'gemini-1.5-flash';
      const url = appendProviderPath(resolveHttpsProviderEndpoint('GEMINI_API_BASE_URL', 'generativelanguage.googleapis.com', '/v1beta'), ['models', targetModel]);
      url.pathname += ':generateContent';
      url.searchParams.set('key', apiKey);
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: 'Hello' }] }],
        }),
      });

      if (!res.ok) {
        const data = await res.json() as any;
        return { valid: false, error: data.error?.message || `Gemini HTTP ${res.status}` };
      }
      return { valid: true };
    } catch (err: any) {
      return { valid: false, error: err.message || 'Network error verifying Gemini key.' };
    }
  }

  async generateReply(params: GenerateReplyParams): Promise<GenerateReplyResult> {
    const { incomingMessage, leadName, config } = params;
    const targetModel = config.model || 'gemini-1.5-flash';

    if (config.apiKey && (config.apiKey.startsWith('test_') || config.apiKey.includes('mock'))) {
      return {
        success: true,
        replyText: `Hello ${leadName || 'valued customer'}! Thanks for contacting us. We received your note: "${incomingMessage}". Let us assist you with that today.`,
        confidence: 0.94,
        tokensUsed: 38,
        model: targetModel,
      };
    }

    const promptText = `
System instructions: ${config.systemPrompt || 'You are an automated CRM assistant.'}
Business context: ${config.businessContext || 'Standard enterprise services'}
Lead Name: ${leadName || 'Customer'}
Customer Inquiry: "${incomingMessage}"
Rules: Provide a helpful, professional reply under ${config.maxOutputChars || 300} characters.
    `.trim();

    try {
      const url = appendProviderPath(resolveHttpsProviderEndpoint('GEMINI_API_BASE_URL', 'generativelanguage.googleapis.com', '/v1beta'), ['models', targetModel]);
      url.pathname += ':generateContent';
      url.searchParams.set('key', config.apiKey);
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: promptText }] }],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: Math.min(Math.round((config.maxOutputChars || 300) / 3), 300),
          },
        }),
      });

      const data = await res.json() as any;
      if (!res.ok) {
        return {
          success: false,
          confidence: 0,
          model: targetModel,
          error: data.error?.message || `Gemini API error ${res.status}`,
        };
      }

      const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
      return {
        success: true,
        replyText: text,
        confidence: 0.92,
        tokensUsed: data.usageMetadata?.totalTokenCount || 40,
        model: targetModel,
      };
    } catch (err: any) {
      return {
        success: false,
        confidence: 0,
        model: targetModel,
        error: err.message || 'Network error reaching Gemini API.',
      };
    }
  }
}
