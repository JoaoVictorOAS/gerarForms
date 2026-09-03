/**
 * FormGen Popup Controller
 * Manages user actions, dynamic queue insertion button, batch generation,
 * and IPC communication with Content Script and Background Service Worker.
 * Path: src/popup/popup.ts
 */

import {
  ExtensionResponse,
  ScanDomResponse,
  GenerateDataResponse,
  InjectRecordResponse,
  AdvanceQueueResponse,
  FormGenQueueState,
  FormSchema,
} from '../shared/types';
import { getActiveQueue, saveActiveQueue, clearActiveQueue, getSettings } from '../shared/storage';

// DOM Elements
const btnInsertRecord = document.getElementById('btn-insert-record') as HTMLButtonElement;
const insertRecordText = document.getElementById('insert-record-text') as HTMLSpanElement;
const btnGenerateSingle = document.getElementById('btn-generate-single') as HTMLButtonElement;
const btnGenerate10 = document.getElementById('btn-generate-10') as HTMLButtonElement;
const btnGenerate100 = document.getElementById('btn-generate-100') as HTMLButtonElement;
const btnSettings = document.getElementById('btn-settings') as HTMLButtonElement;
const btnClearQueue = document.getElementById('btn-clear-queue') as HTMLButtonElement;

const statusMessage = document.getElementById('status-message') as HTMLDivElement;
const formStatusIndicator = document.getElementById('form-status-indicator') as HTMLSpanElement;
const formStatusText = document.getElementById('form-status-text') as HTMLSpanElement;

const queueSection = document.getElementById('queue-section') as HTMLElement;
const queueProgressBar = document.getElementById('queue-progress-bar') as HTMLDivElement;
const queueCountText = document.getElementById('queue-count-text') as HTMLSpanElement;
const queueNextText = document.getElementById('queue-next-text') as HTMLSpanElement;
const providerBadge = document.getElementById('provider-badge') as HTMLSpanElement;

let activeTabId: number | null = null;
let activeTabUrl: string = '';
let cachedSchema: FormSchema | null = null;

// ============================================================================
// UI Feedback Helpers
// ============================================================================

function showStatus(message: string, type: 'loading' | 'success' | 'error'): void {
  if (!statusMessage) return;
  statusMessage.textContent = message;
  statusMessage.className = `status-box ${type}`;
}

function hideStatus(): void {
  if (!statusMessage) return;
  statusMessage.className = 'status-box hidden';
}

function setActionButtonsDisabled(disabled: boolean): void {
  if (btnGenerateSingle) btnGenerateSingle.disabled = disabled;
  if (btnGenerate10) btnGenerate10.disabled = disabled;
  if (btnGenerate100) btnGenerate100.disabled = disabled;
}

// ============================================================================
// Queue UI Management
// ============================================================================

function updateQueueUI(queue: FormGenQueueState | null): void {
  if (!queue || queue.pendingRecords.length === 0) {
    // No active queue
    if (btnInsertRecord) {
      btnInsertRecord.disabled = true;
      insertRecordText.textContent = 'Inserir registro';
    }
    if (queueSection) queueSection.classList.add('hidden');
    return;
  }

  // Queue active: show dynamic button "Inserir registro [$numero_do_registro]"
  if (btnInsertRecord) {
    btnInsertRecord.disabled = false;
    insertRecordText.textContent = `Inserir registro [${queue.currentIndex}/${queue.totalRecords}]`;
  }

  if (queueSection) {
    queueSection.classList.remove('hidden');
    const insertedCount = queue.currentIndex - 1;
    const progressPercent = Math.min(100, Math.round((insertedCount / queue.totalRecords) * 100));
    if (queueProgressBar) queueProgressBar.style.width = `${progressPercent}%`;
    if (queueCountText) queueCountText.textContent = `${insertedCount} de ${queue.totalRecords} registros inseridos`;
    if (queueNextText) queueNextText.textContent = `Próximo: #${queue.currentIndex}`;
  }
}

// ============================================================================
// Initialization
// ============================================================================

async function initPopup(): Promise<void> {
  try {
    // 1. Load active AI provider info
    const settings = await getSettings();
    if (providerBadge) {
      const activeProvider = settings.activeProvider.toUpperCase();
      const model = settings.providers[settings.activeProvider]?.model || 'Default';
      providerBadge.textContent = `IA: ${activeProvider} (${model})`;
    }

    // 2. Query active browser tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) {
      showStatus('Nenhuma aba ativa detectada.', 'error');
      return;
    }

    activeTabId = tab.id;
    activeTabUrl = tab.url || '';

    // 3. Check for active queue
    const activeQueue = await getActiveQueue();
    updateQueueUI(activeQueue);

    // 4. Probe active tab DOM for forms
    await probeActiveTabForm();
  } catch (err) {
    console.error('[FormGen Popup] Error during initialization:', err);
  }
}

