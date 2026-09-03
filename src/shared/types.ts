/**
 * FormGen - Extension Core Infra & Options UI
 * Shared TypeScript Types & Interfaces
 * Path: src/shared/types.ts
 */

// ============================================================================
// 1. DOM Form Scanner & Schema Extraction Types
// ============================================================================

/**
 * Supported form field control types.
 */
export type FormFieldType =
  | 'text'
  | 'email'
  | 'number'
  | 'password'
  | 'tel'
  | 'url'
  | 'date'
  | 'time'
  | 'datetime-local'
  | 'select'
  | 'radio'
  | 'checkbox'
  | 'textarea';

/**
 * Option entry for `<select>` dropdowns and radio button groups.
 */
export interface FieldOption {
  /**
   * Raw value submitted by the option element (e.g. 'sp', 'clt', '1').
   */
  value: string;

  /**
   * Visible human-readable text label (e.g. 'São Paulo', 'CLT', 'Opção 1').
   */
  label: string;
}

/**
 * HTML5 and semantic validation constraints extracted from DOM controls.
 */
export interface ValidationRules {
  /**
   * Field is required for form submission.
   */
  required?: boolean;

  /**
   * Minimum numeric value or minimum date string.
   */
  min?: number | string;

  /**
   * Maximum numeric value or maximum date string.
   */
  max?: number | string;

  /**
   * Allowed numeric stepping interval.
   */
  step?: number | string;

  /**
   * Minimum allowed text length.
   */
  minLength?: number;

  /**
   * Maximum allowed text length.
   */
  maxLength?: number;

  /**
   * Regular expression pattern attribute.
   */
  pattern?: string;

  /**
   * Human-readable description of the pattern (from title attribute).
   */
  patternDescription?: string;

  /**
   * HTML autocomplete token (e.g. 'given-name', 'family-name', 'email', 'tel').
   */
  autocomplete?: string;

  /**
   * Virtual keyboard hint (e.g. 'numeric', 'decimal', 'email', 'tel', 'url').
   */
  inputMode?: string;
}

/**
 * Individual form field descriptor within a FormSchema.
 */
export interface FormField {
  /**
   * Transient unique identifier stamped as `data-formgen-id="fg_X"` on the DOM node.
   * Guarantees 100% deterministic injection mapping even with dynamic classes or duplicate names.
   */
  formgenId: string;

  /**
   * HTML element `id` attribute, if present.
   */
  id?: string;

  /**
   * HTML element `name` attribute, or normalized fallback.
   */
  name: string;

  /**
   * Human-readable label resolved via the 7-tier label resolution cascade.
   */
  label: string;

  /**
   * Normalized control type.
   */
  type: FormFieldType;

  /**
   * Quick boolean flag indicating if the field is required (mirrors validation.required).
   */
  required: boolean;

  /**
   * Detailed validation rules and HTML constraints.
   */
  validation?: ValidationRules;

  /**
   * Placeholder text, if present.
   */
  placeholder?: string;

  /**
   * Pre-existing or default value in the DOM before generation.
   */
  defaultValue?: string | number | boolean;

  /**
   * Valid options for `<select>` or radio button groups.
   */
  options?: FieldOption[];

  /**
   * Indicates if `<select multiple>` is enabled.
   */
  multiple?: boolean;
}

/**
 * Lean JSON schema representing an inspected web form.
 * Designed to minimize token payload (>95% token savings over raw HTML).
 */
export interface FormSchema {
  /**
   * Unique ID or selector identifying this form on the page.
   */
  formId: string;

  /**
   * Optional CSS selector to locate the form container.
   */
  formSelector?: string;

  /**
   * URL of the page hosting the form.
   */
  url?: string;

  /**
   * Title of the form or page.
   */
  title?: string;

  /**
   * Action URL if declared on `<form>`.
   */
  action?: string;

  /**
   * HTTP method ('GET' | 'POST') if declared on `<form>`.
   */
  method?: string;

  /**
   * Sanitized list of fillable form fields.
   */
  fields: FormField[];
}

// ============================================================================
// 2. Multi-Provider AI & Extension Settings Types
// ============================================================================

/**
 * Supported AI provider types.
 */
export type ProviderType = 'gemini' | 'openai' | 'ollama' | 'custom';

/**
 * Configuration parameters for a single AI provider.
 */
export interface ProviderConfig {
  /**
   * Secret API key for authentication (optional for local Ollama).
   */
  apiKey: string;

  /**
   * Provider API Base URL.
   */
  baseUrl: string;

  /**
   * Model identifier (e.g. 'gemini-1.5-flash', 'gpt-4o-mini', 'llama3').
   */
  model: string;
}

/**
 * Default parameters for AI generation requests.
 */
export interface GenerationDefaults {
  /**
   * Sampling temperature between 0.0 and 1.0 (default 0.7).
   */
  temperature: number;

  /**
   * Default locale for synthetic generation (e.g. 'pt-BR').
   */
  locale: string;
}

/**
 * Root extension settings persisted in `chrome.storage.sync`.
 * Complies with Chrome's 8,192 byte quota per item.
 */
export interface FormGenSettings {
  /**
   * Currently active provider selected by user.
   */
  activeProvider: ProviderType;

  /**
   * Configurations for all supported providers.
   */
  providers: {
    gemini: ProviderConfig;
    openai: ProviderConfig;
    ollama: ProviderConfig;
    custom: ProviderConfig;
  };

  /**
   * Default generation parameters.
   */
  generationDefaults: GenerationDefaults;
}

