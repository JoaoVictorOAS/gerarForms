/**
 * FormGen - Extension Core Infra & Options UI
 * Unit Tests for Background Service Worker Message Routing & Queue Contract
 * Path: tests/unit/background_message.test.ts
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { handleIncomingMessage } from '../../src/background/index';
import {
  saveActiveQueue,
  getActiveQueue,
  resetStorageMocks,
} from '../../src/shared/storage';
import {
  FormGenQueueState,
  AdvanceQueueResponse,
  GetQueueStateResponse,
  PingResponse,
} from '../../src/shared/types';

describe('Background Service Worker: Message Routing & Contract Alignment', () => {
  beforeEach(() => {
    resetStorageMocks();
  });

  describe('PING Message', () => {
    it('returns PONG status', async () => {
      const response = (await handleIncomingMessage({ action: 'PING' })) as PingResponse;
      expect(response.success).toBe(true);
      expect(response.status).toBe('PONG');
    });
  });

  describe('GET_QUEUE_STATE Message', () => {
    it('returns active queue state when present', async () => {
      const queue: FormGenQueueState = {
        queueId: 'test-queue-1',
        tabId: 42,
        url: 'https://example.com/form',
        formId: 'form-1',
        totalRecords: 10,
        currentIndex: 2,
        pendingRecords: [{ name: 'User 2' }, { name: 'User 3' }],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      await saveActiveQueue(queue);

      const response = (await handleIncomingMessage({
        action: 'GET_QUEUE_STATE',
      })) as GetQueueStateResponse;

      expect(response.success).toBe(true);
      expect(response.queue).toBeDefined();
      expect(response.queue?.queueId).toBe('test-queue-1');
      expect(response.queue?.currentIndex).toBe(2);
      expect(response.queue?.pendingRecords.length).toBe(2);
    });

    it('returns null when no queue is active', async () => {
      const response = (await handleIncomingMessage({
        action: 'GET_QUEUE_STATE',
      })) as GetQueueStateResponse;

      expect(response.success).toBe(true);
      expect(response.queue).toBeNull();
    });
  });

  describe('ADVANCE_QUEUE Message (Contract Remediation)', () => {
    it('returns popped record payload, indices, and isFinished: false for intermediate advance', async () => {
      const queue: FormGenQueueState = {
        queueId: 'advance-test-queue',
        tabId: 101,
        url: 'https://example.com/checkout',
        formId: 'checkout-form',
        totalRecords: 3,
        currentIndex: 2, // Record #1 already injected
        pendingRecords: [
          { nome: 'Registro 2', email: 'reg2@example.com' },
          { nome: 'Registro 3', email: 'reg3@example.com' },
        ],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      await saveActiveQueue(queue);

      // ADVANCE_QUEUE should pop Record #2
      const response = (await handleIncomingMessage({
        action: 'ADVANCE_QUEUE',
      })) as AdvanceQueueResponse;

      expect(response.success).toBe(true);
      expect(response.record).toEqual({ nome: 'Registro 2', email: 'reg2@example.com' });
      expect(response.currentIndex).toBe(2);
      expect(response.totalRecords).toBe(3);
      expect(response.remainingCount).toBe(1);
      expect(response.isFinished).toBe(false);

      // Storage should reflect next record index
      const remainingQueue = await getActiveQueue();
      expect(remainingQueue).not.toBeNull();
      expect(remainingQueue?.currentIndex).toBe(3);
      expect(remainingQueue?.pendingRecords.length).toBe(1);
    });

    it('returns popped record payload and isFinished: true when consuming final record', async () => {
      const queue: FormGenQueueState = {
        queueId: 'advance-final-queue',
        tabId: 101,
        url: 'https://example.com/checkout',
        formId: 'checkout-form',
        totalRecords: 2,
        currentIndex: 2,
        pendingRecords: [{ nome: 'Registro 2', email: 'reg2@example.com' }],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      await saveActiveQueue(queue);

      // ADVANCE_QUEUE should pop Record #2 and exhaust the queue
      const response = (await handleIncomingMessage({
        action: 'ADVANCE_QUEUE',
      })) as AdvanceQueueResponse;

      expect(response.success).toBe(true);
      expect(response.record).toEqual({ nome: 'Registro 2', email: 'reg2@example.com' });
      expect(response.currentIndex).toBe(2);
      expect(response.totalRecords).toBe(2);
      expect(response.remainingCount).toBe(0);
      expect(response.isFinished).toBe(true);

      // Storage should have been purged upon completion
      const remainingQueue = await getActiveQueue();
      expect(remainingQueue).toBeNull();
    });

    it('returns record: null and isFinished: true when advancing on an already empty/exhausted queue', async () => {
      const response = (await handleIncomingMessage({
        action: 'ADVANCE_QUEUE',
      })) as AdvanceQueueResponse;

      expect(response.success).toBe(true);
      expect(response.record).toBeNull();
      expect(response.isFinished).toBe(true);
      expect(response.remainingCount).toBe(0);
    });
  });

  describe('DISCARD_QUEUE Message', () => {
    it('purges active queue from storage', async () => {
      const queue: FormGenQueueState = {
        queueId: 'discard-queue',
        tabId: 101,
        url: 'https://example.com/checkout',
        formId: 'checkout-form',
        totalRecords: 10,
        currentIndex: 2,
        pendingRecords: [{ a: 1 }, { b: 2 }],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      await saveActiveQueue(queue);

      const response = await handleIncomingMessage({ action: 'DISCARD_QUEUE' });
      expect(response.success).toBe(true);

      const queueAfter = await getActiveQueue();
      expect(queueAfter).toBeNull();
    });
  });

  describe('Future Milestones Stubs', () => {
    it('returns informative milestone messages for SCAN_DOM, INJECT_RECORD, GENERATE_DATA', async () => {
      const scanRes = await handleIncomingMessage({ action: 'SCAN_DOM' });
      expect(scanRes.success).toBe(false);
      expect(scanRes.error).toContain('Milestone 2');

      const injectRes = await handleIncomingMessage({
        action: 'INJECT_RECORD',
        record: { test: 1 },
      });
      expect(injectRes.success).toBe(false);
      expect(injectRes.error).toContain('Milestone 5');

      const genRes = await handleIncomingMessage({
        action: 'GENERATE_DATA',
        count: 1,
        schema: { url: '', formId: '', title: '', fields: [] },
      });
      expect(genRes.success).toBe(false);
      expect(genRes.error).toContain('Milestone 3');
    });
  });
});
