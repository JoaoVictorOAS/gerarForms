/**
 * FormGen DOM Scanner Engine
 * Inspects DOM forms, resolves labels via 7-tier cascade, extracts constraints,
 * groups radio buttons, filters honeypots, stamps transient data-formgen-id,
 * and produces a token-efficient, sanitized Lean FormSchema.
 * Path: src/content/scanner.ts
 */

import {
  FormSchema,
  FormField,
  FormFieldType,
  FieldOption,
  ValidationRules,
} from '../shared/types';

/**
 * Scan configuration options.
 */
export interface ScanOptions {
  /**
   * Target container: CSS selector string (e.g. '#form-enterprise')
   * or direct HTMLElement reference. Defaults to auto-discovery.
   */
  target?: string | HTMLElement;

  /**
   * Root document (defaults to global document).
   */
  document?: Document;

  /**
   * Optional URL override.
   */
  url?: string;

  /**
   * Optional page title override.
   */
  title?: string;
}

/**
 * Result of resolving an element's label via the 7-tier cascade.
 */
export interface ResolvedLabel {
  tier: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
  text: string;
  source?:
    | 'label_for'
    | 'wrapping_label'
    | 'aria_labelledby'
    | 'aria_label'
    | 'fieldset_legend'
    | 'sibling'
    | 'placeholder'
    | 'title'
    | 'name'
    | 'id'
    | 'fallback';
}

/**
 * Type of form boundary discovered in the DOM.
 */
export type FormBoundaryType = 'form_element' | 'orphan_cluster';

/**
 * Discovered form candidate container with associated fillable controls.
 */
export interface FormBoundaryCandidate {
  id: string;
  container: HTMLElement;
  type: FormBoundaryType;
  fillableElements: HTMLElement[];
  score: number;
  selector?: string;
}

// ============================================================================
// 1. Text Sanitization & Normalization Helpers
// ============================================================================

/**
 * Strips raw HTML markup, inline tags, scripts, and extra whitespace from text.
 * Guarantees zero HTML or style code leaks into the schema.
 */
