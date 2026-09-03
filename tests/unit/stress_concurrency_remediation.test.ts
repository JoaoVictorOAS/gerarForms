/**
 * FormGen Milestone 1 Iteration 2 Adversarial Stress Test Suite
 * Focus: High concurrency on advanceActiveQueue & saveSettings,
 * IPC routing for ADVANCE_QUEUE, and Ollama connection error diagnostics.
 * Path: tests/unit/stress_concurrency_remediation.test.ts
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  advanceActiveQueue,
  saveActiveQueue,
  getActiveQueue,
  clearActiveQueue,
  saveSettings,
  getSettings,
  resetSettings,
  resetStorageMocks,
  setStorageMock,
  MemoryStorageArea,
  StorageAreaInterface,
} from '../../src/shared/storage';
import { handleIncomingMessage } from '../../src/background/index';
import { testProviderConnection } from '../../src/options/options';
import {
  FormGenQueueState,
  FormRecord,
  AdvanceQueueResponse,
} from '../../src/shared/types';
import { DEFAULT_SETTINGS, STORAGE_LIMITS } from '../../src/shared/constants';

describe('M1 Iteration 2 Empirical Stress Verification', () => {
  beforeEach(() => {
    resetStorageMocks();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    resetStorageMocks();
    vi.restoreAllMocks();
  });

  // ==========================================================================
  // Dimension 1: High Concurrency on advanceActiveQueue()
  // ==========================================================================
  describe('High Concurrency: advanceActiveQueue()', () => {
    it('10 simultaneous calls on 10 items pop every record uniquely without duplicates or drops', async () => {
      // 1. Prepare queue with 10 distinct records
      const initialRecords: FormRecord[] = Array.from({ length: 10 }, (_, i) => ({
        id: i + 1,
        uuid: `uuid-${i + 1}`,
        name: `Candidate ${i + 1}`,
        email: `candidate${i + 1}@example.com`,
      }));

      const queue: FormGenQueueState = {
        queueId: 'high-concurrency-10-queue',
        tabId: 100,
        url: 'https://form.example.com/apply',
        formId: 'job_application',
        totalRecords: 10,
        currentIndex: 1,
        pendingRecords: initialRecords,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      await saveActiveQueue(queue);

      // 2. Dispatch 10 simultaneous advanceActiveQueue() calls
      const calls = Array.from({ length: 10 }, () => advanceActiveQueue());
      const results = await Promise.all(calls);

      // 3. Collect popped record IDs
      const poppedRecords = results.map((r) => r.record);
      const poppedIds = poppedRecords.map((r) => r?.id);

      // Verify every call received a valid record
      expect(poppedRecords.every((r) => r !== null)).toBe(true);

      // Verify each popped ID is unique (no duplicate pops)
      const uniqueIds = new Set(poppedIds);
      expect(uniqueIds.size).toBe(10);

      // Verify strict sequential FIFO ordering: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
      expect(poppedIds).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

      // Verify remainingCount decrements strictly
      const remainingCounts = results.map((r) => r.remainingCount);
      expect(remainingCounts).toEqual([9, 8, 7, 6, 5, 4, 3, 2, 1, 0]);

      // Verify isFinished status across sequence
      const finishedFlags = results.map((r) => r.isFinished);
      expect(finishedFlags.slice(0, 9)).toEqual(Array(9).fill(false));
      expect(finishedFlags[9]).toBe(true);

      // Verify storage state after 10 pops: queue should be automatically purged
      const finalQueue = await getActiveQueue();
      expect(finalQueue).toBeNull();
    });

    it('over-exhaustion stress: 15 simultaneous calls on 10 items yields exactly 10 records and 5 empty completions', async () => {
      const records: FormRecord[] = Array.from({ length: 10 }, (_, i) => ({
        id: i + 1,
        token: `tok-${i + 1}`,
      }));

      const queue: FormGenQueueState = {
        queueId: 'over-exhaustion-queue',
        tabId: 101,
        url: 'https://example.com/form',
        formId: 'form_1',
        totalRecords: 10,
        currentIndex: 1,
        pendingRecords: records,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      await saveActiveQueue(queue);

      // Dispatch 15 simultaneous calls
      const calls = Array.from({ length: 15 }, () => advanceActiveQueue());
      const results = await Promise.all(calls);

      // Exactly 10 calls should have records, exactly 5 should have record === null
      const validPops = results.filter((r) => r.record !== null);
      const emptyPops = results.filter((r) => r.record === null);

      expect(validPops.length).toBe(10);
      expect(emptyPops.length).toBe(5);

      // All 10 valid pops must have distinct IDs 1..10
      const validIds = validPops.map((r) => r.record?.id);
      expect(new Set(validIds).size).toBe(10);
      expect(validIds).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

      // All empty pops must report isFinished: true, remainingCount: 0
      for (const empty of emptyPops) {
        expect(empty.isFinished).toBe(true);
        expect(empty.remainingCount).toBe(0);
      }

      // Storage should remain clean
      expect(await getActiveQueue()).toBeNull();
    });

    it('maintains strict serialization under simulated asynchronous storage latency and jitter', async () => {
      // Create a mock storage area that injects random async delays (2-8ms) into get/set/remove
      class LatencyStorageMock extends MemoryStorageArea {
        private async delay(): Promise<void> {
          const ms = Math.floor(Math.random() * 6) + 2; // 2-8ms jitter
          await new Promise((resolve) => setTimeout(resolve, ms));
        }

        public override async get(keys?: any): Promise<Record<string, any>> {
          await this.delay();
          return super.get(keys);
        }

        public override async set(items: Record<string, any>): Promise<void> {
          await this.delay();
          return super.set(items);
        }

        public override async remove(keys: any): Promise<void> {
          await this.delay();
          return super.remove(keys);
        }
      }

      const latencyMock = new LatencyStorageMock();
      setStorageMock('local', latencyMock);

      const records: FormRecord[] = Array.from({ length: 10 }, (_, i) => ({
        id: i + 1,
        code: `CODE_${i + 1}`,
      }));

      const queue: FormGenQueueState = {
        queueId: 'jitter-queue',
        tabId: 102,
        url: 'https://example.com/jitter',
        formId: 'jitter_form',
        totalRecords: 10,
        currentIndex: 1,
        pendingRecords: records,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      await saveActiveQueue(queue);

      // Fire 10 simultaneous calls through the jittery storage layer
      const results = await Promise.all(
        Array.from({ length: 10 }, () => advanceActiveQueue())
      );

      const poppedIds = results.map((r) => r.record?.id);
      expect(poppedIds).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      expect(await getActiveQueue()).toBeNull();
    });

    it('handles 100 simultaneous calls on a 100-record batch without race conditions or memory leak', async () => {
      const records: FormRecord[] = Array.from({ length: 100 }, (_, i) => ({
        index: i + 1,
        payload: `data-${i + 1}`,
      }));

      const queue: FormGenQueueState = {
        queueId: 'batch-100-queue',
        tabId: 103,
        url: 'https://example.com/batch100',
        formId: 'form_100',
        totalRecords: 100,
        currentIndex: 1,
        pendingRecords: records,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      await saveActiveQueue(queue);

      // 100 simultaneous calls
      const calls = Array.from({ length: 100 }, () => advanceActiveQueue());
      const results = await Promise.all(calls);

      const poppedIndices = results.map((r) => r.record?.index);
      expect(poppedIndices.length).toBe(100);

      // Strict sequential ordering: [1, 2, ..., 100]
      const expected = Array.from({ length: 100 }, (_, i) => i + 1);
      expect(poppedIndices).toEqual(expected);

      // Final result is finished
      expect(results[99]!.isFinished).toBe(true);
      expect(results[99]!.remainingCount).toBe(0);

      // Storage is clean
      expect(await getActiveQueue()).toBeNull();
    });

    it('safely serializes mixed concurrent queue operations (advance, clear, save)', async () => {
      const qInitial: FormGenQueueState = {
        queueId: 'mixed-queue-init',
        tabId: 104,
        url: 'https://example.com',
        formId: 'f',
        totalRecords: 5,
        currentIndex: 1,
        pendingRecords: [{ id: 1 }, { id: 2 }, { id: 3 }],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      await saveActiveQueue(qInitial);

      // Concurrent mix of advances and clears
      const ops = [
        advanceActiveQueue(),
        advanceActiveQueue(),
        clearActiveQueue(),
        advanceActiveQueue(),
      ];

      // Mutex guarantees all ops resolve without rejection or throwing
      const settled = await Promise.allSettled(ops);
      expect(settled.every((s) => s.status === 'fulfilled')).toBe(true);

      // Queue state in storage is deterministic (null or valid queue)
      const qFinal = await getActiveQueue();
      expect(qFinal === null || Array.isArray(qFinal.pendingRecords)).toBe(true);
    });
  });

  // ==========================================================================
  // Dimension 2: High Concurrency on saveSettings()
  // ==========================================================================
  describe('High Concurrency: saveSettings()', () => {
    it('multiple concurrent saves across different providers and defaults preserve all modified keys', async () => {
      await resetSettings();

      // Dispatch 8 simultaneous saves updating different keys
      const p1 = saveSettings({
        providers: {
          gemini: {
            ...DEFAULT_SETTINGS.providers.gemini,
            apiKey: 'GEMINI_KEY_UNIQUE_1',
            baseUrl: 'https://gemini-endpoint.example.com',
          },
        },
      });

      const p2 = saveSettings({
        providers: {
          openai: {
            ...DEFAULT_SETTINGS.providers.openai,
            apiKey: 'OPENAI_KEY_UNIQUE_2',
            model: 'gpt-4o-mini',
          },
        },
      });

      const p3 = saveSettings({
        providers: {
          ollama: {
            ...DEFAULT_SETTINGS.providers.ollama,
            baseUrl: 'http://ollama-custom-node:11434',
            model: 'mistral:instruct',
          },
        },
      });

      const p4 = saveSettings({
        providers: {
          custom: {
            ...DEFAULT_SETTINGS.providers.custom,
            apiKey: 'CUSTOM_KEY_UNIQUE_4',
            baseUrl: 'https://custom-ai.company.org/v1',
          },
        },
      });

      const p5 = saveSettings({
        activeProvider: 'ollama',
      });

      const p6 = saveSettings({
        generationDefaults: {
          temperature: 0.35,
        },
      });

      const p7 = saveSettings({
        generationDefaults: {
          locale: 'pt-BR',
        },
      });

      const p8 = saveSettings({
        providers: {
          gemini: {
            model: 'gemini-1.5-pro',
          },
        },
      });

      await Promise.all([p1, p2, p3, p4, p5, p6, p7, p8]);

      const finalSettings = await getSettings();

      // Verify that NO keys from the concurrent saves were wiped out or lost
      expect(finalSettings.providers.gemini.apiKey).toBe('GEMINI_KEY_UNIQUE_1');
      expect(finalSettings.providers.gemini.model).toBe('gemini-1.5-pro');

      expect(finalSettings.providers.openai.apiKey).toBe('OPENAI_KEY_UNIQUE_2');
      expect(finalSettings.providers.openai.model).toBe('gpt-4o-mini');

      expect(finalSettings.providers.ollama.baseUrl).toBe('http://ollama-custom-node:11434');
      expect(finalSettings.providers.ollama.model).toBe('mistral:instruct');

      expect(finalSettings.providers.custom.apiKey).toBe('CUSTOM_KEY_UNIQUE_4');
      expect(finalSettings.providers.custom.baseUrl).toBe('https://custom-ai.company.org/v1');

      expect(finalSettings.activeProvider).toBe('ollama');
      expect(finalSettings.generationDefaults.locale).toBe('pt-BR');
      expect(finalSettings.generationDefaults.temperature).toBe(0.35);
    });

    it('mutex recovers safely and processes queued calls after an enqueued save throws an error', async () => {
      await resetSettings();

      // Call 1: Valid save
      const c1 = saveSettings({ activeProvider: 'openai' });

      // Call 2: Invalid save exceeding sync quota (simulate oversized payload > 8192 bytes)
      const hugeString = 'X'.repeat(STORAGE_LIMITS.SYNC_QUOTA_BYTES_PER_ITEM + 500);
      const c2 = saveSettings({
        providers: {
          gemini: {
            apiKey: hugeString,
            baseUrl: 'https://example.com',
            model: 'huge',
          },
        },
      });

      // Call 3: Valid save queued behind the failing save
      const c3 = saveSettings({
        providers: {
          custom: {
            apiKey: 'RECOVERED_CUSTOM_KEY',
            baseUrl: 'https://recovered.example.com',
            model: 'deepseek-coder',
          },
        },
        activeProvider: 'custom',
      });

      // Assert c1 succeeds
      await expect(c1).resolves.toBeUndefined();

      // Assert c2 rejects with quota error
      await expect(c2).rejects.toThrow(/excede o limite do storage\.sync/);

      // Assert c3 succeeds despite c2 failing (no deadlock in settingsMutex!)
      await expect(c3).resolves.toBeUndefined();

      const final = await getSettings();
      expect(final.activeProvider).toBe('custom');
      expect(final.providers.custom.apiKey).toBe('RECOVERED_CUSTOM_KEY');
      expect(final.providers.gemini.apiKey).not.toBe(hugeString);
    });
  });

  // ==========================================================================
  // Dimension 3: IPC Message Routing for ADVANCE_QUEUE
  // ==========================================================================
  describe('IPC Message Routing: ADVANCE_QUEUE', () => {
    it('ADVANCE_QUEUE returns record, remainingCount, currentIndex, totalRecords, and isFinished', async () => {
      const records: FormRecord[] = [
        { fieldA: 'alpha', fieldB: 101 },
        { fieldA: 'beta', fieldB: 202 },
      ];

      const queue: FormGenQueueState = {
        queueId: 'ipc-advance-test',
        tabId: 55,
        url: 'https://example.com/form',
        formId: 'f1',
        totalRecords: 2,
        currentIndex: 1,
        pendingRecords: records,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      await saveActiveQueue(queue);

      // Step 1: Advance first pending record via IPC handler
      const res1 = (await handleIncomingMessage({
        action: 'ADVANCE_QUEUE',
      })) as AdvanceQueueResponse;

      expect(res1.success).toBe(true);
      expect(res1.record).toEqual({ fieldA: 'alpha', fieldB: 101 });
      expect(res1.remainingCount).toBe(1);
      expect(res1.currentIndex).toBe(1);
      expect(res1.totalRecords).toBe(2);
      expect(res1.isFinished).toBe(false);

      // Step 2: Advance second (last) pending record via IPC handler
      const res2 = (await handleIncomingMessage({
        action: 'ADVANCE_QUEUE',
      })) as AdvanceQueueResponse;

      expect(res2.success).toBe(true);
      expect(res2.record).toEqual({ fieldA: 'beta', fieldB: 202 });
      expect(res2.remainingCount).toBe(0);
      expect(res2.currentIndex).toBe(2);
      expect(res2.totalRecords).toBe(2);
      expect(res2.isFinished).toBe(true);

      // Step 3: Advance on exhausted queue via IPC handler
      const res3 = (await handleIncomingMessage({
        action: 'ADVANCE_QUEUE',
      })) as AdvanceQueueResponse;

      expect(res3.success).toBe(true);
      expect(res3.record).toBeNull();
      expect(res3.remainingCount).toBe(0);
      expect(res3.isFinished).toBe(true);
    });

    it('concurrent ADVANCE_QUEUE IPC messages deliver unique records and synchronized remaining counts', async () => {
      const records: FormRecord[] = Array.from({ length: 5 }, (_, i) => ({
        item: i + 1,
        val: `val-${i + 1}`,
      }));

      const queue: FormGenQueueState = {
        queueId: 'concurrent-ipc-queue',
        tabId: 56,
        url: 'https://example.com/ipc',
        formId: 'f2',
        totalRecords: 5,
        currentIndex: 1,
        pendingRecords: records,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      await saveActiveQueue(queue);

      // Dispatch 5 concurrent IPC requests
      const responses = (await Promise.all(
        Array.from({ length: 5 }, () =>
          handleIncomingMessage({ action: 'ADVANCE_QUEUE' })
        )
      )) as AdvanceQueueResponse[];

      // All 5 must be successful
      expect(responses.every((r) => r.success)).toBe(true);

      // All 5 records must be unique items 1..5
      const poppedItems = responses.map((r) => r.record?.item);
      expect(poppedItems).toEqual([1, 2, 3, 4, 5]);

      // Remaining counts must match [4, 3, 2, 1, 0]
      const remCounts = responses.map((r) => r.remainingCount);
      expect(remCounts).toEqual([4, 3, 2, 1, 0]);

      // Last response must have isFinished: true
      expect(responses[4]!.isFinished).toBe(true);
    });
  });

  // ==========================================================================
  // Dimension 4: Ollama Connection Test Response Parsing & Diagnostics
  // ==========================================================================
  describe('Ollama Connection Test: HTML Bodies, Malformed JSON & Diagnostics', () => {
    it('HTTP 200 with text/html content-type returns captive portal/proxy error and does NOT suggest ollama serve', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
        text: () => Promise.resolve('<html><body>Captive Portal Login</body></html>'),
        json: () => Promise.reject(new SyntaxError('Unexpected token < in JSON at position 0')),
      }));

      const result = await testProviderConnection('ollama', {
        apiKey: '',
        baseUrl: 'http://localhost:11434',
        model: 'llama3',
      });

      expect(result.success).toBe(false);
      expect(result.message).toContain('retornou uma página HTML em vez de JSON');
      expect(result.message).toContain('proxy/portal');
      expect(result.message).not.toContain('ollama serve');
      expect(result.message).not.toContain('daemon está em execução');
    });

    it('HTTP 200 with application/xhtml+xml returns HTML warning and does NOT suggest ollama serve', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers({ 'content-type': 'application/xhtml+xml' }),
        json: () => Promise.reject(new SyntaxError('Unexpected token <')),
      }));

      const result = await testProviderConnection('ollama', {
        apiKey: '',
        baseUrl: 'http://localhost:11434',
        model: 'llama3',
      });

      expect(result.success).toBe(false);
      expect(result.message).toContain('retornou uma página HTML em vez de JSON');
      expect(result.message).not.toContain('ollama serve');
    });

    it('HTTP 200 with truncated or malformed JSON body returns JSON syntax error and does NOT suggest ollama serve', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.reject(new SyntaxError('Unexpected end of JSON input')),
      }));

      const result = await testProviderConnection('ollama', {
        apiKey: '',
        baseUrl: 'http://localhost:11434',
        model: 'llama3',
      });

      expect(result.success).toBe(false);
      expect(result.message).toContain('não é um JSON válido');
      expect(result.message).toContain('Unexpected end of JSON input');
      expect(result.message).not.toContain('ollama serve');
      expect(result.message).not.toContain('daemon está em execução');
    });

    it('HTTP 200 with primitive JSON (string/number/array) returns invalid JSON object error and does NOT suggest ollama serve', async () => {
      // Primitive string
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve('just a raw string'),
      }));

      const resString = await testProviderConnection('ollama', {
        apiKey: '',
        baseUrl: 'http://localhost:11434',
        model: 'llama3',
      });

      expect(resString.success).toBe(false);
      expect(resString.message).toContain('não é um objeto JSON válido');
      expect(resString.message).not.toContain('ollama serve');

      // Array at root
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve([1, 2, 3]),
      }));

      const resArray = await testProviderConnection('ollama', {
        apiKey: '',
        baseUrl: 'http://localhost:11434',
        model: 'llama3',
      });

      expect(resArray.success).toBe(false);
      expect(resArray.message).toContain('não é um objeto JSON válido');
      expect(resArray.message).not.toContain('ollama serve');
    });

    it('HTTP 200 with missing or non-array models field returns models array error and does NOT suggest ollama serve', async () => {
      // Missing models
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve({ error: 'none', timestamp: Date.now() }),
      }));

      const resMissing = await testProviderConnection('ollama', {
        apiKey: '',
        baseUrl: 'http://localhost:11434',
        model: 'llama3',
      });

      expect(resMissing.success).toBe(false);
      expect(resMissing.message).toContain('campo "models" ausente ou não é um array válido');
      expect(resMissing.message).not.toContain('ollama serve');

      // Models is a string
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve({ models: 'not-an-array' }),
      }));

      const resNotArray = await testProviderConnection('ollama', {
        apiKey: '',
        baseUrl: 'http://localhost:11434',
        model: 'llama3',
      });

      expect(resNotArray.success).toBe(false);
      expect(resNotArray.message).toContain('campo "models" ausente ou não é um array válido');
      expect(resNotArray.message).not.toContain('ollama serve');
    });

    it('HTTP 200 with models array containing only null/invalid entries returns invalid models list error and does NOT suggest ollama serve', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve({ models: [null, undefined, 123, 'string-model-without-object', {}] }),
      }));

      const result = await testProviderConnection('ollama', {
        apiKey: '',
        baseUrl: 'http://localhost:11434',
        model: 'llama3',
      });

      expect(result.success).toBe(false);
      expect(result.message).toContain('a lista "models" não contém modelos válidos');
      expect(result.message).not.toContain('ollama serve');
    });

    it('genuine offline network failure (TypeError: fetch failed) correctly diagnoses offline daemon and suggests ollama serve', async () => {
      const networkError = new TypeError('fetch failed');
      (networkError as any).cause = { code: 'ECONNREFUSED' };

      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(networkError));

      const result = await testProviderConnection('ollama', {
        apiKey: '',
        baseUrl: 'http://localhost:11434',
        model: 'llama3',
      });

      expect(result.success).toBe(false);
      expect(result.message).toContain('Não foi possível conectar ao Ollama em "http://localhost:11434"');
      expect(result.message).toContain('execute "ollama serve" no seu terminal');
    });

    it('HTTP 502 Bad Gateway with HTML error body returns HTTP 502 error and does NOT suggest ollama serve', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        statusText: 'Bad Gateway',
        headers: new Headers({ 'content-type': 'text/html' }),
        json: () => Promise.reject(new SyntaxError('Unexpected token <')),
      }));

      const result = await testProviderConnection('ollama', {
        apiKey: '',
        baseUrl: 'http://localhost:11434',
        model: 'llama3',
      });

      expect(result.success).toBe(false);
      expect(result.message).toContain('Ollama retornou HTTP 502: Bad Gateway');
      expect(result.message).not.toContain('ollama serve');
    });
  });
});
