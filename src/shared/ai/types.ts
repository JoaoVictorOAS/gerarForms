/**
 * FormGen - Multi-Provider AI Service & Structured Generation
 * Shared AI Types, Adapter Interfaces & Unified Error Hierarchy
 * Path: src/shared/ai/types.ts
 */

import {
  ProviderType,
  ProviderConfig,
  GenerationDefaults,
  FormGenSettings,
  FormField,
  FormSchema,
  FormRecord,
  GenerationEnvelope,
} from '../types';

// Re-export common types for consumers
export type {
  ProviderType,
  ProviderConfig,
  GenerationDefaults,
  FormGenSettings,
  FormField,
  FormSchema,
  FormRecord,
  GenerationEnvelope,
};

// ============================================================================
// 1. Unified AI Error Classification Hierarchy
// ============================================================================

export abstract class AIError extends Error {
  public abstract readonly code: string;
  public readonly provider: ProviderType;
  public readonly status?: number;
  public readonly isTransient: boolean;
  public readonly rawError?: unknown;

  constructor(
    message: string,
    provider: ProviderType,
    options?: { status?: number; isTransient?: boolean; rawError?: unknown; cause?: unknown }
  ) {
    super(message, { cause: options?.cause });
    this.name = this.constructor.name;
    this.provider = provider;
    this.status = options?.status;
    this.isTransient = options?.isTransient ?? false;
    this.rawError = options?.rawError;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class AIAuthError extends AIError {
  public readonly code = 'AUTH_ERROR';
  constructor(message: string, provider: ProviderType, options?: { status?: number; rawError?: unknown }) {
    super(message, provider, { ...options, isTransient: false });
  }
}

export class AIRateLimitError extends AIError {
  public readonly code = 'RATE_LIMIT_ERROR';
  public readonly retryAfterSeconds?: number;
  constructor(message: string, provider: ProviderType, options?: { status?: number; retryAfterSeconds?: number; rawError?: unknown }) {
    super(message, provider, { ...options, isTransient: true });
    this.retryAfterSeconds = options?.retryAfterSeconds;
  }
}

export class AIModelNotFoundError extends AIError {
  public readonly code = 'MODEL_NOT_FOUND';
  constructor(message: string, provider: ProviderType, options?: { status?: number; rawError?: unknown }) {
    super(message, provider, { ...options, isTransient: false });
  }
}

export class AINetworkError extends AIError {
  public readonly code = 'NETWORK_ERROR';
  constructor(message: string, provider: ProviderType, options?: { rawError?: unknown; cause?: unknown }) {
    super(message, provider, { ...options, isTransient: true });
  }
}

export class AITimeoutError extends AIError {
  public readonly code = 'TIMEOUT_ERROR';
  public readonly timeoutMs: number;
  constructor(message: string, provider: ProviderType, timeoutMs: number) {
    super(
      message || `A requisição para o provedor ${provider} excedeu o tempo limite de ${Math.round(timeoutMs / 1000)}s.`,
      provider,
      { isTransient: true }
    );
    this.timeoutMs = timeoutMs;
  }
}

export class AIAbortError extends AIError {
  public readonly code = 'ABORT_ERROR';
  constructor(message: string, provider: ProviderType) {
    super(message, provider, { isTransient: false });
  }
}

export class AISafetyBlockError extends AIError {
  public readonly code = 'SAFETY_BLOCK_ERROR';
  public readonly blockReason?: string;
  constructor(message: string, provider: ProviderType, blockReason?: string) {
    super(message, provider, { isTransient: false });
    this.blockReason = blockReason;
  }
}

export class AIContextLengthExceededError extends AIError {
  public readonly code = 'CONTEXT_LENGTH_EXCEEDED';
  constructor(message: string, provider: ProviderType, options?: { status?: number; rawError?: unknown }) {
    super(message, provider, { ...options, isTransient: false });
  }
}

export class AIServerError extends AIError {
  public readonly code = 'SERVER_ERROR';
  constructor(message: string, provider: ProviderType, options?: { status?: number; rawError?: unknown }) {
    super(message, provider, { ...options, isTransient: true });
  }
}

export class AIInvalidResponseError extends AIError {
  public readonly code = 'INVALID_RESPONSE_ERROR';
  constructor(message: string, provider: ProviderType, options?: { rawError?: unknown }) {
    super(message, provider, { ...options, isTransient: false });
  }
}

export class EmptyAIResponseError extends Error {
  constructor(message = 'Resposta vazia recebida do provedor de IA.') {
    super(message);
    this.name = 'EmptyAIResponseError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class MalformedJsonResponseError extends Error {
  public readonly rawText?: string;
  constructor(message: string, rawText?: string) {
    super(message);
    this.name = 'MalformedJsonResponseError';
    this.rawText = rawText;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ============================================================================
// 2. Adapter Interfaces & Request/Response Contracts
// ============================================================================

export interface GenerateRequestOptions {
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
  abortSignal?: AbortSignal;
  timeoutMs?: number;
}

export interface GenerateResult {
  rawText: string;
  provider: ProviderType;
  model: string;
  durationMs: number;
}

export interface AIProviderAdapter {
  readonly providerType: ProviderType;
  generate(config: ProviderConfig, options: GenerateRequestOptions): Promise<GenerateResult>;
}

// ============================================================================
// 3. Prompt & Schema Compression Contracts
// ============================================================================

export interface CompactFieldDescriptor {
  key: string;
  label: string;
  type: string;
  req?: boolean;
  options?: string[];
  min?: number | string;
  max?: number | string;
  step?: number | string;
  minLen?: number;
  maxLen?: number;
  pattern?: string;
  hint?: string;
}

export interface AssembledPrompt {
  systemPrompt: string;
  userPrompt: string;
  compactFields: CompactFieldDescriptor[];
  fieldKeyMap: Map<string, FormField>;
}

// ============================================================================
// 4. Chunking Pipeline & Progress Contracts
// ============================================================================

export interface ChunkProgress {
  completedRecords: number;
  totalRecords: number;
  currentChunk: number;
  totalChunks: number;
  percent: number;
  status: 'running' | 'completed' | 'failed_recovered';
}

export type ProgressCallback = (progress: ChunkProgress) => void;

export interface ChunkPipelineOptions {
  totalRecords: 1 | 10 | 100;
  chunkSize?: number;
  concurrencyLimit?: number;
  locale?: string;
  onProgress?: ProgressCallback;
  fetchChunkFn: (subCount: number, chunkIndex: number) => Promise<FormRecord[]>;
}

// ============================================================================
// 5. High-Level AI Service Parameters
// ============================================================================

export interface GenerateFormDataParams {
  provider: ProviderType;
  config: ProviderConfig;
  defaults?: GenerationDefaults;
  schema: FormSchema;
  count: 1 | 10 | 100;
  abortSignal?: AbortSignal;
  onProgress?: ProgressCallback;
}
