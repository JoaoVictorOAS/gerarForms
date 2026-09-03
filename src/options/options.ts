/**
 * FormGen Options Page Controller
 * Handles provider configuration, storage.sync persistence,
 * and zero-token API connection verification.
 * Path: src/options/options.ts
 */

import {
  ProviderType,
  ProviderConfig,
  FormGenSettings,
} from '../shared/types';
import {
  DEFAULT_SETTINGS,
  PROVIDER_PRESETS,
} from '../shared/constants';
import {
  getSettings,
  saveSettings,
  resetSettings,
} from '../shared/storage';

export interface TestConnectionResult {
  success: boolean;
  message: string;
  latencyMs?: number;
}

export interface ProviderMeta {
  displayName: string;
  defaultBaseUrl: string;
  defaultModel: string;
  suggestedModels: string[];
  keyRequired: boolean;
  keyPlaceholder: string;
  keyHelpText: string;
  keyDocUrl: string;
  description: string;
}

export const PROVIDER_METADATA: Record<ProviderType, ProviderMeta> = {
  gemini: {
    displayName: PROVIDER_PRESETS.gemini.label,
    defaultBaseUrl: PROVIDER_PRESETS.gemini.defaultBaseUrl,
    defaultModel: PROVIDER_PRESETS.gemini.defaultModel,
    suggestedModels: [...PROVIDER_PRESETS.gemini.models],
    keyRequired: PROVIDER_PRESETS.gemini.requiresApiKey,
    keyPlaceholder: 'AIzaSy...',
    keyHelpText: 'Chave obtida gratuitamente no Google AI Studio.',
    keyDocUrl: PROVIDER_PRESETS.gemini.docsUrl,
    description: PROVIDER_PRESETS.gemini.description,
  },
  openai: {
    displayName: PROVIDER_PRESETS.openai.label,
    defaultBaseUrl: PROVIDER_PRESETS.openai.defaultBaseUrl,
    defaultModel: PROVIDER_PRESETS.openai.defaultModel,
    suggestedModels: [...PROVIDER_PRESETS.openai.models],
    keyRequired: PROVIDER_PRESETS.openai.requiresApiKey,
    keyPlaceholder: 'sk-proj-...',
    keyHelpText: 'Chave de API gerada no console de desenvolvedor da OpenAI.',
    keyDocUrl: PROVIDER_PRESETS.openai.docsUrl,
    description: PROVIDER_PRESETS.openai.description,
  },
  ollama: {
    displayName: PROVIDER_PRESETS.ollama.label,
    defaultBaseUrl: PROVIDER_PRESETS.ollama.defaultBaseUrl,
    defaultModel: PROVIDER_PRESETS.ollama.defaultModel,
    suggestedModels: [...PROVIDER_PRESETS.ollama.models],
    keyRequired: PROVIDER_PRESETS.ollama.requiresApiKey,
    keyPlaceholder: 'Opcional (em branco para localhost)',
    keyHelpText: 'Geralmente não requer chave para instâncias locais rodando ollama serve.',
    keyDocUrl: PROVIDER_PRESETS.ollama.docsUrl,
    description: PROVIDER_PRESETS.ollama.description,
  },
  custom: {
    displayName: PROVIDER_PRESETS.custom.label,
    defaultBaseUrl: PROVIDER_PRESETS.custom.defaultBaseUrl,
    defaultModel: PROVIDER_PRESETS.custom.defaultModel,
    suggestedModels: [...PROVIDER_PRESETS.custom.models],
    keyRequired: false,
    keyPlaceholder: 'gsk_... ou chave customizada',
    keyHelpText: 'Compatível com Groq, Together AI, DeepSeek, LocalAI, OpenRouter e vLLM.',
    keyDocUrl: PROVIDER_PRESETS.custom.docsUrl,
    description: PROVIDER_PRESETS.custom.description,
  },
};

