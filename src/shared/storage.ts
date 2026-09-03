/**
 * FormGen - Extension Core Infra & Options UI
 * Asynchronous Typed Storage Wrappers with Headless Mocking Support
 * Path: src/shared/storage.ts
 */

import {
  FormGenSettings,
  FormGenQueueState,
  FormRecord,
  ProviderType,
  ProviderConfig,
  GenerationDefaults,
  DeepPartial,
} from './types';
import {
  STORAGE_KEYS,
  STORAGE_LIMITS,
  DEFAULT_SETTINGS,
} from './constants';

// ============================================================================
// 1. Storage Area Interface & Helper Types
// ============================================================================

/**
 * Common async interface for Chrome StorageArea and mock test environments.
 */
export interface StorageAreaInterface {
  /**
   * Retrieves one or more items from the storage area.
   */
  get(keys?: string | string[] | Record<string, any> | null): Promise<Record<string, any>>;

  /**
   * Sets multiple items in the storage area.
   */
  set(items: Record<string, any>): Promise<void>;

  /**
   * Removes one or more items from storage.
   */
  remove(keys: string | string[]): Promise<void>;

  /**
   * Removes all items from storage.
   */
  clear(): Promise<void>;

  /**
   * Calculates the amount of space (in bytes) used by items.
   */
  getBytesInUse?(keys?: string | string[]): Promise<number>;
}

export type StorageChangeCallback = (changes: {
  [key: string]: { oldValue?: any; newValue?: any };
}) => void;

// ============================================================================
// 2. In-Memory Mock Storage Area (for Vitest, Node, Headless Tests)
// ============================================================================

/**
 * Deep clone utility to isolate storage state from runtime mutations.
 */
function deepClone<T>(val: T): T {
  if (val === undefined || val === null) return val;
  return JSON.parse(JSON.stringify(val));
}

/**
 * In-memory implementation of Chrome's StorageArea.
 * Provides 100% faithful emulation of Chrome MV3 storage semantics for tests.
 */
export class MemoryStorageArea implements StorageAreaInterface {
  private data: Map<string, any> = new Map();
  private listeners: Set<StorageChangeCallback> = new Set();

  public async get(
    keys?: string | string[] | Record<string, any> | null
  ): Promise<Record<string, any>> {
    const result: Record<string, any> = {};

    if (keys === undefined || keys === null) {
      for (const [k, v] of this.data.entries()) {
        result[k] = deepClone(v);
      }
      return result;
    }

    if (typeof keys === 'string') {
      if (this.data.has(keys)) {
        result[keys] = deepClone(this.data.get(keys));
      }
      return result;
    }

    if (Array.isArray(keys)) {
      for (const k of keys) {
        if (this.data.has(k)) {
          result[k] = deepClone(this.data.get(k));
        }
      }
      return result;
    }

    if (typeof keys === 'object') {
      for (const [k, defaultVal] of Object.entries(keys)) {
        if (this.data.has(k)) {
          result[k] = deepClone(this.data.get(k));
        } else {
          result[k] = deepClone(defaultVal);
        }
      }
      return result;
    }

    return result;
  }

  public async set(items: Record<string, any>): Promise<void> {
    const changes: { [key: string]: { oldValue?: any; newValue?: any } } = {};

    for (const [k, v] of Object.entries(items)) {
      const oldValue = this.data.has(k) ? deepClone(this.data.get(k)) : undefined;
      const newValue = deepClone(v);
      this.data.set(k, newValue);
      changes[k] = { oldValue, newValue };
    }

    this.notifyListeners(changes);
  }

  public async remove(keys: string | string[]): Promise<void> {
    const keysArray = Array.isArray(keys) ? keys : [keys];
    const changes: { [key: string]: { oldValue?: any; newValue?: any } } = {};

    for (const k of keysArray) {
      if (this.data.has(k)) {
        const oldValue = deepClone(this.data.get(k));
        this.data.delete(k);
        changes[k] = { oldValue, newValue: undefined };
      }
    }

    if (Object.keys(changes).length > 0) {
      this.notifyListeners(changes);
    }
  }

  public async clear(): Promise<void> {
    const changes: { [key: string]: { oldValue?: any; newValue?: any } } = {};

    for (const [k, v] of this.data.entries()) {
      changes[k] = { oldValue: deepClone(v), newValue: undefined };
    }

    this.data.clear();

    if (Object.keys(changes).length > 0) {
      this.notifyListeners(changes);
    }
  }