export function sanitizeText(str: string | null | undefined): string {
  if (!str || typeof str !== 'string') return '';
  return str
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Normalizes raw label text extracted from the DOM.
 * Strips required/optional tags, punctuation, asterisks, and collapses whitespace.
 */
export function normalizeLabelText(raw: string | null | undefined): string {
  if (!raw || typeof raw !== 'string') return '';

  let text = raw;

  // 1. Strip raw HTML tags first
  text = text.replace(/<[^>]*>/g, ' ');

  // 2. Replace newlines, carriage returns, and tabs with spaces
  text = text.replace(/[\r\n\t]+/g, ' ');

  // 3. Strip required/optional textual flags (case-insensitive, localized)
  text = text.replace(/\s*\*+\s*/g, ' ');
  text = text.replace(/\s*\((?:obrigat[oó]rio|required|opcional|optional)\)\s*/gi, ' ');
  text = text.replace(/[*★✦]/g, '');

  // 4. Strip trailing punctuation: colons (ASCII & full-width), dashes, underscores
  text = text.replace(/[:：\-_–—]\s*$/g, '');

  // 5. Collapse multiple consecutive spaces and trim
  text = text.replace(/\s+/g, ' ').trim();

  // 6. Length clamp (clamp at 120 characters to prevent dumping giant disclaimers)
  if (text.length > 120) {
    text = text.substring(0, 120).trim();
  }

  return text;
}

/**
 * Converts camelCase, snake_case, or kebab-case identifiers to Title Case text.
 */
export function normalizeIdentifier(identifier: string | null | undefined): string {
  if (!identifier || typeof identifier !== 'string') return '';

  return identifier
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[-_.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

// ============================================================================
// 2. Honeypot & Fillable Input Filtering
// ============================================================================

/**
 * Checks whether an element is an anti-bot honeypot or invisible trap.
 */
export function isHoneypot(el: HTMLElement): boolean {
  if (!el || el.nodeType !== 1) return true;

  // 1. Explicit HTML hidden attribute or aria-hidden
  if (el.hasAttribute('hidden') || el.getAttribute('aria-hidden') === 'true') {
    return true;
  }
  if (Boolean(el.closest('[hidden], [aria-hidden="true"]'))) {
    return true;
  }

  // 2. Class-based honeypot detection
  if (
    Boolean(
      el.closest(
        '.visually-hidden-honeypot, .honeypot, .antispam, [class*="honeypot"]'
      )
    )
  ) {
    return true;
  }

  // 3. Negative tabindex combined with suspicious field names
  const tabIndex = el.getAttribute('tabindex');
  const name = ((el as HTMLInputElement).name || '').toLowerCase();
  const id = (el.id || '').toLowerCase();
  if (
    tabIndex === '-1' &&
    (name.includes('trap') ||
      name.includes('url') ||
      name.includes('honeypot') ||
      id.includes('trap') ||
      id.includes('honeypot'))
  ) {
    return true;
  }

  // 4. Computed style checks (safe for both browser and JSDOM)
  const win =
    el.ownerDocument?.defaultView ||
    (typeof window !== 'undefined' ? window : undefined);

  if (win && typeof win.getComputedStyle === 'function') {
    const style = win.getComputedStyle(el);

    if (
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      style.visibility === 'collapse'
    ) {
      return true;
    }

    if (style.opacity !== '' && parseFloat(style.opacity) === 0) {
      return true;
    }

    // CSS offscreen positioning
    if (style.position === 'absolute' || style.position === 'fixed') {
      const left = parseFloat(style.left);
      const top = parseFloat(style.top);
      if (!isNaN(left) && left < -500) return true;
      if (!isNaN(top) && top < -500) return true;
    }

    // Explicit CSS zero dimensions
    if (style.width === '0px' && style.height === '0px') {
      return true;
    }

    // Check ancestor visibility in computed style
    let parent = el.parentElement;
    while (parent && parent !== el.ownerDocument?.body) {
      const pStyle = win.getComputedStyle(parent);
      if (pStyle.display === 'none' || pStyle.visibility === 'hidden') {
        return true;
      }
      parent = parent.parentElement;
    }
  }

  // 5. Layout geometry check (active only when browser layout engine is present)
  if (typeof el.getBoundingClientRect === 'function') {
    const rect = el.getBoundingClientRect();
    const hasLayout =
      rect.width > 0 || rect.height > 0 || rect.left !== 0 || rect.top !== 0;

    if (hasLayout) {
      if (rect.width === 0 && rect.height === 0) {
        return true;
      }
      if (rect.left < -500 || rect.top < -500) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Validates whether an element is visually rendered and fillable by FormGen.
 */
export function isElementVisibleAndFillable(el: HTMLElement): boolean {
  if (!el || el.nodeType !== 1) return false;

  const tag = el.tagName.toLowerCase();
  if (!['input', 'select', 'textarea'].includes(tag)) {
    return false;
  }

  // Exclude non-fillable input types
  if (tag === 'input') {
    const type = ((el as HTMLInputElement).type || 'text').toLowerCase();
    const nonFillableTypes = [
      'hidden',
      'file',
      'submit',
      'reset',
      'button',
      'image',
    ];
    if (nonFillableTypes.includes(type)) {
      return false;
    }
  }

  // Exclude disabled controls
  const inputOrSelect = el as
    | HTMLInputElement
    | HTMLSelectElement
    | HTMLTextAreaElement;

  if (inputOrSelect.disabled || el.hasAttribute('disabled')) {
    return false;
  }

  // Exclude readonly controls (user cannot fill)
  if ('readOnly' in inputOrSelect && inputOrSelect.readOnly) {
    return false;
  }
  if (el.hasAttribute('readonly')) {
    return false;
  }

  // Exclude honeypots and invisible traps
  if (isHoneypot(el)) {
    return false;
  }

  return true;
}

// ============================================================================
// 3. The 7-Tier Label Resolution Cascade
// ============================================================================

/**
 * Cleans a label DOM node by stripping inner form controls and buttons before reading text.
 */
function extractCleanTextFromLabel(labelEl: HTMLElement): string {
  const clone = labelEl.cloneNode(true) as HTMLElement;
  const unwanted = clone.querySelectorAll(
    'input, select, textarea, button, svg, script, style'
  );
  unwanted.forEach((c) => c.remove());
  return normalizeLabelText(clone.textContent);
}

/**
 * Executes the deterministic 7-tier label resolution cascade.
 *
 * Tier 1: Explicit label[for="id"]
 * Tier 2: Wrapping parent <label>
 * Tier 3: aria-labelledby attribute (split space-separated IDs)
 * Tier 4: aria-label attribute
 * Tier 5: Ancestor <fieldset><legend>
 * Tier 6: Proximity preceding sibling / .form-group label
 * Tier 7: Attribute fallbacks (placeholder -> title -> normalized name -> normalized id)
 */
export function resolveFieldLabel(el: HTMLElement): ResolvedLabel {
  const doc = el.ownerDocument || document;

  // --- Tier 1: Explicit label[for="id"] ---
  if (el.id) {
    try {
      const escapedId =
        typeof CSS !== 'undefined' && CSS.escape
          ? CSS.escape(el.id)
          : el.id.replace(/(["\\])/g, '\\$1');

      let label = doc.querySelector(`label[for="${escapedId}"]`) as HTMLElement;

      if (!label) {
        const labels = doc.getElementsByTagName('label');
        for (let i = 0; i < labels.length; i++) {
          const item = labels.item(i);
          if (item && item.htmlFor === el.id) {
            label = item;
            break;
          }
        }
      }

      if (label) {
        const text = extractCleanTextFromLabel(label);
        if (text) {
          return { tier: 1, text, source: 'label_for' };
        }
      }
    } catch {
      // Fallback if selector fails
    }
  }

  // --- Tier 2: Wrapping <label> ---
  const wrappingLabel = el.closest('label');
  if (wrappingLabel) {
    const text = extractCleanTextFromLabel(wrappingLabel);
    if (text) {
      return { tier: 2, text, source: 'wrapping_label' };
    }
  }

  // --- Tier 3: aria-labelledby ---
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const ids = labelledBy.trim().split(/\s+/);
    const textParts = ids
      .map((refId) => {
        const ref = doc.getElementById(refId);
        return ref ? normalizeLabelText(ref.textContent) : '';
      })
      .filter(Boolean);

    if (textParts.length > 0) {
      return { tier: 3, text: textParts.join(' '), source: 'aria_labelledby' };
    }
  }

  // --- Tier 4: aria-label ---
  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel) {
    const text = normalizeLabelText(ariaLabel);
    if (text) {
      return { tier: 4, text, source: 'aria_label' };
    }
  }

  // --- Tier 5: Ancestor <fieldset><legend> ---
  const fieldset = el.closest('fieldset');
  if (fieldset) {
    const legend = fieldset.querySelector('legend');
    if (legend) {
      const text = normalizeLabelText(legend.textContent);
      if (text) {
        return { tier: 5, text, source: 'fieldset_legend' };
      }
    }
  }

  // --- Tier 6: Proximity Sibling / .form-group Label ---
  // A. Check previous element siblings
  let sibling = el.previousElementSibling;
  while (sibling) {
    const tag = sibling.tagName.toLowerCase();
    if (['label', 'span', 'p', 'div', 'strong', 'b'].includes(tag)) {
      const text = normalizeLabelText(sibling.textContent);
      if (text) {
        return { tier: 6, text, source: 'sibling' };
      }
    }
    sibling = sibling.previousElementSibling;
  }

  // B. Check parent group container (.form-group, .form-row, .field)
  const group =
    (el.closest(
      '.form-group, .form-row, .field, .input-group, [class*="group"]'
    ) as HTMLElement) || el.parentElement;

  if (group && group !== doc.body) {
    const candidates = group.querySelectorAll(
      'label, span, .label, [class*="label"]'
    );
    for (const candidate of Array.from(candidates)) {
      if (candidate !== el && !candidate.contains(el)) {
        // Must appear before el in DOM order
        if (
          candidate.compareDocumentPosition(el) & 4 /* Node.DOCUMENT_POSITION_FOLLOWING */
        ) {
          const text = normalizeLabelText(candidate.textContent);
          if (text) {
            return { tier: 6, text, source: 'sibling' };
          }
        }
      }
    }
  }

  // --- Tier 7: Attribute Fallbacks ---
  const placeholder = el.getAttribute('placeholder');
  if (placeholder) {
    const text = normalizeLabelText(placeholder);
    if (text) {
      return { tier: 7, text, source: 'placeholder' };
    }
  }

  const title = el.getAttribute('title');
  if (title) {
    const text = normalizeLabelText(title);
    if (text) {
      return { tier: 7, text, source: 'title' };
    }
  }

  const nameAttr = el.getAttribute('name');
  if (nameAttr) {
    return { tier: 7, text: normalizeIdentifier(nameAttr), source: 'name' };
  }

  if (el.id) {
    return { tier: 7, text: normalizeIdentifier(el.id), source: 'id' };
  }

  // --- Fallback (Tier 0) ---
  return { tier: 0, text: 'Campo Sem Rótulo', source: 'fallback' };
}

// ============================================================================
// 4. Constraints, Select Options & Radio Group Aggregation
// ============================================================================

/**
 * Maps an element to its normalized FormFieldType.
 */
function resolveFieldType(el: HTMLElement): FormFieldType {
  const tag = el.tagName.toLowerCase();
  if (tag === 'textarea') return 'textarea';
  if (tag === 'select') return 'select';

  const type = ((el as HTMLInputElement).type || 'text').toLowerCase();
  const supportedTypes: FormFieldType[] = [
    'text',
    'email',
    'number',
    'password',
    'tel',
    'url',
    'date',
    'time',
    'datetime-local',
    'select',
    'radio',
    'checkbox',
    'textarea',
  ];

  if (supportedTypes.includes(type as FormFieldType)) {
    return type as FormFieldType;
  }

  return 'text';
}

/**
 * Extracts and sanitizes HTML5 and semantic validation constraints from a DOM control.
 */
export function extractValidationRules(
  el: HTMLElement,
  type: FormFieldType
): ValidationRules | undefined {
  const rules: ValidationRules = {};

  // 1. Required constraint
  const isRequired = Boolean(
    (el as HTMLInputElement).required ||
      el.hasAttribute('required') ||
      el.getAttribute('aria-required') === 'true'
  );
  if (isRequired) {
    rules.required = true;
  }

  // 2. Pattern and Pattern Description (textual inputs)
  if (['text', 'tel', 'email', 'password', 'url'].includes(type)) {
    if (el.hasAttribute('pattern')) {
      const p = el.getAttribute('pattern');
      if (p) rules.pattern = p;

      const title = el.getAttribute('title');
      if (title && title.trim()) {
        rules.patternDescription = sanitizeText(title);
      }
    }
  }

  // 3. Min / Max / Step constraints
  if (['number'].includes(type)) {
    if (el.hasAttribute('min')) {
      const v = parseFloat(el.getAttribute('min')!);
      if (!isNaN(v)) rules.min = v;
    }
    if (el.hasAttribute('max')) {
      const v = parseFloat(el.getAttribute('max')!);
      if (!isNaN(v)) rules.max = v;
    }
    if (el.hasAttribute('step')) {
      const s = el.getAttribute('step')!;
      if (s.toLowerCase() === 'any') {
        rules.step = 'any';
      } else {
        const v = parseFloat(s);
        rules.step = !isNaN(v) ? v : s;
      }
    }
  } else if (
    ['date', 'time', 'datetime-local', 'month', 'week'].includes(type)
  ) {
    if (el.hasAttribute('min')) rules.min = el.getAttribute('min')!;
    if (el.hasAttribute('max')) rules.max = el.getAttribute('max')!;
    if (el.hasAttribute('step')) rules.step = el.getAttribute('step')!;
  }

  // 4. MinLength and MaxLength constraints
  if (
    ['text', 'tel', 'email', 'password', 'url', 'textarea'].includes(type)
  ) {
    if (el.hasAttribute('minlength')) {
      const v = parseInt(el.getAttribute('minlength')!, 10);
      if (!isNaN(v) && v >= 0) rules.minLength = v;
    }
    if (el.hasAttribute('maxlength')) {
      const v = parseInt(el.getAttribute('maxlength')!, 10);
      if (!isNaN(v) && v >= 0) rules.maxLength = v;
    }
  }

  // 5. Autocomplete semantic hint
  if (el.hasAttribute('autocomplete')) {
    const ac = el.getAttribute('autocomplete')!.trim();
    if (ac && ac !== 'off' && ac !== 'on') {
      rules.autocomplete = sanitizeText(ac);
    }
  }

  // 6. InputMode virtual keyboard hint
  if (el.hasAttribute('inputmode')) {
    const im = el.getAttribute('inputmode')!.trim();
    if (im) {
      rules.inputMode = sanitizeText(im);
    }
  }

  return Object.keys(rules).length > 0 ? rules : undefined;
}

/**
 * Extracts selectable options from `<select>` elements, pruning empty placeholders.
 */
export function extractSelectOptions(select: HTMLSelectElement): FieldOption[] {
  const options: FieldOption[] = [];

  for (const opt of Array.from(select.options)) {
    // Exclude disabled options
    if (opt.disabled || opt.hasAttribute('disabled')) {
      continue;
    }

    const rawVal = opt.value !== undefined ? opt.value.trim() : '';
    const rawText = (opt.textContent || opt.label || '').trim();

    // Exclude empty / placeholder options
    if (rawVal === '') {
      continue;
    }
    if (
      /^(selecione|escolha|select|choose|--|\s*$)/i.test(rawText) &&
      rawVal === ''
    ) {
      continue;
    }

    options.push({
      value: sanitizeText(rawVal),
      label: normalizeLabelText(rawText) || sanitizeText(rawVal),
    });
  }

  return options;
}

/**
 * Removes all transient data-formgen-id attributes from the given DOM root.
 */
export function cleanupFormGenStamps(
  root: HTMLElement | Document = document
): void {
  const stamped = root.querySelectorAll('[data-formgen-id]');
  for (let i = 0; i < stamped.length; i++) {
    const el = stamped[i];
    if (el) el.removeAttribute('data-formgen-id');
  }
}

// ============================================================================
// 5. Form Boundary Discovery
// ============================================================================

/**
 * Discovers all active form containers and orphan input clusters.
 */
export function discoverFormBoundaries(
  root: Document | HTMLElement = document,
  activeTarget?: HTMLElement | string
): FormBoundaryCandidate[] {
  const doc = root.ownerDocument || (root as Document);
  const candidates: FormBoundaryCandidate[] = [];
  const assignedElements = new Set<HTMLElement>();

  // 1. Discover all HTML <form> elements
  const forms = Array.from(root.querySelectorAll('form')) as HTMLFormElement[];
  for (const form of forms) {
    const candidateControls: HTMLElement[] = Array.from(
      form.querySelectorAll('input, select, textarea')
    );

    // HTML5 form attribute association: query elements outside <form> referencing form.id
    if (form.id) {
      try {
        const escapedId =
          typeof CSS !== 'undefined' && CSS.escape
            ? CSS.escape(form.id)
            : form.id.replace(/(["\\])/g, '\\$1');
        const externalControls = doc.querySelectorAll(
          `input[form="${escapedId}"], select[form="${escapedId}"], textarea[form="${escapedId}"]`
        );
        Array.from(externalControls).forEach((el) =>
          candidateControls.push(el as HTMLElement)
        );
      } catch {
        // Fallback if selector fails
      }
    }

    // Deduplicate and filter fillable controls
    const uniqueControls = Array.from(new Set(candidateControls));
    const fillable = uniqueControls.filter(isElementVisibleAndFillable);

    if (fillable.length > 0) {
      fillable.forEach((el) => assignedElements.add(el));

      // Heuristic Scoring
      let score = fillable.length * 10;
      if (form.querySelector('button[type="submit"], input[type="submit"]')) {
        score += 25;
      }
      if (form.querySelector('input[type="email"], input[type="password"]')) {
        score += 15;
      }
      const identifier = `${form.id} ${form.name} ${form.className}`.toLowerCase();
      if (
        /cadastro|registro|signup|signin|login|checkout|contact|formulario|employee|enterprise/.test(
          identifier
        )
      ) {
        score += 30;
      }
      const isPeripheral = Boolean(form.closest('header, footer, nav'));
      if (isPeripheral && fillable.length <= 2) {
        score -= 50;
      }
      if (
        form.querySelector(
          'input[type="search"], input[name="q"], input[name="search"]'
        )
      ) {
        score -= 30;
      }

      candidates.push({
        id: form.id || `form_${candidates.length}`,
        container: form,
        type: 'form_element',
        fillableElements: fillable,
        score,
        selector: form.id ? `#${form.id}` : undefined,
      });
    }
  }

  // 2. Discover Orphan Form Controls (SPAs without <form> tag)
  const allControls = Array.from(
    root.querySelectorAll('input, select, textarea')
  ) as HTMLElement[];
  const orphanControls = allControls
    .filter((el) => !assignedElements.has(el))
    .filter(isElementVisibleAndFillable);

  if (orphanControls.length > 0) {
    const clusters = new Map<HTMLElement, HTMLElement[]>();

    for (const orphan of orphanControls) {
      const container =
        (orphan.closest(
          '[role="form"], [data-form], main, dialog, section, article, .card, .form-container, [class*="form"]'
        ) as HTMLElement) || doc.body;

      if (!clusters.has(container)) {
        clusters.set(container, []);
      }
      clusters.get(container)!.push(orphan);
    }

    for (const [container, inputs] of clusters.entries()) {
      let score = inputs.length * 8;
      if (container.getAttribute('role') === 'form') score += 20;

      candidates.push({
        id: container.id
          ? `orphan_${container.id}`
          : `orphan_cluster_${candidates.length}`,
        container,
        type: 'orphan_cluster',
        fillableElements: inputs,
        score,
        selector: container.id ? `#${container.id}` : undefined,
      });
    }
  }

  // Sort descending by score
  candidates.sort((a, b) => b.score - a.score);

  // If activeTarget was requested, prioritize matching candidate
  if (activeTarget) {
    const targetEl =
      typeof activeTarget === 'string'
        ? doc.getElementById(activeTarget.replace(/^#/, '')) ||
          doc.querySelector(activeTarget)
        : activeTarget;

    if (targetEl) {
      const targetIndex = candidates.findIndex(
        (c) =>
          c.container === targetEl ||
          c.id === activeTarget ||
          c.container.contains(targetEl)
      );
      if (targetIndex > 0) {
        const [matched] = candidates.splice(targetIndex, 1);
        if (matched) {
          candidates.unshift(matched);
        }
      }
    }
  }

  return candidates;
}

// ============================================================================
// 6. Lean Schema Generation & Stamping Engine
// ============================================================================

/**
 * Inspects a form or page and extracts a strict, token-efficient Lean FormSchema.
 */
export function scanDocument(options: ScanOptions = {}): FormSchema {
  const doc = options.document || (typeof document !== 'undefined' ? document : undefined);
  if (!doc) {
    throw new Error('Documento não disponível para escaneamento.');
  }

  // 1. Resolve target container element
  let container: HTMLElement | null = null;

  if (options.target) {
    if (typeof options.target === 'string') {
      const sel = options.target;
      container = (doc.getElementById(sel.replace(/^#/, '')) ||
        doc.querySelector(sel)) as HTMLElement;
      if (!container) {
        throw new Error(`Formulário não encontrado para o seletor: ${sel}`);
      }
    } else {
      container = options.target;
    }
  } else {
    // Auto-discovery
    const candidates = discoverFormBoundaries(doc);
    if (candidates.length > 0 && candidates[0]) {
      container = candidates[0].container;
    } else {
      throw new Error('Nenhum formulário detectável encontrado na página.');
    }
  }

  // 2. Clean up previous FormGen transient stamps
  cleanupFormGenStamps(doc);

  // 3. Collect fillable controls within container
  let rawControls: HTMLElement[] = [];
  const tag = container.tagName.toLowerCase();

  if (['input', 'select', 'textarea'].includes(tag)) {
    rawControls = [container];
  } else {
    rawControls = Array.from(
      container.querySelectorAll('input, select, textarea')
    ) as HTMLElement[];

    // HTML5 form="id" association if container is a <form> with an id
    if (container.id && tag === 'form') {
      try {
        const escapedId =
          typeof CSS !== 'undefined' && CSS.escape
            ? CSS.escape(container.id)
            : container.id.replace(/(["\\])/g, '\\$1');
        const external = doc.querySelectorAll(
          `input[form="${escapedId}"], select[form="${escapedId}"], textarea[form="${escapedId}"]`
        );
        Array.from(external).forEach((el) =>
          rawControls.push(el as HTMLElement)
        );
      } catch {
        // Fallback
      }
    }
  }

  // Deduplicate and filter fillable controls
  const uniqueControls = Array.from(new Set(rawControls));
  const fillableElements = uniqueControls.filter(isElementVisibleAndFillable);

  // 4. Pre-process Radio Groups and Multi-Checkbox Counts
  const radioGroups = new Map<string, HTMLInputElement[]>();
  const checkboxCounts = new Map<string, number>();

  for (const el of fillableElements) {
    const elTag = el.tagName.toLowerCase();
    if (elTag === 'input') {
      const input = el as HTMLInputElement;
      const type = (input.type || 'text').toLowerCase();

      if (type === 'radio') {
        const groupKey = input.name || input.id || 'unnamed_radio';
        if (!radioGroups.has(groupKey)) {
          radioGroups.set(groupKey, []);
        }
        radioGroups.get(groupKey)!.push(input);
      } else if (type === 'checkbox') {
        const cbName = (input.name || input.id || 'unnamed_checkbox').replace(
          /\[\]$/,
          ''
        );
        checkboxCounts.set(cbName, (checkboxCounts.get(cbName) || 0) + 1);
      }
    }
  }

  // 5. Build FormFields in DOM document order and stamp transient IDs
  const fields: FormField[] = [];
  const processedRadioGroups = new Set<string>();
  let stampCounter = 0;

  for (const el of fillableElements) {
    const elTag = el.tagName.toLowerCase();
    const inputType =
      elTag === 'input'
        ? ((el as HTMLInputElement).type || 'text').toLowerCase()
        : elTag;

    // --- RADIO BUTTON GROUP PROCESSING ---
    if (inputType === 'radio') {
      const input = el as HTMLInputElement;
      const groupKey = input.name || input.id || 'unnamed_radio';

      // Only process the group once, on first encounter
      if (processedRadioGroups.has(groupKey)) {
        continue;
      }
      processedRadioGroups.add(groupKey);

      const groupRadios = radioGroups.get(groupKey) || [input];
      const formgenId = `fg_${stampCounter++}`;

      // Stamp all radio elements in group with the SAME formgenId
      groupRadios.forEach((r) => r.setAttribute('data-formgen-id', formgenId));

      // Resolve group label: Prioritize ancestor fieldset legend
      let groupLabel = '';
      const fieldset = input.closest('fieldset');
      if (fieldset) {
        const legend = fieldset.querySelector('legend');
        if (legend && legend.textContent?.trim()) {
          groupLabel = normalizeLabelText(legend.textContent);
        }
      }
      if (!groupLabel) {
        groupLabel = resolveFieldLabel(input).text;
      }

      // Check if group is required or has default value
      let isRequired = false;
      let defaultValue: string | undefined = undefined;
      const options: FieldOption[] = [];

      for (const r of groupRadios) {
        if (r.required || r.hasAttribute('required')) {
          isRequired = true;
        }
        if (r.checked) {
          defaultValue = sanitizeText(r.value);
        }

        // Resolve individual option label
        let optLabel = '';
        const parentLabel = r.closest('label');
        if (parentLabel) {
          optLabel = extractCleanTextFromLabel(parentLabel);
        }
        if (!optLabel && r.id) {
          const explicit = doc.querySelector(
            `label[for="${CSS.escape(r.id)}"]`
          );
          if (explicit) {
            optLabel = extractCleanTextFromLabel(explicit as HTMLElement);
          }
        }
        if (!optLabel) {
          optLabel = sanitizeText(r.value);
        }

        options.push({
          value: sanitizeText(r.value),
          label: optLabel,
        });
      }

      const radioField: FormField = {
        formgenId,
        id: input.id || undefined,
        name: groupKey,
        label: groupLabel,
        type: 'radio',
        required: isRequired,
        options,
      };

      if (defaultValue !== undefined) {
        radioField.defaultValue = defaultValue;
      }

      fields.push(radioField);
      continue;
    }

    // --- STANDARD INPUT / SELECT / TEXTAREA PROCESSING ---
    const formgenId = `fg_${stampCounter++}`;
    el.setAttribute('data-formgen-id', formgenId);

    const fieldType = resolveFieldType(el);
    const resolvedLabel = resolveFieldLabel(el);
    const validation = extractValidationRules(el, fieldType);
    const isRequired = Boolean(
      (el as HTMLInputElement).required ||
        el.hasAttribute('required') ||
        el.getAttribute('aria-required') === 'true'
    );

    const fieldName =
      (el as HTMLInputElement).name ||
      el.id ||
      `field_${fields.length}`;

    const field: FormField = {
      formgenId,
      id: el.id || undefined,
      name: fieldName,
      label: resolvedLabel.text,
      type: fieldType,
      required: isRequired,
    };

    if (validation) {
      field.validation = validation;
    }

    // Placeholder
    const placeholder = el.getAttribute('placeholder');
    if (placeholder && placeholder.trim()) {
      field.placeholder = sanitizeText(placeholder);
    }

    // Select options
    if (fieldType === 'select') {
      const select = el as HTMLSelectElement;
      const opts = extractSelectOptions(select);
      field.options = opts;

      if (select.multiple) {
        field.multiple = true;
      }

      // Default value for select
      if (!select.multiple && select.selectedIndex >= 0) {
        const selectedOpt = select.options[select.selectedIndex];
        if (selectedOpt && selectedOpt.value && selectedOpt.value.trim() !== '') {
          field.defaultValue = sanitizeText(selectedOpt.value);
        }
      }
    }

    // Checkbox defaults
    if (fieldType === 'checkbox') {
      const cb = el as HTMLInputElement;
      if (cb.checked) {
        field.defaultValue = true;
      }
    }

    // Text / textarea default value
    if (
      ['text', 'email', 'number', 'password', 'tel', 'url', 'date', 'textarea'].includes(
        fieldType
      )
    ) {
      const val = (el as HTMLInputElement).value;
      if (val && val.trim() !== '') {
        field.defaultValue = sanitizeText(val);
      }
    }

    fields.push(field);
  }

  // 6. Form metadata resolution
  let resolvedId = '';
  if (typeof container.getAttribute === 'function') {
    resolvedId = container.getAttribute('id') || '';
  } else if (typeof container.id === 'string') {
    resolvedId = container.id;
  }

  const formId =
    resolvedId ||
    (typeof options.target === 'string'
      ? options.target.replace(/^#/, '')
      : 'form_active');

  const formSelector = resolvedId ? `#${resolvedId}` : undefined;

  const schema: FormSchema = {
    formId,
    formSelector,
    url: options.url || (doc.location ? doc.location.href : undefined),
    title:
      options.title ||
      container.getAttribute('title') ||
      doc.title ||
      undefined,
    fields,
  };

  if (tag === 'form') {
    const formEl = container as HTMLFormElement;
    const action = formEl.getAttribute('action');
    if (action) schema.action = action;
    const method = formEl.getAttribute('method');
    if (method) schema.method = method.toUpperCase();
  }

  return schema;
}
