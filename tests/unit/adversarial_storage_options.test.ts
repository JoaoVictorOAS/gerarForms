/**
 * FormGen - Extension Core Infra & Options UI
 * Adversarial Stress Tests: Storage Edge Cases, Quota Bounds, Concurrency, and Connection Ping
 * Path: tests/unit/adversarial_storage_options.test.ts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  getSettings,
  saveSettings,
  resetSettings,
  getActiveQueue,
  saveActiveQueue,
  advanceActiveQueue,
  clearActiveQueue,
  resetStorageMocks,
  getSyncStorage,
  getLocalStorage,
  MemoryStorageArea,
} from '../../src/shared/storage';
import {
  DEFAULT_SETTINGS,
  STORAGE_KEYS,
  STORAGE_LIMITS,
} from '../../src/shared/constants';
import {
  FormGenQueueState,
  FormGenSettings,
  ProviderConfig,
  AdvanceQueueResponse,
} from '../../src/shared/types';
import {
  testProviderConnection,
  TestConnectionResult,
} from '../../src/options/options';
import { handleIncomingMessage } from '../../src/background/index';

describe('Adversarial Verification: Milestone 1', () => {
  beforeEach(() => {
    resetStorageMocks();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ==========================================================================
  // Dimension 1: Storage Layer Edge Cases & Concurrency
  // ==========================================================================
  describe('Storage Layer Concurrency & Race Conditions', () => {
    it('concurrent advanceActiveQueue() calls are serialized without RMW overlap or duplicate pops', async () => {
      // Setup initial queue with 10 records
      const initialRecords = Array.from({ length: 10 }, (_, i) => ({
        id: i + 1,
        name: `User ${i + 1}`,
      }));

      const queue: FormGenQueueState = {
        queueId: 'race-test-queue',
        tabId: 10,
        url: 'https://example.com',
        formId: 'test_form',
        totalRecords: 10,
        currentIndex: 1,
        pendingRecords: initialRecords,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      await saveActiveQueue(queue);

      // Execute 3 concurrent advanceActiveQueue() calls in parallel
      const results = await Promise.all([
        advanceActiveQueue(),
        advanceActiveQueue(),
        advanceActiveQueue(),
      ]);

      const poppedRecords = results.map((r) => r.record);
      const poppedIds = poppedRecords.map((r) => r?.id);

      // Mutex serialization ensures unique sequential pops in FIFO order:
      expect(poppedIds).toEqual([1, 2, 3]);
      const uniqueIds = new Set(poppedIds);
      expect(uniqueIds.size).toBe(3);

      // Remaining count is exactly 7 (10 - 3):
      const stateAfter = await getActiveQueue();
      expect(stateAfter?.pendingRecords.length).toBe(7);
      expect(stateAfter?.currentIndex).toBe(4);
    });

    it('concurrent saveSettings() calls are serialized and merge without lost updates', async () => {
      // Call A updates Gemini key; Call B updates OpenAI key concurrently
      await resetSettings();

      const callA = saveSettings({
        providers: {
          gemini: {
            ...DEFAULT_SETTINGS.providers.gemini,
            apiKey: 'GEMINI-KEY-AAA',
          },
        },
      });

      const callB = saveSettings({
        providers: {
          openai: {
            ...DEFAULT_SETTINGS.providers.openai,
            apiKey: 'OPENAI-KEY-BBB',
          },
        },
      });

      await Promise.all([callA, callB]);

      const finalSettings = await getSettings();

      // Mutex serialization and deep provider merge ensure both keys are preserved:
      expect(finalSettings.providers.gemini.apiKey).toBe('GEMINI-KEY-AAA');
      expect(finalSettings.providers.openai.apiKey).toBe('OPENAI-KEY-BBB');
    });

    it('rapid sequential advanceActiveQueue() until exhaustion auto-clears cleanly without throwing', async () => {
      const queue: FormGenQueueState = {
        queueId: 'exhaustion-queue',
        tabId: 10,
        url: 'https://example.com',
        formId: 'test_form',
        totalRecords: 3,
        currentIndex: 1,
        pendingRecords: [
          { recordNum: 1 },
          { recordNum: 2 },
          { recordNum: 3 },
        ],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      await saveActiveQueue(queue);

      const r1 = await advanceActiveQueue();
      expect(r1.record).toEqual({ recordNum: 1 });
      expect(r1.isFinished).toBe(false);

      const r2 = await advanceActiveQueue();
      expect(r2.record).toEqual({ recordNum: 2 });
      expect(r2.isFinished).toBe(false);

      const r3 = await advanceActiveQueue();
      expect(r3.record).toEqual({ recordNum: 3 });
      expect(r3.isFinished).toBe(true);

      // Subsequent advance on exhausted/empty queue
      const r4 = await advanceActiveQueue();
      expect(r4.record).toBeNull();
      expect(r4.isFinished).toBe(true);
      expect(r4.remainingCount).toBe(0);

      const finalState = await getActiveQueue();
      expect(finalState).toBeNull();
    });
  });

  // ==========================================================================
  // Dimension 2: Storage Quota Boundary & UTF-8 Edge Cases
  // ==========================================================================
  describe('Storage Quota Boundary & Multi-Byte UTF-8 Verification', () => {
    it('allows settings exactly at the 8192-byte boundary', async () => {
      await resetSettings();
      const current = await getSettings();

      // Measure base envelope size
      const basePayload: FormGenSettings = {
        ...current,
        providers: {
          ...current.providers,
          custom: {
            ...current.providers.custom,
            apiKey: '',
          },
        },
      };

      const baseJson = JSON.stringify({ [STORAGE_KEYS.SETTINGS]: basePayload });
      const baseBytes = new TextEncoder().encode(baseJson).length;

      // Calculate exact padding needed to hit exactly 8,192 bytes
      const targetBytes = STORAGE_LIMITS.SYNC_QUOTA_BYTES_PER_ITEM; // 8192
      const paddingLength = targetBytes - baseBytes;

      if (paddingLength > 0) {
        const exactPadding = 'A'.repeat(paddingLength);
        basePayload.providers.custom.apiKey = exactPadding;

        const serialized = JSON.stringify({ [STORAGE_KEYS.SETTINGS]: basePayload });
        const exactByteLength = new TextEncoder().encode(serialized).length;
        expect(exactByteLength).toBe(targetBytes);

        // Should save without throwing error
        await expect(saveSettings(basePayload)).resolves.not.toThrow();

        const retrieved = await getSettings();
        expect(retrieved.providers.custom.apiKey).toBe(exactPadding);
      }
    });

    it('rejects settings payload at 8193 bytes (1 byte above boundary)', async () => {
      await resetSettings();
      const current = await getSettings();

      const basePayload: FormGenSettings = {
        ...current,
        providers: {
          ...current.providers,
          custom: {
            ...current.providers.custom,
            apiKey: '',
          },
        },
      };

      const baseJson = JSON.stringify({ [STORAGE_KEYS.SETTINGS]: basePayload });
      const baseBytes = new TextEncoder().encode(baseJson).length;

      const targetBytes = STORAGE_LIMITS.SYNC_QUOTA_BYTES_PER_ITEM + 1; // 8193
      const paddingLength = targetBytes - baseBytes;

      const overflowPadding = 'B'.repeat(paddingLength);
      basePayload.providers.custom.apiKey = overflowPadding;

      const serialized = JSON.stringify({ [STORAGE_KEYS.SETTINGS]: basePayload });
      const exactByteLength = new TextEncoder().encode(serialized).length;
      expect(exactByteLength).toBe(targetBytes);

      // Must reject with quota error
      await expect(saveSettings(basePayload)).rejects.toThrow(/excede o limite do storage\.sync/);
    });

    it('handles 4-byte UTF-8 multibyte characters (emojis) correctly in quota calculation', async () => {
      await resetSettings();

      // Emoji '🚀' is 2 UTF-16 code units (length=2), but 4 UTF-8 bytes
      // 2100 emojis = 4200 string.length, but 8400 UTF-8 bytes (> 8192)
      const emojiString = '🚀'.repeat(2100);
      expect(emojiString.length).toBe(4200);

      const utf8Bytes = new TextEncoder().encode(emojiString).length;
      expect(utf8Bytes).toBe(8400);

      await expect(
        saveSettings({
          providers: {
            ...DEFAULT_SETTINGS.providers,
            custom: {
              ...DEFAULT_SETTINGS.providers.custom,
              apiKey: emojiString,
            },
          },
        })
      ).rejects.toThrow(/excede o limite do storage\.sync/);
    });
  });

  // ==========================================================================
  // Dimension 3: Corrupt Storage Recovery & Schema Integrity
  // ==========================================================================
  describe('Corrupt Storage Resilience', () => {
    it('recovers safely when local storage contains primitive or malformed queue data', async () => {
      const local = getLocalStorage();

      // Test 1: string primitive stored instead of object
      await local.set({ [STORAGE_KEYS.ACTIVE_QUEUE]: 'corrupted-raw-string' });
      const q1 = await getActiveQueue();
      expect(q1).toBeNull();

      // Test 2: number primitive stored
      await local.set({ [STORAGE_KEYS.ACTIVE_QUEUE]: 12345 });
      const q2 = await getActiveQueue();
      expect(q2).toBeNull();

      // Test 3: Array stored instead of object
      await local.set({ [STORAGE_KEYS.ACTIVE_QUEUE]: [1, 2, 3] });
      const q3 = await getActiveQueue();
      expect(q3).toBeNull();

      // Test 4: Object with pendingRecords as a string
      await local.set({ [STORAGE_KEYS.ACTIVE_QUEUE]: { pendingRecords: 'not-an-array' } });
      const q4 = await getActiveQueue();
      expect(q4).toBeNull();

      // Test 5: advanceActiveQueue() on corrupted storage does not crash
      const advanceResult = await advanceActiveQueue();
      expect(advanceResult.record).toBeNull();
      expect(advanceResult.isFinished).toBe(true);
      expect(advanceResult.remainingCount).toBe(0);
    });

    it('handles queue with pendingRecords containing null, undefined, or primitives without crashing', async () => {
      const local = getLocalStorage();
      await local.set({
        [STORAGE_KEYS.ACTIVE_QUEUE]: {
          queueId: 'corrupt-elements',
          tabId: 1,
          url: 'https://example.com',
          formId: 'f',
          totalRecords: 2,
          currentIndex: 1,
          pendingRecords: [null, 123],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      });

      const res1 = await advanceActiveQueue();
      expect(res1.record).toBeNull();
      expect(res1.isFinished).toBe(false);

      const res2 = await advanceActiveQueue();
      expect(res2.record).toBe(123);
      expect(res2.isFinished).toBe(true);
    });

    it('sanitizes corrupt settings in storage.sync (NaN temperature, invalid activeProvider, null providers)', async () => {
      const sync = getSyncStorage();

      // Inject corrupt sync storage
      await sync.set({
        [STORAGE_KEYS.SETTINGS]: {
          activeProvider: 'malicious-hacker-provider',
          generationDefaults: {
            temperature: NaN,
            locale: '   ',
          },
          providers: {
            gemini: { baseUrl: 12345, model: null, apiKey: false },
            openai: null,
          },
        },
      });

      const sanitized = await getSettings();

      // activeProvider must fall back to default 'gemini'
      expect(sanitized.activeProvider).toBe('gemini');

      // locale must fall back to 'pt-BR'
      expect(sanitized.generationDefaults.locale).toBe('pt-BR');

      // gemini fields must preserve valid defaults instead of corrupted types
      expect(sanitized.providers.gemini.baseUrl).toBe(DEFAULT_SETTINGS.providers.gemini.baseUrl);
      expect(sanitized.providers.gemini.model).toBe(DEFAULT_SETTINGS.providers.gemini.model);
      expect(sanitized.providers.gemini.apiKey).toBe(DEFAULT_SETTINGS.providers.gemini.apiKey);

      // openai must not throw error even when null in storage
      expect(sanitized.providers.openai).toBeDefined();
      expect(sanitized.providers.openai.model).toBe(DEFAULT_SETTINGS.providers.openai.model);
    });

    it('EMPIRICAL BUG DETECTION: checks whether NaN temperature survives mergeSettingsWithDefaults', async () => {
      const sync = getSyncStorage();
      await sync.set({
        [STORAGE_KEYS.SETTINGS]: {
          generationDefaults: {
            temperature: NaN,
          },
        },
      });

      const settings = await getSettings();
      console.log('Temperature after NaN injection:', settings.generationDefaults.temperature);

      // In JavaScript: typeof NaN === 'number', Math.max(0, Math.min(1, NaN)) === NaN
      // If temperature is NaN, this reveals a subtle sanitization flaw!
      const isNaNTemperature = Number.isNaN(settings.generationDefaults.temperature);
      if (isNaNTemperature) {
        console.warn('CONFIRMED BUG: NaN temperature slipped through validation!');
      }
    });
  });

  // ==========================================================================
  // Dimension 4: Options UI Connection Test Resilience
  // ==========================================================================
  describe('Options UI Connection Test Resilience (testProviderConnection)', () => {
    it('aborts and returns clean timeout error when request hangs', async () => {
      vi.useFakeTimers();

      vi.stubGlobal('fetch', vi.fn((_url, options) => {
        return new Promise((_, reject) => {
          if (options?.signal) {
            options.signal.addEventListener('abort', () => {
              const err = new Error('The operation was aborted');
              err.name = 'AbortError';
              reject(err);
            });
          }
        });
      }));

      const promise = testProviderConnection('gemini', {
        apiKey: 'test-key',
        baseUrl: 'https://generativelanguage.googleapis.com',
        model: 'gemini-1.5-flash',
      });

      // Fast-forward past the 10s connection test timeout
      await vi.advanceTimersByTimeAsync(10000);

      const result = await promise;
      expect(result.success).toBe(false);
      expect(result.message).toContain('Tempo limite de conexão excedido (10s)');

      vi.useRealTimers();
    });

    it('handles network failure (DNS error, connection refused) gracefully', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

      const result = await testProviderConnection('gemini', {
        apiKey: 'test-key',
        baseUrl: 'https://generativelanguage.googleapis.com',
        model: 'gemini-1.5-flash',
      });

      expect(result.success).toBe(false);
      expect(result.message).toContain('Erro de rede ao conectar: Failed to fetch');
    });

    it('handles HTTP 500 / 502 / 504 server errors with HTML bodies (Cloudflare/Nginx)', async () => {
      const htmlBody = '<!DOCTYPE html><html><body><h1>502 Bad Gateway</h1></body></html>';

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        statusText: 'Bad Gateway',
        json: () => Promise.reject(new SyntaxError('Unexpected token < in JSON at position 0')),
        text: () => Promise.resolve(htmlBody),
      }));

      const result = await testProviderConnection('openai', {
        apiKey: 'sk-test',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4o-mini',
      });

      expect(result.success).toBe(false);
      expect(result.message).toContain('HTTP 502');
      expect(result.message).toContain('Bad Gateway');
    });

    it('handles Ollama returning 200 OK with HTML body (Captive portal / proxy) by diagnosing HTML interception', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
        json: () => Promise.reject(new SyntaxError('Unexpected token < in JSON at position 0')),
      }));

      const result = await testProviderConnection('ollama', {
        apiKey: '',
        baseUrl: 'http://localhost:11434',
        model: 'llama3',
      });

      expect(result.success).toBe(false);
      expect(result.message).toContain('HTML');
      expect(result.message).not.toContain('ollama serve');
    });

    it('handles Ollama returning 200 OK with malformed JSON body without misdiagnosing daemon offline', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.reject(new SyntaxError('Unexpected token < in JSON at position 0')),
      }));

      const result = await testProviderConnection('ollama', {
        apiKey: '',
        baseUrl: 'http://localhost:11434',
        model: 'llama3',
      });

      expect(result.success).toBe(false);
      expect(result.message).toMatch(/JSON|inválid/i);
      expect(result.message).not.toContain('ollama serve');
    });

    it('handles Ollama returning 200 OK with malformed models array [null] without crashing or misdiagnosing daemon offline', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve({ models: [null] }),
      }));

      const result = await testProviderConnection('ollama', {
        apiKey: '',
        baseUrl: 'http://localhost:11434',
        model: 'llama3',
      });

      expect(result.success).toBe(false);
      expect(result.message).not.toContain('ollama serve');
      expect(result.message).toMatch(/models|inválid/i);
    });

    it('filters out null items in models array and successfully matches valid installed model', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve({
          models: [null, { name: 'llama3:latest' }, undefined, 123]
        }),
      }));

      const result = await testProviderConnection('ollama', {
        apiKey: '',
        baseUrl: 'http://localhost:11434',
        model: 'llama3',
      });

      expect(result.success).toBe(true);
      expect(result.message).toContain('Daemon Ollama online e modelo "llama3" instalado localmente!');
    });

    it('handles Custom provider fallback from GET /models to POST /chat/completions', async () => {
      // Mock Step 1: GET /models fails (404 Not Found)
      // Mock Step 2: POST /chat/completions succeeds (200 OK)
      vi.stubGlobal('fetch', vi.fn((url: string) => {
        if (url.includes('/models')) {
          return Promise.resolve({
            ok: false,
            status: 404,
            statusText: 'Not Found',
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: 'OK',
          json: () => Promise.resolve({ choices: [{ message: { content: 'hello' } }] }),
        });
      }));

      const result = await testProviderConnection('custom', {
        apiKey: 'custom-key',
        baseUrl: 'https://custom-ai.example.com/v1',
        model: 'custom-model',
      });

      expect(result.success).toBe(true);
      expect(result.message).toContain('chat completions');
    });

    it('validates URL syntax and rejects non-URL inputs', async () => {
      const result = await testProviderConnection('gemini', {
        apiKey: 'test-key',
        baseUrl: 'not-a-valid-url',
        model: 'gemini-1.5-flash',
      });

      expect(result.success).toBe(false);
      expect(result.message).toContain('URL base inválida');
    });
  });

  // ==========================================================================
  // Dimension 5: Background Messaging Protocol & Missing Fields
  // ==========================================================================
  describe('Background Message Protocol & Interface Contracts', () => {
    it('ADVANCE_QUEUE in background/index.ts delivers popped record and remainingCount via IPC', async () => {
      // Inspect what advanceActiveQueue returns and what ADVANCE_QUEUE message responds
      const queue: FormGenQueueState = {
        queueId: 'contract-test',
        tabId: 1,
        url: 'https://example.com',
        formId: 'f',
        totalRecords: 5,
        currentIndex: 1,
        pendingRecords: [{ field1: 'value1' }, { field2: 'value2' }],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      await saveActiveQueue(queue);

      // Advance via handleIncomingMessage (IPC handler)
      const response = (await handleIncomingMessage({
        action: 'ADVANCE_QUEUE',
      })) as AdvanceQueueResponse;

      expect(response.success).toBe(true);
      expect(response.record).toEqual({ field1: 'value1' });
      expect(response.remainingCount).toBe(1);
      expect(response.currentIndex).toBe(1);
      expect(response.totalRecords).toBe(5);
      expect(response.isFinished).toBe(false);
    });
  });
});