  public async getBytesInUse(keys?: string | string[]): Promise<number> {
    const data = await this.get(keys);
    return new TextEncoder().encode(JSON.stringify(data)).length;
  }

  public addListener(callback: StorageChangeCallback): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  private notifyListeners(changes: { [key: string]: { oldValue?: any; newValue?: any } }): void {
    for (const listener of this.listeners) {
      try {
        listener(changes);
      } catch (err) {
        console.error('Error in MemoryStorageArea listener:', err);
      }
    }
  }
}

// ============================================================================
// 3. Native Chrome Storage Area Adapter
// ============================================================================

/**
 * Adapter delegating to standard `chrome.storage.sync` or `chrome.storage.local`.
 */
class ChromeStorageArea implements StorageAreaInterface {
  constructor(private areaName: 'sync' | 'local') {}

  private get area(): chrome.storage.StorageArea {
    return chrome.storage[this.areaName];
  }

  public async get(
    keys?: string | string[] | Record<string, any> | null
  ): Promise<Record<string, any>> {
    return new Promise((resolve, reject) => {
      this.area.get(keys as any, (items) => {
        if (chrome.runtime.lastError) {
          return reject(new Error(chrome.runtime.lastError.message));
        }
        resolve(items || {});
      });
    });
  }

  public async set(items: Record<string, any>): Promise<void> {
    return new Promise((resolve, reject) => {
      this.area.set(items, () => {
        if (chrome.runtime.lastError) {
          return reject(new Error(chrome.runtime.lastError.message));
        }
        resolve();
      });
    });
  }

  public async remove(keys: string | string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      this.area.remove(keys as any, () => {
        if (chrome.runtime.lastError) {
          return reject(new Error(chrome.runtime.lastError.message));
        }
        resolve();
      });
    });
  }

  public async clear(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.area.clear(() => {
        if (chrome.runtime.lastError) {
          return reject(new Error(chrome.runtime.lastError.message));
        }
        resolve();
      });
    });
  }

  public async getBytesInUse(keys?: string | string[]): Promise<number> {
    return new Promise((resolve, reject) => {
      this.area.getBytesInUse(keys as any, (bytes) => {
        if (chrome.runtime.lastError) {
          return reject(new Error(chrome.runtime.lastError.message));
        }
        resolve(bytes);
      });
    });
  }
}

// ============================================================================
// 4. Storage Instances & Mock Management
// ============================================================================

/**
 * In-process Promise-chain mutex to serialize asynchronous Read-Modify-Write (RMW)
 * operations and eliminate race conditions.
 *
 * Implements a strict FIFO lock queue where tasks execute in arrival order.
 * Ensures error isolation: even if an enqueued task rejects or throws, the lock
 * is safely released to prevent deadlock and allow subsequent tasks to proceed.
 */
export class AsyncMutex {
  private queue: Promise<void> = Promise.resolve();

  /**
   * Executes an asynchronous task exclusively within the mutex lock.
   *
   * @param task Function returning a Promise or value to be executed with mutual exclusion.
   * @returns Result of the task.
   */
  public async runExclusive<T>(task: () => Promise<T> | T): Promise<T> {
    let release: () => void;
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });

    const wait = this.queue;
    this.queue = next;

    await wait;
    try {
      return await task();
    } finally {
      release!();
    }
  }

  /**
   * Resets the mutex chain to an immediately resolved state.
   * Primarily used for test teardown (e.g. in resetStorageMocks()).
   */
  public reset(): void {
    this.queue = Promise.resolve();
  }
}

// Dedicated mutex instances for independent storage domains
export const settingsMutex = new AsyncMutex();
export const queueMutex = new AsyncMutex();

let customSyncMock: StorageAreaInterface | null = null;
let customLocalMock: StorageAreaInterface | null = null;

const fallbackSyncMock = new MemoryStorageArea();
const fallbackLocalMock = new MemoryStorageArea();

/**
 * Checks if the Chrome Extension Storage API is available in current execution context.
 */
export function isChromeStorageAvailable(area: 'sync' | 'local'): boolean {
  try {
    return (
      typeof chrome !== 'undefined' &&
      typeof chrome.storage !== 'undefined' &&
      typeof chrome.storage[area] !== 'undefined' &&
      typeof chrome.storage[area].get === 'function'
    );
  } catch {
    return false;
  }
}

