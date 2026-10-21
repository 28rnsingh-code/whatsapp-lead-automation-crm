export type AiProviderType = 'openai' | 'gemini' | 'anthropic' | 'mock';
export type AiReplyMode = 'disabled' | 'draft_only' | 'approval_before_send' | 'automatic_send';

export interface AiConfig {
  provider: AiProviderType;
  apiKey?: string;
  model: string;
  mode: AiReplyMode;
  systemPrompt?: string;
  businessContext?: string;
  confidenceThreshold: number; // e.g. 0.75
  maxOutputChars: number; // e.g. 300
  enabled: boolean;
  status?: 'active' | 'unconfigured' | 'error';
  lastTestedAt?: string;
  errorMessage?: string;
}

export interface MaskedAiConfig {
  provider: AiProviderType;
  apiKeyMasked?: string;
  model: string;
  mode: AiReplyMode;
  systemPrompt: string;
  businessContext: string;
  confidenceThreshold: number;
  maxOutputChars: number;
  enabled: boolean;
  status: 'active' | 'unconfigured' | 'error';
  lastTestedAt?: string;
  errorMessage?: string;
}

export interface GenerateReplyParams {
  tenantId: string;
  leadName?: string;
  companyName?: string;
  incomingMessage: string;
  conversationHistory?: Array<{ sender: 'lead' | 'agent'; text: string }>;
  config: AiConfig;
}

export interface GenerateReplyResult {
  success: boolean;
  replyText?: string;
  confidence: number;
  tokensUsed?: number;
  model: string;
  error?: string;
}

export interface AiProviderAdapter {
  readonly id: AiProviderType;
  readonly name: string;
  readonly supportedModels: string[];

  validateKey(apiKey: string, model: string): Promise<{ valid: boolean; error?: string }>;
  generateReply(params: GenerateReplyParams): Promise<GenerateReplyResult>;
}
