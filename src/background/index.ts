/**
 * FormGen Background Service Worker
 * Coordinates runtime messaging, AI API proxying, and persistent queue routing.
 * Path: src/background/index.ts
 */

import {
  ExtensionMessage,
  ExtensionResponse,
  GenerateDataRequest,
  GenerateDataResponse,
} from '../shared/types';
import {
  getActiveQueue,
  advanceActiveQueue,
  clearActiveQueue,
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
