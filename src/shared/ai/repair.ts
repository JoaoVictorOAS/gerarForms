/**
 * FormGen - Multi-Provider AI Service & Structured Generation
 * Multi-Tier JSON Sanitization, Lexical Repair & Schema Conformance Engine
 * Path: src/shared/ai/repair.ts
 */

import { FormField, FormSchema, FormRecord } from '../types';
import { EmptyAIResponseError, MalformedJsonResponseError } from './types';
import {
  generateDeterministicFallback,
  resolveOptionMatch,
} from './heuristics';

// ============================================================================
// 1. Lexical Sanitizers & Control Character Handlers
// ============================================================================

/**
 * Repairs unescaped control characters (literal newlines, carriage returns, tabs)
 * inside double-quoted string literals without corrupting JSON delimiters outside strings.
 */
export function escapeControlCharactersInStrings(input: string): string {
  let inString = false;
  let isEscaped = false;
  let out = '';

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    if (inString) {
      if (isEscaped) {
        out += ch;
        isEscaped = false;
      } else if (ch === '\\') {
        out += ch;
        isEscaped = true;
      } else if (ch === '"') {
        out += ch;
        inString = false;
      } else if (ch === '\n') {
        out += '\\n';
      } else if (ch === '\r') {
        out += '\\r';
      } else if (ch === '\t') {
        out += '\\t';
      } else {
        out += ch;
      }
    } else {
      if (ch === '"') {
        inString = true;
      }
      out += ch;
    }
  }

  return out;
}

/**
 * Strips markdown code blocks (```json ... ``` or ``` ... ```) and conversational
 * commentary from raw LLM output. Handles unclosed code fences resulting from token limits.
 */