/**
 * Returns active storage area for `sync` (settings).
 */
export function getSyncStorage(): StorageAreaInterface {
  if (customSyncMock) return customSyncMock;
  if (isChromeStorageAvailable('sync')) {
    return new ChromeStorageArea('sync');
  }
  return fallbackSyncMock;
}

/**
 * Returns active storage area for `local` (queue).
 */
export function getLocalStorage(): StorageAreaInterface {
  if (customLocalMock) return customLocalMock;
  if (isChromeStorageAvailable('local')) {
    return new ChromeStorageArea('local');
  }
  return fallbackLocalMock;
}

/**
 * Sets a custom mock storage implementation for tests.
 */
export function setStorageMock(
  area: 'sync' | 'local',
  mock: StorageAreaInterface | null
): void {
  if (area === 'sync') {
    customSyncMock = mock;
  } else {
    customLocalMock = mock;
  }
}

/**
 * Resets fallback and custom mocks to empty clean state.
 */
export function resetStorageMocks(): void {
  customSyncMock = null;
  customLocalMock = null;
  fallbackSyncMock.clear();
  fallbackLocalMock.clear();
  settingsMutex.reset();
  queueMutex.reset();
}

// ============================================================================
// 5. Deep Merging & Validation Utilities
// ============================================================================

/**
 * Recursively merges saved settings with DEFAULT_SETTINGS to ensure schema integrity.
 */
function mergeSettingsWithDefaults(
  saved: Partial<FormGenSettings> | undefined | null
): FormGenSettings {
  if (!saved || typeof saved !== 'object') {
    return deepClone(DEFAULT_SETTINGS);
  }

  const merged: FormGenSettings = deepClone(DEFAULT_SETTINGS);

  if (saved.activeProvider && ['gemini', 'openai', 'ollama', 'custom'].includes(saved.activeProvider)) {
    merged.activeProvider = saved.activeProvider;
  }

  if (saved.providers && typeof saved.providers === 'object') {
    const providerKeys: ProviderType[] = ['gemini', 'openai', 'ollama', 'custom'];
    for (const p of providerKeys) {
      if (saved.providers[p] && typeof saved.providers[p] === 'object') {
        merged.providers[p] = {
          apiKey: typeof saved.providers[p].apiKey === 'string' ? saved.providers[p].apiKey : merged.providers[p].apiKey,
          baseUrl: typeof saved.providers[p].baseUrl === 'string' ? saved.providers[p].baseUrl : merged.providers[p].baseUrl,
          model: typeof saved.providers[p].model === 'string' ? saved.providers[p].model : merged.providers[p].model,
        };
      }
    }
  }

  if (saved.generationDefaults && typeof saved.generationDefaults === 'object') {
    merged.generationDefaults = {
      temperature:
        typeof saved.generationDefaults.temperature === 'number'
          ? Math.max(0, Math.min(1, saved.generationDefaults.temperature))
          : merged.generationDefaults.temperature,
      locale:
        typeof saved.generationDefaults.locale === 'string' && saved.generationDefaults.locale.trim()
          ? saved.generationDefaults.locale.trim()
          : merged.generationDefaults.locale,
    };
  }

  return merged;
}

// ============================================================================
// 6. Settings Storage API (chrome.storage.sync)
// ============================================================================

/**
 * Retrieves FormGen extension settings from `chrome.storage.sync`.
 * Guarantees all default fields exist through deep merge.
 */
export async function getSettings(): Promise<FormGenSettings> {
  const storage = getSyncStorage();
  const raw = await storage.get(STORAGE_KEYS.SETTINGS);
  return mergeSettingsWithDefaults(raw[STORAGE_KEYS.SETTINGS]);
}

/**
 * Saves modified settings to `chrome.storage.sync`.
 * Enforces Chrome's 8 KB quota check before serialization.
 * Serializes RMW transactions via settingsMutex to prevent lost updates.
 */
