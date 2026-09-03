/**
 * FormGen - Extension Core Infra & Options UI
 * Shared Constants & Default Configurations
 * Path: src/shared/constants.ts
 */

import {
  FormGenSettings,
  ProviderType,
} from './types';

// ============================================================================
// 1. Default Provider Endpoints & Models
// ============================================================================

/**
 * Standard REST base URLs for supported AI providers.
 */
export const DEFAULT_ENDPOINTS: Readonly<Record<ProviderType, string>> = Object.freeze({
  gemini: 'https://generativelanguage.googleapis.com',
  openai: 'https://api.openai.com/v1',
  ollama: 'http://localhost:11434',
  custom: 'https://api.groq.com/openai/v1',
});

/**
 * Default AI models optimized for structured JSON and low latency.
 */
export const DEFAULT_MODELS: Readonly<Record<ProviderType, string>> = Object.freeze({
  gemini: 'gemini-2.5-flash',
  openai: 'gpt-4o-mini',
  ollama: 'llama3.3',
  custom: 'llama-3.3-70b-versatile',
});

/**
 * Metadata and model presets for options dashboard UI.
 */
export interface ProviderMetadata {
  label: string;
  models: string[];
  defaultModel: string;
  defaultBaseUrl: string;
  requiresApiKey: boolean;
  description: string;
  docsUrl: string;
}

export const PROVIDER_PRESETS: Readonly<Record<ProviderType, ProviderMetadata>> = Object.freeze({
  gemini: {
    label: 'Google Gemini',
    models: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-3.8-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'],
    defaultModel: 'gemini-2.5-flash',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com',
    requiresApiKey: true,
    description: 'Modelos Gemini de última geração do Google com raciocínio avançado e suporte nativo a JSON.',
    docsUrl: 'https://ai.google.dev/',
  },
  openai: {
    label: 'OpenAI',
    models: ['gpt-4o-mini', 'gpt-4o', 'o4-mini', 'o3-mini', 'gpt-5.4'],
    defaultModel: 'gpt-4o-mini',
    defaultBaseUrl: 'https://api.openai.com/v1',
    requiresApiKey: true,
    description: 'Modelos GPT e série reasoning (o4/o3) com suporte a modo JSON estrito.',
    docsUrl: 'https://platform.openai.com/docs/models',
  },
  ollama: {
    label: 'Ollama (Local)',
    models: ['llama3.3', 'llama3.2', 'deepseek-r1', 'qwen2.5', 'mistral'],
    defaultModel: 'llama3.3',
    defaultBaseUrl: 'http://localhost:11434',
    requiresApiKey: false,
    description: 'Modelos locais via Ollama (Llama 3.3, DeepSeek R1, Qwen 2.5) sem custo ou tráfego externo.',
    docsUrl: 'https://ollama.ai/',
  },
  custom: {
    label: 'Compatível com OpenAI / Groq / DeepSeek',
    models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'deepseek-chat', 'deepseek-reasoner'],
    defaultModel: 'llama-3.3-70b-versatile',
    defaultBaseUrl: 'https://api.groq.com/openai/v1',
    requiresApiKey: true,
    description: 'Inferência ultra-rápida compatível com OpenAI (Groq, DeepSeek, Together, vLLM).',
    docsUrl: 'https://console.groq.com/docs/models',
  },
});

// ============================================================================
// 2. Default Extension Settings
// ============================================================================

/**
 * Initial extension settings seeded on installation or reset.
 * Persisted in `chrome.storage.sync` under `STORAGE_KEYS.SETTINGS`.
 */
export const DEFAULT_SETTINGS: Readonly<FormGenSettings> = Object.freeze({
  activeProvider: 'gemini',
  providers: {
    gemini: {
      apiKey: '',
      baseUrl: DEFAULT_ENDPOINTS.gemini,
      model: DEFAULT_MODELS.gemini,
    },
    openai: {
      apiKey: '',
      baseUrl: DEFAULT_ENDPOINTS.openai,
      model: DEFAULT_MODELS.openai,
    },
    ollama: {
      apiKey: '',
      baseUrl: DEFAULT_ENDPOINTS.ollama,
      model: DEFAULT_MODELS.ollama,
    },
    custom: {
      apiKey: '',
      baseUrl: DEFAULT_ENDPOINTS.custom,
      model: DEFAULT_MODELS.custom,
    },
  },
  generationDefaults: {
    temperature: 0.7,
    locale: 'pt-BR',
  },
});

