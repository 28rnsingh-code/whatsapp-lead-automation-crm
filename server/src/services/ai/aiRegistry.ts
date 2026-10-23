import { AiProviderAdapter, AiProviderType, AiConfig, MaskedAiConfig } from './types';
import { MockAiAdapter } from './mockAdapter';
import { OpenAiAdapter } from './openaiAdapter';
import { GeminiAdapter } from './geminiAdapter';
import { maskSecret, encryptSecret, decryptSecret, hasSecureEncryptionKey } from '../whatsapp/adapterRegistry';

const adapters: Partial<Record<AiProviderType, AiProviderAdapter>> = {
  openai: new OpenAiAdapter(),
  gemini: new GeminiAdapter(),
  mock: new MockAiAdapter(),
};

export function getAiAdapter(provider: AiProviderType = 'mock'): AiProviderAdapter {
  if (!adapters[provider] || (provider === 'mock' && process.env.NODE_ENV === 'production')) {
    throw new Error(`AI provider "${String(provider)}" is not implemented or is disabled in production.`);
  }
  return adapters[provider]!;
}

export function getAllSupportedAiProviders(): Array<{
  id: AiProviderType;
  name: string;
  supportedModels: string[];
}> {
  const supported: Array<{ id: AiProviderType; name: string; supportedModels: string[] }> = [
    {
      id: 'openai',
      name: 'OpenAI (GPT-4o / GPT-4o-mini)',
      supportedModels: ['gpt-4o-mini', 'gpt-4o', 'gpt-3.5-turbo'],
    },
    {
      id: 'gemini',
      name: 'Google Gemini (1.5 Flash / Pro)',
      supportedModels: ['gemini-1.5-flash', 'gemini-1.5-pro'],
    },
  ];
  if (process.env.NODE_ENV !== 'production') {
    supported.push({
      id: 'mock',
      name: 'Local Sandbox / Mock AI',
      supportedModels: ['mock-fast-reply', 'mock-smart-assistant'],
    });
  }
  return supported;
}

export function maskAiConfig(config: AiConfig): MaskedAiConfig {
  return {
    provider: config.provider || 'mock',
    apiKeyMasked: maskSecret(config.apiKey),
    model: config.model || 'mock-fast-reply',
    mode: config.mode || 'draft_only',
    systemPrompt: config.systemPrompt || 'You are an intelligent, courteous WhatsApp sales representative.',
    businessContext: config.businessContext || '',
    confidenceThreshold: config.confidenceThreshold || 0.75,
    maxOutputChars: config.maxOutputChars || 300,
    enabled: !!config.enabled,
    status: config.status || 'unconfigured',
    lastTestedAt: config.lastTestedAt,
    errorMessage: config.errorMessage,
  };
}

export { encryptSecret, decryptSecret, hasSecureEncryptionKey };
