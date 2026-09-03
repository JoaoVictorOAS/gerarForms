/**
 * FormGen Background Service Worker
 * Coordinates runtime messaging, AI API proxying, persistent queue routing,
 * and context menu interactions.
 * Path: src/background/index.ts
 */

import {
  ExtensionMessage,
  ExtensionResponse,
  GenerateDataRequest,
  GenerateDataResponse,
  ScanDomResponse,
  InjectRecordResponse,
  FormRecord,
  FormGenQueueState,
} from '../shared/types';
import {
  getActiveQueue,
  advanceActiveQueue,
  clearActiveQueue,
  saveActiveQueue,
  getActiveProviderConfig,
} from '../shared/storage';
import { generateFormData } from '../shared/ai';

console.log('[FormGen SW] Background Service Worker initialized.');

/**
 * Top-level synchronous onMessage listener.
 * In Chrome MV3, this MUST be registered synchronously on script evaluation.
 * Returns `true` synchronously to indicate an asynchronous `sendResponse`.
 */
if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage?.addListener) {
  chrome.runtime.onMessage.addListener(
    (
      message: ExtensionMessage,
      sender: chrome.runtime.MessageSender,
      sendResponse: (response: ExtensionResponse) => void
    ): boolean => {
      handleIncomingMessage(message, sender)
        .then((res) => {
          sendResponse(res);
        })
        .catch((err) => {
          console.error('[FormGen SW] Error processing message:', err);
          sendResponse({
            success: false,
            error: err instanceof Error ? err.message : String(err),
          } as ExtensionResponse);
        });

      // Keep the message channel open for async sendResponse
      return true;
    }
  );
}

/**
 * Configures Chrome Context Menus for FormGen.
 * Submenu hierarchy:
 *   - FormGen
 *     - Criar registros ▶
 *       - 1 registro (preencher agora)
 *       - Lote com 10 registros
 *       - Lote com 100 registros
 *     - [separator]
 *     - Inserir próximo registro da fila
 *     - Descartar fila ativa
 */
export function setupContextMenus(): void {
  if (typeof chrome === 'undefined' || !chrome.contextMenus?.create) return;

  chrome.contextMenus.removeAll(() => {
    // 1. Root Menu
    chrome.contextMenus.create({
      id: 'formgen_root',
      title: 'FormGen',
      contexts: ['all'],
    });

    // 2. Submenu: Criar registros
    chrome.contextMenus.create({
      id: 'formgen_create_menu',
      parentId: 'formgen_root',
      title: 'Criar registros',
      contexts: ['all'],
    });

    chrome.contextMenus.create({
      id: 'formgen_create_1',
      parentId: 'formgen_create_menu',
      title: '1 registro (preencher agora)',
      contexts: ['all'],
    });

    chrome.contextMenus.create({
      id: 'formgen_create_10',
      parentId: 'formgen_create_menu',
      title: 'Lote com 10 registros',
      contexts: ['all'],
    });

    chrome.contextMenus.create({
      id: 'formgen_create_100',
      parentId: 'formgen_create_menu',
      title: 'Lote com 100 registros',
      contexts: ['all'],
    });

    // Separator
    chrome.contextMenus.create({
      id: 'formgen_sep_1',
      parentId: 'formgen_root',
      type: 'separator',
      contexts: ['all'],
    });

    // 3. Inserir próximo registro da fila
    chrome.contextMenus.create({
      id: 'formgen_inject_next',
      parentId: 'formgen_root',
      title: 'Inserir próximo registro da fila',
      contexts: ['all'],
    });

    // 4. Descartar fila ativa
    chrome.contextMenus.create({
      id: 'formgen_discard_queue',
      parentId: 'formgen_root',
      title: 'Descartar fila ativa',
      contexts: ['all'],
    });
  });
}

/**
 * Handles clicks on FormGen context menu items.
 * Exported for testing.
 */