async function probeActiveTabForm(): Promise<void> {
  if (!activeTabId) return;

  try {
    const response = await chrome.tabs.sendMessage(activeTabId, {
      action: 'SCAN_DOM',
    }) as ScanDomResponse;

    if (response && response.success && response.schema && response.schema.fields.length > 0) {
      cachedSchema = response.schema;
      if (formStatusIndicator) {
        formStatusIndicator.className = 'status-indicator ready';
      }
      if (formStatusText) {
        const fieldCount = response.schema.fields.length;
        formStatusText.textContent = `Formulário detectado (${fieldCount} ${fieldCount === 1 ? 'campo' : 'campos'})`;
      }
    } else {
      if (formStatusIndicator) {
        formStatusIndicator.className = 'status-indicator';
      }
      if (formStatusText) {
        formStatusText.textContent = 'Nenhum formulário detectado na página.';
      }
    }
  } catch (err) {
    // Content script might not be injected or page is chrome://
    if (formStatusIndicator) {
      formStatusIndicator.className = 'status-indicator error';
    }
    if (formStatusText) {
      formStatusText.textContent = 'Página não suportada ou recarregue a aba.';
    }
  }
}

// ============================================================================
// Actions
// ============================================================================

/**
 * Scan active tab DOM and return schema.
 */
async function scanForm(): Promise<FormSchema | null> {
  if (!activeTabId) {
    showStatus('Aba ativa não identificada.', 'error');
    return null;
  }

  try {
    const scanRes = await chrome.tabs.sendMessage(activeTabId, {
      action: 'SCAN_DOM',
    }) as ScanDomResponse;

    if (!scanRes || !scanRes.success || !scanRes.schema || scanRes.schema.fields.length === 0) {
      showStatus(scanRes?.error || 'Nenhum campo detectado para preenchimento.', 'error');
      return null;
    }

    cachedSchema = scanRes.schema;
    return scanRes.schema;
  } catch (err) {
    showStatus('Erro ao comunicar com a página. Recarregue a aba.', 'error');
    return null;
  }
}

/**
 * Generate 1 single record and inject immediately into the form.
 */
async function handleGenerateSingle(): Promise<void> {
  showStatus('Analisando formulário...', 'loading');
  setActionButtonsDisabled(true);

  try {
    const schema = await scanForm();
    if (!schema) {
      setActionButtonsDisabled(false);
      return;
    }

    showStatus('Gerando dados com IA...', 'loading');
    const genRes = await chrome.runtime.sendMessage({
      action: 'GENERATE_DATA',
      count: 1,
      schema,
    }) as GenerateDataResponse;

    if (!genRes || !genRes.success || !genRes.records || genRes.records.length === 0) {
      showStatus(genRes?.error || 'Falha na resposta da IA.', 'error');
      setActionButtonsDisabled(false);
      return;
    }

    showStatus('Preenchendo formulário...', 'loading');
    const recordToInject = genRes.records[0];

    const injectRes = await chrome.tabs.sendMessage(activeTabId!, {
      action: 'INJECT_RECORD',
      record: recordToInject,
      formId: schema.formId,
    }) as InjectRecordResponse;

    if (injectRes && injectRes.success) {
      const count = injectRes.injectedFields?.length || (recordToInject ? Object.keys(recordToInject).length : 0);
      showStatus(`Registro único inserido com sucesso (${count} campos)!`, 'success');
    } else {
      showStatus(injectRes?.error || 'Erro ao preencher campos.', 'error');
    }
  } catch (err) {
    showStatus(err instanceof Error ? err.message : String(err), 'error');
  } finally {
    setActionButtonsDisabled(false);
  }
}

/**
 * Generate multiple records (10 or 100):
 * - Injects the 1st record into the form immediately.
 * - Stores remaining records (#2..#N) in browser storage queue.
 * - Updates button to "Inserir registro [$numero_do_registro]".
 */
