import { AiProviderAdapter, AiProviderType, AiConfig, MaskedAiConfig } from './types';
import { MockAiAdapter } from './mockAdapter';
import { OpenAiAdapter } from './openaiAdapter';
import { GeminiAdapter } from './geminiAdapter';
import { maskSecret, encryptSecret, decryptSecret } from '../whatsapp/adapterRegistry';

const adapters: Partial<Record<AiProviderType, AiProviderAdapter>> = {
  mock: new MockAiAdapter(),
  openai: new OpenAiAdapter(),
  gemini: new GeminiAdapter(),
};

export function getAiAdapter(provider: AiProviderType = 'mock'): AiProviderAdapter {
  const adapter = adapters[provider];
  if (!adapter) throw new Error(`AI provider \"${String(provider)}\" is not implemented in this release.`);
  if (provider === 'mock' && process.env.NODE_ENV === 'production') {
    throw new Error('The mock AI provider cannot be used in production. Configure a real AI provider.');
  }
  return adapter;
}

export function getAllSupportedAiProviders(): Array<{
  id: AiProviderType;
  name: string;
  supportedModels: string[];
}> {
  const providers: Array<{ id: AiProviderType; name: string; supportedModels: string[] }> = [
    {
      id: 'openai',
      name: 'OpenAI (GPT-4o / GPT-4o-mini)',
      supportedModels: ['gpt-4o-mini', 'gpt-4o', 'gpt-3.5-turbo'],
    },
    {
      id: 'gemini',
      name: 'Google Gemini',
      supportedModels: ['gemini-1.5-flash', 'gemini-1.5-pro'],
    },
  ];
  if (process.env.NODE_ENV !== 'production') {
    providers.push({
      id: 'mock',
      name: 'Local Sandbox / Mock AI',
      supportedModels: ['mock-fast-reply', 'mock-smart-assistant'],
    });
  }
  return providers;
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

export { encryptSecret, decryptSecret };