export async function saveSettings(
  partialSettings: DeepPartial<FormGenSettings>
): Promise<void> {
  return settingsMutex.runExclusive(async () => {
    const current = await getSettings();

    const providerKeys: ProviderType[] = ['gemini', 'openai', 'ollama', 'custom'];
    const updatedProviders = { ...current.providers };

    if (partialSettings.providers && typeof partialSettings.providers === 'object') {
      for (const p of providerKeys) {
        const pConfig = partialSettings.providers[p];
        if (pConfig && typeof pConfig === 'object') {
          updatedProviders[p] = {
            ...current.providers[p],
            ...pConfig,
          };
        }
      }
    }

    const updatedGenerationDefaults: GenerationDefaults = {
      temperature:
        partialSettings.generationDefaults?.temperature !== undefined &&
        typeof partialSettings.generationDefaults.temperature === 'number' &&
        !Number.isNaN(partialSettings.generationDefaults.temperature)
          ? Math.max(0, Math.min(1, partialSettings.generationDefaults.temperature))
          : current.generationDefaults.temperature,
      locale:
        typeof partialSettings.generationDefaults?.locale === 'string' &&
        partialSettings.generationDefaults.locale.trim()
          ? partialSettings.generationDefaults.locale.trim()
          : current.generationDefaults.locale,
    };

    const updated: FormGenSettings = {
      ...current,
      ...partialSettings,
      providers: updatedProviders,
      generationDefaults: updatedGenerationDefaults,
    };

    // Quota enforcement: sync items cannot exceed 8,192 bytes
    const serialized = JSON.stringify({ [STORAGE_KEYS.SETTINGS]: updated });
    const byteLength = new TextEncoder().encode(serialized).length;

    if (byteLength > STORAGE_LIMITS.SYNC_QUOTA_BYTES_PER_ITEM) {
      throw new Error(
        `Tamanho das configurações (${byteLength} bytes) excede o limite do storage.sync (${STORAGE_LIMITS.SYNC_QUOTA_BYTES_PER_ITEM} bytes).`
      );
    }

    const storage = getSyncStorage();
    await storage.set({ [STORAGE_KEYS.SETTINGS]: updated });
  });
}

/**
 * Resets settings to default values.
 * Serialized via settingsMutex to prevent racing with saveSettings().
 */
export async function resetSettings(): Promise<FormGenSettings> {
  return settingsMutex.runExclusive(async () => {
    const storage = getSyncStorage();
    const defaults = deepClone(DEFAULT_SETTINGS);
    await storage.set({ [STORAGE_KEYS.SETTINGS]: defaults });
    return defaults;
  });
}

/**
 * Convenience helper to fetch the active provider's configuration.
 */
export async function getActiveProviderConfig(): Promise<{
  provider: ProviderType;
  config: ProviderConfig;
  defaults: GenerationDefaults;
}> {
  const settings = await getSettings();
  const active = settings.activeProvider;
  return {
    provider: active,
    config: settings.providers[active],
    defaults: settings.generationDefaults,
  };
}

/**
 * Observes changes to settings across extension contexts.
 */
