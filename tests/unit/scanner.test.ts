/**
 * FormGen - DOM Scanner & Lean Schema Extraction Unit Test Suite
 * Validates 7-tier label cascade, constraints extraction, radio grouping,
 * honeypot rejection, transient data-formgen-id stamping, zero HTML/styles leaks,
 * and content script IPC message routing.
 * Path: tests/unit/scanner.test.ts
 */

import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { scanDocument } from '../../src/content/scanner';
import { handleContentMessage } from '../../src/content/index';
import { FormSchema, ScanDomResponse } from '../../src/shared/types';

describe('Milestone 2: DOM Scanner & Lean Schema Extraction', () => {
  let dom: JSDOM;
  let document: Document;
  let window: any;

  beforeEach(() => {
    const fixtureHtml = fs.readFileSync(
      path.resolve(__dirname, '../fixtures/test-fixture.html'),
      'utf8'
    );
    dom = new JSDOM(fixtureHtml, {
      url: 'http://localhost:3000/test-fixture.html',
      runScripts: 'dangerously',
    });
    window = dom.window;
    document = window.document;

    // Polyfill globals for DOM operations
    globalThis.window = window as any;
    globalThis.document = document as any;
    globalThis.HTMLElement = window.HTMLElement;
    globalThis.HTMLInputElement = window.HTMLInputElement;
    globalThis.HTMLSelectElement = window.HTMLSelectElement;
    globalThis.HTMLTextAreaElement = window.HTMLTextAreaElement;
    globalThis.Node = window.Node;
  });

  // ==========================================================================
  // Suite 1: Canonical Enterprise Form (#form-enterprise)
  // ==========================================================================
  describe('1. Canonical Enterprise Form (#form-enterprise)', () => {
    let schema: FormSchema;

    beforeEach(() => {
      schema = scanDocument({
        target: '#form-enterprise',
        document,
      });
    });

    it('extracts exactly 11 interactive fields and sets form identifiers', () => {
      expect(schema).toBeDefined();
      expect(schema.formId).toBe('form-enterprise');
      expect(schema.fields).toHaveLength(11);
    });

    it('excludes submit and reset buttons from schema fields', () => {
      const fieldNames = schema.fields.map((f) => f.name);
      expect(fieldNames).not.toContain('btn-submit-enterprise');
      expect(fieldNames).not.toContain('btn-reset-enterprise');
      const types = schema.fields.map((f) => f.type);
      expect(types).not.toContain('button');
      expect(types).not.toContain('submit');
      expect(types).not.toContain('reset');
    });

    it('extracts Field 1 (fullname): text, normalized label, minLength/maxLength, required', () => {
      const field = schema.fields.find((f) => f.name === 'fullname')!;
      expect(field).toBeDefined();
      expect(field.type).toBe('text');
      expect(field.label).toBe('Nome Completo'); // '*' stripped and trimmed
      expect(field.required).toBe(true);
      expect(field.placeholder).toBe('Nome completo do colaborador');
      expect(field.validation?.minLength).toBe(3);
      expect(field.validation?.maxLength).toBe(50);
      expect(field.validation?.autocomplete).toBe('name');
      expect(field.formgenId).toMatch(/^fg_\d+$/);
    });

    it('extracts Field 2 (email): email, normalized label, autocomplete, required', () => {
      const field = schema.fields.find((f) => f.name === 'email')!;
      expect(field).toBeDefined();
      expect(field.type).toBe('email');
      expect(field.label).toBe('E-mail Corporativo'); // '*' stripped
      expect(field.required).toBe(true);
      expect(field.placeholder).toBe('colaborador@empresa.com.br');
      expect(field.validation?.autocomplete).toBe('email');
    });

    it('extracts Field 3 (age): number, min/max/step constraints, required', () => {
      const field = schema.fields.find((f) => f.name === 'age')!;
      expect(field).toBeDefined();
      expect(field.type).toBe('number');
      expect(field.label).toBe('Idade');
      expect(field.required).toBe(true);
      expect(Number(field.validation?.min)).toBe(18);
      expect(Number(field.validation?.max)).toBe(120);
      expect(Number(field.validation?.step)).toBe(1);
    });

    it('extracts Field 4 (phone): tel, regex pattern validation', () => {
      const field = schema.fields.find((f) => f.name === 'phone')!;
      expect(field).toBeDefined();
      expect(field.type).toBe('tel');
      expect(field.label).toBe('Telefone Comercial');
      expect(field.required).toBe(false);
      expect(field.validation?.pattern).toBe('\\(\\d{2}\\) \\d{4,5}-\\d{4}');
      expect(field.placeholder).toBe('(11) 98765-4321');
    });

    it('extracts Field 5 (birthdate): date, min/max ISO dates', () => {
      const field = schema.fields.find((f) => f.name === 'birthdate')!;
      expect(field).toBeDefined();
      expect(field.type).toBe('date');
      expect(field.label).toBe('Data de Nascimento');
      expect(field.required).toBe(false);
      expect(field.validation?.min).toBe('1950-01-01');
      expect(field.validation?.max).toBe('2026-12-31');
    });

    it('extracts Field 6 (state): select single, 5 valid options excluding placeholder', () => {
      const field = schema.fields.find((f) => f.name === 'state')!;
      expect(field).toBeDefined();
      expect(field.type).toBe('select');
      expect(field.label).toBe('Estado (UF)');
      expect(field.required).toBe(true);
      expect(field.multiple).toBeFalsy();
      expect(field.options).toBeDefined();
      expect(field.options).toHaveLength(5);
      expect(field.options!.map((o) => o.value)).toEqual([
        'SP',
        'RJ',
        'MG',
        'RS',
        'PR',
      ]);
      expect(field.options!.map((o) => o.label)).toEqual([
        'São Paulo (SP)',
        'Rio de Janeiro (RJ)',
        'Minas Gerais (MG)',
        'Rio Grande do Sul (RS)',
        'Paraná (PR)',
      ]);
    });

    it('extracts Field 7 (skills): select multiple, 5 options', () => {
      const field = schema.fields.find((f) => f.name === 'skills')!;
      expect(field).toBeDefined();
      expect(field.type).toBe('select');
      expect(field.label).toBe('Habilidades Técnicas (Múltiplas)');
      expect(field.multiple).toBe(true);
      expect(field.required).toBe(false);
      expect(field.options).toHaveLength(5);
      expect(field.options!.map((o) => o.value)).toEqual([
        'javascript',
        'typescript',
        'python',
        'rust',
        'go',
      ]);
    });

    it('extracts Field 8 (ent-contract): aggregates 3 radio inputs into 1 logical field', () => {
      const field = schema.fields.find((f) => f.name === 'ent-contract')!;
      expect(field).toBeDefined();
      expect(field.type).toBe('radio');
      expect(field.label).toBe('Tipo de Contrato'); // from fieldset legend
      expect(field.required).toBe(true);
      expect(field.options).toHaveLength(3);
      expect(field.options).toEqual([
        { value: 'clt', label: 'CLT Efetivo' },
        { value: 'pj', label: 'Pessoa Jurídica (PJ)' },
        { value: 'estagio', label: 'Estágio' },
      ]);
    });

    it('extracts Field 9 (newsletter): checkbox optional', () => {
      const field = schema.fields.find((f) => f.name === 'newsletter')!;
      expect(field).toBeDefined();
      expect(field.type).toBe('checkbox');
      expect(field.label).toBe('Desejo receber boletim técnico quinzenal');
      expect(field.required).toBe(false);
    });

    it('extracts Field 10 (terms): checkbox required with stripped asterisk', () => {
      const field = schema.fields.find((f) => f.name === 'terms')!;
      expect(field).toBeDefined();
      expect(field.type).toBe('checkbox');
      expect(field.label).toBe('Declaro que li e concordo com os Termos de Uso');
      expect(field.required).toBe(true);
    });

    it('extracts Field 11 (bio): textarea, maxLength 500, placeholder', () => {
      const field = schema.fields.find((f) => f.name === 'bio')!;
      expect(field).toBeDefined();
      expect(field.type).toBe('textarea');
      expect(field.label).toBe('Biografia Resumida');
      expect(field.required).toBe(false);
      expect(field.validation?.maxLength).toBe(500);
      expect(field.placeholder).toBe(
        'Fale brevemente sobre sua formação e objetivos...'
      );
    });
  });

  // ==========================================================================
  // Suite 2: 7-Tier Label Resolution Cascade (#form-edge-cases)
  // ==========================================================================
  describe('2. 7-Tier Label Resolution Cascade (#form-edge-cases)', () => {
    let schema: FormSchema;

    beforeEach(() => {
      schema = scanDocument({
        target: '#form-edge-cases',
        document,
      });
    });

    it('resolves Tier 1: explicit label[for="id"]', () => {
      const field = schema.fields.find((f) => f.name === 'tier1_field');
      expect(field).toBeDefined();
      expect(field?.label).toBe('Tier 1: Explicit Label For');
    });

    it('resolves Tier 2: wrapping parent <label>', () => {
      const field = schema.fields.find((f) => f.name === 'tier2_field');
      expect(field).toBeDefined();
      expect(field?.label).toBe('Tier 2: Nested Wrapping Label Text');
    });

    it('resolves Tier 3: compound aria-labelledby (multi-id resolution)', () => {
      const field = schema.fields.find((f) => f.name === 'tier3_field');
      expect(field).toBeDefined();
      expect(field?.label).toBe('Tier 3 Compound Aria LabelledBy');
    });

    it('resolves Tier 4: aria-label attribute', () => {
      const field = schema.fields.find((f) => f.name === 'tier4_field');
      expect(field).toBeDefined();
      expect(field?.label).toBe('Tier 4 Accessible Name');
    });

    it('resolves Tier 5: ancestor fieldset legend for input and radio group', () => {
      const field = schema.fields.find((f) => f.name === 'tier5_field');
      expect(field).toBeDefined();
      expect(field?.label).toBe('Tier 5: Ancestor Fieldset Legend');

      const radioField = schema.fields.find((f) => f.name === 'tier5_radio');
      expect(radioField).toBeDefined();
      expect(radioField?.label).toBe('Tier 5: Ancestor Fieldset Legend');
      expect(radioField?.options).toHaveLength(2);
    });

    it('resolves Tier 6: preceding sibling span in same container', () => {
      const field = schema.fields.find((f) => f.name === 'tier6_field');
      expect(field).toBeDefined();
      expect(field?.label).toBe('Tier 6: Sibling Span Label');
    });

    it('resolves Tier 7: placeholder attribute fallback', () => {
      const field = schema.fields.find((f) => f.name === 'user_postal_code');
      expect(field).toBeDefined();
      expect(field?.label).toBe('Tier 7: Placeholder Postal Code');
    });
  });

  // ==========================================================================
  // Suite 3: Adversarial Honeypots & Non-Fillable Control Exclusions
  // ==========================================================================
  describe('3. Adversarial Traps & Non-Fillable Exclusions', () => {
    let schema: FormSchema;

    beforeEach(() => {
      schema = scanDocument({
        target: '#form-edge-cases',
        document,
      });
    });

    it('omits offscreen honeypot (left: -9999px)', () => {
      const names = schema.fields.map((f) => f.name);
      expect(names).not.toContain('trap_offscreen_url');
    });

    it('omits display: none honeypot', () => {
      const names = schema.fields.map((f) => f.name);
      expect(names).not.toContain('trap_display_none');
    });

    it('omits zero-dimension / opacity: 0 honeypot', () => {
      const names = schema.fields.map((f) => f.name);
      expect(names).not.toContain('trap_zero_dimension');
    });

    it('omits hidden CSRF security token (type="hidden")', () => {
      const names = schema.fields.map((f) => f.name);
      expect(names).not.toContain('csrf_token');
    });

    it('omits disabled controls', () => {
      const names = schema.fields.map((f) => f.name);
      expect(names).not.toContain('disabled_control');
    });

    it('omits readonly controls from fillable schema', () => {
      const names = schema.fields.map((f) => f.name);
      expect(names).not.toContain('readonly_control');
    });

    it('omits file inputs (type="file")', () => {
      const names = schema.fields.map((f) => f.name);
      expect(names).not.toContain('attachment_file');
    });

    it('omits orphan inputs outside form when scoped to #form-edge-cases', () => {
      const names = schema.fields.map((f) => f.name);
      expect(names).not.toContain('orphan_field');
    });
  });

  // ==========================================================================
  // Suite 4: Lean JSON Schema Sanitization Guarantee & Token Economy
  // ==========================================================================
  describe('4. Lean JSON Schema Sanitization Guarantee & Token Economy', () => {
    let schema: FormSchema;

    beforeEach(() => {
      schema = scanDocument({
        target: '#form-enterprise',
        document,
      });
    });

    it('produces JSON with zero HTML markup or script tags', () => {
      const json = JSON.stringify(schema);
      expect(json).not.toMatch(/<div/i);
      expect(json).not.toMatch(/<span/i);
      expect(json).not.toMatch(/<input/i);
      expect(json).not.toMatch(/<label/i);
      expect(json).not.toMatch(/<form/i);
      expect(json).not.toMatch(/<button/i);
      expect(json).not.toMatch(/<script/i);
      expect(json).not.toMatch(/<\/?[a-z][a-z0-9]*[^<>]*>/i);
    });

    it('produces JSON with zero inline styles or CSS classes', () => {
      const json = JSON.stringify(schema);
      expect(json).not.toMatch(/style\s*=/i);
      expect(json).not.toMatch(/class\s*=/i);
      expect(json).not.toMatch(/display\s*:/i);
      expect(json).not.toMatch(/color\s*:/i);
      expect(json).not.toMatch(/background\s*:/i);
      expect(json).not.toMatch(/padding\s*:/i);
      expect(json).not.toMatch(/margin\s*:/i);
    });

    it('achieves substantial payload byte savings over raw HTML', () => {
      const rawHtml = document.getElementById('form-enterprise')!.outerHTML;
      const json = JSON.stringify(schema);
      expect(json.length).toBeLessThan(rawHtml.length * 0.7);
    });
  });

  // ==========================================================================
  // Suite 5: Transient DOM Stamping (data-formgen-id)
  // ==========================================================================
  describe('5. Transient DOM Stamping (data-formgen-id)', () => {
    let schema: FormSchema;

    beforeEach(() => {
      schema = scanDocument({
        target: '#form-enterprise',
        document,
      });
    });

    it('stamps data-formgen-id on all single-control DOM elements', () => {
      for (const field of schema.fields) {
        if (field.type === 'radio') continue;
        const stampedEl = document.querySelector(
          `[data-formgen-id="${field.formgenId}"]`
        );
        expect(stampedEl).not.toBeNull();
        expect(stampedEl?.getAttribute('name')).toBe(field.name);
      }
    });

    it('stamps all radio inputs in a group with the same data-formgen-id', () => {
      const radioField = schema.fields.find((f) => f.name === 'ent-contract')!;
      expect(radioField).toBeDefined();
      const stampedRadios = document.querySelectorAll(
        `input[type="radio"][data-formgen-id="${radioField.formgenId}"]`
      );
      expect(stampedRadios).toHaveLength(3);
      const values = Array.from(stampedRadios).map((r: any) => r.value);
      expect(values).toEqual(['clt', 'pj', 'estagio']);
    });

    it('guarantees unique formgenId identifiers across distinct fields', () => {
      const ids = schema.fields.map((f) => f.formgenId);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });

    it('remains idempotent on repeated scans', () => {
      const secondSchema = scanDocument({
        target: '#form-enterprise',
        document,
      });
      expect(secondSchema.fields).toHaveLength(11);
      const firstIds = schema.fields.map((f) => f.formgenId);
      const secondIds = secondSchema.fields.map((f) => f.formgenId);
      expect(secondIds).toEqual(firstIds);
    });
  });

  // ==========================================================================
  // Suite 6: Content Script Message Handler Integration (handleContentMessage)
  // ==========================================================================
  describe('6. Content Script Message Handler Integration', () => {
    it('returns PONG on PING action', async () => {
      const res = await handleContentMessage(
        { action: 'PING' },
        undefined,
        document
      );
      expect(res.success).toBe(true);
      expect((res as any).status).toBe('PONG');
    });

    it('executes SCAN_DOM and returns enterprise schema on target formId', async () => {
      const res = (await handleContentMessage(
        { action: 'SCAN_DOM', formId: 'form-enterprise' } as any,
        undefined,
        document
      )) as ScanDomResponse;
      expect(res.success).toBe(true);
      expect(res.schema).toBeDefined();
      expect(res.schema?.formId).toBe('form-enterprise');
      expect(res.schema?.fields).toHaveLength(11);
    });

    it('executes SCAN_DOM on form-edge-cases', async () => {
      const res = (await handleContentMessage(
        { action: 'SCAN_DOM', formId: 'form-edge-cases' } as any,
        undefined,
        document
      )) as ScanDomResponse;
      expect(res.success).toBe(true);
      expect(res.schema?.formId).toBe('form-edge-cases');
      expect(res.schema?.fields.length).toBeGreaterThan(0);
    });

    it('returns error when target form does not exist', async () => {
      const res = await handleContentMessage(
        { action: 'SCAN_DOM', formId: 'non-existent-form' } as any,
        undefined,
        document
      );
      expect(res.success).toBe(false);
      expect(res.error).toBeDefined();
    });

    it('returns error on invalid or unsupported action', async () => {
      const res = await handleContentMessage(
        { action: 'UNKNOWN_ACTION' } as any,
        undefined,
        document
      );
      expect(res.success).toBe(false);
      expect(res.error).toContain('não suportada');
    });
  });
});
