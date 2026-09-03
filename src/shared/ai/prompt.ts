/**
 * FormGen - Multi-Provider AI Service & Structured Generation
 * Token-Efficient Prompt Engineering & Schema Compression Engine
 * Path: src/shared/ai/prompt.ts
 */

import { FormSchema, FormField } from '../types';
import { CompactFieldDescriptor, AssembledPrompt } from './types';

// ============================================================================
// 1. Lean Schema Compressor
// ============================================================================

/**
 * Compresses a verbose FormSchema into a high-density, semantic-only descriptor.
 * Removes transient DOM metadata (formgenId, selectors, URLs) to save ~70% prompt tokens.
 */
export function compressSchemaForPrompt(schema: FormSchema): {
  compactFields: CompactFieldDescriptor[];
  fieldKeyMap: Map<string, FormField>;
} {
  const compactFields: CompactFieldDescriptor[] = [];
  const fieldKeyMap = new Map<string, FormField>();
  const seenKeys = new Set<string>();

  const fields = schema.fields || [];

  for (const field of fields) {
    // Deterministic key priority: name -> id -> formgenId
    let key = (field.name || field.id || field.formgenId).trim();
    if (seenKeys.has(key)) {
      key = `${key}_${field.formgenId}`;
    }
    seenKeys.add(key);
    fieldKeyMap.set(key, field);

    const compact: CompactFieldDescriptor = {
      key,
      label: field.label,
      type: field.type,
    };

    if (field.required) {
      compact.req = true;
    }

    // For select and radio: pass exact allowed options values
    if (field.options && field.options.length > 0) {
      compact.options = field.options.map((opt) => opt.value);
    }

    if (field.validation) {
      const v = field.validation;
      if (v.min !== undefined) compact.min = v.min;
      if (v.max !== undefined) compact.max = v.max;
      if (v.step !== undefined) compact.step = v.step;
      if (v.minLength !== undefined) compact.minLen = v.minLength;
      if (v.maxLength !== undefined) compact.maxLen = v.maxLength;
      if (v.pattern) compact.pattern = v.pattern;
    }

    if (field.placeholder && field.placeholder.length < 60) {
      compact.hint = field.placeholder;
    }

    compactFields.push(compact);
  }

  return { compactFields, fieldKeyMap };
}

// ============================================================================
// 2. Structured System Prompt Formulation
// ============================================================================

/**
 * Builds the hardened system prompt enforcing RFC 8259 JSON, negative constraints,
 * and domain heuristics.
 *
 * NOTE: Explicitly includes the word "JSON" to fulfill OpenAI's strict requirement
 * when `response_format: { type: "json_object" }` is enabled.
 */
export function buildSystemPrompt(locale = 'pt-BR'): string {
  return `You are FormGen AI, an expert synthetic test data generator for automated browser form testing.
Your mission is to generate realistic, diverse, and strictly schema-compliant synthetic test records in JSON format based on a provided web form schema.

STRICT OPERATING CONSTRAINTS:
1. OUTPUT CONTRACT:
   - Output STRICT, raw, parseable JSON ONLY.
   - NEVER output markdown formatting (do NOT use \`\`\` or \`\`\`json code fences).
   - NEVER include conversational preambles, greetings, or post-generation explanations.
   - The top-level response MUST be a JSON object containing a single key "records", whose value is an array of record objects:
     { "records": [ { ... } ] }

2. FIELD KEY INTEGRITY:
   - Every object in the "records" array MUST contain keys corresponding to the "key" attributes declared in the schema.
   - Do NOT omit any declared fields. If a field is optional, provide a plausible realistic value anyway.

3. VALUE CONSTRAINTS & DATA TYPES:
   - select & radio: The value MUST STRICTLY match one of the string values listed in the field's "options" array. NEVER invent or translate options.
   - checkbox: MUST be a boolean (true or false). If the field is marked req: true (e.g. Terms of Service, Privacy Policy), it MUST ALWAYS be true.
   - number: MUST be a numeric JSON value (not a string), strictly respecting "min", "max", and "step" constraints.
   - date: Output in ISO-8601 "YYYY-MM-DD" format, strictly within any "min" and "max" date limits.
   - textarea / bio: Generate 1 to 3 realistic sentences conforming to "maxLen".

4. DOMAIN SEMANTICS & HEURISTICS (Locale: ${locale}):
   - Person Names: Generate authentic, culturally accurate full names (first name + 1-2 surnames).
   - Brazilian CPF: MUST be an 11-digit number with mathematically valid check digits (modulo 11). If pattern indicates formatting, use "000.000.000-00", otherwise unformatted digits.
   - Brazilian CNPJ: MUST have mathematically valid check digits (modulo 11), formatted as "00.000.000/0001-00" unless pattern specifies digits only.
   - Telephones: Use valid DDD area codes (e.g. 11 for SP, 21 for RJ) with 9-digit mobile format "(DD) 9XXXX-XXXX" or 8-digit landline "(DD) 3XXX-XXXX" matching pattern/hint.
   - Addresses & CEP: Valid 8-digit CEP ("00000-000"), realistic streets, neighborhoods, and cities logically matching the chosen State (UF).
   - Corporate Data: Plausible corporate names (e.g. "Tecnologia Ltda", "Logística S.A.") and coherent corporate email addresses matching person or company names.

5. DIVERSITY & COHERENCE:
   - When generating multiple records, ensure every record is unique (different names, emails, documents, and varied option selections).
   - Maintain cross-field consistency within each record: person name matches email username; state matches city and CEP region; age matches birthdate.`;
}

// ============================================================================
// 3. User Prompt Formulation
// ============================================================================

/**
 * Builds the user prompt injecting the compact schema and requested batch count.
 */
export function buildUserPrompt(
  compactSchema: CompactFieldDescriptor[],
  count: number,
  formTitle?: string
): string {
  const schemaStr = JSON.stringify(compactSchema, null, 2);
  return `Generate exactly ${count} synthetic test record(s) for the web form "${formTitle || 'Form'}".

FORM FIELDS SCHEMA:
${schemaStr}

CONTRACT REMINDER:
Return ONLY a valid JSON object matching this structure:
{
  "records": [
    ${count > 1 ? `/* exactly ${count} record objects */` : '{ /* 1 record object */ }'}
  ]
}`;
}

// ============================================================================
// 4. Multi-Provider Prompt Assembler
// ============================================================================

/**
 * Orchestrates the full prompt assembly pipeline: compresses the FormSchema,
 * builds system and user prompts, and preserves the field key map.
 */
export function assemblePrompts(
  schema: FormSchema,
  count: number,
  locale = 'pt-BR'
): AssembledPrompt {
  const { compactFields, fieldKeyMap } = compressSchemaForPrompt(schema);
  const systemPrompt = buildSystemPrompt(locale);
  const userPrompt = buildUserPrompt(
    compactFields,
    count,
    schema.title || schema.formId || 'Form'
  );

  return {
    systemPrompt,
    userPrompt,
    compactFields,
    fieldKeyMap,
  };
}
