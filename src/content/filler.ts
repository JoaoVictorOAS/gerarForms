/**
 * FormGen - DOM Form Filler
 * Injects structured mock records into DOM form fields and emulates synthetic events.
 * Path: src/content/filler.ts
 */

import { FormRecord, InjectRecordResponse } from '../shared/types';

/**
 * Result of DOM injection.
 */
export interface InjectRecordResult extends InjectRecordResponse {
  totalFieldsCount: number;
}

/**
 * Safe CSS selector escaping supporting both browser and Node/JSDOM environments.
 */
function safeEscape(str: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(str);
  }
  return str.replace(/([ !"#$%&'()*+,.\/:;<=>?@[\\\]^`{|}~])/g, '\\$1');
}

/**
 * Dispatches standard synthetic events so reactive frameworks (React, Vue, Angular)
 * and legacy onchange handlers detect the value change.
 */
export function dispatchInputEvents(element: HTMLElement): void {
  const win = element.ownerDocument?.defaultView || (typeof window !== 'undefined' ? window : null);
  const EventCtor = win?.Event || (typeof Event !== 'undefined' ? Event : null);
  if (!EventCtor) return;

  const eventOptions: EventInit = { bubbles: true, cancelable: true, composed: true };

  // 1. input event (for v-model, useState, controlled inputs)
  element.dispatchEvent(new EventCtor('input', eventOptions));

  // 2. change event
  element.dispatchEvent(new EventCtor('change', eventOptions));

  // 3. blur event (validation trigger)
  element.dispatchEvent(new EventCtor('blur', eventOptions));
}

/**
 * Bypasses prototype setter traps in React/Vue for text-like inputs.
 * React 16+ overrides the `value` property descriptor on HTMLInputElement/HTMLTextAreaElement.
 * Calling the prototype setter ensures React's internal state tracker detects the change.
 */
export function setNativeValue(
  element: HTMLInputElement | HTMLTextAreaElement,
  value: string | number
): void {
  const strVal = value !== undefined && value !== null ? String(value) : '';
  const win = element.ownerDocument?.defaultView || (typeof window !== 'undefined' ? window : null);
  const proto = element.tagName.toUpperCase() === 'TEXTAREA'
    ? (win?.HTMLTextAreaElement?.prototype || Object.getPrototypeOf(element))
    : (win?.HTMLInputElement?.prototype || Object.getPrototypeOf(element));

  const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');

  if (descriptor && typeof descriptor.set === 'function') {
    descriptor.set.call(element, strVal);
  } else {
    element.value = strVal;
  }
}

/**
 * Bypasses prototype setter for checkboxes and radio buttons.
 */
export function setNativeChecked(
  element: HTMLInputElement,
  checked: boolean
): void {
  const win = element.ownerDocument?.defaultView || (typeof window !== 'undefined' ? window : null);
  const proto = win?.HTMLInputElement?.prototype || Object.getPrototypeOf(element);
  const descriptor = Object.getOwnPropertyDescriptor(proto, 'checked');

  if (descriptor && typeof descriptor.set === 'function') {
    descriptor.set.call(element, checked);
  } else {
    element.checked = checked;
  }
}

/**
 * Normalizes an identifier or name for tolerant matching.
 */
function normalizeKey(str: string): string {
  return str.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Finds matching input, select or textarea elements in the document or container
 * for a given record key.
 */
export function findMatchingElements(
  key: string,
  container: Document | HTMLElement
): HTMLElement[] {
  const matches: HTMLElement[] = [];
  const escapedKey = safeEscape(key);

  // 1. By data-formgen-id
  const byFormgenId = container.querySelector(`[data-formgen-id="${escapedKey}"]`);
  if (byFormgenId && byFormgenId.nodeType === 1) {
    matches.push(byFormgenId as HTMLElement);
    return matches;
  }

  // 2. By ID exact match
  const byId = container.querySelector(`#${escapedKey}`);
  if (byId && byId.nodeType === 1) {
    matches.push(byId as HTMLElement);
    return matches;
  }

  // 3. By name exact match
  const byName = container.querySelectorAll(`[name="${escapedKey}"]`);
  if (byName.length > 0) {
    for (let i = 0; i < byName.length; i++) {
      const el = byName[i];
      if (el && el.nodeType === 1) matches.push(el as HTMLElement);
    }
    return matches;
  }

  // 4. Tolerant normalized match across all form controls
  const normKey = normalizeKey(key);
  const allControls = container.querySelectorAll('input, select, textarea');

  for (let i = 0; i < allControls.length; i++) {
    const el = allControls[i] as HTMLElement;
    if (!el || el.nodeType !== 1) continue;

    const nameAttr = el.getAttribute('name');
    const idAttr = el.getAttribute('id');
    const formgenIdAttr = el.getAttribute('data-formgen-id');

    if (
      (nameAttr && normalizeKey(nameAttr) === normKey) ||
      (idAttr && normalizeKey(idAttr) === normKey) ||
      (formgenIdAttr && normalizeKey(formgenIdAttr) === normKey)
    ) {
      matches.push(el);
    }
  }

  return matches;
}

/**
 * Injects a single field value into a DOM element.
 */
export function injectElementValue(
  element: HTMLElement,
  rawVal: any
): boolean {
  if (!element || rawVal === undefined || rawVal === null) return false;

  const tagName = element.tagName.toUpperCase();

  if (tagName === 'INPUT') {
    const input = element as HTMLInputElement;
    const type = (input.type || 'text').toLowerCase();

    if (type === 'checkbox') {
      const isChecked =
        rawVal === true ||
        rawVal === 1 ||
        rawVal === 'true' ||
        rawVal === '1' ||
        rawVal === input.value;
      setNativeChecked(input, isChecked);
      dispatchInputEvents(input);
      return true;
    }

    if (type === 'radio') {
      const match =
        String(rawVal).toLowerCase() === input.value.toLowerCase() ||
        rawVal === true ||
        rawVal === 1;
      if (match) {
        setNativeChecked(input, true);
        dispatchInputEvents(input);
        return true;
      }
      return false;
    }

    // Standard text-like, date, tel, number input
    setNativeValue(input, rawVal);
    dispatchInputEvents(input);
    return true;
  }

  if (tagName === 'TEXTAREA') {
    const textarea = element as HTMLTextAreaElement;
    setNativeValue(textarea, rawVal);
    dispatchInputEvents(textarea);
    return true;
  }

  if (tagName === 'SELECT') {
    const select = element as HTMLSelectElement;
    const targetStr = String(rawVal).trim().toLowerCase();

    let matchedOptionIndex = -1;

    // Match by value first, then by visible text
    for (let i = 0; i < select.options.length; i++) {
      const opt = select.options[i];
      if (opt.value.trim().toLowerCase() === targetStr) {
        matchedOptionIndex = i;
        break;
      }
    }

    if (matchedOptionIndex === -1) {
      for (let i = 0; i < select.options.length; i++) {
        const opt = select.options[i];
        if (opt.text.trim().toLowerCase() === targetStr) {
          matchedOptionIndex = i;
          break;
        }
      }
    }

    if (matchedOptionIndex !== -1) {
      select.selectedIndex = matchedOptionIndex;
      dispatchInputEvents(select);
      return true;
    } else if (select.options.length > 1) {
      // Fallback: pick the first non-empty option if no exact match
      const fallbackIdx = select.options[0].value === '' ? 1 : 0;
      if (select.options[fallbackIdx]) {
        select.selectedIndex = fallbackIdx;
        dispatchInputEvents(select);
        return true;
      }
    }
  }

  return false;
}

/**
 * Injects an entire FormRecord into the active DOM document or form.
 *
 * @param record FormRecord object with field keys mapped to mock values
 * @param target Optional form selector or ID
 * @param rootDoc Optional Document reference for headless testing
 */
export function injectRecordIntoDom(
  record: FormRecord,
  target?: string,
  rootDoc?: Document
): InjectRecordResult {
  const doc = rootDoc || (typeof document !== 'undefined' ? document : null);

  if (!doc) {
    return {
      success: false,
      injectedFields: [],
      skippedFields: Object.keys(record || {}),
      totalFieldsCount: 0,
      error: 'Document context not available for injection.',
    };
  }

  let container: HTMLElement | Document = doc;
  if (target) {
    const selector = target.startsWith('#') || target.includes(' ') || target.includes('.')
      ? target
      : `#${target}`;
    const found = doc.querySelector<HTMLElement>(selector);
    if (found) {
      container = found;
    }
  }

  const injectedFields: string[] = [];
  const skippedFields: string[] = [];

  const entries = Object.entries(record || {});

  for (const [key, value] of entries) {
    const elements = findMatchingElements(key, container);

    if (elements.length === 0) {
      skippedFields.push(key);
      continue;
    }

    let injectedAny = false;
    for (const el of elements) {
      const didInject = injectElementValue(el, value);
      if (didInject) {
        injectedAny = true;
      }
    }

    if (injectedAny) {
      injectedFields.push(key);
    } else {
      skippedFields.push(key);
    }
  }

  return {
    success: injectedFields.length > 0,
    injectedFields,
    skippedFields,
    totalFieldsCount: entries.length,
    error: injectedFields.length === 0 ? 'Nenhum campo foi correspondido ou preenchido.' : undefined,
  };
}
