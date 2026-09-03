/**
 * FormGen - Multi-Provider AI Service & Structured Generation
 * REST Adapters for Google Gemini, OpenAI, Ollama & Custom Gateways
 * Path: src/shared/ai/adapters.ts
 */

import { ProviderType, ProviderConfig } from '../types';
import { GENERATION_LIMITS } from '../constants';
import {
  AIProviderAdapter,
  GenerateRequestOptions,
  GenerateResult,
  AIError,
  AIAuthError,
  AIRateLimitError,
  AIModelNotFoundError,
  AINetworkError,
  AITimeoutError,
  AIAbortError,
  AISafetyBlockError,
  AIContextLengthExceededError,
  AIServerError,
  AIInvalidResponseError,
} from './types';

// ============================================================================
// 1. Endpoint Resolution & URL Normalizers
// ============================================================================

export function resolveGeminiEndpoint(baseUrl: string, model: string): string {
  const clean = (baseUrl || 'https://generativelanguage.googleapis.com')
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/v1beta\/?$/, '');
  return `${clean}/v1beta/models/${encodeURIComponent(model)}:generateContent`;
}

export function resolveOpenAIEndpoint(baseUrl: string): string {
  const clean = (baseUrl || 'https://api.openai.com/v1').trim().replace(/\/+$/, '');
  return clean.endsWith('/chat/completions') ? clean : `${clean}/chat/completions`;
}

export function resolveOllamaEndpoint(baseUrl: string): string {
  const clean = (baseUrl || 'http://localhost:11434').trim().replace(/\/+$/, '');
  return clean.endsWith('/api/chat') ? clean : `${clean}/api/chat`;
}

export function resolveCustomEndpoint(baseUrl: string): string {
  const clean = (baseUrl || 'https://api.groq.com/openai/v1').trim().replace(/\/+$/, '');
  return clean.endsWith('/chat/completions') ? clean : `${clean}/chat/completions`;
}

// ============================================================================
// 2. Resilient Dual-Signal HTTP Fetch Executor
// ============================================================================

/**
 * Executes fetch with an AbortController timeout and caller-provided AbortSignal.
 * Cleans up listeners to prevent service worker timer/listener memory leaks.
 */
export async function executeFetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number = GENERATION_LIMITS.AI_TIMEOUT_MS,
  externalSignal?: AbortSignal,
  provider: ProviderType = 'custom'
): Promise<Response> {
  const controller = new AbortController();
  let timedOut = false;

  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  let onExternalAbort: (() => void) | undefined;
  if (externalSignal) {
    if (externalSignal.aborted) {
      clearTimeout(timeoutId);
      throw new AIAbortError('A requisição foi cancelada pelo usuário.', provider);
    }
    onExternalAbort = () => {
      controller.abort();
    };
    externalSignal.addEventListener('abort', onExternalAbort, { once: true });
  }

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
    });

    // Detect captive portal / HTML proxy interceptors
    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    if (contentType.includes('text/html') || contentType.includes('application/xhtml+xml')) {
      throw new AIInvalidResponseError(
        `O endpoint ${url} retornou uma página HTML em vez de JSON da API (HTTP ${response.status}). Verifique a URL configurada ou o proxy de rede.`,
        provider,
        { rawError: { status: response.status, contentType } }
      );
    }

    return response;
  } catch (err: unknown) {
    if (timedOut) {
      throw new AITimeoutError(
        `Tempo limite esgotado (${Math.round(timeoutMs / 1000)}s) ao aguardar resposta do provedor ${provider}.`,
        provider,
        timeoutMs
      );
    }
    if (externalSignal?.aborted) {
      throw new AIAbortError('A requisição foi cancelada pelo usuário.', provider);
    }
    if (err instanceof AIError) {
      throw err;
    }
    if (err instanceof Error && err.name === 'AbortError') {
      throw new AIAbortError('A requisição foi abortada.', provider);
    }
    if (err instanceof TypeError || (err instanceof Error && err.message.toLowerCase().includes('fetch'))) {
      if (provider === 'ollama' && (url.includes('localhost') || url.includes('127.0.0.1'))) {
        throw new AINetworkError(
          `Não foi possível conectar ao Ollama em ${url}. Certifique-se de que o daemon local está ativo executando 'ollama serve'.`,
          provider,
          { rawError: err, cause: err }
        );
      }
      throw new AINetworkError(
        `Falha de conexão com o endpoint do provedor ${provider} (${url}): ${
          err instanceof Error ? err.message : String(err)
        }`,
        provider,
        { rawError: err, cause: err }
      );
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
    if (externalSignal && onExternalAbort) {
      externalSignal.removeEventListener('abort', onExternalAbort);
    }
  }
}

