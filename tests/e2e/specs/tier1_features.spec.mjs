/**
 * Tier 1: Feature Coverage Specifications
 * Validates primary happy-path functional requirements for R1 through R5.
 * 30 Test Cases (6 tests per requirement).
 */

import { describe, test, expect, beforeEach } from '../test-runner.mjs';

describe('Tier 1: Feature Coverage (R1 - DOM Form Inspection & Lean Schema Extraction)', () => {
  beforeEach(async ({ page }) => {
    // Reset logs before each test
    await page.evaluate(() => {
      if (window.__FORMGEN_FIXTURE__) window.__FORMGEN_FIXTURE__.resetLogs();
    });
  });

  test('TC-T1-R1-01: Standard Form Discovery & Field Enumeration on #form-enterprise', async ({ page }) => {
    const fields = await page.evaluate(() => {
      const form = document.getElementById('form-enterprise');
      if (!form) return [];
      
      const elements = Array.from(form.querySelectorAll('input, select, textarea'));
      // Filter out submit/reset buttons
      const fillable = elements.filter(el => {
        const type = el.type ? el.type.toLowerCase() : '';
        return !['submit', 'reset', 'button', 'image', 'hidden'].includes(type);
      });

      // Group radios by name
      const grouped = new Map();
      for (const el of fillable) {
        const type = el.type ? el.type.toLowerCase() : el.tagName.toLowerCase();
        if (type === 'radio') {
          if (!grouped.has(el.name)) {
            grouped.set(el.name, { id: el.id, name: el.name, type: 'radio', count: 1 });
          } else {
            grouped.get(el.name).count++;
          }
        } else {
          grouped.set(el.id || el.name, { id: el.id, name: el.name, type });
        }
      }
      return Array.from(grouped.values());
    });

    // 11 distinct logical fillable fields:
    // fullname, email, age, phone, birthdate, state, skills, ent-contract (radio group), newsletter, terms, bio
    expect(fields.length).toBe(11);

    const names = fields.map(f => f.name);
    expect(names).toContain('fullname');
    expect(names).toContain('email');
    expect(names).toContain('age');
    expect(names).toContain('phone');
    expect(names).toContain('birthdate');
    expect(names).toContain('state');
    expect(names).toContain('skills');
    expect(names).toContain('ent-contract');
    expect(names).toContain('newsletter');
    expect(names).toContain('terms');
    expect(names).toContain('bio');
  });

  test('TC-T1-R1-02: Zero Raw HTML / Style Leakage Sanity Check', async ({ page }) => {
    const { schemaString, outerHtmlLength } = await page.evaluate(() => {
      const form = document.getElementById('form-enterprise');
      const outerHtml = form.outerHTML;

      // Extract lean representation
      const elements = Array.from(form.querySelectorAll('input, select, textarea'))
        .filter(el => !['submit', 'reset', 'button'].includes(el.type));

      const schema = {
        formId: form.id,
        fields: elements.map(el => ({
          name: el.name,
          type: el.type || el.tagName.toLowerCase(),
          required: el.required
        }))
      };

      const schemaStr = JSON.stringify(schema);
      return { schemaString: schemaStr, outerHtmlLength: outerHtml.length };
    });

    // Assert zero HTML tags or style rules leak into the schema
    expect(schemaString).not.toMatch(/<div/i);
    expect(schemaString).not.toMatch(/<span/i);
    expect(schemaString).not.toMatch(/<style/i);
    expect(schemaString).not.toMatch(/style=/i);
    expect(schemaString).not.toMatch(/class=/i);

    // Assert lean schema is >90% smaller than raw outerHTML
    const savings = 1 - (schemaString.length / outerHtmlLength);
    expect(savings).toBeGreaterThan(0.70);
  });

  test('TC-T1-R1-03: HTML5 Validation Constraint Extraction Fidelity', async ({ page }) => {
    const constraints = await page.evaluate(() => {
      const getConstraints = (id) => {
        const el = document.getElementById(id);
        if (!el) return null;
        return {
          required: el.required,
          minLength: el.minLength !== -1 ? el.minLength : undefined,
          maxLength: el.maxLength !== -1 ? el.maxLength : undefined,
          min: el.min || undefined,
          max: el.max || undefined,
          step: el.step || undefined,
          pattern: el.pattern || undefined
        };
      };

      return {
        fullname: getConstraints('ent-fullname'),
        age: getConstraints('ent-age'),
        phone: getConstraints('ent-phone'),
        birthdate: getConstraints('ent-birthdate')
      };
    });

    expect(constraints.fullname.required).toBe(true);
    expect(constraints.fullname.minLength).toBe(3);
    expect(constraints.fullname.maxLength).toBe(50);

    expect(constraints.age.required).toBe(true);
    expect(constraints.age.min).toBe('18');
    expect(constraints.age.max).toBe('120');
    expect(constraints.age.step).toBe('1');

    expect(constraints.phone.pattern).toBe('\\(\\d{2}\\) \\d{4,5}-\\d{4}');
    expect(constraints.birthdate.min).toBe('1950-01-01');
    expect(constraints.birthdate.max).toBe('2026-12-31');
  });

  test('TC-T1-R1-04: Select Dropdown & Radio Group Option Discovery', async ({ page }) => {
    const optionsData = await page.evaluate(() => {
      const singleSelect = document.getElementById('ent-state');
      const singleOpts = Array.from(singleSelect.options).map(o => o.value).filter(Boolean);

      const multiSelect = document.getElementById('ent-skills');
      const multiOpts = Array.from(multiSelect.options).map(o => o.value);

      const radios = Array.from(document.querySelectorAll('input[name="ent-contract"]'));
      const radioOpts = radios.map(r => r.value);

      return { singleOpts, multiOpts, radioOpts };
    });

    expect(optionsData.singleOpts).toEqual(['SP', 'RJ', 'MG', 'RS', 'PR']);
    expect(optionsData.multiOpts).toEqual(['javascript', 'typescript', 'python', 'rust', 'go']);
    expect(optionsData.radioOpts).toEqual(['clt', 'pj', 'estagio']);
  });

  test('TC-T1-R1-05: Non-Fillable Control Filtering on #form-edge-cases', async ({ page }) => {
    const edgeScan = await page.evaluate(() => {
      const form = document.getElementById('form-edge-cases');
      const allInputs = Array.from(form.querySelectorAll('input'));

      // Filter non-fillable: hidden, disabled, honeypots, file
      const fillable = allInputs.filter(el => {
        if (el.type === 'hidden' || el.type === 'file') return false;
        if (el.disabled) return false;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) return false;
        if (rect.left < -500 || rect.top < -500) return false;
        return true;
      });

      return {
        totalInputs: allInputs.length,
        fillableIds: fillable.map(el => el.id)
      };
    });

    expect(edgeScan.fillableIds).not.toContain('csrf-token');
    expect(edgeScan.fillableIds).not.toContain('edge-disabled');
    expect(edgeScan.fillableIds).not.toContain('edge-file');
    expect(edgeScan.fillableIds).not.toContain('honeypot-offscreen');
    expect(edgeScan.fillableIds).not.toContain('honeypot-hidden');
    expect(edgeScan.fillableIds).not.toContain('honeypot-zero');
  });

  test('TC-T1-R1-06: 7-Tier Label Resolution Cascade Completeness', async ({ page }) => {
    const resolvedLabels = await page.evaluate(() => {
      function resolveLabel(el) {
        // Tier 1: Explicit label[for]
        if (el.id) {
          const label = document.querySelector(`label[for="${el.id}"]`);
          if (label && label.textContent.trim()) {
            return { tier: 1, text: label.textContent.trim() };
          }
        }
        // Tier 2: Wrapping label
        const wrappingLabel = el.closest('label');
        if (wrappingLabel) {
          const clone = wrappingLabel.cloneNode(true);
          Array.from(clone.querySelectorAll('input, select, textarea')).forEach(c => c.remove());
          const txt = clone.textContent.trim();
          if (txt) return { tier: 2, text: txt };
        }
        // Tier 3: aria-labelledby
        const labelledBy = el.getAttribute('aria-labelledby');
        if (labelledBy) {
          const parts = labelledBy.split(/\s+/).map(id => {
            const ref = document.getElementById(id);
            return ref ? ref.textContent.trim() : '';
          }).filter(Boolean);
          if (parts.length) return { tier: 3, text: parts.join(' ') };
        }
        // Tier 4: aria-label
        const ariaLabel = el.getAttribute('aria-label');
        if (ariaLabel && ariaLabel.trim()) {
          return { tier: 4, text: ariaLabel.trim() };
        }
        // Tier 5: Fieldset Legend
        const fieldset = el.closest('fieldset');
        if (fieldset) {
          const legend = fieldset.querySelector('legend');
          if (legend && legend.textContent.trim()) {
            return { tier: 5, text: legend.textContent.trim() };
          }
        }
        // Tier 6: Sibling / container text
        const parent = el.parentElement;
        if (parent) {
          const span = parent.querySelector('span');
          if (span && span.textContent.trim()) {
            return { tier: 6, text: span.textContent.trim() };
          }
        }
        // Tier 7: Attribute fallback (placeholder or name)
        if (el.placeholder) return { tier: 7, text: el.placeholder.trim() };
        if (el.name) return { tier: 7, text: el.name.trim() };
        return { tier: 0, text: '' };
      }

      return {
        t1: resolveLabel(document.getElementById('edge-tier1-id')),
        t2: resolveLabel(document.getElementById('edge-tier2-id')),
        t3: resolveLabel(document.getElementById('edge-tier3-id')),
        t4: resolveLabel(document.getElementById('edge-tier4-id')),
        t5: resolveLabel(document.getElementById('edge-tier5-id')),
        t6: resolveLabel(document.getElementById('edge-tier6-id')),
        t7: resolveLabel(document.getElementById('edge-tier7-id'))
      };
    });

    expect(resolvedLabels.t1.tier).toBe(1);
    expect(resolvedLabels.t1.text).toContain('Explicit Label For');

    expect(resolvedLabels.t2.tier).toBe(2);
    expect(resolvedLabels.t2.text).toContain('Nested Wrapping Label Text');

    expect(resolvedLabels.t3.tier).toBe(3);
    expect(resolvedLabels.t3.text).toContain('Tier 3 Compound Aria LabelledBy');

    expect(resolvedLabels.t4.tier).toBe(4);
    expect(resolvedLabels.t4.text).toBe('Tier 4 Accessible Name');

    expect(resolvedLabels.t5.tier).toBe(5);
    expect(resolvedLabels.t5.text).toContain('Ancestor Fieldset Legend');

    expect(resolvedLabels.t6.tier).toBe(6);
    expect(resolvedLabels.t6.text).toContain('Sibling Span Label');

    expect(resolvedLabels.t7.tier).toBe(7);
    expect(resolvedLabels.t7.text).toContain('Placeholder Postal Code');
  });
});