// In-Memory Working State
let currentSettings: FormGenSettings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
let activeProvider: ProviderType = 'gemini';
let toastTimeoutId: ReturnType<typeof setTimeout> | null = null;

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    initEventListeners();
    loadAndHydrateSettings();
  });
}

/**
 * Set up DOM event listeners.
 */
export function initEventListeners(): void {
  // Tab switching
  const tabs = document.querySelectorAll<HTMLButtonElement>('.tab-button');
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const targetProvider = tab.dataset.provider as ProviderType;
      if (targetProvider && targetProvider !== activeProvider) {
        switchProviderTab(targetProvider);
      }
    });
  });

  // Password visibility toggle
  const toggleBtn = document.getElementById('toggle-key-visibility') as HTMLButtonElement | null;
  toggleBtn?.addEventListener('click', toggleKeyVisibility);

  // Endpoint reset link
  const resetEndpointBtn = document.getElementById('btn-reset-endpoint') as HTMLButtonElement | null;
  resetEndpointBtn?.addEventListener('click', () => {
    const meta = PROVIDER_METADATA[activeProvider];
    const baseUrlInput = document.getElementById('base-url') as HTMLInputElement | null;
    if (baseUrlInput) {
      baseUrlInput.value = meta.defaultBaseUrl;
      baseUrlInput.focus();
    }
  });

  // Temperature range live display
  const tempSlider = document.getElementById('temperature') as HTMLInputElement | null;
  const tempDisplay = document.getElementById('temperature-display') as HTMLElement | null;
  tempSlider?.addEventListener('input', () => {
    if (tempDisplay && tempSlider) {
      tempDisplay.textContent = tempSlider.value;
    }
  });

  // Connection testing
  const testBtn = document.getElementById('btn-test-connection') as HTMLButtonElement | null;
  testBtn?.addEventListener('click', handleTestConnection);

  // Save settings
  const saveBtn = document.getElementById('btn-save-settings') as HTMLButtonElement | null;
  saveBtn?.addEventListener('click', handleSaveSettings);

  // Restore factory defaults
  const resetDefaultsBtn = document.getElementById('btn-restore-defaults') as HTMLButtonElement | null;
  resetDefaultsBtn?.addEventListener('click', handleRestoreDefaults);
}

/**
 * Load settings from storage with fallback to defaults.
 */
export async function loadAndHydrateSettings(): Promise<void> {
  try {
    currentSettings = await getSettings();
  } catch (err) {
    console.warn('[FormGen Options] Storage unavailable, using defaults:', err);
    currentSettings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  }

  activeProvider = currentSettings.activeProvider || 'gemini';
  renderTabButtons(activeProvider);
  renderProviderFields(activeProvider);
  renderGeneralDefaults();
}

/**
 * Handle tab switching, persisting unsaved edits of the previous provider in memory.
 */
export function switchProviderTab(newProvider: ProviderType): void {
  // 1. Snapshot current DOM values into currentSettings.providers[activeProvider]
  snapshotActiveProviderFromDOM();

  // 2. Set new active provider
  activeProvider = newProvider;
  currentSettings.activeProvider = newProvider;

  // 3. Re-render tabs and fields
  renderTabButtons(newProvider);
  renderProviderFields(newProvider);

  // 4. Hide previous test results
  hideStatusBanner();
}

/**
 * Read current form inputs into memory buffer.
 */
export function snapshotActiveProviderFromDOM(): void {
  const baseUrlInput = document.getElementById('base-url') as HTMLInputElement | null;
  const modelInput = document.getElementById('model-name') as HTMLInputElement | null;
  const apiKeyInput = document.getElementById('api-key') as HTMLInputElement | null;

  if (baseUrlInput && modelInput && apiKeyInput) {
    currentSettings.providers[activeProvider] = {
      baseUrl: baseUrlInput.value.trim(),
      model: modelInput.value.trim(),
      apiKey: apiKeyInput.value.trim(),
    };
  }
}

/**
 * Update UI tab button states.
 */
