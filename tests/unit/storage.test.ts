/**
 * FormGen - Extension Core Infra & Options UI
 * Unit Tests for src/shared/storage.ts
 * Path: tests/unit/storage.test.ts
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  getSettings,
  saveSettings,
  resetSettings,
  getActiveProviderConfig,
  getActiveQueue,
  saveActiveQueue,
  advanceActiveQueue,
  clearActiveQueue,
  subscribeToSettings,
  subscribeToQueue,
  resetStorageMocks,
  isChromeStorageAvailable,
  MemoryStorageArea,
} from '../../src/shared/storage';
import { DEFAULT_SETTINGS, STORAGE_KEYS } from '../../src/shared/constants';
import { FormGenQueueState } from '../../src/shared/types';

describe('src/shared/storage.ts - Storage Layer & Mocking System', () => {
  beforeEach(() => {
    resetStorageMocks();
  });

  describe('Headless Mock Environment Fallback', () => {
    it('detects that chrome.storage is not defined in node/vitest environment', () => {
      expect(isChromeStorageAvailable('sync')).toBe(false);
      expect(isChromeStorageAvailable('local')).toBe(false);
    });

    it('MemoryStorageArea supports set, get, remove, and clear operations', async () => {
      const mem = new MemoryStorageArea();
      await mem.set({ key1: 'value1', key2: { nested: 123 } });

      const single = await mem.get('key1');
      expect(single).toEqual({ key1: 'value1' });

      const multi = await mem.get(['key1', 'key2']);
      expect(multi).toEqual({ key1: 'value1', key2: { nested: 123 } });

      const withDefault = await mem.get({ missingKey: 'defaultVal' });
      expect(withDefault).toEqual({ missingKey: 'defaultVal' });

      await mem.remove('key1');
      const afterRemove = await mem.get('key1');
      expect(afterRemove).toEqual({});

      await mem.clear();
      const all = await mem.get(null);
      expect(all).toEqual({});
    });
  });

  describe('Settings Storage (chrome.storage.sync)', () => {
    it('returns DEFAULT_SETTINGS when storage is initially empty', async () => {
      const settings = await getSettings();
      expect(settings).toEqual(DEFAULT_SETTINGS);
      expect(settings.activeProvider).toBe('gemini');
      expect(settings.providers.gemini.model).toBe('gemini-2.5-flash');
      expect(settings.providers.openai.model).toBe('gpt-4o-mini');
      expect(settings.providers.ollama.baseUrl).toBe('http://localhost:11434');
    });

    it('saves partial settings without losing untouched providers', async () => {
      await saveSettings({
        activeProvider: 'openai',
        providers: {
          ...DEFAULT_SETTINGS.providers,
          openai: {
            apiKey: 'sk-test-key-12345',
            baseUrl: 'https://api.openai.com/v1',
            model: 'gpt-4o',
          },
        },
      });

      const updated = await getSettings();
      expect(updated.activeProvider).toBe('openai');
      expect(updated.providers.openai.apiKey).toBe('sk-test-key-12345');
      expect(updated.providers.openai.model).toBe('gpt-4o');
      // Verify other providers remain intact
      expect(updated.providers.gemini.baseUrl).toBe(DEFAULT_SETTINGS.providers.gemini.baseUrl);
      expect(updated.providers.ollama.baseUrl).toBe(DEFAULT_SETTINGS.providers.ollama.baseUrl);
    });

    it('resets settings to default values via resetSettings()', async () => {
      await saveSettings({
        activeProvider: 'custom',
        generationDefaults: { temperature: 0.2, locale: 'en-US' },
      });

      const before = await getSettings();
      expect(before.activeProvider).toBe('custom');
      expect(before.generationDefaults.locale).toBe('en-US');

      const restored = await resetSettings();
      expect(restored).toEqual(DEFAULT_SETTINGS);

      const after = await getSettings();
      expect(after.activeProvider).toBe('gemini');
      expect(after.generationDefaults.locale).toBe('pt-BR');
    });

    it('retrieves active provider configuration via getActiveProviderConfig()', async () => {
      await saveSettings({
        activeProvider: 'ollama',
        providers: {
          ...DEFAULT_SETTINGS.providers,
          ollama: {
            apiKey: '',
            baseUrl: 'http://127.0.0.1:11434',
            model: 'llama3.1',
          },
        },
      });

      const activeConfig = await getActiveProviderConfig();
      expect(activeConfig.provider).toBe('ollama');
      expect(activeConfig.config.baseUrl).toBe('http://127.0.0.1:11434');
      expect(activeConfig.config.model).toBe('llama3.1');
      expect(activeConfig.defaults.locale).toBe('pt-BR');
    });

    it('throws an error if settings payload exceeds 8 KB sync item quota', async () => {
      const hugeString = 'x'.repeat(9000);
      await expect(
        saveSettings({
          providers: {
            ...DEFAULT_SETTINGS.providers,
            custom: {
              apiKey: hugeString,
              baseUrl: 'https://example.com',
              model: 'custom-model',
            },
          },
        })
      ).rejects.toThrow(/excede o limite do storage\.sync/);
    });

    it('notifies subscribers when settings change', async () => {
      let notifiedSettings: any = null;
      const unsubscribe = subscribeToSettings((settings) => {
        notifiedSettings = settings;
      });

      await saveSettings({ activeProvider: 'ollama' });
      expect(notifiedSettings).not.toBeNull();
      expect(notifiedSettings.activeProvider).toBe('ollama');

      unsubscribe();
    });
  });

  describe('Queue Storage (chrome.storage.local)', () => {
    const mockQueue: FormGenQueueState = {
      queueId: 'uuid-12345',
      tabId: 101,
      url: 'https://example.com/signup',
      formId: 'registration_form',
      totalRecords: 3,
      currentIndex: 2,
      pendingRecords: [
        { name: 'User 2', email: 'user2@example.com' },
        { name: 'User 3', email: 'user3@example.com' },
      ],
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
    };

    it('returns null when no active queue is stored', async () => {
      const queue = await getActiveQueue();
      expect(queue).toBeNull();
    });

    it('saves and retrieves active queue state', async () => {
      await saveActiveQueue(mockQueue);
      const queue = await getActiveQueue();

      expect(queue).not.toBeNull();
      expect(queue?.queueId).toBe('uuid-12345');
      expect(queue?.totalRecords).toBe(3);
      expect(queue?.currentIndex).toBe(2);
      expect(queue?.pendingRecords).toHaveLength(2);
    });

    it('advances sequential queue step by step and auto-clears when finished', async () => {
      await saveActiveQueue(mockQueue);

      // Advance step 1: pops User 2 (record #2)
      const step1 = await advanceActiveQueue();
      expect(step1.record).toEqual({ name: 'User 2', email: 'user2@example.com' });
      expect(step1.isFinished).toBe(false);
      expect(step1.currentIndex).toBe(2);
      expect(step1.remainingCount).toBe(1);

      // Verify queue in storage has currentIndex: 3 and 1 pending record
      const intermediateQueue = await getActiveQueue();
      expect(intermediateQueue?.currentIndex).toBe(3);
      expect(intermediateQueue?.pendingRecords).toHaveLength(1);

      // Advance step 2: pops User 3 (record #3) - last record!
      const step2 = await advanceActiveQueue();
      expect(step2.record).toEqual({ name: 'User 3', email: 'user3@example.com' });
      expect(step2.isFinished).toBe(true);
      expect(step2.currentIndex).toBe(3);
      expect(step2.remainingCount).toBe(0);

      // Verify storage was automatically cleared
      const finalQueue = await getActiveQueue();
      expect(finalQueue).toBeNull();
    });

    it('discards queue cleanly via clearActiveQueue()', async () => {
      await saveActiveQueue(mockQueue);
      expect(await getActiveQueue()).not.toBeNull();

      await clearActiveQueue();
      expect(await getActiveQueue()).toBeNull();
    });

    it('notifies subscribers when queue changes', async () => {
      let observedQueue: FormGenQueueState | null = null;
      const unsubscribe = subscribeToQueue((q) => {
        observedQueue = q;
      });

      await saveActiveQueue(mockQueue);
      expect(observedQueue).not.toBeNull();
      expect((observedQueue as FormGenQueueState | null)?.queueId).toBe('uuid-12345');

      await clearActiveQueue();
      expect(observedQueue).toBeNull();

      unsubscribe();
    });
  });
});
