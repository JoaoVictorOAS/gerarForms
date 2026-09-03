/**
 * FormGen - Milestone 2 Adversarial Forensic Audit Suite
 * Stress-tests DOM Scanner against XSS injections, malformed DOM structures,
 * adversarial honeypots, token savings thresholds, and IPC edge cases.
 * Path: tests/unit/adversarial_scanner_audit.test.ts
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { JSDOM } from 'jsdom';
import {
  scanDocument,
  cleanupFormGenStamps,
  discoverFormBoundaries,
  resolveFieldLabel,
  isHoneypot,
  isElementVisibleAndFillable,
  extractValidationRules,
  extractSelectOptions,
  normalizeLabelText,
  sanitizeText,
} from '../../src/content/scanner';
import { handleContentMessage } from '../../src/content/index';
import { FormSchema, ScanDomResponse } from '../../src/shared/types';

describe('Forensic Audit: Milestone 2 Adversarial Stress Testing', () => {
  let dom: JSDOM;
  let document: Document;
  let window: any;

  beforeEach(() => {
    dom = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>', {
      url: 'http://localhost:3000/adversarial.html',
    });
    window = dom.window;
    document = window.document;

    globalThis.window = window as any;
    globalThis.document = document as any;
    globalThis.HTMLElement = window.HTMLElement;
    globalThis.HTMLInputElement = window.HTMLInputElement;
    globalThis.HTMLSelectElement = window.HTMLSelectElement;
    globalThis.HTMLTextAreaElement = window.HTMLTextAreaElement;
    globalThis.Node = window.Node;
  });

  // ==========================================================================
  // 1. Hostile HTML / Script / Style Injection Attacks (Zero-Leakage Assurance)
  // ==========================================================================
  describe('1. Hostile HTML / Script / Style Injection Attacks', () => {
    it('sanitizes malicious script tags and inline handlers in labels and placeholders', () => {
      document.body.innerHTML = `
        <form id="hostile-form">
          <div class="form-group">
            <label for="malicious-input">
              <script>alert("PWNED")</script>
              <b>Nome</b> <i>Completo</i> * (obrigatório):
            </label>
            <input
              type="text"
              id="malicious-input"
              name="userName"
              placeholder="Insira seu nome..."
              title="Pattern info"
              pattern="[A-Za-z]+"
            >
          </div>
        </form>
      `;

      const schema = scanDocument({ target: '#hostile-form', document });
      expect(schema.fields).toHaveLength(1);
      const field = schema.fields[0]!;

      // Label must be clean text without script tags, markup or required tag
      expect(field.label).not.toContain('<script>');
      expect(field.label).not.toContain('alert');
      expect(field.label).not.toContain('<b>');
      expect(field.label).not.toContain('(obrigatório)');
      expect(field.label).toBe('Nome Completo');

      // Entire JSON payload check: zero HTML markup
      const json = JSON.stringify(schema);
      expect(json).not.toMatch(/<script>/i);
      expect(json).not.toMatch(/<b/i);
      expect(json).not.toMatch(/<i/i);
      expect(json).not.toMatch(/<\/?[a-z][a-z0-9]*[^<>]*>/i);
    });

    it('sanitizes malicious select options containing HTML and styles', () => {
      document.body.innerHTML = `
        <form id="select-injection-form">
          <select id="infected-select" name="role">
            <option value="">-- Selecione seu cargo --</option>
            <option value="admin"><span>Administrador <strong>Master</strong></span></option>
            <option value="guest">Convidado</option>
          </select>
        </form>
      `;

      const schema = scanDocument({ target: '#select-injection-form', document });
      expect(schema.fields).toHaveLength(1);
      const field = schema.fields[0]!;

      expect(field.options).toHaveLength(2); // Empty placeholder excluded
      expect(field.options![0]!.label).toBe('Administrador Master');
      expect(field.options![0]!.value).toBe('admin');
      expect(field.options![1]!.value).toBe('guest');
      expect(field.options![1]!.label).toBe('Convidado');

      const json = JSON.stringify(schema);
      expect(json).not.toContain('<span');
      expect(json).not.toContain('<strong');
      expect(json).not.toMatch(/<\/?[a-z][a-z0-9]*[^<>]*>/i);
    });
  });

  // ==========================================================================
  // 2. Adversarial Anti-Bot Honeypot Variants
  // ==========================================================================
  describe('2. Adversarial Anti-Bot Honeypot Variants', () => {
    it('detects and filters out deeply nested and obscure honeypots', () => {
      document.body.innerHTML = `
        <form id="honeypot-test-form">
          <!-- Genuine input -->
          <label for="real-email">Email</label>
          <input type="email" id="real-email" name="email" required>

          <!-- Trap A: Parent has display: none -->
          <div style="display: none;">
            <label for="trap-a">Hidden Trap A</label>
            <input type="text" id="trap-a" name="trap_hidden_parent">
          </div>

          <!-- Trap B: Ancestor has aria-hidden="true" -->
          <div aria-hidden="true">
            <div>
              <input type="text" id="trap-b" name="secondary_email">
            </div>
          </div>

          <!-- Trap C: Negative tabindex + keyword in name -->
          <input type="text" id="trap-c" name="website_url_honeypot" tabindex="-1">

          <!-- Trap D: Honeypot CSS class marker on wrapper -->
          <div class="visually-hidden-honeypot">
            <input type="text" id="trap-d" name="security_verify">
          </div>

          <!-- Trap E: Offscreen positioning -->
          <input type="text" id="trap-e" name="address_confirm" style="position: absolute; left: -9999px;">

          <!-- Trap F: Zero dimension and 0 opacity -->
          <input type="text" id="trap-f" name="phone_confirm" style="width: 0px; height: 0px; opacity: 0;">
        </form>
      `;

      const schema = scanDocument({ target: '#honeypot-test-form', document });
      expect(schema.fields).toHaveLength(1);
      expect(schema.fields[0]!.name).toBe('email');
    });
  });

  // ==========================================================================
  // 3. Fallback Hierarchy & Extreme Boundary Testing in 7-Tier Cascade
  // ==========================================================================
  describe('3. Fallback Hierarchy & Extreme Boundary Testing in 7-Tier Cascade', () => {
    it('falls back seamlessly when higher tiers provide empty or broken references', () => {
      document.body.innerHTML = `
        <form id="cascade-fallback-form">
          <!-- Empty explicit label -> falls back to placeholder -->
          <label for="empty-label"></label>
          <input type="text" id="empty-label" name="address" placeholder="Rua e Número">

          <!-- Broken aria-labelledby with non-existent ID -> falls back to title -->
          <input type="text" id="broken-aria" name="neighborhood" aria-labelledby="ghost-id-1 ghost-id-2" title="Bairro de Residência">

          <!-- Whitespace-only aria-label -> falls back to normalized name -->
          <input type="text" id="whitespace-aria" name="user_zip_code" aria-label="   ">

          <!-- No label, no placeholder, no title, no name -> falls back to normalized ID -->
          <input type="text" id="customer-phone-primary">

          <!-- Completely anonymous input with nothing -> Tier 0 fallback -->
          <input type="text">
        </form>
      `;

      const schema = scanDocument({ target: '#cascade-fallback-form', document });
      expect(schema.fields).toHaveLength(5);

      expect(schema.fields[0]!.label).toBe('Rua e Número'); // Tier 7 placeholder
      expect(schema.fields[1]!.label).toBe('Bairro de Residência'); // Tier 7 title
      expect(schema.fields[2]!.label).toBe('User Zip Code'); // Tier 7 normalized name
      expect(schema.fields[3]!.label).toBe('Customer Phone Primary'); // Tier 7 normalized ID
      expect(schema.fields[4]!.label).toBe('Campo Sem Rótulo'); // Tier 0 fallback
    });

    it('correctly handles compound labels with SVG icons, buttons, and sub-elements in wrapping label', () => {
      document.body.innerHTML = `
        <form id="wrapping-test-form">
          <label>
            <svg><path d="M0 0"></path></svg>
            <span>Número do Documento</span>
            <button type="button">Ajuda</button>
            <input type="text" id="doc-number" name="docNumber">
          </label>
        </form>
      `;

      const schema = scanDocument({ target: '#wrapping-test-form', document });
      expect(schema.fields).toHaveLength(1);
      expect(schema.fields[0]!.label).toBe('Número do Documento');
    });
  });

  // ==========================================================================
  // 4. HTML5 Form External Associated Controls (HTML5 form="id")
  // ==========================================================================
  describe('4. HTML5 External Controls via form="id"', () => {
    it('captures controls located outside the form container linked via form="formId"', () => {
      document.body.innerHTML = `
        <form id="split-form">
          <label for="in-1">Dentro do Form</label>
          <input type="text" id="in-1" name="fieldInside">
        </form>

        <div class="external-container">
          <label for="out-1">Fora do Form (Ligado por form="split-form")</label>
          <input type="text" id="out-1" name="fieldOutside" form="split-form" required>
        </div>
      `;

      const schema = scanDocument({ target: '#split-form', document });
      expect(schema.fields).toHaveLength(2);
      expect(schema.fields.map((f) => f.name)).toEqual(['fieldInside', 'fieldOutside']);
      expect(schema.fields.find((f) => f.name === 'fieldOutside')?.required).toBe(true);
    });
  });

  // ==========================================================================
  // 5. Idempotency & DOM Stamping Integrity
  // ==========================================================================
  describe('5. Idempotency & DOM Stamping Integrity', () => {
    it('performs repeated idempotent scans without multiplying stamps or leaking state', () => {
      document.body.innerHTML = `
        <form id="idempotent-form">
          <label for="f-1">Campo 1</label>
          <input type="text" id="f-1" name="field1">
          <label for="f-2">Campo 2</label>
          <input type="text" id="f-2" name="field2">
        </form>
      `;

      const scan1 = scanDocument({ target: '#idempotent-form', document });
      const stampsAfterScan1 = document.querySelectorAll('[data-formgen-id]');
      expect(stampsAfterScan1).toHaveLength(2);

      const scan2 = scanDocument({ target: '#idempotent-form', document });
      const stampsAfterScan2 = document.querySelectorAll('[data-formgen-id]');
      expect(stampsAfterScan2).toHaveLength(2);

      // Verify stamps match
      expect(scan1.fields.map((f) => f.formgenId)).toEqual(
        scan2.fields.map((f) => f.formgenId)
      );

      // Test manual cleanup
      cleanupFormGenStamps(document);
      const stampsAfterCleanup = document.querySelectorAll('[data-formgen-id]');
      expect(stampsAfterCleanup).toHaveLength(0);
    });
  });

  // ==========================================================================
  // 6. Content Script Runtime IPC Edge Cases
  // ==========================================================================
  describe('6. Content Script Runtime IPC Edge Cases', () => {
    it('handles null and invalid messages gracefully without unhandled exceptions', async () => {
      const resNull = await handleContentMessage(null as any);
      expect(resNull.success).toBe(false);

      const resEmpty = await handleContentMessage({} as any);
      expect(resEmpty.success).toBe(false);

      const resBogus = await handleContentMessage({ action: 'BOGUS' } as any);
      expect(resBogus.success).toBe(false);
      expect(resBogus.error).toContain('não suportada');
    });

    it('returns structured error when target selector is invalid syntax', async () => {
      const res = (await handleContentMessage(
        { action: 'SCAN_DOM', formSelector: ':::invalid::selector::' } as any,
        undefined,
        document
      )) as ScanDomResponse;

      expect(res.success).toBe(false);
      expect(res.error).toBeDefined();
    });
  });
});