export function renderTabButtons(selected: ProviderType): void {
  const tabs = document.querySelectorAll<HTMLButtonElement>('.tab-button');
  tabs.forEach((tab) => {
    const isSelected = tab.dataset.provider === selected;
    tab.classList.toggle('active', isSelected);
    tab.setAttribute('aria-selected', isSelected ? 'true' : 'false');
  });
}

/**
 * Populate provider fields with current in-memory values and metadata.
 */
export function renderProviderFields(provider: ProviderType): void {
  const meta = PROVIDER_METADATA[provider];
  const config = currentSettings.providers[provider];

  // Header and descriptions
  const titleEl = document.getElementById('provider-title');
  const descEl = document.getElementById('provider-description');
  const docLink = document.getElementById('provider-doc-link') as HTMLAnchorElement | null;

  if (titleEl) titleEl.textContent = meta.displayName;
  if (descEl) descEl.textContent = meta.description;
  if (docLink) docLink.href = meta.keyDocUrl;

  // Base URL
  const baseUrlInput = document.getElementById('base-url') as HTMLInputElement | null;
  if (baseUrlInput) {
    baseUrlInput.value = config.baseUrl || meta.defaultBaseUrl;
    baseUrlInput.placeholder = meta.defaultBaseUrl;
  }

  // Model and suggestions datalist
  const modelInput = document.getElementById('model-name') as HTMLInputElement | null;
  if (modelInput) {
    modelInput.value = config.model || meta.defaultModel;
    modelInput.placeholder = meta.defaultModel;
  }

  const datalist = document.getElementById('model-suggestions');
  if (datalist) {
    datalist.innerHTML = '';
    meta.suggestedModels.forEach((m) => {
      const opt = document.createElement('option');
      opt.value = m;
      datalist.appendChild(opt);
    });
  }

  // API Key
  const apiKeyInput = document.getElementById('api-key') as HTMLInputElement | null;
  const keyHint = document.getElementById('api-key-hint');
  const optionalBadge = document.getElementById('api-key-optional-badge');

  if (apiKeyInput) {
    apiKeyInput.value = config.apiKey || '';
    apiKeyInput.placeholder = meta.keyPlaceholder;
    apiKeyInput.required = meta.keyRequired;
  }

  if (keyHint) keyHint.textContent = meta.keyHelpText;
  if (optionalBadge) {
    optionalBadge.style.display = meta.keyRequired ? 'none' : 'inline-block';
  }
}

/**
 * Populate global generation parameters.
 */
export function renderGeneralDefaults(): void {
  const tempSlider = document.getElementById('temperature') as HTMLInputElement | null;
  const tempDisplay = document.getElementById('temperature-display') as HTMLElement | null;
  const localeSelect = document.getElementById('locale') as HTMLSelectElement | null;

  if (tempSlider) {
    tempSlider.value = String(currentSettings.generationDefaults.temperature ?? 0.7);
  }
  if (tempDisplay) {
    tempDisplay.textContent = String(currentSettings.generationDefaults.temperature ?? 0.7);
  }
  if (localeSelect) {
    localeSelect.value = currentSettings.generationDefaults.locale || 'pt-BR';
  }
}

/**
 * Toggle password input visibility between 'password' and 'text'.
 */
export function toggleKeyVisibility(): void {
  const keyInput = document.getElementById('api-key') as HTMLInputElement | null;
  const eyeIcon = document.querySelector('.icon-eye');
  const eyeOffIcon = document.querySelector('.icon-eye-off');
  if (!keyInput) return;

  const isPassword = keyInput.type === 'password';
  keyInput.type = isPassword ? 'text' : 'password';

  eyeIcon?.classList.toggle('hidden', isPassword);
  eyeOffIcon?.classList.toggle('hidden', !isPassword);
}

/**
 * Test Connection action handler.
 */