// ============================================================================
// 3. HTTP Error Classification & Status Mapping
// ============================================================================

export async function handleHttpError(
  res: Response,
  provider: ProviderType,
  model: string
): Promise<never> {
  const status = res.status;
  let rawBodyText = '';
  let errorJson: any = null;

  try {
    rawBodyText = await res.text();
    errorJson = JSON.parse(rawBodyText);
  } catch {
    // Body is not JSON
  }

  const detailedMessage =
    errorJson?.error?.message ||
    errorJson?.message ||
    rawBodyText.substring(0, 300) ||
    res.statusText ||
    `HTTP ${status}`;

  // 401 / 403: Authentication or Authorization failure
  if (status === 401 || status === 403) {
    throw new AIAuthError(
      `Autenticação recusada pelo provedor ${provider} (HTTP ${status}): ${detailedMessage}. Verifique sua chave de API nas configurações.`,
      provider,
      { status, rawError: errorJson || rawBodyText }
    );
  }

  // 404: Model or Route not found
  if (status === 404) {
    if (provider === 'ollama') {
      throw new AIModelNotFoundError(
        `Modelo '${model}' não encontrado no Ollama. Execute 'ollama pull ${model}' no terminal local.`,
        provider,
        { status, rawError: errorJson || rawBodyText }
      );
    }
    throw new AIModelNotFoundError(
      `Recurso ou modelo '${model}' não encontrado no provedor ${provider} (HTTP 404): ${detailedMessage}.`,
      provider,
      { status, rawError: errorJson || rawBodyText }
    );
  }

  // 429: Rate limit or quota exhausted
  if (status === 429) {
    const retryAfterHeader = res.headers?.get?.('retry-after');
    const retryAfterSeconds = retryAfterHeader ? parseInt(retryAfterHeader, 10) || undefined : undefined;
    throw new AIRateLimitError(
      `Limite de requisições excedido no provedor ${provider} (HTTP 429): ${detailedMessage}.`,
      provider,
      { status, retryAfterSeconds, rawError: errorJson || rawBodyText }
    );
  }

  // 400: Context length or validation errors
  if (status === 400) {
    const lower = detailedMessage.toLowerCase();
    if (
      lower.includes('context_length') ||
      lower.includes('maximum context length') ||
      lower.includes('token count') ||
      lower.includes('too many tokens')
    ) {
      throw new AIContextLengthExceededError(
        `O formulário excedeu o limite de contexto do modelo ${model} no provedor ${provider}: ${detailedMessage}.`,
        provider,
        { status, rawError: errorJson || rawBodyText }
      );
    }
  }

  // 5xx: Server or Gateway failure
  if (status >= 500) {
    throw new AIServerError(
      `Erro interno do servidor no provedor ${provider} (HTTP ${status}): ${detailedMessage}. O serviço pode estar temporariamente indisponível.`,
      provider,
      { status, rawError: errorJson || rawBodyText }
    );
  }

  // Generic fallback error
  throw new AIInvalidResponseError(
    `Erro retornado pelo provedor ${provider} (HTTP ${status}): ${detailedMessage}`,
    provider,
    { rawError: errorJson || rawBodyText }
  );
}

// ============================================================================
// 4. Provider Adapters Implementation
// ============================================================================

/**
 * Google Gemini REST Adapter
 * Uses v1beta/models/{model}:generateContent with JSON responseMimeType
 * and x-goog-api-key header.
 */
export class GeminiAdapter implements AIProviderAdapter {
  readonly providerType: ProviderType = 'gemini';