/**
 * Recursively make all properties and nested properties optional.
 */
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends (infer U)[]
    ? T[P]
    : T[P] extends object
    ? DeepPartial<T[P]>
    : T[P];
};

/**
 * Generic record representing injected field values.
 * Keys are field names or `data-formgen-id`s, values are strings, numbers, booleans.
 */
export type FormRecord = Record<string, any>;

/**
 * AI generation response envelope matching `{ "records": [ ... ] }`.
 */
export interface GenerationEnvelope {
  records: FormRecord[];
}

// ============================================================================
// 3. Browser Queue State Types (chrome.storage.local)
// ============================================================================

/**
 * Persistent queue state in `chrome.storage.local` for batch generation.
 */
export interface FormGenQueueState {
  /**
   * Unique UUID for the generation session.
   */
  queueId: string;

  /**
   * Chrome Tab ID hosting the active form session.
   */
  tabId: number;

  /**
   * Canonical URL of the page where the queue was initialized.
   */
  url: string;

  /**
   * Form identifier or selector.
   */
  formId: string;

  /**
   * Total number of records requested in batch (1, 10, 100).
   */
  totalRecords: number;

  /**
   * 1-indexed number of the NEXT record to be injected into the form.
   * Starts at 2 when record #1 is injected immediately upon batch generation.
   */
  currentIndex: number;

  /**
   * Remaining records pending injection ([record #2, ..., record #N]).
   */
  pendingRecords: FormRecord[];

  /**
   * Timestamp in ms when queue was created.
   */
  createdAt: number;

  /**
   * Timestamp in ms when queue was last mutated.
   */
  updatedAt: number;
}

// ============================================================================
// 4. Runtime Messaging Protocol (IPC Contracts)
// ============================================================================

// --- 4.1 SCAN_DOM Message Contract ---
export interface ScanDomRequest {
  action: 'SCAN_DOM';
  formId?: string;
  formSelector?: string;
  fromContextMenu?: boolean;
}

export interface ScanDomResponse {
  success: boolean;
  schema?: FormSchema;
  error?: string;
}

// --- 4.2 INJECT_RECORD Message Contract ---
export interface InjectRecordRequest {
  action: 'INJECT_RECORD';
  record: FormRecord;
  formId?: string;
  fromContextMenu?: boolean;
}

export interface InjectRecordResponse {
  success: boolean;
  injectedFields?: string[];
  skippedFields?: string[];
  error?: string;
}

// --- 4.3 GENERATE_DATA Message Contract ---
export interface GenerateDataRequest {
  action: 'GENERATE_DATA';
  count: 1 | 10 | 100;
  schema: FormSchema;
  tabId?: number;
}

export interface GenerateDataResponse {
  success: boolean;
  count?: number;
  records?: FormRecord[];
  firstRecordInjected?: boolean;
  queueId?: string;
  error?: string;
}

// --- 4.4 TEST_PROVIDER_CONNECTION Message Contract ---
export interface TestProviderConnectionRequest {
  action: 'TEST_PROVIDER_CONNECTION';
  provider: ProviderType;
  config: ProviderConfig;
}

export interface TestProviderConnectionResponse {
  success: boolean;
  latencyMs?: number;
  error?: string;
}

// --- 4.5 GET_QUEUE_STATE Message Contract ---
export interface GetQueueStateRequest {
  action: 'GET_QUEUE_STATE';
  tabId?: number;
  url?: string;
}

export interface GetQueueStateResponse {
  success: boolean;
  queue?: FormGenQueueState | null;
  error?: string;
}

// --- 4.6 ADVANCE_QUEUE Message Contract ---
export interface AdvanceQueueRequest {
  action: 'ADVANCE_QUEUE';
  tabId?: number;
}

export interface AdvanceQueueResponse {
  success: boolean;
  record?: FormRecord | null;
  currentIndex?: number;
  totalRecords?: number;
  remainingCount?: number;
  isFinished?: boolean;
  error?: string;
}

// --- 4.7 DISCARD_QUEUE Message Contract ---
export interface DiscardQueueRequest {
  action: 'DISCARD_QUEUE';
}

export interface DiscardQueueResponse {
  success: boolean;
  error?: string;
}

// --- 4.8 PING Message Contract ---
export interface PingRequest {
  action: 'PING';
}

export interface PingResponse {
  success: boolean;
  status: 'PONG';
  error?: string;
}

// --- 4.9 SHOW_TOAST Message Contract ---
export interface ShowToastRequest {
  action: 'SHOW_TOAST';
  message: string;
  type?: 'info' | 'success' | 'warning' | 'error';
}

export interface ShowToastResponse {
  success: boolean;
  error?: string;
}

/**
 * Union of all extension message requests.
 */
export type ExtensionMessage =
  | ScanDomRequest
  | InjectRecordRequest
  | GenerateDataRequest
  | TestProviderConnectionRequest
  | GetQueueStateRequest
  | AdvanceQueueRequest
  | DiscardQueueRequest
  | PingRequest
  | ShowToastRequest;

/**
 * Union of all extension message responses.
 */
export type ExtensionResponse =
  | ScanDomResponse
  | InjectRecordResponse
  | GenerateDataResponse
  | TestProviderConnectionResponse
  | GetQueueStateResponse
  | AdvanceQueueResponse
  | DiscardQueueResponse
  | PingResponse
  | ShowToastResponse;

/**
 * Generic API response wrapper.
 */
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
}