export async function handleTestConnection(): Promise<void> {
  snapshotActiveProviderFromDOM();
  const config = currentSettings.providers[activeProvider];

  const testBtn = document.getElementById('btn-test-connection') as HTMLButtonElement | null;
  const spinner = document.getElementById('test-spinner');
  const icon = document.getElementById('test-icon');
  const btnText = document.getElementById('test-btn-text');

  // Set loading state
  if (testBtn) testBtn.disabled = true;
  spinner?.classList.remove('hidden');
  icon?.classList.add('hidden');
  if (btnText) btnText.textContent = 'Testando conexão...';
  hideStatusBanner();

  try {
    const result = await testProviderConnection(activeProvider, config);
    showStatusBanner(result);
  } catch (err: any) {
    showStatusBanner({
      success: false,
      message: `Erro inesperado durante o teste: ${err.message}`,
    });
  } finally {
    if (testBtn) testBtn.disabled = false;
    spinner?.classList.add('hidden');
    icon?.classList.remove('hidden');
    if (btnText) btnText.textContent = 'Testar Conexão';
  }
}

/**
 * Lightweight, zero-token endpoint verification for each provider.
 */
export async function testProviderConnection(
  provider: ProviderType,
  config: ProviderConfig
): Promise<TestConnectionResult> {
  const startTime = performance.now();
  const cleanUrl = config.baseUrl.trim().replace(/\/+$/, '');

  // URL Syntax Validation
  try {
    new URL(cleanUrl);
  } catch {
    return {
      success: false,
      message: `URL base inválida: "${cleanUrl}". Informe uma URL com http:// ou https://.`,
    };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    if (provider === 'gemini') {
      if (!config.apiKey) {
        return { success: false, message: 'Chave de API do Gemini é obrigatória.' };
      }
      // Zero-token verification: inspect model metadata
      const endpoint = `${cleanUrl}/v1beta/models/${config.model}`;
      const res = await fetch(endpoint, {
        method: 'GET',
        headers: {
          'x-goog-api-key': config.apiKey,
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
      });
      const latency = Math.round(performance.now() - startTime);

      if (res.ok) {
        const contentType = (typeof res.headers?.get === 'function' ? res.headers.get('content-type') : '') || '';
        if (contentType.toLowerCase().includes('text/html') || contentType.toLowerCase().includes('application/xhtml+xml')) {
          return {
            success: false,
            latencyMs: latency,
            message: `Resposta inesperada da API Gemini (HTTP ${res.status}): o endpoint retornou uma página HTML em vez de JSON. Verifique a URL ou proxy de rede.`,
          };
        }
        return {
          success: true,
          latencyMs: latency,
          message: `Conexão bem-sucedida! Modelo "${config.model}" verificado e ativo.`,
        };
      }

      const errData = await res.json().catch(() => ({}));
      const errMsg = errData.error?.message || res.statusText;

      if (res.status === 400 || res.status === 403) {
        return {
          success: false,
          latencyMs: latency,
          message: `Falha de autenticação (HTTP ${res.status}): Chave de API inválida no Google AI Studio.`,
        };
      }
      if (res.status === 404) {
        return {
          success: false,
          latencyMs: latency,
          message: `Modelo não encontrado (HTTP 404): "${config.model}" não está disponível nesta chave ou região.`,
        };
      }
      return {
        success: false,
        latencyMs: latency,
        message: `Erro da API Gemini (HTTP ${res.status}): ${errMsg}`,
      };
    }

    if (provider === 'openai') {
      if (!config.apiKey) {
        return { success: false, message: 'Chave de API da OpenAI é obrigatória.' };
      }
      // Zero-token verification: inspect model metadata
      const endpoint = `${cleanUrl}/models/${config.model}`;
      const res = await fetch(endpoint, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
      });
      const latency = Math.round(performance.now() - startTime);

      if (res.ok) {
        const contentType = (typeof res.headers?.get === 'function' ? res.headers.get('content-type') : '') || '';
        if (contentType.toLowerCase().includes('text/html') || contentType.toLowerCase().includes('application/xhtml+xml')) {
          return {
            success: false,
            latencyMs: latency,
            message: `Resposta inesperada da API OpenAI (HTTP ${res.status}): o endpoint retornou uma página HTML em vez de JSON. Verifique a URL ou proxy de rede.`,
          };
        }
        return {
          success: true,
          latencyMs: latency,
          message: `Conexão com OpenAI estabelecida com sucesso! Modelo "${config.model}" pronto.`,
        };
      }

      const errData = await res.json().catch(() => ({}));
      const errMsg = errData.error?.message || res.statusText;

      if (res.status === 401) {
        return {
          success: false,
          latencyMs: latency,
          message: `Chave de API inválida (HTTP 401). Verifique suas credenciais em platform.openai.com.`,
        };
      }
      if (res.status === 404) {
        return {
          success: false,
          latencyMs: latency,
          message: `Modelo "${config.model}" não encontrado ou inacessível para esta chave (HTTP 404).`,
        };
      }
      return {
        success: false,
        latencyMs: latency,
        message: `Erro da API OpenAI (HTTP ${res.status}): ${errMsg}`,
      };
    }

    if (provider === 'ollama') {
      // Zero-token verification: fetch daemon tags
      const endpoint = `${cleanUrl}/api/tags`;
      const headers: Record<string, string> = {
        'Accept': 'application/json',
      };
      if (config.apiKey) {
        headers['Authorization'] = `Bearer ${config.apiKey}`;
      }

      const res = await fetch(endpoint, {
        method: 'GET',
        headers,
        signal: controller.signal,
      });
      const latency = Math.round(performance.now() - startTime);

      if (res.ok) {
        // Step 1: Content-Type validation (detect HTML captive portals / proxies)
        const contentType = (typeof res.headers?.get === 'function' ? res.headers.get('content-type') : '') || '';
        if (contentType.toLowerCase().includes('text/html') || contentType.toLowerCase().includes('application/xhtml+xml')) {
          return {
            success: false,
            latencyMs: latency,
            message: `Resposta inesperada do Ollama (HTTP ${res.status}): o endpoint retornou uma página HTML em vez de JSON. Verifique se a URL "${cleanUrl}" aponta diretamente para o daemon do Ollama e se não há um proxy/portal interceptando a requisição.`,
          };
        }

        // Step 2: Safe JSON body parsing
        let data: any;
        try {
          data = await res.json();
        } catch (jsonErr: any) {
          return {
            success: false,
            latencyMs: latency,
            message: `Resposta inválida do Ollama (HTTP ${res.status}): o corpo retornado não é um JSON válido (${jsonErr.message || 'formato incorreto'}). Verifique se a URL "${cleanUrl}" aponta para um daemon Ollama.`,
          };
        }

        // Step 3: Validate root payload is an object
        if (!data || typeof data !== 'object' || Array.isArray(data)) {
          return {
            success: false,
            latencyMs: latency,
            message: `Resposta inesperada do Ollama (HTTP ${res.status}): o corpo retornado não é um objeto JSON válido.`,
          };
        }

        // Step 4: Validate "models" property is an Array
        if (!Array.isArray(data.models)) {
          return {
            success: false,
            latencyMs: latency,
            message: `Resposta inesperada do Ollama (HTTP ${res.status}): campo "models" ausente ou não é um array válido. Verifique se a URL aponta para a API do Ollama.`,
          };
        }

        // Step 5: Filter out non-object or null items before mapping
        const validModelObjects = data.models.filter(
          (m: any) => m !== null && typeof m === 'object'
        );

        const models: string[] = validModelObjects
          .map((m: any) => {
            const rawName = typeof m.name === 'string' ? m.name : typeof m.model === 'string' ? m.model : '';
            return rawName.trim();
          })
          .filter((name: string) => name.length > 0);

        if (data.models.length > 0 && models.length === 0) {
          return {
            success: false,
            latencyMs: latency,
            message: `Resposta inesperada do Ollama (HTTP ${res.status}): a lista "models" não contém modelos válidos.`,
          };
        }

        // Step 6: Match model
        const match = models.some(
          (name) =>
            name === config.model ||
            name.startsWith(`${config.model}:`) ||
            name.split(':')[0] === config.model
        );

        if (match) {
          return {
            success: true,
            latencyMs: latency,
            message: `Daemon Ollama online e modelo "${config.model}" instalado localmente!`,
          };
        } else {
          const sample = models.slice(0, 3).join(', ');
          return {
            success: true,
            latencyMs: latency,
            message: `Ollama conectado! Porém o modelo "${config.model}" não está baixado. Execute "ollama run ${config.model}" no terminal. Modelos encontrados: ${sample || 'nenhum'}.`,
          };
        }
      }

      const errData = await res.json().catch(() => ({}));
      const errMsg = (errData && typeof errData === 'object' && typeof errData.error === 'string')
        ? errData.error
        : res.statusText || 'Erro inesperado';

      return {
        success: false,
        latencyMs: latency,
        message: `Ollama retornou HTTP ${res.status}: ${errMsg}`,
      };
    }

    if (provider === 'custom') {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (config.apiKey) {
        headers['Authorization'] = `Bearer ${config.apiKey}`;
      }

      // Step 1: Try GET /models
      const modelsEndpoint = `${cleanUrl}/models`;
      const getRes = await fetch(modelsEndpoint, {
        method: 'GET',
        headers,
        signal: controller.signal,
      }).catch(() => null);

      if (getRes && getRes.ok) {
        const latency = Math.round(performance.now() - startTime);
        return {
          success: true,
          latencyMs: latency,
          message: `Endpoint customizado acessível! Lista de modelos validada com sucesso.`,
        };
      }

      // Step 2: Fallback to 1-token completion
      const chatEndpoint = cleanUrl.endsWith('/chat/completions')
        ? cleanUrl
        : `${cleanUrl}/chat/completions`;

      const pingRes = await fetch(chatEndpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: config.model,
          messages: [{ role: 'user', content: 'hi' }],
          max_tokens: 1,
        }),
        signal: controller.signal,
      });
      const latency = Math.round(performance.now() - startTime);

      if (pingRes.ok) {
        return {
          success: true,
          latencyMs: latency,
          message: `Endpoint customizado validado com sucesso via chat completions!`,
        };
      }

      const errData = await pingRes.json().catch(() => ({}));
      const errMsg = errData.error?.message || pingRes.statusText;
      return {
        success: false,
        latencyMs: latency,
        message: `Falha na verificação do endpoint customizado (HTTP ${pingRes.status}): ${errMsg}`,
      };
    }
  } catch (err: any) {
    const latency = Math.round(performance.now() - startTime);
    if (err.name === 'AbortError') {
      return {
        success: false,
        latencyMs: latency,
        message: `Tempo limite de conexão excedido (10s). Verifique se o servidor está online em "${cleanUrl}".`,
      };
    }
    if (provider === 'ollama') {
      const isNetworkUnreachable =
        err.name === 'TypeError' ||
        (typeof err.message === 'string' && (
          err.message.includes('Failed to fetch') ||
          err.message.includes('fetch failed') ||
          err.message.includes('network') ||
          err.message.includes('Network')
        )) ||
        ['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNRESET'].includes(err.code || err.cause?.code);

      if (isNetworkUnreachable) {
        return {
          success: false,
          latencyMs: latency,
          message: `Não foi possível conectar ao Ollama em "${cleanUrl}". Verifique se o daemon está em execução (execute "ollama serve" no seu terminal).`,
        };
      }

      return {
        success: false,
        latencyMs: latency,
        message: `Erro ao comunicar com Ollama: ${err.message || String(err)}`,
      };
    }
    return {
      success: false,
      latencyMs: latency,
      message: `Erro de rede ao conectar: ${err.message}. Verifique a URL e sua conexão.`,
    };
  } finally {
    clearTimeout(timeoutId);
  }

  return { success: false, message: 'Provedor desconhecido.' };
}