  async generate(config: ProviderConfig, options: GenerateRequestOptions): Promise<GenerateResult> {
    const startTime = performance.now();
    const endpoint = resolveGeminiEndpoint(config.baseUrl, config.model);
    const timeoutMs = options.timeoutMs ?? GENERATION_LIMITS.AI_TIMEOUT_MS;

    const payload = {
      contents: [
        {
          role: 'user',
          parts: [{ text: `${options.systemPrompt}\n\n${options.userPrompt}` }],
        },
      ],
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: options.temperature ?? 0.7,
      },
    };

    const res = await executeFetchWithTimeout(
      endpoint,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': config.apiKey,
        },
        body: JSON.stringify(payload),
      },
      timeoutMs,
      options.abortSignal,
      'gemini'
    );

    if (!res.ok) {
      await handleHttpError(res, 'gemini', config.model);
    }

    const data = await res.json();
    if (data.promptFeedback?.blockReason) {
      throw new AISafetyBlockError(
        `Prompt bloqueado pelas diretrizes de segurança do Gemini: ${data.promptFeedback.blockReason}`,
        'gemini',
        data.promptFeedback.blockReason
      );
    }

    const candidate = data.candidates?.[0];
    if (!candidate) {
      throw new AIInvalidResponseError('Nenhum candidato de resposta retornado pelo Gemini.', 'gemini', {
        rawError: data,
      });
    }

    if (candidate.finishReason === 'SAFETY') {
      throw new AISafetyBlockError('Geração de dados bloqueada pelas diretrizes de segurança do Gemini.', 'gemini');
    }

    const text = candidate.content?.parts?.map((p: any) => p.text).join('') || '';
    if (!text.trim()) {
      throw new AIInvalidResponseError('Resposta de texto vazia retornada pelo Gemini.', 'gemini', {
        rawError: data,
      });
    }

    return {
      rawText: text,
      provider: 'gemini',
      model: config.model,
      durationMs: Math.round(performance.now() - startTime),
    };
  }
}

/**
 * OpenAI REST Adapter
 * Uses /v1/chat/completions with Bearer authorization and response_format: { type: "json_object" }.
 */
export class OpenAIAdapter implements AIProviderAdapter {
  readonly providerType: ProviderType = 'openai';

  async generate(config: ProviderConfig, options: GenerateRequestOptions): Promise<GenerateResult> {
    const startTime = performance.now();
    const endpoint = resolveOpenAIEndpoint(config.baseUrl);
    const timeoutMs = options.timeoutMs ?? GENERATION_LIMITS.AI_TIMEOUT_MS;

    const payload = {
      model: config.model,
      messages: [
        { role: 'system', content: options.systemPrompt },
        { role: 'user', content: options.userPrompt },
      ],
      response_format: { type: 'json_object' },
      temperature: options.temperature ?? 0.7,
    };

    const res = await executeFetchWithTimeout(
      endpoint,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(payload),
      },
      timeoutMs,
      options.abortSignal,
      'openai'
    );

    if (!res.ok) {
      await handleHttpError(res, 'openai', config.model);
    }

    const data = await res.json();
    const choice = data.choices?.[0];
    if (!choice?.message?.content) {
      throw new AIInvalidResponseError('Estrutura de resposta vazia ou inválida da OpenAI.', 'openai', {
        rawError: data,
      });
    }

    return {
      rawText: choice.message.content,
      provider: 'openai',
      model: config.model,
      durationMs: Math.round(performance.now() - startTime),
    };
  }
}

/**
 * Ollama REST Adapter
 * Uses local /api/chat with stream: false and format: "json".
 */
export class OllamaAdapter implements AIProviderAdapter {
  readonly providerType: ProviderType = 'ollama';

