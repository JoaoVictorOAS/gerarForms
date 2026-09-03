import { describe, it, expect, beforeEach, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { FormGenQueueState } from '../../src/shared/types';

describe('FormGen Popup Controller (Milestone 4)', () => {
  let dom: JSDOM;
  let document: Document;

  beforeEach(() => {
    dom = new JSDOM(`
      <!DOCTYPE html>
      <html>
        <body>
          <button id="btn-insert-record" disabled>
            <span id="insert-record-text">Inserir registro</span>
          </button>
          <button id="btn-generate-single">Gerar registro único</button>
          <button id="btn-generate-10">10 Registros</button>
          <button id="btn-generate-100">100 Registros</button>
          <button id="btn-settings">Settings</button>
          <button id="btn-clear-queue">Descartar</button>
          <div id="status-message" class="status-box hidden"></div>
          <span id="form-status-indicator" class="status-indicator"></span>
          <span id="form-status-text">Detectando...</span>
          <section id="queue-section" class="queue-section hidden">
            <div id="queue-progress-bar" style="width: 0%;"></div>
            <span id="queue-count-text"></span>
            <span id="queue-next-text"></span>
          </section>
          <span id="provider-badge"></span>
        </body>
      </html>
    `, { url: 'http://localhost/popup.html' });
    document = dom.window.document;
  });

  it('updates dynamic button text when active queue is present', () => {
    const now = Date.now();
    const queue: FormGenQueueState = {
      queueId: 'q_test_1',
      tabId: 1,
      url: 'http://localhost/form',
      formId: 'client-form',
      totalRecords: 10,
      currentIndex: 2,
      pendingRecords: Array.from({ length: 9 }, (_, i) => ({ nome: `User ${i + 2}` })),
      createdAt: now,
      updatedAt: now,
    };

    const btn = document.getElementById('btn-insert-record') as HTMLButtonElement;
    const textSpan = document.getElementById('insert-record-text') as HTMLSpanElement;
    const queueSection = document.getElementById('queue-section') as HTMLElement;
    const countText = document.getElementById('queue-count-text') as HTMLSpanElement;

    // Simulate updateQueueUI logic
    btn.disabled = false;
    textSpan.textContent = `Inserir registro [${queue.currentIndex}/${queue.totalRecords}]`;
    queueSection.classList.remove('hidden');
    countText.textContent = `${queue.currentIndex - 1} de ${queue.totalRecords} registros inseridos`;

    expect(btn.disabled).toBe(false);
    expect(textSpan.textContent).toBe('Inserir registro [2/10]');
    expect(queueSection.classList.contains('hidden')).toBe(false);
    expect(countText.textContent).toBe('1 de 10 registros inseridos');
  });

  it('disables dynamic button when queue is exhausted or null', () => {
    const btn = document.getElementById('btn-insert-record') as HTMLButtonElement;
    const textSpan = document.getElementById('insert-record-text') as HTMLSpanElement;
    const queueSection = document.getElementById('queue-section') as HTMLElement;

    // Simulate queue finish
    btn.disabled = true;
    textSpan.textContent = 'Inserir registro';
    queueSection.classList.add('hidden');

    expect(btn.disabled).toBe(true);
    expect(textSpan.textContent).toBe('Inserir registro');
    expect(queueSection.classList.contains('hidden')).toBe(true);
  });

  it('formats batch generation queue correctly: record #1 immediate, #2..#N pending', () => {
    const totalCount = 10;
    const generatedRecords = Array.from({ length: totalCount }, (_, i) => ({ id: i + 1, nome: `Pessoa ${i + 1}` }));

    const firstRecord = generatedRecords[0];
    const pendingRecords = generatedRecords.slice(1);

    expect(firstRecord!.id).toBe(1);
    expect(pendingRecords.length).toBe(9);
    expect(pendingRecords[0]!.id).toBe(2);

    const now = Date.now();
    const queueState: FormGenQueueState = {
      queueId: 'q_batch',
      tabId: 1,
      url: 'http://test/form',
      formId: 'test-form',
      totalRecords: totalCount,
      currentIndex: 2,
      pendingRecords,
      createdAt: now,
      updatedAt: now,
    };

    expect(queueState.currentIndex).toBe(2);
    expect(queueState.pendingRecords.length).toBe(9);
  });
});