async function handleGenerateBatch(count: 10 | 100): Promise<void> {
  showStatus(`Gerando lote de ${count} registros com IA...`, 'loading');
  setActionButtonsDisabled(true);

  try {
    const schema = await scanForm();
    if (!schema) {
      setActionButtonsDisabled(false);
      return;
    }

    const genRes = await chrome.runtime.sendMessage({
      action: 'GENERATE_DATA',
      count,
      schema,
    }) as GenerateDataResponse;

    if (!genRes || !genRes.success || !genRes.records || genRes.records.length === 0) {
      showStatus(genRes?.error || 'Falha na geração dos registros com IA.', 'error');
      setActionButtonsDisabled(false);
      return;
    }

    const records = genRes.records;
    const firstRecord = records[0];
    const pendingRecords = records.slice(1);

    // 1. Inject first record immediately into form
    showStatus('Preenchendo 1º registro no formulário...', 'loading');
    const injectRes = await chrome.tabs.sendMessage(activeTabId!, {
      action: 'INJECT_RECORD',
      record: firstRecord,
      formId: schema.formId,
    }) as InjectRecordResponse;

    // 2. Save remaining records into browser storage queue
    const now = Date.now();
    const queueState: FormGenQueueState = {
      queueId: `queue_${now}`,
      tabId: activeTabId!,
      url: activeTabUrl,
      formId: schema.formId || 'form',
      totalRecords: count,
      currentIndex: 2, // Next record to inject
      pendingRecords,
      createdAt: now,
      updatedAt: now,
    };

    await saveActiveQueue(queueState);

    // 3. Update UI
    updateQueueUI(queueState);

    const injectedCount = injectRes?.injectedFields?.length || (firstRecord ? Object.keys(firstRecord).length : 0);
    showStatus(
      `Registro #1 inserido (${injectedCount} campos)! ${pendingRecords.length} registros guardados na fila.`,
      'success'
    );
  } catch (err) {
    showStatus(err instanceof Error ? err.message : String(err), 'error');
  } finally {
    setActionButtonsDisabled(false);
  }
}

/**
 * Inserts the next record from the browser queue: "Inserir registro [$numero_do_registro]"
 */
async function handleInsertNextRecord(): Promise<void> {
  showStatus('Avançando fila...', 'loading');
  if (btnInsertRecord) btnInsertRecord.disabled = true;

  try {
    // 1. Advance queue atomically via background service worker
    const advanceRes = await chrome.runtime.sendMessage({
      action: 'ADVANCE_QUEUE',
    }) as AdvanceQueueResponse;

    if (!advanceRes || !advanceRes.success || !advanceRes.record) {
      showStatus(advanceRes?.error || 'Nenhum registro pendente na fila.', 'error');
      updateQueueUI(null);
      return;
    }

    // 2. Inject popped record into active form
    const injectRes = await chrome.tabs.sendMessage(activeTabId!, {
      action: 'INJECT_RECORD',
      record: advanceRes.record,
      formId: cachedSchema?.formId,
    }) as InjectRecordResponse;

    // 3. Refresh queue state from storage
    const currentQueue = await getActiveQueue();
    updateQueueUI(currentQueue);

    if (advanceRes.isFinished) {
      showStatus('Último registro inserido com sucesso! Fila concluída.', 'success');
    } else {
      showStatus(
        `Registro #${advanceRes.currentIndex} inserido! Restam ${advanceRes.remainingCount} na fila.`,
        'success'
      );
    }
  } catch (err) {
    showStatus(err instanceof Error ? err.message : String(err), 'error');
  } finally {
    const currentQueue = await getActiveQueue();
    if (btnInsertRecord) {
      btnInsertRecord.disabled = !currentQueue || currentQueue.pendingRecords.length === 0;
    }
  }
}

/**
 * Discards remaining queued records.
 */
async function handleClearQueue(): Promise<void> {
  try {
    await chrome.runtime.sendMessage({ action: 'DISCARD_QUEUE' });
    updateQueueUI(null);
    showStatus('Fila descartada com sucesso.', 'success');
  } catch (err) {
    showStatus('Erro ao descartar fila.', 'error');
  }
}

// ============================================================================
// Event Listeners
// ============================================================================

btnInsertRecord?.addEventListener('click', handleInsertNextRecord);
btnGenerateSingle?.addEventListener('click', handleGenerateSingle);
btnGenerate10?.addEventListener('click', () => handleGenerateBatch(10));
btnGenerate100?.addEventListener('click', () => handleGenerateBatch(100));
btnClearQueue?.addEventListener('click', handleClearQueue);

btnSettings?.addEventListener('click', () => {
  if (chrome.runtime.openOptionsPage) {
    chrome.runtime.openOptionsPage();
  } else {
    window.open(chrome.runtime.getURL('options.html'));
  }
});

// Run initialization on DOM load
document.addEventListener('DOMContentLoaded', initPopup);
