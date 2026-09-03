/**
 * FormGen Content Script Entrypoint
 * Handles runtime message listening, DOM scanning coordination, context menu element tracking,
 * filling injection, and non-intrusive toast notifications.
 * Path: src/content/index.ts
 */

import {
  ExtensionMessage,
  ExtensionResponse,
  ScanDomRequest,
  ScanDomResponse,
  InjectRecordRequest,
  InjectRecordResponse,
  ShowToastRequest,
} from '../shared/types';
import { scanDocument } from './scanner';
import { injectRecordIntoDom } from './filler';

// Expose scanDocument for headless test runners and empirical benchmarks
if (typeof window !== 'undefined') {
  (window as any).__scanDocument = scanDocument;
}

/**
 * Tracks the most recent DOM element targeted by a right-click context menu event.
 */
let lastRightClickedElement: HTMLElement | null = null;

/**
 * Returns the last element clicked via right-click (context menu).
 */
export function getLastRightClickedElement(): HTMLElement | null {
  return lastRightClickedElement;
}

/**
 * Manually set the last right-clicked element (useful for tests).
 */
export function setLastRightClickedElement(el: HTMLElement | null): void {
  lastRightClickedElement = el;
}

/**
 * Register global contextmenu capture listener.
 */
if (typeof document !== 'undefined') {
  document.addEventListener(
    'contextmenu',
    (event: MouseEvent) => {
      lastRightClickedElement = (event.target as HTMLElement) || null;
    },
    true
  );
}

/**
 * Displays a non-intrusive floating toast notification on the page.
 */
export function showPageToast(
  message: string,
  type: 'info' | 'success' | 'warning' | 'error' = 'info',
  rootDoc?: Document
): void {
  const doc = rootDoc || (typeof document !== 'undefined' ? document : null);
  if (!doc || !doc.body) return;

  const toastId = 'formgen-toast-notification';
  const existing = doc.getElementById(toastId);
  if (existing) {
    existing.remove();
  }

  const toast = doc.createElement('div');
  toast.id = toastId;

  const bgColors: Record<string, string> = {
    info: '#2563eb',
    success: '#16a34a',
    warning: '#d97706',
    error: '#dc2626',
  };

  const icons: Record<string, string> = {
    info: 'ℹ️',
    success: '✅',
    warning: '⚠️',
    error: '❌',
  };

  Object.assign(toast.style, {
    position: 'fixed',
    bottom: '24px',
    right: '24px',
    zIndex: '2147483647',
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '12px 18px',
    backgroundColor: bgColors[type] || bgColors.info,
    color: '#ffffff',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    fontSize: '13px',
    fontWeight: '600',
    borderRadius: '8px',
    boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.3), 0 8px 10px -6px rgba(0, 0, 0, 0.2)',
    transition: 'opacity 0.25s ease, transform 0.25s ease',
    opacity: '0',
    transform: 'translateY(12px)',
    pointerEvents: 'none',
  });

  const iconSpan = doc.createElement('span');
  iconSpan.textContent = icons[type] || 'ℹ️';
  toast.appendChild(iconSpan);

  const textSpan = doc.createElement('span');
  textSpan.textContent = message;
  toast.appendChild(textSpan);

  doc.body.appendChild(toast);

  if (typeof requestAnimationFrame !== 'undefined') {
    requestAnimationFrame(() => {
      toast.style.opacity = '1';
      toast.style.transform = 'translateY(0)';
    });
  } else {
    toast.style.opacity = '1';
    toast.style.transform = 'translateY(0)';
  }

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(12px)';
    setTimeout(() => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    }, 300);
  }, 3500);
}

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

    case 'SHOW_TOAST': {
      const toastReq = message as ShowToastRequest;
      showPageToast(toastReq.message, toastReq.type, rootDoc);
      return { success: true } as ExtensionResponse;
    }

    case 'SCAN_DOM': {
      try {
        const scanReq = message as ScanDomRequest;

        let target: string | HTMLElement | undefined = undefined;

        if (scanReq.fromContextMenu && lastRightClickedElement) {
          target = lastRightClickedElement.closest('form') || lastRightClickedElement;
        } else if (typeof scanReq.formSelector === 'string' && scanReq.formSelector.trim()) {
          target = scanReq.formSelector.trim();
        } else if (typeof scanReq.formId === 'string' && scanReq.formId.trim()) {
          const trimmed = scanReq.formId.trim();
          target = trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
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

        let target: string | HTMLElement | undefined = undefined;
        if (injectReq.fromContextMenu && lastRightClickedElement) {
          target = lastRightClickedElement.closest('form') || lastRightClickedElement;
        } else if (injectReq.formId) {
          target = injectReq.formId;
        }

        const res = injectRecordIntoDom(
          injectReq.record,
          target,
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