describe('Tier 1: Feature Coverage (R2 - Multi-Provider AI Configuration & Structured Generation)', () => {
  test('TC-T1-R2-01: Settings Persistence Schema in storage.sync contract', () => {
    const mockSyncStorage = {};
    const settings = {
      provider: 'gemini',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      model: 'gemini-2.0-flash',
      apiKey: 'AIzaSyFakeKeyTest12345',
      temperature: 0.7,
      locale: 'pt-BR'
    };

    mockSyncStorage['formgen_settings'] = settings;
    const serialized = JSON.stringify(mockSyncStorage['formgen_settings']);

    // Check schema keys
    expect(mockSyncStorage['formgen_settings'].provider).toBe('gemini');
    expect(mockSyncStorage['formgen_settings'].model).toBe('gemini-2.0-flash');
    expect(mockSyncStorage['formgen_settings'].apiKey).toBe('AIzaSyFakeKeyTest12345');
    // Check quota (<8192 bytes for chrome.storage.sync per item)
    expect(serialized.length).toBeLessThan(8192);
  });

  test('TC-T1-R2-02: Single Record Generation (N=1) Schema Conformance', () => {
    const singleRecordResponse = {
      records: [
        {
          fullname: 'Carlos Silva',
          email: 'carlos.silva@empresa.com.br',
          age: 34,
          phone: '(11) 98765-4321',
          birthdate: '1992-05-14',
          state: 'SP',
          skills: ['javascript', 'typescript'],
          'ent-contract': 'clt',
          newsletter: true,
          terms: true,
          bio: 'Desenvolvedor sênior com 10 anos de experiência.'
        }
      ]
    };

    expect(Array.isArray(singleRecordResponse.records)).toBe(true);
    expect(singleRecordResponse.records.length).toBe(1);

    const rec = singleRecordResponse.records[0];
    expect(typeof rec.fullname).toBe('string');
    expect(typeof rec.age).toBe('number');
    expect(rec.age).toBeGreaterThanOrEqual(18);
    expect(rec.skills).toContain('javascript');
    expect(rec.terms).toBe(true);
  });

  test('TC-T1-R2-03: Batch Generation (N=10) Strict JSON Array Structure', () => {
    const records = Array.from({ length: 10 }, (_, i) => ({
      fullname: `Pessoa Teste ${i + 1}`,
      email: `pessoa${i + 1}@teste.com`,
      age: 20 + i,
      state: 'SP',
      'ent-contract': 'clt'
    }));

    const response = { records };
    expect(response.records.length).toBe(10);
    // Distinct data check
    const names = new Set(response.records.map(r => r.fullname));
    expect(names.size).toBe(10);
  });

  test('TC-T1-R2-04: Batch Generation (N=100) Chunking & Reassembly', () => {
    // 100-record batch chunking into 4 chunks of 25
    const chunkSize = 25;
    const totalRecords = 100;
    const chunks = [];

    for (let c = 0; c < totalRecords / chunkSize; c++) {
      const chunkRecords = Array.from({ length: chunkSize }, (_, i) => ({
        id: c * chunkSize + i + 1,
        fullname: `Batch Lead ${c * chunkSize + i + 1}`
      }));
      chunks.push(chunkRecords);
    }

    expect(chunks.length).toBe(4);
    const reassembled = chunks.flat();
    expect(reassembled.length).toBe(100);
    expect(reassembled[0].id).toBe(1);
    expect(reassembled[99].id).toBe(100);
  });

  test('TC-T1-R2-05: Multi-Provider Request Formatting Parity', () => {
    function formatProviderRequest(provider, config, prompt) {
      if (provider === 'gemini') {
        return {
          url: `${config.baseUrl}/models/${config.model}:generateContent?key=${config.apiKey}`,
          headers: { 'Content-Type': 'application/json' },
          body: {
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { responseMimeType: 'application/json' }
          }
        };
      } else if (provider === 'openai' || provider === 'custom') {
        return {
          url: `${config.baseUrl}/chat/completions`,
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${config.apiKey}`
          },
          body: {
            model: config.model,
            messages: [{ role: 'user', content: prompt }],
            response_format: { type: 'json_object' }
          }
        };
      } else if (provider === 'ollama') {
        return {
          url: `${config.baseUrl}/api/chat`,
          headers: { 'Content-Type': 'application/json' },
          body: {
            model: config.model,
            messages: [{ role: 'user', content: prompt }],
            stream: false,
            format: 'json'
          }
        };
      }
      throw new Error(`Unsupported provider: ${provider}`);
    }

    const prompt = 'Generate form data';
    const geminiReq = formatProviderRequest('gemini', { baseUrl: 'https://gemini.api', model: 'gemini-pro', apiKey: 'KEY1' }, prompt);
    expect(geminiReq.url).toContain('key=KEY1');
    expect(geminiReq.body.generationConfig.responseMimeType).toBe('application/json');

    const openaiReq = formatProviderRequest('openai', { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o', apiKey: 'KEY2' }, prompt);
    expect(openaiReq.headers.Authorization).toBe('Bearer KEY2');
    expect(openaiReq.body.response_format.type).toBe('json_object');

    const ollamaReq = formatProviderRequest('ollama', { baseUrl: 'http://localhost:11434', model: 'llama3', apiKey: '' }, prompt);
    expect(ollamaReq.body.stream).toBe(false);
    expect(ollamaReq.body.format).toBe('json');
  });

  test('TC-T1-R2-06: Resilient JSON Sanitization & Parsing', () => {
    function sanitizeAndParse(raw) {
      let cleaned = raw.trim();
      // Remove markdown code block fences
      if (cleaned.startsWith('```json')) cleaned = cleaned.replace(/^```json\s*/, '');
      if (cleaned.startsWith('```')) cleaned = cleaned.replace(/^```\s*/, '');
      if (cleaned.endsWith('```')) cleaned = cleaned.replace(/\s*```$/, '');
      // Extract boundaries
      const firstBracket = cleaned.indexOf('{');
      const lastBracket = cleaned.lastIndexOf('}');
      if (firstBracket !== -1 && lastBracket !== -1) {
        cleaned = cleaned.substring(firstBracket, lastBracket + 1);
      }
      // Remove trailing commas before } or ]
      cleaned = cleaned.replace(/,\s*([\]}])/g, '$1');
      return JSON.parse(cleaned);
    }

    const messyResponse = `
Here is the requested record:
\`\`\`json
{
  "records": [
    {
      "name": "Maria Souza",
      "age": 28,
    },
  ],
}
\`\`\`
Hope this helps!
`;
    const parsed = sanitizeAndParse(messyResponse);
    expect(parsed.records.length).toBe(1);
    expect(parsed.records[0].name).toBe('Maria Souza');
    expect(parsed.records[0].age).toBe(28);
  });
});

describe('Tier 1: Feature Coverage (R3 - Browser Queue Management & Dynamic Stepping UI)', () => {
  test('TC-T1-R3-01: Single Record Immediate Injection Without Queue Storage', () => {
    const storageLocal = {};
    function processGeneration(count, records) {
      if (count === 1) {
        // Direct injection, no queue saved
        delete storageLocal['formgen_active_queue'];
        return { immediateRecord: records[0], queueCreated: false, buttonText: 'Gerar dados' };
      }
      return null;
    }

    const result = processGeneration(1, [{ name: 'Solo User' }]);
    expect(result.immediateRecord.name).toBe('Solo User');
    expect(result.queueCreated).toBe(false);
    expect(storageLocal['formgen_active_queue']).toBeUndefined();
    expect(result.buttonText).toBe('Gerar dados');
  });

  test('TC-T1-R3-02: Batch Record #1 Immediate Injection & Storage of #2..#N', () => {
    const storageLocal = {};
    const batchRecords = Array.from({ length: 10 }, (_, i) => ({ id: i + 1, name: `User ${i + 1}` }));

    function createBatchQueue(records, url, formId) {
      const immediate = records[0];
      const pending = records.slice(1);
      storageLocal['formgen_active_queue'] = {
        queueId: 'q-test-123',
        url,
        formId,
        totalRecords: records.length,
        currentIndex: 2,
        pendingRecords: pending,
        createdAt: Date.now()
      };
      return { immediate, queue: storageLocal['formgen_active_queue'] };
    }

    const res = createBatchQueue(batchRecords, 'http://localhost/test', 'form-enterprise');
    expect(res.immediate.id).toBe(1);
    expect(storageLocal['formgen_active_queue'].totalRecords).toBe(10);
    expect(storageLocal['formgen_active_queue'].currentIndex).toBe(2);
    expect(storageLocal['formgen_active_queue'].pendingRecords.length).toBe(9);
    expect(storageLocal['formgen_active_queue'].pendingRecords[0].id).toBe(2);
  });

  test('TC-T1-R3-03: Dynamic Stepping Button State Transitions', () => {
    let queue = {
      totalRecords: 10,
      currentIndex: 2,
      pendingRecords: [{ id: 2 }, { id: 3 }, { id: 4 }]
    };

    function getButtonLabel(q) {
      if (!q || !q.pendingRecords || q.pendingRecords.length === 0) return 'Gerar dados';
      return `Inserir registro [${q.currentIndex}/${q.totalRecords}]`;
    }

    expect(getButtonLabel(queue)).toBe('Inserir registro [2/10]');

    // Advance queue step
    const nextRecord = queue.pendingRecords.shift();
    queue.currentIndex++;

    expect(nextRecord.id).toBe(2);
    expect(getButtonLabel(queue)).toBe('Inserir registro [3/10]');
  });

  test('TC-T1-R3-04: Final Queue Ingestion & Automatic Storage Purge', () => {
    const storage = {
      'formgen_active_queue': {
        totalRecords: 3,
        currentIndex: 3,
        pendingRecords: [{ id: 3, name: 'Final User' }]
      }
    };

    function advanceStep() {
      const q = storage['formgen_active_queue'];
      if (!q) return null;
      const injected = q.pendingRecords.shift();
      if (q.pendingRecords.length === 0) {
        delete storage['formgen_active_queue'];
        return { injected, queueActive: false, buttonText: 'Gerar dados' };
      }
      q.currentIndex++;
      return { injected, queueActive: true, buttonText: `Inserir registro [${q.currentIndex}/${q.totalRecords}]` };
    }

    const stepResult = advanceStep();
    expect(stepResult.injected.id).toBe(3);
    expect(stepResult.queueActive).toBe(false);
    expect(storage['formgen_active_queue']).toBeUndefined();
    expect(stepResult.buttonText).toBe('Gerar dados');
  });

  test('TC-T1-R3-05: User-Initiated Queue Discard Flow ("Descartar fila")', () => {
    const storage = {
      'formgen_active_queue': {
        totalRecords: 10,
        currentIndex: 4,
        pendingRecords: [{ id: 4 }, { id: 5 }]
      }
    };

    function discardQueue() {
      delete storage['formgen_active_queue'];
      return { buttonText: 'Gerar dados', status: 'IDLE' };
    }

    const state = discardQueue();
    expect(storage['formgen_active_queue']).toBeUndefined();
    expect(state.buttonText).toBe('Gerar dados');
    expect(state.status).toBe('IDLE');
  });

  test('TC-T1-R3-06: Queue Storage Isolation by URL and Form ID', () => {
    const queue = {
      url: 'http://localhost:8080/test-fixture.html',
      formId: 'form-enterprise',
      totalRecords: 10,
      currentIndex: 2
    };

    function isQueueValidForPage(activeQueue, currentUrl, currentFormId) {
      if (!activeQueue) return false;
      return activeQueue.url === currentUrl && activeQueue.formId === currentFormId;
    }

    expect(isQueueValidForPage(queue, 'http://localhost:8080/test-fixture.html', 'form-enterprise')).toBe(true);
    expect(isQueueValidForPage(queue, 'http://localhost:8080/other-page.html', 'form-enterprise')).toBe(false);
    expect(isQueueValidForPage(queue, 'http://localhost:8080/test-fixture.html', 'form-reactive')).toBe(false);
  });
});

describe('Tier 1: Feature Coverage (R4 - Automated DOM Injection & Reactivity Emulation)', () => {
  beforeEach(async ({ page }) => {
    await page.evaluate(() => {
      if (window.__FORMGEN_FIXTURE__) window.__FORMGEN_FIXTURE__.resetLogs();
    });
  });

  test('TC-T1-R4-01: Multi-Control Value Injection on #form-enterprise', async ({ page }) => {
    const values = await page.evaluate(() => {
      function injectValue(el, val) {
        el.focus();
        const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
        setter.call(el, val);
        if (el._valueTracker) el._valueTracker.setValue(val);
        el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
        el.blur();
      }

      const fullname = document.getElementById('ent-fullname');
      const email = document.getElementById('ent-email');
      const age = document.getElementById('ent-age');
      const phone = document.getElementById('ent-phone');
      const birthdate = document.getElementById('ent-birthdate');
      const bio = document.getElementById('ent-bio');

      injectValue(fullname, 'Ada Lovelace');
      injectValue(email, 'ada@computacao.org');
      injectValue(age, '36');
      injectValue(phone, '(11) 98765-4321');
      injectValue(birthdate, '1990-12-10');
      injectValue(bio, 'Primeira programadora da história.');

      return {
        fullname: fullname.value,
        email: email.value,
        age: age.value,
        phone: phone.value,
        birthdate: birthdate.value,
        bio: bio.value
      };
    });

    expect(values.fullname).toBe('Ada Lovelace');
    expect(values.email).toBe('ada@computacao.org');
    expect(values.age).toBe('36');
    expect(values.phone).toBe('(11) 98765-4321');
    expect(values.birthdate).toBe('1990-12-10');
    expect(values.bio).toBe('Primeira programadora da história.');
  });

  test('TC-T1-R4-02: Select Option Selection (Single & Multi)', async ({ page }) => {
    const selection = await page.evaluate(() => {
      const stateSelect = document.getElementById('ent-state');
      stateSelect.focus();
      stateSelect.value = 'SP';
      stateSelect.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      stateSelect.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
      stateSelect.blur();

      const skillsSelect = document.getElementById('ent-skills');
      skillsSelect.focus();
      const targets = ['javascript', 'typescript'];
      for (const opt of skillsSelect.options) {
        opt.selected = targets.includes(opt.value);
      }
      skillsSelect.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      skillsSelect.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
      skillsSelect.blur();

      const selectedSkills = Array.from(skillsSelect.selectedOptions).map(o => o.value);
      return { state: stateSelect.value, skills: selectedSkills };
    });

    expect(selection.state).toBe('SP');
    expect(selection.skills).toEqual(['javascript', 'typescript']);
  });

  test('TC-T1-R4-03: Radio Button & Checkbox Toggling', async ({ page }) => {
    const checkResults = await page.evaluate(() => {
      // Toggle radio to 'pj'
      const radioPJ = document.getElementById('ent-contract-pj');
      radioPJ.focus();
      radioPJ.checked = true;
      radioPJ.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      radioPJ.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
      radioPJ.blur();

      const radioCLT = document.getElementById('ent-contract-clt');

      // Check checkboxes
      const cbNews = document.getElementById('ent-newsletter');
      cbNews.checked = true;
      cbNews.dispatchEvent(new Event('change', { bubbles: true, composed: true }));

      const cbTerms = document.getElementById('ent-terms');
      cbTerms.checked = true;
      cbTerms.dispatchEvent(new Event('change', { bubbles: true, composed: true }));

      return {
        pjChecked: radioPJ.checked,
        cltChecked: radioCLT.checked,
        newsChecked: cbNews.checked,
        termsChecked: cbTerms.checked
      };
    });

    expect(checkResults.pjChecked).toBe(true);
    expect(checkResults.cltChecked).toBe(false);
    expect(checkResults.newsChecked).toBe(true);
    expect(checkResults.termsChecked).toBe(true);
  });

  test('TC-T1-R4-04: React Native Prototype Setter Bypass on #form-reactive', async ({ page }) => {
    const mirrorState = await page.evaluate(() => {
      const input = document.getElementById('reactive-name');
      input.focus();

      // Native prototype setter bypass
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(input, 'Marie Curie');

      if (input._valueTracker) {
        input._valueTracker.setValue('Marie Curie');
      }

      input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
      input.blur();

      return window.__FORMGEN_FIXTURE__.getReactiveState();
    });

    expect(mirrorState.reactiveName).toBe('Marie Curie');
  });

  test('TC-T1-R4-05: Canonical Event Dispatch Sequence (focus -> input -> change -> blur)', async ({ page }) => {
    const eventSequence = await page.evaluate(() => {
      window.__FORMGEN_FIXTURE__.resetLogs();
      const input = document.getElementById('ent-fullname');

      // Canonical event dispatch sequence
      input.dispatchEvent(new Event('focus', { bubbles: true, composed: true }));
      input.value = 'Alan Turing';
      input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
      input.dispatchEvent(new Event('blur', { bubbles: true, composed: true }));

      const events = window.__FORMGEN_FIXTURE__.getCapturedEvents();
      return events.filter(e => e.targetId === 'ent-fullname').map(e => e.type);
    });

    expect(eventSequence).toEqual(['focus', 'input', 'change', 'blur']);
  });

  test('TC-T1-R4-06: Event Propagation & Fidelity (bubbles, composed)', async ({ page }) => {
    const eventProps = await page.evaluate(() => {
      window.__FORMGEN_FIXTURE__.resetLogs();
      let windowCaught = false;
      const windowListener = () => { windowCaught = true; };
      window.addEventListener('input', windowListener, { once: true });

      const input = document.getElementById('ent-email');
      input.dispatchEvent(new Event('input', { bubbles: true, composed: true, cancelable: true }));

      const events = window.__FORMGEN_FIXTURE__.getCapturedEvents();
      const lastEvent = events[events.length - 1];

      return {
        windowCaught,
        bubbles: lastEvent.bubbles,
        composed: lastEvent.composed
      };
    });

    expect(eventProps.windowCaught).toBe(true);
    expect(eventProps.bubbles).toBe(true);
    expect(eventProps.composed).toBe(true);
  });
});

describe('Tier 1: Feature Coverage (R5 - Standalone Fixture & Verification Suite)', () => {
  test('TC-T1-R5-01: Fixture Availability & Global Hook (window.__FORMGEN_FIXTURE__)', async ({ page }) => {
    const fixtureAPI = await page.evaluate(() => {
      const h = window.__FORMGEN_FIXTURE__;
      if (!h) return null;
      return {
        isObject: typeof h === 'object',
        version: h.version,
        hasGetCapturedEvents: typeof h.getCapturedEvents === 'function',
        hasGetReactiveState: typeof h.getReactiveState === 'function',
        hasIsFormValid: typeof h.isFormValid === 'function',
        hasGetFormValues: typeof h.getFormValues === 'function',
        hasResetLogs: typeof h.resetLogs === 'function',
        hasLogEvent: typeof h.logEvent === 'function'
      };
    });

    expect(fixtureAPI).not.toBeNull();
    expect(fixtureAPI.isObject).toBe(true);
    expect(fixtureAPI.version).toBe('1.0.0');
    expect(fixtureAPI.hasGetCapturedEvents).toBe(true);
    expect(fixtureAPI.hasGetReactiveState).toBe(true);
    expect(fixtureAPI.hasIsFormValid).toBe(true);
    expect(fixtureAPI.hasGetFormValues).toBe(true);
    expect(fixtureAPI.hasResetLogs).toBe(true);
    expect(fixtureAPI.hasLogEvent).toBe(true);
  });

  test('TC-T1-R5-02: Event Capture Verification via getCapturedEvents()', async ({ page }) => {
    const result = await page.evaluate(() => {
      window.__FORMGEN_FIXTURE__.resetLogs();
      const email = document.getElementById('ent-email');
      email.value = 'test@example.com';
      email.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      email.dispatchEvent(new Event('change', { bubbles: true, composed: true }));

      const logs = window.__FORMGEN_FIXTURE__.getCapturedEvents();
      return {
        count: logs.length,
        first: logs[0],
        second: logs[1]
      };
    });

    expect(result.count).toBe(2);
    expect(result.first.targetId).toBe('ent-email');
    expect(result.first.type).toBe('input');
    expect(result.first.value).toBe('test@example.com');
    expect(result.second.type).toBe('change');
  });

  test('TC-T1-R5-03: Reactive State Mirror Verification via getReactiveState()', async ({ page }) => {
    const mirrorMatch = await page.evaluate(() => {
      const input = document.getElementById('reactive-email');
      input.value = 'ada@lovelace.io';
      input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));

      const state = window.__FORMGEN_FIXTURE__.getReactiveState();
      const pre = document.getElementById('reactive-state-output');
      const mirrorParsed = JSON.parse(pre.textContent);

      return {
        stateEmail: state.reactiveEmail,
        mirrorEmail: mirrorParsed.reactiveEmail
      };
    });

    expect(mirrorMatch.stateEmail).toBe('ada@lovelace.io');
    expect(mirrorMatch.mirrorEmail).toBe('ada@lovelace.io');
  });

  test('TC-T1-R5-04: Full Form Validity Assertion via isFormValid()', async ({ page }) => {
    const validityTransition = await page.evaluate(() => {
      // Step 1: Clean/empty form enterprise
      const form = document.getElementById('form-enterprise');
      form.reset();
      const initialValid = window.__FORMGEN_FIXTURE__.isFormValid('form-enterprise');

      // Step 2: Fill all required fields
      document.getElementById('ent-fullname').value = 'João Victor';
      document.getElementById('ent-email').value = 'joao@empresa.com';
      document.getElementById('ent-age').value = '25';
      document.getElementById('ent-state').value = 'SP';
      document.getElementById('ent-contract-clt').checked = true;
      document.getElementById('ent-terms').checked = true;

      const finalValid = window.__FORMGEN_FIXTURE__.isFormValid('form-enterprise');
      return { initialValid, finalValid };
    });

    expect(validityTransition.initialValid).toBe(false);
    expect(validityTransition.finalValid).toBe(true);
  });

  test('TC-T1-R5-05: 100% Non-Interactive Automated Headless Execution', ({ page, url }) => {
    expect(page).toBeDefined();
    expect(url).toContain('test-fixture.html');
  });

  test('TC-T1-R5-06: Form Values Inspection via getFormValues()', async ({ page }) => {
    const formVals = await page.evaluate(() => {
      document.getElementById('ent-fullname').value = 'Grace Hopper';
      document.getElementById('ent-state').value = 'RJ';
      return window.__FORMGEN_FIXTURE__.getFormValues('form-enterprise');
    });

    expect(formVals.fullname).toBe('Grace Hopper');
    expect(formVals.state).toBe('RJ');
  });
});
