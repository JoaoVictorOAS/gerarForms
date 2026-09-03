/**
 * FormGen Content Script Entrypoint
 * Handles runtime message listening, DOM scanning coordination, and filling injection.
 * Path: src/content/index.ts
 */

import {
  ExtensionMessage,
  ExtensionResponse,
  ScanDomRequest,
  ScanDomResponse,
  InjectRecordRequest,
  InjectRecordResponse,
} from '../shared/types';
import { scanDocument } from './scanner';
import { injectRecordIntoDom } from './filler';

/**
 * Handles incoming messages dispatched to this content script tab.
 * Exported for headless unit testing in JSDOM environments.
 *
 * @param message ExtensionMessage
 * @param sender chrome.runtime.MessageSender
 * @param rootDoc Document (optional override for headless testing)
 */
export async function handleContentMessage(
  message: ExtensionMessage,
  sender?: chrome.runtime.MessageSender,
  rootDoc?: Document
): Promise<ExtensionResponse> {
  if (!message || typeof message !== 'object' || !message.action) {
    return {
      success: false,
      error: 'Mensagem inválida recebida pelo content script.',
    };
  }

  switch (message.action) {
    case 'PING': {
      return { success: true, status: 'PONG' } as ExtensionResponse;
    }

    case 'SCAN_DOM': {
      try {
        const scanReq = message as ScanDomRequest & {
          formId?: string;
          formSelector?: string;
        };

        let target: string | undefined = scanReq.formSelector;
        if (!target && scanReq.formId) {
          target = scanReq.formId.startsWith('#')
            ? scanReq.formId
            : `#${scanReq.formId}`;
        }

        const schema = scanDocument({
          target,
          document:
            rootDoc || (typeof document !== 'undefined' ? document : undefined),
        });

        return {
          success: true,
          schema,
        } as ScanDomResponse;
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
        } as ScanDomResponse;
      }
    }

    case 'INJECT_RECORD': {
      try {
        const injectReq = message as InjectRecordRequest;
        if (!injectReq.record || typeof injectReq.record !== 'object') {
          return {
            success: false,
            error: 'Registro de dados inválido ou vazio para injeção.',
          } as InjectRecordResponse;
        }

        const res = injectRecordIntoDom(
          injectReq.record,
          injectReq.formId,
          rootDoc || (typeof document !== 'undefined' ? document : undefined)
        );

        return {
          success: res.success,
          injectedFields: res.injectedFields,
          skippedFields: res.skippedFields,
          error: res.error,
        } as InjectRecordResponse;
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
        } as InjectRecordResponse;
      }
    }

    default: {
      return {
        success: false,
        error: `Ação não suportada pelo content script: ${(message as any).action}`,
      };
    }
  }
}

/**
 * Register top-level runtime message listener if in extension environment.
 * Must be synchronous during script evaluation in Chrome MV3.
 * Returns true to maintain async response channel.
 */
if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage?.addListener) {
  chrome.runtime.onMessage.addListener(
    (
      message: ExtensionMessage,
      sender: chrome.runtime.MessageSender,
      sendResponse: (response: ExtensionResponse) => void
    ): boolean => {
      handleContentMessage(message, sender)
        .then((response) => {
          sendResponse(response);
        })
        .catch((err) => {
          sendResponse({
            success: false,
            error: err instanceof Error ? err.message : String(err),
          });
        });

      // Synchronously return true to keep message channel open for async response
      return true;
    }
  );
}