// ============================================================================
// 3. Storage Keys & Quota Constants
// ============================================================================

/**
 * Storage keys used for extension persistence.
 */
export const STORAGE_KEYS = Object.freeze({
  /**
   * Key in `chrome.storage.sync` for user settings.
   */
  SETTINGS: 'formgen_settings',

  /**
   * Key in `chrome.storage.local` for the active batch queue.
   */
  ACTIVE_QUEUE: 'formgen_active_queue',
});

/**
 * Chrome storage limitations.
 */
export const STORAGE_LIMITS = Object.freeze({
  /**
   * Maximum bytes allowed per item in `chrome.storage.sync` (8 KB).
   */
  SYNC_QUOTA_BYTES_PER_ITEM: 8192,

  /**
   * Maximum total bytes in `chrome.storage.sync` (100 KB).
   */
  SYNC_QUOTA_TOTAL_BYTES: 102400,

  /**
   * Local storage quota (10 MB).
   */
  LOCAL_QUOTA_BYTES: 10485760,
});

// ============================================================================
// 4. DOM Stamping & Attribute Constants
// ============================================================================

/**
 * HTML data attributes stamped on DOM elements for deterministic tracking.
 */
export const DOM_ATTRIBUTES = Object.freeze({
  /**
   * Identifier stamped on form inputs: `data-formgen-id="fg_0"`.
   */
  FORMGEN_ID: 'data-formgen-id',

  /**
   * Stamp applied to container when scanned.
   */
  FORMGEN_STAMPED: 'data-formgen-stamped',
});

// ============================================================================
// 5. Batch & Generation Limits
// ============================================================================

/**
 * Supported record batch sizes.
 */
export const BATCH_SIZES = [1, 10, 100] as const;
export type BatchSize = (typeof BATCH_SIZES)[number];

/**
 * Runtime execution constraints and timeouts.
 */
export const GENERATION_LIMITS = Object.freeze({
  /**
   * Maximum batch chunk size when invoking AI for 100 records.
   * Splits 100 records into chunks of 20 to prevent LLM token cutoffs.
   */
  CHUNK_SIZE_100: 20,

  /**
   * Clamped maximum character length for extracted input labels.
   */
  MAX_LABEL_LENGTH: 100,

  /**
   * Maximum duration (ms) for an AI generation fetch request (60s).
   */
  AI_TIMEOUT_MS: 60000,

  /**
   * Maximum duration (ms) for testing provider endpoint connectivity (10s).
   */
  CONNECTION_TEST_TIMEOUT_MS: 10000,

  /**
   * Maximum duration (ms) for pinging content script availability (2s).
   */
  PING_TIMEOUT_MS: 2000,
});

// ============================================================================
// 6. User Interface Strings & Localized Messages (pt-BR)
// ============================================================================

/**
 * User-facing UI strings for Popup and Options dashboards.
 */
export const UI_STRINGS = Object.freeze({
  BUTTON_IDLE: 'Gerar dados',
  BUTTON_INJECT_PREFIX: 'Inserir registro',
  BUTTON_DISCARD: 'Descartar fila',
  BUTTON_SAVE: 'Salvar Configurações',
  BUTTON_TEST: 'Testar Conexão',
  BUTTON_RESET: 'Restaurar Padrões',
  STATUS_GENERATING: 'Gerando dados estruturados com IA...',
  STATUS_INJECTING: 'Preenchendo formulário na página...',
  STATUS_SUCCESS_SINGLE: 'Registro preenchido com sucesso!',
  STATUS_QUEUE_FINISHED: 'Fila concluída: todos os registros foram inseridos!',
  STATUS_QUEUE_DISCARDED: 'Fila de registros descartada com sucesso.',
  STATUS_SETTINGS_SAVED: 'Configurações salvas com sucesso!',
  STATUS_NO_FORM: 'Nenhum formulário ou campo detectado na página ativa.',
  ERROR_AUTH: 'Chave de API inválida para o provedor selecionado. Verifique as configurações.',
  ERROR_RATE_LIMIT: 'Limite de taxa de requisições excedido. Aguarde alguns instantes.',
  ERROR_NETWORK: 'Falha na conexão com o endpoint do provedor de IA.',
  ERROR_NO_CONTENT_SCRIPT: 'Não foi possível comunicar com a página. Recarregue a aba e tente novamente.',
  ERROR_QUOTA_EXCEEDED: 'O limite de armazenamento de configurações foi excedido.',
});
