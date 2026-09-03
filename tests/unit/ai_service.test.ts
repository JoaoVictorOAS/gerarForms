/**
 * FormGen - Milestone 3 Unit Test Suite
 * Comprehensive tests for AI Adapters, Prompt Engine, Heuristics,
 * JSON Repair Engine, Schema Conformance, 100-Record Chunking & Background SW IPC
 * Path: tests/unit/ai_service.test.ts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  parseAndRepairJson,
  stripMarkdownAndPreamble,
  extractJsonBoundary,
  repairJsonSyntax,
  salvageTruncatedJson,
  conformRecordsToSchema,
  escapeControlCharactersInStrings,
} from '../../src/shared/ai/repair';
import {
  generateValidCPF,
  generateValidCNPJ,
  generateValidPhone,
  generateValidCEP,
  classifyFieldSemantics,
  resolveOptionMatch,
  generateDeterministicFallback,
} from '../../src/shared/ai/heuristics';
import {
  compressSchemaForPrompt,
  buildSystemPrompt,
  buildUserPrompt,
  assemblePrompts,
} from '../../src/shared/ai/prompt';
import {
  GeminiAdapter,
  OpenAIAdapter,
  OllamaAdapter,
  CustomOpenAIAdapter,
  getAIAdapter,
  resolveGeminiEndpoint,
  resolveOpenAIEndpoint,
  resolveOllamaEndpoint,
  resolveCustomEndpoint,
} from '../../src/shared/ai/adapters';
import {
  AIAuthError,
  AIModelNotFoundError,
  AIRateLimitError,
  AITimeoutError,
  AINetworkError,
  AIAbortError,
  AISafetyBlockError,
  EmptyAIResponseError,
  MalformedJsonResponseError,
} from '../../src/shared/ai/types';
import { generateFormData } from '../../src/shared/ai/service';
import { handleIncomingMessage } from '../../src/background/index';
import {
  saveSettings,
  resetStorageMocks,
  getActiveProviderConfig,
} from '../../src/shared/storage';
import {
  FormSchema,
  FormField,
  FormRecord,
  GenerateDataResponse,
} from '../../src/shared/types';

// ============================================================================
// Test Fixtures & Sample Schemas
// ============================================================================

const SAMPLE_SCHEMA: FormSchema = {
  formId: 'test-form',
  fields: [
    {
      formgenId: 'fg_0',
      id: 'ent-fullname',
      name: 'fullname',
      label: 'Nome Completo',
      type: 'text',
      required: true,
      validation: { minLength: 3, maxLength: 50 },
    },
    {
      formgenId: 'fg_1',
      id: 'ent-email',
      name: 'email',
      label: 'E-mail Corporativo',
      type: 'email',
      required: true,
    },
    {
      formgenId: 'fg_2',
      id: 'ent-age',
      name: 'age',
      label: 'Idade',
      type: 'number',
      required: true,
      validation: { min: 18, max: 120 },
    },
    {
      formgenId: 'fg_3',
      id: 'ent-cpf',
      name: 'cpf',
      label: 'CPF',
      type: 'text',
      required: true,
      validation: { pattern: '\\d{3}\\.\\d{3}\\.\\d{3}-\\d{2}' },
    },
    {
      formgenId: 'fg_4',
      id: 'ent-state',
      name: 'state',
      label: 'Estado (UF)',
      type: 'select',
      required: true,
      options: [
        { value: 'SP', label: 'São Paulo (SP)' },
        { value: 'RJ', label: 'Rio de Janeiro (RJ)' },
        { value: 'MG', label: 'Minas Gerais (MG)' },
      ],
    },
    {
      formgenId: 'fg_5',
      id: 'ent-contract',
      name: 'contract',
      label: 'Tipo de Contrato',
      type: 'radio',
      required: true,
      options: [
        { value: 'clt', label: 'CLT Efetivo' },
        { value: 'pj', label: 'Pessoa Jurídica' },
      ],
    },
    {
      formgenId: 'fg_6',
      id: 'ent-terms',
      name: 'terms',
      label: 'Termos de Uso',
      type: 'checkbox',
      required: true,
    },
    {
      formgenId: 'fg_7',
      id: 'ent-birthdate',
      name: 'birthdate',
      label: 'Data de Nascimento',
      type: 'date',
      required: false,
    },
    {
      formgenId: 'fg_8',
      id: 'ent-bio',
      name: 'bio',
      label: 'Biografia',
      type: 'textarea',
      required: false,
      validation: { maxLength: 200 },
    },
  ],
};

describe('Milestone 3: Multi-Provider AI Service & Structured Generation', () => {
  beforeEach(() => {
    resetStorageMocks();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ==========================================================================
  // Dimension 1: JSON Sanitization & Lexical Repair Engine
  // ==========================================================================
  describe('1. JSON Sanitization & Robust Repair Engine', () => {
    it('parses clean pristine JSON envelope directly', () => {
      const payload = JSON.stringify({
        records: [{ fullname: 'Carlos Lima', email: 'carlos@exemplo.com' }],
      });
      const parsed = parseAndRepairJson(payload);
      expect(parsed.records).toHaveLength(1);
      expect(parsed.records[0].fullname).toBe('Carlos Lima');
    });

    it('strips markdown ```json ... ``` code blocks with surrounding newlines', () => {
      const raw = '```json\n{\n  "records": [{"fullname": "Mariana"}]\n}\n```';
      const parsed = parseAndRepairJson(raw);
      expect(parsed.records[0].fullname).toBe('Mariana');
    });

    it('strips uppercase ```JSON and language-less ``` code blocks', () => {
      const rawUpper = '```JSON\n{"records": [{"name": "Upper"}]}\n```';
      const rawBare = '```\n{"records": [{"name": "Bare"}]}\n```';
      expect(parseAndRepairJson(rawUpper).records[0].name).toBe('Upper');
      expect(parseAndRepairJson(rawBare).records[0].name).toBe('Bare');
    });

    it('extracts JSON from conversational preamble and postamble commentary', () => {
      const raw = `
        Claro! Aqui estão os registros sintéticos solicitados para o formulário:
        {
          "records": [
            { "fullname": "Beatriz Santos", "email": "beatriz@teste.com" }
          ]
        }
        Espero que ajude! Caso precise de mais campos, avise.
      `;
      const parsed = parseAndRepairJson(raw);
      expect(parsed.records[0].fullname).toBe('Beatriz Santos');
    });

    it('extracts JSON correctly even when preamble contains false bracket delimiters', () => {
      const raw = `
        Com base na regra [R2] e no item [0], gerei o objeto:
        {
          "records": [{ "fullname": "Thiago Silva" }]
        }
      `;
      const parsed = parseAndRepairJson(raw);
      expect(parsed.records[0].fullname).toBe('Thiago Silva');
    });

    it('repairs trailing commas in both objects and arrays', () => {
      const raw = `
        {
          "records": [
            {
              "fullname": "Fernanda Lima",
              "email": "fernanda@exemplo.com",
            },
          ],
        }
      `;
      const parsed = parseAndRepairJson(raw);
      expect(parsed.records[0].fullname).toBe('Fernanda Lima');
    });

    it('repairs unquoted object keys', () => {
      const raw = `
        {
          records: [
            {
              fullname: "Lucas Mendes",
              email: "lucas@exemplo.com",
              age: 28
            }
          ]
        }
      `;
      const parsed = parseAndRepairJson(raw);
      expect(parsed.records[0].fullname).toBe('Lucas Mendes');
      expect(parsed.records[0].age).toBe(28);
    });

    it('repairs single-quoted keys and string values while preserving internal apostrophes', () => {
      const raw = `
        {'records': [{'empresa': 'D\\'água Ltda', 'cidade': 'Niterói'}]}
      `;
      const parsed = parseAndRepairJson(raw);
      expect(parsed.records[0].empresa).toBe("D'água Ltda");
      expect(parsed.records[0].cidade).toBe('Niterói');
    });

    it('repairs unescaped literal newlines and tabs inside multiline string literals', () => {
      const raw = '{\n  "records": [\n    {\n      "bio": "Primeira linha\nSegunda linha\tcom tab"\n    }\n  ]\n}';
      const parsed = parseAndRepairJson(raw);
      expect(parsed.records[0].bio).toContain('Primeira linha');
      expect(parsed.records[0].bio).toContain('Segunda linha');
    });

    it('strips inline and multi-line JavaScript comments', () => {
      const raw = `
        {
          // Comentário inicial
          "records": [
            /* registro #1 */
            { "fullname": "Juliana" } // final
          ]
        }
      `;
      const parsed = parseAndRepairJson(raw);
      expect(parsed.records[0].fullname).toBe('Juliana');
    });

    it('converts Python literals (True, False, None) to valid JSON', () => {
      const raw = `
        {
          "records": [
            { "active": True, "archived": False, "extra": None }
          ]
        }
      `;
      const parsed = parseAndRepairJson(raw);
      expect(parsed.records[0].active).toBe(true);
      expect(parsed.records[0].archived).toBe(false);
      expect(parsed.records[0].extra).toBeNull();
    });

    it('salvages truncated JSON cut off mid-generation by balancing unclosed arrays', () => {
      const truncated = '{"records": [{"fullname": "Registro Completo 1"}, {"fullname": "Registro Completo 2"}, {"fullname": "Incomple';
      const parsed = parseAndRepairJson(truncated);
      expect(parsed.records.length).toBeGreaterThanOrEqual(2);
      expect(parsed.records[0].fullname).toBe('Registro Completo 1');
      expect(parsed.records[1].fullname).toBe('Registro Completo 2');
    });

    it('extracts records directly from a bare array payload without top-level envelope', () => {
      const raw = '[{"fullname": "Registro Sem Envelope"}]';
      const parsed = parseAndRepairJson(raw);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed[0].fullname).toBe('Registro Sem Envelope');
    });

    it('extracts records from a single object payload without array wrapper', () => {
      const raw = '{"fullname": "Objeto Unico"}';
      const parsed = parseAndRepairJson(raw);
      expect(parsed.fullname).toBe('Objeto Unico');
    });

    it('throws EmptyAIResponseError on null, empty, or whitespace-only response', () => {
      expect(() => parseAndRepairJson('')).toThrow(EmptyAIResponseError);
      expect(() => parseAndRepairJson('   ')).toThrow(EmptyAIResponseError);
    });

    it('throws MalformedJsonResponseError on completely unrecoverable gibberish', () => {
      expect(() => parseAndRepairJson('Este texto definitivamente não é um JSON válido.')).toThrow(
        MalformedJsonResponseError
      );
    });
  });

  // ==========================================================================
  // Dimension 2: Domain Heuristics & Schema Conformance
  // ==========================================================================
  describe('2. Domain Heuristics & Schema Conformance', () => {
    it('coerces string numbers to numbers and clamps to min/max boundaries', () => {
      const rawRecords = [
        { age: '25' },
        { age: '10' }, // Below min: 18
        { age: '150' }, // Above max: 120
      ];
      const conformed = conformRecordsToSchema(rawRecords, SAMPLE_SCHEMA, 3);
      expect(conformed[0]!.age).toBe(25);
      expect(conformed[1]!.age).toBe(18); // Clamped to min
      expect(conformed[2]!.age).toBe(120); // Clamped to max
    });

    it('coerces truthy/falsy representations to boolean and enforces true for required checkboxes', () => {
      const rawRecords = [
        { terms: 'true' },
        { terms: '1' },
        { terms: 'yes' },
        { terms: false }, // Required checkbox must be forced to true
      ];
      const conformed = conformRecordsToSchema(rawRecords, SAMPLE_SCHEMA, 4);
      expect(conformed[0]!.terms).toBe(true);
      expect(conformed[1]!.terms).toBe(true);
      expect(conformed[2]!.terms).toBe(true);
      expect(conformed[3]!.terms).toBe(true);
    });

    it('strictly conforms select and radio fields to schema options list via 6-tier matching', () => {
      const rawRecords = [
        { state: 'SP', contract: 'clt' }, // Exact match
        { state: 'são paulo (sp)', contract: 'pj' }, // Label match
        { state: 'Invalido_UF', contract: 'Invalido_Contrato' }, // Fallback to option 0
      ];
      const conformed = conformRecordsToSchema(rawRecords, SAMPLE_SCHEMA, 3);
      expect(conformed[0]!.state).toBe('SP');
      expect(conformed[0]!.contract).toBe('clt');

      expect(conformed[1]!.state).toBe('SP');
      expect(conformed[1]!.contract).toBe('pj');

      expect(conformed[2]!.state).toBe('SP'); // Fallback
      expect(conformed[2]!.contract).toBe('clt'); // Fallback
    });

    it('normalizes dates from DD/MM/YYYY to standard YYYY-MM-DD', () => {
      const rawRecords = [{ birthdate: '15/08/1995' }];
      const conformed = conformRecordsToSchema(rawRecords, SAMPLE_SCHEMA, 1);
      expect(conformed[0]!.birthdate).toBe('1995-08-15');
    });

    it('generates mathematically valid Modulo 11 Brazilian CPFs', () => {
      for (let i = 0; i < 20; i++) {
        const cpf = generateValidCPF(true, i);
        expect(cpf).toMatch(/^\d{3}\.\d{3}\.\d{3}-\d{2}$/);

        const digits = cpf.replace(/\D/g, '').split('').map(Number);
        expect(digits).toHaveLength(11);

        // Verify DV1
        let s1 = 0;
        for (let j = 0; j < 9; j++) s1 += digits[j]! * (10 - j);
        const r1 = s1 % 11;
        const dv1 = r1 < 2 ? 0 : 11 - r1;
        expect(digits[9]).toBe(dv1);

        // Verify DV2
        let s2 = 0;
        for (let j = 0; j < 10; j++) s2 += digits[j]! * (11 - j);
        const r2 = s2 % 11;
        const dv2 = r2 < 2 ? 0 : 11 - r2;
        expect(digits[10]).toBe(dv2);
      }
    });

    it('generates mathematically valid Modulo 11 Brazilian CNPJs', () => {
      for (let i = 0; i < 10; i++) {
        const cnpj = generateValidCNPJ(true, i);
        expect(cnpj).toMatch(/^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/);

        const digits = cnpj.replace(/\D/g, '').split('').map(Number);
        expect(digits).toHaveLength(14);

        // Verify DV1
        const w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
        let s1 = 0;
        for (let j = 0; j < 12; j++) s1 += digits[j]! * w1[j]!;
        const r1 = s1 % 11;
        const dv1 = r1 < 2 ? 0 : 11 - r1;
        expect(digits[12]).toBe(dv1);

        // Verify DV2
        const w2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
        let s2 = 0;
        for (let j = 0; j < 13; j++) s2 += digits[j]! * w2[j]!;
        const r2 = s2 % 11;
        const dv2 = r2 < 2 ? 0 : 11 - r2;
        expect(digits[13]).toBe(dv2);
      }
    });

    it('stamps name, id, and formgenId keys on every record for deterministic injection', () => {
      const rawRecords = [{ fullname: 'Gabriel Alves', email: 'gabriel@exemplo.com' }];
      const conformed = conformRecordsToSchema(rawRecords, SAMPLE_SCHEMA, 1);
      const rec = conformed[0]!;

      expect(rec['fullname']).toBe('Gabriel Alves');
      expect(rec['ent-fullname']).toBe('Gabriel Alves');
      expect(rec['fg_0']).toBe('Gabriel Alves');
    });

    it('guarantees output array length strictly matches expectedCount', () => {
      const rawRecords = [{ fullname: 'Primeiro Registro' }];
      const conformed = conformRecordsToSchema(rawRecords, SAMPLE_SCHEMA, 5);

      expect(conformed).toHaveLength(5);
      expect(conformed[0]!.fullname).toBe('Primeiro Registro');
      expect(conformed[1]!.fullname).toBeDefined();
      expect(conformed[4]!.email).toContain('@');
    });
  });

  // ==========================================================================
  // Dimension 3: Multi-Provider REST Adapters & Realistic Mocking
  // ==========================================================================
  describe('3. Multi-Provider REST Adapters', () => {
    it('GeminiAdapter: correctly formats URL, x-goog-api-key, and responseMimeType', async () => {
      let capturedUrl = '';
      let capturedHeaders: Record<string, string> = {};
      let capturedBody: any = null;

      vi.stubGlobal('fetch', vi.fn(async (url: string, init: any) => {
        capturedUrl = url;
        capturedHeaders = init.headers;
        capturedBody = JSON.parse(init.body);
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            candidates: [
              {
                content: {
                  parts: [{ text: '{"records":[{"fullname":"Gemini User"}]}' }],
                },
              },
            ],
          }),
        };
      }));

      const adapter = new GeminiAdapter();
      const result = await adapter.generate(
        {
          apiKey: 'gemini-key-123',
          baseUrl: 'https://generativelanguage.googleapis.com',
          model: 'gemini-1.5-flash',
        },
        {
          systemPrompt: 'System instructions',
          userPrompt: 'User prompt',
        }
      );

      expect(capturedUrl).toBe(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent'
      );
      expect(capturedHeaders['x-goog-api-key']).toBe('gemini-key-123');
      expect(capturedBody.generationConfig.responseMimeType).toBe('application/json');
      expect(result.rawText).toBe('{"records":[{"fullname":"Gemini User"}]}');
      expect(result.provider).toBe('gemini');
    });

    it('OpenAIAdapter: sends Bearer token and response_format json_object', async () => {
      let capturedHeaders: Record<string, string> = {};
      let capturedBody: any = null;

      vi.stubGlobal('fetch', vi.fn(async (_url: string, init: any) => {
        capturedHeaders = init.headers;
        capturedBody = JSON.parse(init.body);
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            choices: [
              {
                message: {
                  content: '{"records":[{"fullname":"OpenAI User"}]}',
                },
              },
            ],
          }),
        };
      }));

      const adapter = new OpenAIAdapter();
      const result = await adapter.generate(
        {
          apiKey: 'sk-test-key',
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-4o-mini',
        },
        {
          systemPrompt: 'Return JSON',
          userPrompt: 'Generate',
        }
      );

      expect(capturedHeaders['Authorization']).toBe('Bearer sk-test-key');
      expect(capturedBody.response_format.type).toBe('json_object');
      expect(result.rawText).toBe('{"records":[{"fullname":"OpenAI User"}]}');
      expect(result.provider).toBe('openai');
    });

    it('OllamaAdapter: sends stream:false and format:json to /api/chat', async () => {
      let capturedUrl = '';
      let capturedBody: any = null;

      vi.stubGlobal('fetch', vi.fn(async (url: string, init: any) => {
        capturedUrl = url;
        capturedBody = JSON.parse(init.body);
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            message: {
              content: '{"records":[{"fullname":"Ollama User"}]}',
            },
          }),
        };
      }));

      const adapter = new OllamaAdapter();
      const result = await adapter.generate(
        {
          apiKey: '',
          baseUrl: 'http://localhost:11434',
          model: 'llama3',
        },
        {
          systemPrompt: 'System',
          userPrompt: 'User',
        }
      );

      expect(capturedUrl).toBe('http://localhost:11434/api/chat');
      expect(capturedBody.stream).toBe(false);
      expect(capturedBody.format).toBe('json');
      expect(result.rawText).toBe('{"records":[{"fullname":"Ollama User"}]}');
      expect(result.provider).toBe('ollama');
    });

    it('CustomOpenAIAdapter: retries without response_format when custom gateway returns 400', async () => {
      let attemptCount = 0;
      let lastSentBody: any = null;

      vi.stubGlobal('fetch', vi.fn(async (_url: string, init: any) => {
        attemptCount++;
        lastSentBody = JSON.parse(init.body);

        if (attemptCount === 1) {
          // Reject response_format on first attempt
          return {
            ok: false,
            status: 400,
            headers: new Headers({ 'content-type': 'application/json' }),
            text: async () => '{"error":"response_format is not supported by this model"}',
            clone() {
              return this;
            },
          };
        }

        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            choices: [{ message: { content: '{"records":[{"fullname":"Groq User"}]}' } }],
          }),
        };
      }));

      const adapter = new CustomOpenAIAdapter();
      const result = await adapter.generate(
        {
          apiKey: 'gsk-custom',
          baseUrl: 'https://api.groq.com/openai/v1',
          model: 'llama-3.1-8b-instant',
        },
        {
          systemPrompt: 'JSON prompt',
          userPrompt: 'Data',
        }
      );

      expect(attemptCount).toBe(2);
      expect(lastSentBody.response_format).toBeUndefined();
      expect(result.rawText).toBe('{"records":[{"fullname":"Groq User"}]}');
      expect(result.provider).toBe('custom');
    });

    it('maps HTTP 401/403 to AIAuthError', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => ({
        ok: false,
        status: 401,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () => '{"error":{"message":"Invalid API key"}}',
        json: async () => ({ error: { message: 'Invalid API key' } }),
      })));

      const adapter = new OpenAIAdapter();
      await expect(
        adapter.generate(
          { apiKey: 'bad-key', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
          { systemPrompt: '', userPrompt: '' }
        )
      ).rejects.toThrow(AIAuthError);
    });

    it('maps HTTP 404 to AIModelNotFoundError', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => ({
        ok: false,
        status: 404,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () => '{"error":{"message":"The model does not exist"}}',
        json: async () => ({ error: { message: 'The model does not exist' } }),
      })));

      const adapter = new OpenAIAdapter();
      await expect(
        adapter.generate(
          { apiKey: 'key', baseUrl: 'https://api.openai.com/v1', model: 'unknown-model' },
          { systemPrompt: '', userPrompt: '' }
        )
      ).rejects.toThrow(AIModelNotFoundError);
    });

    it('maps HTTP 429 to AIRateLimitError with retryAfterSeconds', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => ({
        ok: false,
        status: 429,
        headers: new Headers({
          'content-type': 'application/json',
          'retry-after': '30',
        }),
        text: async () => '{"error":"Rate limit reached"}',
        json: async () => ({ error: 'Rate limit reached' }),
      })));

      const adapter = new OpenAIAdapter();
      try {
        await adapter.generate(
          { apiKey: 'key', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
          { systemPrompt: '', userPrompt: '' }
        );
        expect.unreachable('Should have thrown');
      } catch (err: any) {
        expect(err).toBeInstanceOf(AIRateLimitError);
        expect(err.retryAfterSeconds).toBe(30);
      }
    });

    it('handles safety block on GeminiAdapter', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => ({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({
          promptFeedback: { blockReason: 'SAFETY' },
          candidates: [],
        }),
      })));

      const adapter = new GeminiAdapter();
      await expect(
        adapter.generate(
          { apiKey: 'key', baseUrl: 'https://generativelanguage.googleapis.com', model: 'gemini-1.5-flash' },
          { systemPrompt: '', userPrompt: '' }
        )
      ).rejects.toThrow(AISafetyBlockError);
    });
  });

  // ==========================================================================
  // Dimension 4: Structured Prompt Engine & Schema Compression
  // ==========================================================================
  describe('4. Structured Prompt Engine & Schema Compression', () => {
    it('compresses FormSchema achieving significant token/byte reduction', () => {
      const rawSize = JSON.stringify(SAMPLE_SCHEMA).length;
      const { compactFields } = compressSchemaForPrompt(SAMPLE_SCHEMA);
      const compactSize = JSON.stringify(compactFields).length;

      const reduction = 1 - compactSize / rawSize;
      expect(reduction).toBeGreaterThan(0.45); // Significant compression > 45%
    });

    it('buildSystemPrompt contains "JSON" keyword and enforces records envelope', () => {
      const prompt = buildSystemPrompt('pt-BR');
      expect(prompt).toContain('JSON');
      expect(prompt).toContain('{ "records": [ { ... } ] }');
      expect(prompt).toContain('pt-BR');
    });

    it('assemblePrompts returns fully assembled prompt objects', () => {
      const assembled = assemblePrompts(SAMPLE_SCHEMA, 10, 'pt-BR');
      expect(assembled.systemPrompt).toBeDefined();
      expect(assembled.userPrompt).toContain('Generate exactly 10 synthetic test record(s)');
      expect(assembled.compactFields.length).toBe(SAMPLE_SCHEMA.fields.length);
    });
  });

  // ==========================================================================
  // Dimension 5: Chunking Pipeline Logic (1, 10, 100 records)
  // ==========================================================================
  describe('5. Chunking Pipeline Execution (1, 10, 100 records)', () => {
    it('executes single-shot generation for count = 1', async () => {
      let callCount = 0;
      vi.stubGlobal('fetch', vi.fn(async () => {
        callCount++;
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            choices: [{ message: { content: '{"records":[{"fullname":"User 1"}]}' } }],
          }),
        };
      }));

      const records = await generateFormData({
        provider: 'openai',
        config: { apiKey: 'key', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
        schema: SAMPLE_SCHEMA,
        count: 1,
      });

      expect(callCount).toBe(1);
      expect(records).toHaveLength(1);
      expect(records[0]!.fullname).toBe('User 1');
    });

    it('executes single-shot generation for count = 10', async () => {
      let callCount = 0;
      vi.stubGlobal('fetch', vi.fn(async () => {
        callCount++;
        const recs = Array.from({ length: 10 }, (_, i) => ({ fullname: `User ${i + 1}` }));
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            choices: [{ message: { content: JSON.stringify({ records: recs }) } }],
          }),
        };
      }));

      const records = await generateFormData({
        provider: 'openai',
        config: { apiKey: 'key', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
        schema: SAMPLE_SCHEMA,
        count: 10,
      });

      expect(callCount).toBe(1);
      expect(records).toHaveLength(10);
    });

    it('chunks 100 records into 10 sub-batches of 10 and reports progress callbacks', async () => {
      let callCount = 0;
      const progressSnapshots: number[] = [];

      vi.stubGlobal('fetch', vi.fn(async () => {
        callCount++;
        const recs = Array.from({ length: 10 }, (_, i) => ({ fullname: `User ${callCount * 10 + i}` }));
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            choices: [{ message: { content: JSON.stringify({ records: recs }) } }],
          }),
        };
      }));

      const records = await generateFormData({
        provider: 'openai',
        config: { apiKey: 'key', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
        schema: SAMPLE_SCHEMA,
        count: 100,
        onProgress: (p) => {
          progressSnapshots.push(p.completedRecords);
        },
      });

      expect(callCount).toBe(10); // 10 chunks of 10
      expect(records).toHaveLength(100);
      expect(progressSnapshots).toContain(100);
    });

    it('falls back seamlessly to synthetic generator if an AI chunk fails during batch 100', async () => {
      let callCount = 0;

      vi.stubGlobal('fetch', vi.fn(async () => {
        callCount++;
        if (callCount === 2) {
          // Fail chunk 2
          throw new Error('Network timeout in chunk 2');
        }
        const recs = Array.from({ length: 10 }, (_, i) => ({ fullname: `User ${callCount * 10 + i}` }));
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            choices: [{ message: { content: JSON.stringify({ records: recs }) } }],
          }),
        };
      }));

      const records = await generateFormData({
        provider: 'openai',
        config: { apiKey: 'key', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
        schema: SAMPLE_SCHEMA,
        count: 100,
      });

      // Still delivers all 100 records
      expect(records).toHaveLength(100);
    });
  });

  // ==========================================================================
  // Dimension 6: Background SW GENERATE_DATA IPC Integration
  // ==========================================================================
  describe('6. Background SW GENERATE_DATA IPC Routing', () => {
    it('rejects GENERATE_DATA if schema is empty or missing fields', async () => {
      const res = (await handleIncomingMessage({
        action: 'GENERATE_DATA',
        count: 1,
        schema: { formId: 'empty', fields: [] },
      })) as GenerateDataResponse;

      expect(res.success).toBe(false);
      expect(res.error).toContain('Schema de formulário inválido');
    });

    it('rejects GENERATE_DATA if batch count is not 1, 10, or 100', async () => {
      const res = (await handleIncomingMessage({
        action: 'GENERATE_DATA',
        count: 50 as any,
        schema: SAMPLE_SCHEMA,
      })) as GenerateDataResponse;

      expect(res.success).toBe(false);
      expect(res.error).toContain('Quantidade de registros inválida: 50');
    });

    it('rejects GENERATE_DATA if active provider requires API key but none is configured', async () => {
      await saveSettings({
        activeProvider: 'openai',
        providers: {
          openai: { apiKey: '', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
        },
      });

      const res = (await handleIncomingMessage({
        action: 'GENERATE_DATA',
        count: 1,
        schema: SAMPLE_SCHEMA,
      })) as GenerateDataResponse;

      expect(res.success).toBe(false);
      expect(res.error).toContain('Chave de API não configurada');
    });

    it('successfully routes GENERATE_DATA through AI service and returns records', async () => {
      await saveSettings({
        activeProvider: 'openai',
        providers: {
          openai: {
            apiKey: 'sk-test-valid-key',
            baseUrl: 'https://api.openai.com/v1',
            model: 'gpt-4o-mini',
          },
        },
      });

      vi.stubGlobal('fetch', vi.fn(async () => ({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  records: [
                    {
                      fullname: 'Ana Carolina',
                      email: 'ana@empresa.com.br',
                      age: 30,
                      cpf: '123.456.789-00',
                      state: 'SP',
                      contract: 'clt',
                      terms: true,
                    },
                  ],
                }),
              },
            },
          ],
        }),
      })));

      const res = (await handleIncomingMessage({
        action: 'GENERATE_DATA',
        count: 1,
        schema: SAMPLE_SCHEMA,
      })) as GenerateDataResponse;

      expect(res.success).toBe(true);
      expect(res.count).toBe(1);
      expect(res.records).toBeDefined();
      expect(res.records).toHaveLength(1);
      expect(res.records![0]!.fullname).toBe('Ana Carolina');
      expect(res.records![0]!['ent-fullname']).toBe('Ana Carolina');
      expect(res.records![0]!['fg_0']).toBe('Ana Carolina');
    });
  });
});