export function subscribeToSettings(
  callback: (newSettings: FormGenSettings) => void
): () => void {
  if (isChromeStorageAvailable('sync')) {
    const listener = (
      changes: { [key: string]: chrome.storage.StorageChange },
      areaName: string
    ) => {
      const change = changes[STORAGE_KEYS.SETTINGS];
      if (areaName === 'sync' && change) {
        callback(mergeSettingsWithDefaults(change.newValue as Partial<FormGenSettings>));
      }
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }

  // Fallback for mock environments
  return fallbackSyncMock.addListener((changes) => {
    const change = changes[STORAGE_KEYS.SETTINGS];
    if (change) {
      callback(mergeSettingsWithDefaults(change.newValue as Partial<FormGenSettings>));
    }
  });
}

// ============================================================================
// 7. Queue Storage API (chrome.storage.local)
// ============================================================================

/**
 * Low-level un-locked queue persistence. Used internally to prevent deadlock.
 */
async function _saveActiveQueueInternal(queue: FormGenQueueState): Promise<void> {
  const storage = getLocalStorage();
  const updated: FormGenQueueState = {
    ...queue,
    updatedAt: Date.now(),
  };
  await storage.set({ [STORAGE_KEYS.ACTIVE_QUEUE]: updated });
}

/**
 * Low-level un-locked queue deletion. Used internally to prevent deadlock.
 */
async function _clearActiveQueueInternal(): Promise<void> {
  const storage = getLocalStorage();
  await storage.remove(STORAGE_KEYS.ACTIVE_QUEUE);
}

/**
 * Retrieves active batch queue from `chrome.storage.local`.
 */
export async function getActiveQueue(): Promise<FormGenQueueState | null> {
  const storage = getLocalStorage();
  const raw = await storage.get(STORAGE_KEYS.ACTIVE_QUEUE);
  const queue = raw[STORAGE_KEYS.ACTIVE_QUEUE];
  if (!queue || typeof queue !== 'object' || !Array.isArray(queue.pendingRecords)) {
    return null;
  }
  return queue as FormGenQueueState;
}

/**
 * Saves or updates active batch queue in `chrome.storage.local`.
 * Serialized via queueMutex.
 */
export async function saveActiveQueue(queue: FormGenQueueState): Promise<void> {
  return queueMutex.runExclusive(() => _saveActiveQueueInternal(queue));
}

/**
 * Clears active queue from `chrome.storage.local`.
 * Serialized via queueMutex.
 */
export async function clearActiveQueue(): Promise<void> {
  return queueMutex.runExclusive(() => _clearActiveQueueInternal());
}

/**
 * Result returned when advancing the queue.
 */
export interface AdvanceQueueResult {
  /**
   * Next record popped from pending queue, or null if queue was empty.
   */
  record: FormRecord | null;

  /**
   * True if all records in the batch have been injected and queue is now cleared.
   */
  isFinished: boolean;

  /**
   * Number of records still remaining after this advance.
   */
  remainingCount: number;

  /**
   * Current 1-indexed record number that was just processed.
   */
  currentIndex: number;

  /**
   * Total records in the batch.
   */
  totalRecords: number;
}

/**
 * Advances the active queue atomically:
 * 1. Serializes the entire Read-Modify-Write transaction via queueMutex.
 * 2. Pops the next record from `pendingRecords`.
 * 3. Increments `currentIndex`.
 * 4. If records remain, persists state via `_saveActiveQueueInternal`.
 * 5. If queue is exhausted, auto-clears via `_clearActiveQueueInternal`.
 */
export async function advanceActiveQueue(): Promise<AdvanceQueueResult> {
  return queueMutex.runExclusive(async () => {
    const queue = await getActiveQueue();

    if (!queue || queue.pendingRecords.length === 0) {
      await _clearActiveQueueInternal();
      return {
        record: null,
        isFinished: true,
        remainingCount: 0,
        currentIndex: queue ? queue.currentIndex : 0,
        totalRecords: queue ? queue.totalRecords : 0,
      };
    }

    const nextRecord: FormRecord | null = queue.pendingRecords[0] ?? null;
    const remainingRecords = queue.pendingRecords.slice(1);
    const processedIndex = queue.currentIndex;
    const nextIndex = processedIndex + 1;

    if (remainingRecords.length === 0) {
      // Last record in batch has been consumed
      await _clearActiveQueueInternal();
      return {
        record: nextRecord,
        isFinished: true,
        remainingCount: 0,
        currentIndex: processedIndex,
        totalRecords: queue.totalRecords,
      };
    }

    // Update queue with remaining records
    const updatedQueue: FormGenQueueState = {
      ...queue,
      currentIndex: nextIndex,
      pendingRecords: remainingRecords,
      updatedAt: Date.now(),
    };

    await _saveActiveQueueInternal(updatedQueue);

    return {
      record: nextRecord,
      isFinished: false,
      remainingCount: remainingRecords.length,
      currentIndex: processedIndex,
      totalRecords: queue.totalRecords,
    };
  });
}

/**
 * Observes changes to active queue across extension contexts.
 */
export function subscribeToQueue(
  callback: (newQueue: FormGenQueueState | null) => void
): () => void {
  if (isChromeStorageAvailable('local')) {
    const listener = (
      changes: { [key: string]: chrome.storage.StorageChange },
      areaName: string
    ) => {
      const change = changes[STORAGE_KEYS.ACTIVE_QUEUE];
      if (areaName === 'local' && change) {
        const val = change.newValue || null;
        callback(val as FormGenQueueState | null);
      }
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }

  // Fallback for mock environments
  return fallbackLocalMock.addListener((changes) => {
    const change = changes[STORAGE_KEYS.ACTIVE_QUEUE];
    if (change) {
      const val = change.newValue || null;
      callback(val as FormGenQueueState | null);
    }
  });
}