/**
 * Display test result banner.
 */
export function showStatusBanner(result: TestConnectionResult): void {
  const banner = document.getElementById('connection-status-banner');
  const icon = document.getElementById('status-banner-icon');
  const title = document.getElementById('status-banner-title');
  const message = document.getElementById('status-banner-message');
  const latency = document.getElementById('status-latency');

  if (!banner || !icon || !title || !message || !latency) return;

  banner.classList.remove('hidden', 'success', 'error');
  banner.classList.add(result.success ? 'success' : 'error');

  icon.textContent = result.success ? '✓' : '✕';
  title.textContent = result.success ? 'Conexão Estabelecida' : 'Falha na Conexão';
  message.textContent = result.message;

  if (result.latencyMs !== undefined) {
    latency.textContent = `${result.latencyMs}ms`;
    latency.classList.remove('hidden');
  } else {
    latency.classList.add('hidden');
  }
}

/**
 * Hide test result banner.
 */
export function hideStatusBanner(): void {
  const banner = document.getElementById('connection-status-banner');
  banner?.classList.add('hidden');
}

/**
 * Handle Save Settings button click.
 */
export async function handleSaveSettings(): Promise<void> {
  snapshotActiveProviderFromDOM();

  // Validate current provider
  const config = currentSettings.providers[activeProvider];
  const meta = PROVIDER_METADATA[activeProvider];

  if (!config.baseUrl) {
    showToast('A URL base do endpoint não pode ficar vazia.', 'error');
    return;
  }
  if (!config.model) {
    showToast('O nome do modelo não pode ficar vazio.', 'error');
    return;
  }
  if (meta.keyRequired && !config.apiKey) {
    showToast(`A Chave de API é obrigatória para o provedor ${meta.displayName}.`, 'error');
    return;
  }

  // Update generation defaults
  const tempSlider = document.getElementById('temperature') as HTMLInputElement | null;
  const localeSelect = document.getElementById('locale') as HTMLSelectElement | null;

  currentSettings.generationDefaults = {
    temperature: parseFloat(tempSlider?.value || '0.7'),
    locale: localeSelect?.value || 'pt-BR',
  };

  // UI Save Animation
  const saveBtn = document.getElementById('btn-save-settings') as HTMLButtonElement | null;
  const spinner = document.getElementById('save-spinner');
  const icon = document.getElementById('save-icon');

  if (saveBtn) saveBtn.disabled = true;
  spinner?.classList.remove('hidden');
  icon?.classList.add('hidden');

  try {
    await saveSettings(currentSettings);
    showToast('Configurações salvas com sucesso!');
  } catch (err: any) {
    showToast(`Erro ao persistir configurações: ${err.message}`, 'error');
  } finally {
    if (saveBtn) saveBtn.disabled = false;
    spinner?.classList.add('hidden');
    icon?.classList.remove('hidden');
  }
}

/**
 * Handle restore factory defaults.
 */
export async function handleRestoreDefaults(): Promise<void> {
  const confirmReset = window.confirm(
    'Deseja restaurar as configurações padrão de fábrica para todos os provedores?'
  );
  if (!confirmReset) return;

  currentSettings = await resetSettings();
  activeProvider = currentSettings.activeProvider;

  renderTabButtons(activeProvider);
  renderProviderFields(activeProvider);
  renderGeneralDefaults();
  hideStatusBanner();

  showToast('Padrões de fábrica restaurados com sucesso!');
}

/**
 * Show auto-hiding toast alert.
 */
export function showToast(message: string, type: 'success' | 'error' = 'success'): void {
  const toast = document.getElementById('toast-notification');
  const toastText = document.getElementById('toast-text');
  if (!toast || !toastText) return;

  if (toastTimeoutId) {
    clearTimeout(toastTimeoutId);
  }

  toastText.textContent = message;
  toast.style.backgroundColor = type === 'error' ? '#ef4444' : '#0f172a';
  toast.classList.remove('hidden');

  toastTimeoutId = setTimeout(() => {
    toast.classList.add('hidden');
    toastTimeoutId = null;
  }, 3500);
}