  async generate(config: ProviderConfig, options: GenerateRequestOptions): Promise<GenerateResult> {
    const startTime = performance.now();
    const endpoint = resolveOllamaEndpoint(config.baseUrl);
    const timeoutMs = options.timeoutMs ?? GENERATION_LIMITS.AI_TIMEOUT_MS;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    if (config.apiKey?.trim()) {
      headers['Authorization'] = `Bearer ${config.apiKey.trim()}`;
    }

    const payload = {
      model: config.model,
      messages: [
        { role: 'system', content: options.systemPrompt },
        { role: 'user', content: options.userPrompt },
      ],
      stream: false,
      format: 'json',
      options: {
        temperature: options.temperature ?? 0.7,
      },
    };

    const res = await executeFetchWithTimeout(
      endpoint,
      {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      },
      timeoutMs,
      options.abortSignal,
      'ollama'
    );

    if (!res.ok) {
      await handleHttpError(res, 'ollama', config.model);
    }

    const data = await res.json();
    if (typeof data.message?.content !== 'string') {
      throw new AIInvalidResponseError('Resposta do Ollama não contém message.content válido.', 'ollama', {
        rawError: data,
      });
    }

    return {
      rawText: data.message.content,
      provider: 'ollama',
      model: config.model,
      durationMs: Math.round(performance.now() - startTime),
    };
  }
}

/**
 * Custom OpenAI-Compatible Adapter (Groq, Together AI, DeepSeek, LocalAI, vLLM)
 * Features dynamic URL normalization, gateway headers, and 2-phase adaptive fallback
 * when gateways reject response_format: { type: "json_object" }.
 */
export class CustomOpenAIAdapter implements AIProviderAdapter {
  readonly providerType: ProviderType = 'custom';

  async generate(config: ProviderConfig, options: GenerateRequestOptions): Promise<GenerateResult> {
    const startTime = performance.now();
    const endpoint = resolveCustomEndpoint(config.baseUrl);
    const timeoutMs = options.timeoutMs ?? GENERATION_LIMITS.AI_TIMEOUT_MS;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'HTTP-Referer': 'https://github.com/JoaoVictorOAS/gerarForms',
      'X-Title': 'FormGen',
    };
    if (config.apiKey?.trim()) {
      headers['Authorization'] = `Bearer ${config.apiKey.trim()}`;
    }

    const payloadWithFormat = {
      model: config.model,
      messages: [
        { role: 'system', content: options.systemPrompt },
        { role: 'user', content: options.userPrompt },
      ],
      response_format: { type: 'json_object' },
      temperature: options.temperature ?? 0.7,
    };

    // Phase 1: Attempt with strict json_object format
    let res = await executeFetchWithTimeout(
      endpoint,
      {
        method: 'POST',
        headers,
        body: JSON.stringify(payloadWithFormat),
      },
      timeoutMs,
      options.abortSignal,
      'custom'
    );

    // Phase 2: Adaptive fallback if custom provider rejects response_format
    if (!res.ok && (res.status === 400 || res.status === 422)) {
      const errText = (await res.clone().text().catch(() => '')).toLowerCase();
      if (
        errText.includes('response_format') ||
        errText.includes('format') ||
        errText.includes('json_object') ||
        errText.includes('extra fields') ||
        errText.includes('unknown parameter')
      ) {
        console.warn('[FormGen AI] Provedor customizado rejeitou response_format. Retentando sem o parâmetro...');
        const { response_format, ...payloadWithoutFormat } = payloadWithFormat;
        res = await executeFetchWithTimeout(
          endpoint,
          {
            method: 'POST',
            headers,
            body: JSON.stringify(payloadWithoutFormat),
          },
          timeoutMs,
          options.abortSignal,
          'custom'
        );
      }
    }

    if (!res.ok) {
      await handleHttpError(res, 'custom', config.model);
    }

    const data = await res.json();
    const choice = data.choices?.[0];
    if (!choice?.message?.content) {
      throw new AIInvalidResponseError('Estrutura de resposta vazia ou inválida do provedor customizado.', 'custom', {
        rawError: data,
      });
    }

    return {
      rawText: choice.message.content,
      provider: 'custom',
      model: config.model,
      durationMs: Math.round(performance.now() - startTime),
    };
  }
}

// ============================================================================
// 5. Adapter Factory
// ============================================================================

export function getAIAdapter(provider: ProviderType): AIProviderAdapter {
  switch (provider) {
    case 'gemini':
      return new GeminiAdapter();
    case 'openai':
      return new OpenAIAdapter();
    case 'ollama':
      return new OllamaAdapter();
    case 'custom':
      return new CustomOpenAIAdapter();
    default:
      throw new Error(`Provedor desconhecido: ${provider}`);
  }
}