export function stripMarkdownAndPreamble(raw: string): string {
  if (!raw || typeof raw !== 'string') return '';

  let cleaned = raw.trim();

  // 1. Extract content from closed markdown code fences (case-insensitive)
  const fencedMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fencedMatch && fencedMatch[1]) {
    cleaned = fencedMatch[1].trim();
  } else {
    // 2. Handle unclosed opening markdown fence (model token cutoff)
    const unclosedMatch = cleaned.match(/```(?:json)?\s*([\s\S]*)$/i);
    if (unclosedMatch && unclosedMatch[1]) {
      cleaned = unclosedMatch[1].trim();
    }
  }

  return cleaned;
}

/**
 * Extracts the outermost valid JSON boundary (object { ... } or array [ ... ]).
 * Prioritizes the object envelope wrapping "records" to prevent false-positive
 * matches on brackets in commentary preambles.
 */
export function extractJsonBoundary(text: string): string {
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  const firstBracket = text.indexOf('[');
  const lastBracket = text.lastIndexOf(']');

  const hasBraces = firstBrace !== -1 && lastBrace > firstBrace;
  const hasBrackets = firstBracket !== -1 && lastBracket > firstBracket;

  if (!hasBraces && !hasBrackets) {
    return text;
  }

  // If text contains "records", prioritize the object envelope
  if (hasBraces && text.includes('"records"')) {
    return text.substring(firstBrace, lastBrace + 1);
  }

  // If both exist, determine outermost envelope by position
  if (hasBraces && hasBrackets) {
    if (firstBrace < firstBracket && lastBrace > lastBracket) {
      return text.substring(firstBrace, lastBrace + 1);
    }
    if (firstBracket < firstBrace && lastBracket > lastBrace) {
      return text.substring(firstBracket, lastBracket + 1);
    }
    return firstBrace < firstBracket
      ? text.substring(firstBrace, lastBrace + 1)
      : text.substring(firstBracket, lastBracket + 1);
  }

  if (hasBraces) {
    return text.substring(firstBrace, lastBrace + 1);
  }

  return text.substring(firstBracket, lastBracket + 1);
}

/**
 * Applies defensive lexical syntax repairs to salvage imperfect JSON:
 * - Strips JavaScript single-line (//) and multi-line comments
 * - Converts Python boolean literals (True, False, None)
 * - Quotes unquoted object keys
 * - Converts single-quoted keys and string values while preserving internal apostrophes
 * - Removes trailing commas in objects and arrays
 * - Escapes literal control characters in strings
 */
export function repairJsonSyntax(input: string): string {
  let repaired = input;

  // 1. Remove comments
  repaired = repaired.replace(/\/\*[\s\S]*?\*\//g, '');
  repaired = repaired.replace(/(?<!:)\/\/.*$/gm, '');

  // 2. Convert Python literals to valid JSON
  repaired = repaired.replace(/:\s*True\b/g, ': true');
  repaired = repaired.replace(/:\s*False\b/g, ': false');
  repaired = repaired.replace(/:\s*None\b/g, ': null');

  // 3. Fix unquoted keys: e.g. { nome: "João" } -> { "nome": "João" }
  repaired = repaired.replace(
    /([{,]\s*)([a-zA-Z_$][a-zA-Z0-9_$-]*)\s*:/g,
    '$1"$2":'
  );

  // 4. Convert single-quoted keys: e.g. { 'nome': "João" } -> { "nome": "João" }
  repaired = repaired.replace(
    /([{,]\s*)'([^'\\]*(?:\\.[^'\\]*)*)'\s*:/g,
    '$1"$2":'
  );

  // 5. Convert single-quoted string values while preserving internal apostrophes
  repaired = repaired.replace(
    /(:\s*)'((?:[^'\\]|\\.)*)'(\s*[,}\]])/g,
    (_, prefix, val, suffix) => {
      const cleanVal = val.replace(/(?<!\\)"/g, '\\"').replace(/\\'/g, "'");
      return `${prefix}"${cleanVal}"${suffix}`;
    }
  );

  // 6. Fix trailing commas in objects and arrays
  repaired = repaired.replace(/,(\s*[}\]])/g, '$1');
  repaired = repaired.replace(/,(\s*[}\]])/g, '$1');

  // 7. Fix unescaped control characters in strings
  repaired = escapeControlCharactersInStrings(repaired);

  return repaired;
}

/**
 * Attempts to salvage truncated JSON when the LLM response cuts off mid-generation.
 * Finds the last complete record closing brace `}` and closes the open array/object.
 */
export function salvageTruncatedJson(input: string): string {
  const lastCloseBrace = input.lastIndexOf('}');
  if (lastCloseBrace === -1) return input;

  // Check if string contains an open "records": [
  const recordsIdx = input.indexOf('"records"');
  const openBracket = recordsIdx !== -1 ? input.indexOf('[', recordsIdx) : input.indexOf('[');

  if (openBracket !== -1 && lastCloseBrace > openBracket) {
    const sliced = input.substring(0, lastCloseBrace + 1);
    return `${sliced}\n  ]\n}`;
  }

  return input;
}

// ============================================================================
// 2. Multi-Tier Progressive JSON Parser
// ============================================================================

/**
 * Executes a 5-tier progressive JSON parsing and repair pipeline:
 * Tier 0: Direct JSON.parse
 * Tier 1: Markdown stripping + direct parse
 * Tier 2: Boundary extraction + direct parse
 * Tier 3: Lexical syntax repairs
 * Tier 4: Truncation salvage + repairs
 *
 * @throws EmptyAIResponseError if input is empty.
 * @throws MalformedJsonResponseError if text cannot be salvaged.
 */
export function parseAndRepairJson(rawText: string): any {
  if (!rawText || typeof rawText !== 'string' || !rawText.trim()) {
    throw new EmptyAIResponseError();
  }

  const trimmed = rawText.trim();

  // Tier 0: Direct parse
  try {
    return JSON.parse(trimmed);
  } catch {
    // Continue to Tier 1
  }

  // Tier 1: Markdown stripping
  const stripped = stripMarkdownAndPreamble(trimmed);
  try {
    return JSON.parse(stripped);
  } catch {
    // Continue to Tier 2
  }

  // Tier 2: Boundary extraction
  const bounded = extractJsonBoundary(stripped);
  try {
    return JSON.parse(bounded);
  } catch {
    // Continue to Tier 3
  }

  // Tier 3: Lexical syntax repairs
  const repaired = repairJsonSyntax(bounded);
  try {
    return JSON.parse(repaired);
  } catch {
    // Continue to Tier 4
  }

  // Tier 4: Truncation salvage + repairs
  const salvaged = salvageTruncatedJson(bounded);
  const repairedSalvaged = repairJsonSyntax(salvaged);
  try {
    return JSON.parse(repairedSalvaged);
  } catch (finalErr) {
    throw new MalformedJsonResponseError(
      `Falha ao decodificar JSON gerado pela IA após 4 tentativas de reparo: ${
        finalErr instanceof Error ? finalErr.message : String(finalErr)
      }`,
      rawText.substring(0, 300)
    );
  }
}

// ============================================================================
// 3. Field Coercion & Schema Conformance
// ============================================================================

/**
 * Coerces and normalizes a single raw field value according to its FormField type,
 * HTML constraints, and validation rules.
 */
export function coerceFieldValue(
  rawVal: any,
  field: FormField,
  recordIndex: number
): any {
  if (rawVal === undefined || rawVal === null || rawVal === '') {
    if (field.required || field.type === 'checkbox') {
      return generateDeterministicFallback(field, recordIndex);
    }
    return '';
  }

  switch (field.type) {
    case 'checkbox': {
      if (typeof rawVal === 'boolean') {
        return field.required ? true : rawVal;
      }
      const str = String(rawVal).toLowerCase().trim();
      const isTruthy = ['true', '1', 'yes', 'sim', 'on', 'accepted'].includes(str);
      return field.required ? true : isTruthy;
    }

    case 'number': {
      let num = typeof rawVal === 'number' ? rawVal : parseFloat(String(rawVal).replace(',', '.'));
      if (isNaN(num)) {
        return generateDeterministicFallback(field, recordIndex);
      }
      if (field.validation?.min !== undefined && num < Number(field.validation.min)) {
        num = Number(field.validation.min);
      }
      if (field.validation?.max !== undefined && num > Number(field.validation.max)) {
        num = Number(field.validation.max);
      }
      return num;
    }

    case 'select':
    case 'radio': {
      if (!field.options || field.options.length === 0) {
        return String(rawVal);
      }
      return resolveOptionMatch(rawVal, field.options);
    }

    case 'date': {
      const str = String(rawVal).trim();
      const brDate = str.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
      if (brDate && brDate[1] && brDate[2] && brDate[3]) {
        return `${brDate[3]}-${brDate[2]}-${brDate[1]}`;
      }
      if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
        return str;
      }
      return generateDeterministicFallback(field, recordIndex);
    }

    case 'email': {
      const str = String(rawVal).trim().toLowerCase();
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str)) {
        return str;
      }
      return generateDeterministicFallback(field, recordIndex);
    }

    case 'text':
    case 'textarea':
    default: {
      let str = String(rawVal).trim();
      if (field.validation?.minLength && str.length < field.validation.minLength) {
        str = str.padEnd(field.validation.minLength, 'x');
      }
      if (field.validation?.maxLength && str.length > field.validation.maxLength) {
        str = str.substring(0, field.validation.maxLength);
      }
      return str;
    }
  }
}

/**
 * Conforms parsed AI payload to the FormSchema.
 * Guarantees:
 * 1. Tri-key stamping (`name`, `id`, `formgenId`) on every record for 100% deterministic injection.
 * 2. Type coercion and boundary clamping for numbers, booleans, dates, and selects.
 * 3. Exact count matching (`output.length === expectedCount`), synthesizing missing records if necessary.
 */
export function conformRecordsToSchema(
  parsedPayload: any,
  schema: FormSchema,
  expectedCount: number
): FormRecord[] {
  let rawRecords: any[] = [];

  if (Array.isArray(parsedPayload)) {
    rawRecords = parsedPayload;
  } else if (parsedPayload && Array.isArray(parsedPayload.records)) {
    rawRecords = parsedPayload.records;
  } else if (parsedPayload && Array.isArray(parsedPayload.data)) {
    rawRecords = parsedPayload.data;
  } else if (parsedPayload && typeof parsedPayload === 'object') {
    rawRecords = [parsedPayload];
  }

  const fields = schema.fields || [];
  const conformedRecords: FormRecord[] = [];

  const countToProcess = Math.max(rawRecords.length, expectedCount);

  for (let i = 0; i < countToProcess && conformedRecords.length < expectedCount; i++) {
    const rawRec = rawRecords[i] || {};
    const conformed: FormRecord = {};

    for (const field of fields) {
      let val: any = undefined;

      if (rawRec[field.name] !== undefined) {
        val = rawRec[field.name];
      } else if (field.id && rawRec[field.id] !== undefined) {
        val = rawRec[field.id];
      } else if (field.formgenId && rawRec[field.formgenId] !== undefined) {
        val = rawRec[field.formgenId];
      } else {
        const recKeys = Object.keys(rawRec);
        const nameMatch = recKeys.find(
          (k) => k.toLowerCase() === field.name.toLowerCase()
        );
        if (nameMatch) {
          val = rawRec[nameMatch];
        } else if (field.id) {
          const idMatch = recKeys.find(
            (k) => k.toLowerCase() === field.id!.toLowerCase()
          );
          if (idMatch) val = rawRec[idMatch];
        }
      }

      const cleanVal = coerceFieldValue(val, field, i);

      // Tri-key stamping
      conformed[field.name] = cleanVal;
      if (field.id) {
        conformed[field.id] = cleanVal;
      }
      if (field.formgenId) {
        conformed[field.formgenId] = cleanVal;
      }
    }

    conformedRecords.push(conformed);
  }

  // Synthesize missing records if needed
  while (conformedRecords.length < expectedCount) {
    const idx = conformedRecords.length;
    const conformed: FormRecord = {};

    for (const field of fields) {
      const fallbackVal = generateDeterministicFallback(field, idx);
      conformed[field.name] = fallbackVal;
      if (field.id) conformed[field.id] = fallbackVal;
      if (field.formgenId) conformed[field.formgenId] = fallbackVal;
    }

    conformedRecords.push(conformed);
  }

  return conformedRecords.slice(0, expectedCount);
}

/**
 * High-level orchestration function: parses raw LLM output and produces strictly
 * validated, conformed FormRecord[] conforming to FormSchema.
 */
export function parseAndConformAIResponse(
  rawText: string,
  schema: FormSchema,
  expectedCount: number
): FormRecord[] {
  const parsed = parseAndRepairJson(rawText);
  return conformRecordsToSchema(parsed, schema, expectedCount);
}