export async function handleContextMenuClick(
  info: chrome.contextMenus.OnClickData,
  tab?: chrome.tabs.Tab
): Promise<void> {
  const tabId = tab?.id;
  if (!tabId) return;

  const menuItemId = String(info.menuItemId);

  const notifyTab = async (
    message: string,
    type: 'info' | 'success' | 'warning' | 'error' = 'info'
  ) => {
    try {
      await chrome.tabs.sendMessage(tabId, {
        action: 'SHOW_TOAST',
        message,
        type,
      });
    } catch {
      // Content script may not be loaded yet
    }
  };

  const ensureContentScript = async () => {
    try {
      await chrome.tabs.sendMessage(tabId, { action: 'PING' });
    } catch {
      if (typeof chrome !== 'undefined' && chrome.scripting?.executeScript) {
        try {
          await chrome.scripting.executeScript({
            target: { tabId },
            files: ['content.js'],
          });
        } catch {
          // Ignore if permission denied or chrome:// URL
        }
      }
    }
  };

  if (
    menuItemId === 'formgen_create_1' ||
    menuItemId === 'formgen_create_10' ||
    menuItemId === 'formgen_create_100'
  ) {
    const count: 1 | 10 | 100 =
      menuItemId === 'formgen_create_1'
        ? 1
        : menuItemId === 'formgen_create_10'
        ? 10
        : 100;

    await ensureContentScript();
    await notifyTab(`FormGen: Inspecionando formulário para gerar ${count} registro(s)...`, 'info');

    // 1. Scan form targeted by right-click
    let scanRes: ScanDomResponse;
    try {
      scanRes = (await chrome.tabs.sendMessage(tabId, {
        action: 'SCAN_DOM',
        fromContextMenu: true,
      })) as ScanDomResponse;
    } catch (err) {
      await notifyTab('FormGen: Não foi possível inspecionar a página. Recarregue a aba.', 'error');
      return;
    }

    if (
      !scanRes ||
      !scanRes.success ||
      !scanRes.schema ||
      !Array.isArray(scanRes.schema.fields) ||
      scanRes.schema.fields.length === 0
    ) {
      await notifyTab('FormGen: Nenhum campo de formulário detectado no elemento clicado.', 'warning');
      return;
    }

    const schema = scanRes.schema;

    // 2. Load provider credentials
    const { provider, config, defaults } = await getActiveProviderConfig();
    if (provider !== 'ollama' && !config.apiKey?.trim()) {
      await notifyTab(
        `FormGen: Chave de API não configurada para ${provider}. Abra as opções da extensão.`,
        'error'
      );
      return;
    }

    await notifyTab(`FormGen: Gerando ${count} registro(s) com ${provider}...`, 'info');

    // 3. Generate structured data with AI
    let records: FormRecord[];
    try {
      records = await generateFormData({
        provider,
        config,
        defaults,
        schema,
        count,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await notifyTab(`FormGen: Falha na IA: ${msg}`, 'error');
      return;
    }

    if (!records || records.length === 0) {
      await notifyTab('FormGen: Nenhum dado retornado pela IA.', 'error');
      return;
    }

    // 4. Inject record #1
    const firstRecord = records[0];
    const injectRes = (await chrome.tabs.sendMessage(tabId, {
      action: 'INJECT_RECORD',
      record: firstRecord,
      formId: schema.formId,
      fromContextMenu: true,
    })) as InjectRecordResponse;

    const fieldsCount =
      injectRes?.injectedFields?.length || (firstRecord ? Object.keys(firstRecord).length : 0);

    // 5. Handle queue if batch
    if (count > 1) {
      const pendingRecords = records.slice(1);
      const now = Date.now();
      const queueState: FormGenQueueState = {
        queueId: `queue_${now}`,
        tabId,
        url: tab.url || '',
        formId: schema.formId || 'form',
        totalRecords: count,
        currentIndex: 2,
        pendingRecords,
        createdAt: now,
        updatedAt: now,
      };

      await saveActiveQueue(queueState);
      await notifyTab(
        `FormGen: Registro #1 preenchido (${fieldsCount} campos)! Fila criada com ${pendingRecords.length} registros restantes.`,
        'success'
      );
    } else {
      await notifyTab(
        `FormGen: Formulário preenchido com sucesso (${fieldsCount} campos)!`,
        'success'
      );
    }
    return;
  }

  if (menuItemId === 'formgen_inject_next') {
    await ensureContentScript();
    const queue = await getActiveQueue();

    if (!queue || !queue.pendingRecords || queue.pendingRecords.length === 0) {
      await notifyTab('FormGen: Nenhuma fila de registros ativa.', 'warning');
      return;
    }

    const result = await advanceActiveQueue();
    if (!result || !result.record) {
      await notifyTab('FormGen: Fila concluída!', 'info');
      return;
    }

    const injectRes = (await chrome.tabs.sendMessage(tabId, {
      action: 'INJECT_RECORD',
      record: result.record,
      formId: queue.formId,
      fromContextMenu: true,
    })) as InjectRecordResponse;

    const fieldsCount =
      injectRes?.injectedFields?.length || Object.keys(result.record).length;

    if (result.isFinished) {
      await notifyTab(
        `FormGen: Registro final [${result.currentIndex}/${result.totalRecords}] inserido (${fieldsCount} campos)! Fila concluída.`,
        'success'
      );
    } else {
      await notifyTab(
        `FormGen: Registro [${result.currentIndex}/${result.totalRecords}] inserido (${fieldsCount} campos)! Restam ${result.remainingCount}.`,
        'success'
      );
    }
    return;
  }

  if (menuItemId === 'formgen_discard_queue') {
    await clearActiveQueue();
    await notifyTab('FormGen: Fila de registros descartada com sucesso.', 'info');
    return;
  }
}

/**
 * Context menu listeners registration in Chrome MV3.
 */
if (typeof chrome !== 'undefined') {
  if (chrome.runtime?.onInstalled?.addListener) {
    chrome.runtime.onInstalled.addListener(() => {
      setupContextMenus();
    });
  }

  if (chrome.runtime?.onStartup?.addListener) {
    chrome.runtime.onStartup.addListener(() => {
      setupContextMenus();
    });
  }

  if (chrome.contextMenus?.onClicked?.addListener) {
    chrome.contextMenus.onClicked.addListener((info, tab) => {
      handleContextMenuClick(info, tab).catch((err) => {
        console.error('[FormGen SW] Context menu execution error:', err);
      });
    });
  }

  // Setup context menus immediately on evaluation
  setupContextMenus();
}

/**
 * Route and handle incoming runtime messages.
 * Exported for headless unit testing.
 */
export async function handleIncomingMessage(
  message: ExtensionMessage,
  sender?: chrome.runtime.MessageSender
): Promise<ExtensionResponse> {
  if (!message || typeof message !== 'object' || !message.action) {
    return { success: false, error: 'Mensagem inválida ou sem ação especificada.' };
  }

  switch (message.action) {
    case 'PING': {
      return { success: true, status: 'PONG' };
    }

    case 'GET_QUEUE_STATE': {
      const queue = await getActiveQueue();
      return { success: true, queue };
    }

    case 'ADVANCE_QUEUE': {
      const result = await advanceActiveQueue();
      return {
        success: true,
        record: result.record,
        currentIndex: result.currentIndex,
        totalRecords: result.totalRecords,
        remainingCount: result.remainingCount,
        isFinished: result.isFinished,
      };
    }

    case 'DISCARD_QUEUE': {
      await clearActiveQueue();
      return { success: true };
    }

    case 'SCAN_DOM': {
      return {
        success: false,
        error: 'SCAN_DOM é executado no contexto do content script (Milestone 2).',
      };
    }

    case 'INJECT_RECORD': {
      return {
        success: false,
        error: 'INJECT_RECORD é executado no contexto do content script (Milestone 5).',
      };
    }

    case 'GENERATE_DATA': {
      const genReq = message as GenerateDataRequest;

      // 1. Validate FormSchema
      if (
        !genReq.schema ||
        !Array.isArray(genReq.schema.fields) ||
        genReq.schema.fields.length === 0
      ) {
        return {
          success: false,
          error: 'Schema de formulário inválido ou nenhum campo detectado (Milestone 3 AI Service).',
        } as GenerateDataResponse;
      }

      // 2. Validate batch count
      const count = genReq.count ?? 1;
      if (![1, 10, 100].includes(count)) {
        return {
          success: false,
          error: `Quantidade de registros inválida: ${count}. Permitidos: 1, 10 ou 100.`,
        } as GenerateDataResponse;
      }

      try {
        // 3. Load active provider credentials from chrome.storage.sync
        const { provider, config, defaults } = await getActiveProviderConfig();

        if (provider !== 'ollama' && !config.apiKey?.trim()) {
          return {
            success: false,
            error: `Chave de API não configurada para o provedor ${provider}. Acesse as Configurações da extensão.`,
          } as GenerateDataResponse;
        }

        if (!config.baseUrl?.trim()) {
          return {
            success: false,
            error: `Base URL não configurada para o provedor ${provider}.`,
          } as GenerateDataResponse;
        }

        // 4. Delegate structured generation to AI Service
        const records = await generateFormData({
          provider,
          config,
          defaults,
          schema: genReq.schema,
          count,
        });

        return {
          success: true,
          count: records.length,
          records,
        } as GenerateDataResponse;
      } catch (err) {
        console.error('[FormGen SW] Erro na geração estruturada com IA:', err);
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
        } as GenerateDataResponse;
      }
    }

    case 'TEST_PROVIDER_CONNECTION': {
      return {
        success: false,
        error: 'TEST_PROVIDER_CONNECTION é executado no dashboard de opções (Milestone 1).',
      };
    }

    default: {
      return {
        success: false,
        error: `Ação desconhecida: ${(message as any).action}`,
      };
    }
  }
}
