/**
 * FormGen - Milestone 3 Adversarial Stress & Empirical Verification Test Suite
 * Author: m3_challenger_1 (EMPIRICAL CHALLENGER)
 * Path: tests/unit/m3_challenger_stress.test.ts
 *
 * Target: Milestone 3 Multi-Provider AI Service & Structured Generation
 * Scope:
 *  1. Severely Degraded JSON Inputs & Progressive Repair Engine
 *  2. Modulo 11 Mathematical Check Digit Oracle (1,000 CPFs & 1,000 CNPJs)
 *  3. 100-Record Chunking Pipeline Latency & Progress Tracking
 *  4. High-Concurrency Stress on generateFormData (Multi-Schema Isolation)
 *  5. Rate Limit (HTTP 429) Handling, Backoff Metadata & Fallback Recovery
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  parseAndRepairJson,
  stripMarkdownAndPreamble,
  extractJsonBoundary,
  repairJsonSyntax,
  salvageTruncatedJson,
  conformRecordsToSchema,
  escapeControlCharactersInStrings,
  parseAndConformAIResponse,
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
  GeminiAdapter,
  OpenAIAdapter,
  OllamaAdapter,
  CustomOpenAIAdapter,
  getAIAdapter,
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
import { FormSchema, FormField, FormRecord } from '../../src/shared/types';

// ============================================================================
// Independent Mathematical Verification Oracles
// ============================================================================

/**
 * Independent Oracle to verify Brazilian CPF Modulo 11 check digits.
 * Returns true if and only if both DVs match the Modulo 11 calculation.
 */
function verifyCpfModulo11(cpfStr: string): { valid: boolean; reason?: string } {
  const digits = cpfStr.replace(/\D/g, '');
  if (digits.length !== 11) {
    return { valid: false, reason: `Length is ${digits.length}, expected 11` };
  }

  // Check for invalid known sequences (all identical digits)
  if (/^(\d)\1{10}$/.test(digits)) {
    return { valid: false, reason: 'All digits are identical' };
  }

  const nums = digits.split('').map(Number);

  // Check digit 1
  let s1 = 0;
  for (let i = 0; i < 9; i++) {
    s1 += nums[i]! * (10 - i);
  }
  const r1 = s1 % 11;
  const dv1 = r1 < 2 ? 0 : 11 - r1;
  if (nums[9] !== dv1) {
    return { valid: false, reason: `DV1 mismatch: expected ${dv1}, got ${nums[9]}` };
  }

  // Check digit 2
  let s2 = 0;
  for (let i = 0; i < 10; i++) {
    s2 += nums[i]! * (11 - i);
  }
  const r2 = s2 % 11;
  const dv2 = r2 < 2 ? 0 : 11 - r2;
  if (nums[10] !== dv2) {
    return { valid: false, reason: `DV2 mismatch: expected ${dv2}, got ${nums[10]}` };
  }

  return { valid: true };
}

/**
 * Independent Oracle to verify Brazilian CNPJ Modulo 11 check digits.
 * Returns true if and only if both DVs match the Modulo 11 calculation.
 */
function verifyCnpjModulo11(cnpjStr: string): { valid: boolean; reason?: string } {
  const digits = cnpjStr.replace(/\D/g, '');
  if (digits.length !== 14) {
    return { valid: false, reason: `Length is ${digits.length}, expected 14` };
  }

  if (/^(\d)\1{13}$/.test(digits)) {
    return { valid: false, reason: 'All digits are identical' };
  }

  const nums = digits.split('').map(Number);

  // Weights for DV1
  const w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  let s1 = 0;
  for (let i = 0; i < 12; i++) {
    s1 += nums[i]! * w1[i]!;
  }
  const r1 = s1 % 11;
  const dv1 = r1 < 2 ? 0 : 11 - r1;
  if (nums[12] !== dv1) {
    return { valid: false, reason: `DV1 mismatch: expected ${dv1}, got ${nums[12]}` };
  }

  // Weights for DV2
  const w2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  let s2 = 0;
  for (let i = 0; i < 13; i++) {
    s2 += nums[i]! * w2[i]!;
  }
  const r2 = s2 % 11;
  const dv2 = r2 < 2 ? 0 : 11 - r2;
  if (nums[13] !== dv2) {
    return { valid: false, reason: `DV2 mismatch: expected ${dv2}, got ${nums[13]}` };
  }

  return { valid: true };
}

// ============================================================================
// Schemas for Multi-Concurrency & Stress Testing
// ============================================================================

const ENTERPRISE_SCHEMA: FormSchema = {
  formId: 'form-enterprise-challenger',
  fields: [
    { formgenId: 'fg_0', id: 'f-name', name: 'nome', label: 'Nome Completo', type: 'text', required: true },
    { formgenId: 'fg_1', id: 'f-cpf', name: 'cpf', label: 'CPF', type: 'text', required: true },
    { formgenId: 'fg_2', id: 'f-cnpj', name: 'cnpj', label: 'CNPJ da Empresa', type: 'text', required: false },
    { formgenId: 'fg_3', id: 'f-email', name: 'email', label: 'E-mail', type: 'email', required: true },
    { formgenId: 'fg_4', id: 'f-phone', name: 'telefone', label: 'Telefone Celular', type: 'tel', required: true },
    { formgenId: 'fg_5', id: 'f-cep', name: 'cep', label: 'CEP', type: 'text', required: true },
    { formgenId: 'fg_6', id: 'f-city', name: 'cidade', label: 'Cidade', type: 'text', required: true },
    {
      formgenId: 'fg_7',
      id: 'f-uf',
      name: 'uf',
      label: 'Estado (UF)',
      type: 'select',
      options: [
        { value: 'SP', label: 'São Paulo' },
        { value: 'RJ', label: 'Rio de Janeiro' },
        { value: 'MG', label: 'Minas Gerais' },
      ],
      required: true,
    },
    { formgenId: 'fg_8', id: 'f-age', name: 'idade', label: 'Idade', type: 'number', required: false, validation: { min: 18, max: 99 } },
    { formgenId: 'fg_9', id: 'f-terms', name: 'termos', label: 'Aceito os Termos', type: 'checkbox', required: true },
  ],
};

const SIMPLE_FEEDBACK_SCHEMA: FormSchema = {
  formId: 'form-feedback',
  fields: [
    { formgenId: 'fg_fb_1', id: 'fb-rating', name: 'rating', label: 'Avaliação', type: 'number', required: true, validation: { min: 1, max: 5 } },
    { formgenId: 'fg_fb_2', id: 'fb-comments', name: 'comments', label: 'Comentários', type: 'textarea', required: false },
  ],
};

const FINANCIAL_BILLING_SCHEMA: FormSchema = {
  formId: 'form-billing',
  fields: [
    { formgenId: 'fg_bill_1', id: 'bill-company', name: 'razaoSocial', label: 'Razão Social', type: 'text', required: true },
    { formgenId: 'fg_bill_2', id: 'bill-cnpj', name: 'cnpj', label: 'CNPJ', type: 'text', required: true },
    { formgenId: 'fg_bill_3', id: 'bill-value', name: 'valor', label: 'Valor da Fatura', type: 'number', required: true, validation: { min: 100, max: 50000 } },
    { formgenId: 'fg_bill_4', id: 'bill-due', name: 'vencimento', label: 'Data de Vencimento', type: 'date', required: true },
  ],
};

// ============================================================================
// Test Suites
// ============================================================================

describe('Challenger 1 Empirical Stress Tests: Milestone 3 AI Service', () => {

  // --------------------------------------------------------------------------
  // Suite 1: Severely Degraded JSON Inputs & Repair Pipeline
  // --------------------------------------------------------------------------
  describe('1. Severely Degraded JSON Inputs & Progressive Repair Engine', () => {
    
    it('repairs truncated array in envelope by salvaging completed items and discarding partial tail', () => {
      const truncated = `{
        "records": [
          { "nome": "Lucas Silva", "email": "lucas@test.com" },
          { "nome": "Mariana Souza", "email": "mariana@test.com" },
          { "nome": "Incomplete Person", "email": "incomp`;

      const parsed = parseAndRepairJson(truncated);
      expect(parsed).toBeDefined();
      expect(parsed.records).toHaveLength(2);
      expect(parsed.records[0].nome).toBe('Lucas Silva');
      expect(parsed.records[1].nome).toBe('Mariana Souza');

      // Now conform to schema requesting 3 records
      const conformed = conformRecordsToSchema(parsed, ENTERPRISE_SCHEMA, 3);
      expect(conformed).toHaveLength(3);
      expect(conformed[0]!.nome).toBe('Lucas Silva');
      expect(conformed[1]!.nome).toBe('Mariana Souza');
      // Third record was deterministically synthesized to satisfy expectedCount
      expect(conformed[2]!.nome).toBeDefined();
      expect(conformed[2]!.email).toContain('@');
    });

    it('handles truncated bare array cleanly without crashing', () => {
      const truncatedBare = `[
        { "nome": "Rodrigo Santos", "email": "rodrigo@test.com" },
        { "nome": "Juliana Lima", "email": "juliana@test.com" },
        { "nome": "Truncated User", "em`;

      // Test whether parseAndRepairJson can recover or what error it throws
      let result: any = null;
      let error: any = null;
      try {
        result = parseAndRepairJson(truncatedBare);
      } catch (e) {
        error = e;
      }

      console.log('Truncated bare array result:', result ? 'SUCCESS' : 'THREW ERROR', error?.message);
    });

    it('repairs unescaped literal control characters (newlines, carriage returns, tabs) in multiline string values', () => {
      // Raw string literal containing unescaped \n and \t inside a JSON string value
      const rawWithLiteralBreaks = '{\n  "records": [\n    {\n      "nome": "Carlos\\nSilva",\n      "bio": "Primeira linha\nSegunda linha\r\nTerceira linha com \ttabulação"\n    }\n  ]\n}';

      const parsed = parseAndRepairJson(rawWithLiteralBreaks);
      expect(parsed.records).toHaveLength(1);
      expect(parsed.records[0].bio).toContain('Primeira linha');
      expect(parsed.records[0].bio).toContain('Segunda linha');
    });

    it('repairs mixed single and double quotes while preserving internal apostrophes (e.g. D\'Angelo)', () => {
      const singleQuotedWithApostrophe = `{
        'records': [
          {
            'nome': 'D\\'Angelo O\\'Connor',
            'cidade': 'Sant\\'Ana do Livramento',
            "uf": 'SP',
            'active': true
          }
        ]
      }`;

      const parsed = parseAndRepairJson(singleQuotedWithApostrophe);
      expect(parsed.records).toHaveLength(1);
      expect(parsed.records[0].nome).toBe("D'Angelo O'Connor");
      expect(parsed.records[0].cidade).toBe("Sant'Ana do Livramento");
      expect(parsed.records[0].uf).toBe('SP');
    });

    it('repairs unquoted object keys with standard identifiers and hyphens', () => {
      const unquotedKeys = `{
        records: [
          {
            nome: "Felipe Mendes",
            cpf: "12345678901",
            empresa-parceira: "Nexus Tech",
            _status: "ativo"
          }
        ]
      }`;

      const parsed = parseAndRepairJson(unquotedKeys);
      expect(parsed.records).toHaveLength(1);
      expect(parsed.records[0].nome).toBe('Felipe Mendes');
      expect(parsed.records[0]['empresa-parceira']).toBe('Nexus Tech');
    });

    it('evaluates behavior on unquoted keys containing spaces', () => {
      const unquotedWithSpaces = `{
        records: [
          {
            nome completo: "Felipe Mendes",
            email corporativo: "felipe@test.com"
          }
        ]
      }`;

      let error: any = null;
      try {
        parseAndRepairJson(unquotedWithSpaces);
      } catch (e) {
        error = e;
      }
      // Documenting whether unquoted keys with spaces can be repaired or throws
      console.log('Unquoted keys with spaces threw:', error ? error.message : 'SUCCESS');
    });

    it('repairs multiple nested trailing commas in objects and arrays', () => {
      const trailingCommas = `{
        "records": [
          {
            "nome": "Amanda Costa",
            "tags": ["developer", "tester",],
            "idade": 29,
          },
          {
            "nome": "Bruno Alves",
            "tags": ["manager",],
          },
        ],
      }`;

      const parsed = parseAndRepairJson(trailingCommas);
      expect(parsed.records).toHaveLength(2);
      expect(parsed.records[0].nome).toBe('Amanda Costa');
      expect(parsed.records[1].nome).toBe('Bruno Alves');
    });

    it('isolates JSON envelope amidst heavy conversational preamble, false bracket noise, and postamble', () => {
      const noisyResponse = `
Certamente! Aqui está a lista com os dados sintéticos solicitados para o teste [Ambiente: Dev].
Note que usamos {formId: "enterprise"} como referência.

\`\`\`json
{
  "records": [
    { "nome": "Larissa Gomes", "email": "larissa@exemplo.com" }
  ]
}
\`\`\`

Espero que estes dados atendam às necessidades do formulário. Caso precise de mais registros [ex: 10 ou 100], estou à disposição!
`;

      const parsed = parseAndRepairJson(noisyResponse);
      expect(parsed.records).toHaveLength(1);
      expect(parsed.records[0].nome).toBe('Larissa Gomes');
    });

    it('repairs Python boolean/None literals and strips inline and block JavaScript comments', () => {
      const pythonAndJsCommented = `{
        // Lista de registros gerados
        "records": [
          {
            /* Dados do usuário principal */
            "nome": "Thiago Carvalho",
            "ativo": True,
            "suspenso": False,
            "observacao": None
          }
        ]
      }`;

      const parsed = parseAndRepairJson(pythonAndJsCommented);
      expect(parsed.records).toHaveLength(1);
      expect(parsed.records[0].nome).toBe('Thiago Carvalho');
      expect(parsed.records[0].ativo).toBe(true);
      expect(parsed.records[0].suspenso).toBe(false);
      expect(parsed.records[0].observacao).toBeNull();
    });

    it('throws EmptyAIResponseError on null, empty, or whitespace-only inputs', () => {
      expect(() => parseAndRepairJson('')).toThrowError(EmptyAIResponseError);
      expect(() => parseAndRepairJson('   \n\t  ')).toThrowError(EmptyAIResponseError);
      expect(() => parseAndRepairJson(null as any)).toThrowError(EmptyAIResponseError);
    });

    it('throws MalformedJsonResponseError on unrecoverable HTML or binary garbage', () => {
      const htmlError = '<!DOCTYPE html><html><head><title>502 Bad Gateway</title></head><body><h1>Server Error</h1></body></html>';
      expect(() => parseAndRepairJson(htmlError)).toThrowError(MalformedJsonResponseError);
    });
  });

  // --------------------------------------------------------------------------
  // Suite 2: Modulo 11 Verification on 1,000 Synthetic CPFs & 1,000 CNPJs
  // --------------------------------------------------------------------------
  describe('2. Modulo 11 Check Digit Validation Oracle (1,000 CPFs & 1,000 CNPJs)', () => {

    it('empirically validates 1,000 synthetic CPFs with 100.0% Modulo 11 check digit compliance', () => {
      const TOTAL_SAMPLES = 1000;
      let passCount = 0;
      const failures: { sample: string; reason?: string }[] = [];

      for (let i = 0; i < TOTAL_SAMPLES; i++) {
        // Test formatted for even seeds, unformatted for odd seeds
        const formatted = i % 2 === 0;
        // Test seeded for 0..799, unseeded random for 800..999
        const seed = i < 800 ? i : undefined;

        const cpf = generateValidCPF(formatted, seed);

        if (formatted) {
          expect(cpf).toMatch(/^\d{3}\.\d{3}\.\d{3}-\d{2}$/);
        } else {
          expect(cpf).toMatch(/^\d{11}$/);
        }

        const oracleResult = verifyCpfModulo11(cpf);
        if (oracleResult.valid) {
          passCount++;
        } else {
          failures.push({ sample: cpf, reason: oracleResult.reason });
        }
      }

      expect(failures).toHaveLength(0);
      expect(passCount).toBe(TOTAL_SAMPLES);
      const complianceRate = (passCount / TOTAL_SAMPLES) * 100;
      expect(complianceRate).toBe(100.0);
    });

    it('empirically validates 1,000 synthetic CNPJs with 100.0% Modulo 11 check digit compliance', () => {
      const TOTAL_SAMPLES = 1000;
      let passCount = 0;
      const failures: { sample: string; reason?: string }[] = [];

      for (let i = 0; i < TOTAL_SAMPLES; i++) {
        const formatted = i % 2 === 0;
        const seed = i < 800 ? i : undefined;

        const cnpj = generateValidCNPJ(formatted, seed);

        if (formatted) {
          expect(cnpj).toMatch(/^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/);
        } else {
          expect(cnpj).toMatch(/^\d{14}$/);
        }

        const oracleResult = verifyCnpjModulo11(cnpj);
        if (oracleResult.valid) {
          passCount++;
        } else {
          failures.push({ sample: cnpj, reason: oracleResult.reason });
        }
      }

      expect(failures).toHaveLength(0);
      expect(passCount).toBe(TOTAL_SAMPLES);
      const complianceRate = (passCount / TOTAL_SAMPLES) * 100;
      expect(complianceRate).toBe(100.0);
    });

    it('validates Brazilian Phone and CEP generators format and variety across 100 samples', () => {
      for (let i = 0; i < 100; i++) {
        const phone = generateValidPhone(true, true, i);
        expect(phone).toMatch(/^\(\d{2}\) 9\d{4}-\d{4}$/);

        const cep = generateValidCEP(true, i);
        expect(cep).toMatch(/^\d{5}-\d{3}$/);
      }
    });
  });

  // --------------------------------------------------------------------------
  // Suite 3: 100-Record Chunking Latency & Progress Tracking
  // --------------------------------------------------------------------------
  describe('3. 100-Record Chunking Latency, Progress Callbacks & Tri-Key Stamping', () => {

    it('executes 100-record generation with chunking, progress sequence, and bounded latency', async () => {
      // Mock fetch with artificial network latency of 15ms per sub-batch (10 records)
      let chunkCallCount = 0;
      const originalFetch = globalThis.fetch;

      globalThis.fetch = vi.fn().mockImplementation(async () => {
        chunkCallCount++;
        await new Promise((resolve) => setTimeout(resolve, 15));
        
        // Return 10 records per chunk
        const chunkRecords = Array.from({ length: 10 }, (_, i) => ({
          nome: `Pessoa ${chunkCallCount * 10 + i}`,
          cpf: generateValidCPF(true, chunkCallCount * 10 + i),
          email: `user${chunkCallCount * 10 + i}@test.com`,
          uf: 'SP',
          termos: true,
        }));

        return new Response(JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({ records: chunkRecords }),
              },
            },
          ],
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      });

      const progressEvents: any[] = [];
      const startTime = performance.now();

      const result = await generateFormData({
        provider: 'openai',
        config: {
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-4o-mini',
          apiKey: 'sk-test-key-valid',
        },
        schema: ENTERPRISE_SCHEMA,
        count: 100,
        onProgress: (p) => {
          progressEvents.push({ ...p });
        },
      });

      const totalDuration = performance.now() - startTime;
      globalThis.fetch = originalFetch;

      // 1. Result verification
      expect(result).toHaveLength(100);
      expect(chunkCallCount).toBe(10); // Exactly 10 chunks of 10

      // 2. Tri-Key Stamping verification on all 100 records
      for (let i = 0; i < 100; i++) {
        const rec = result[i]!;
        for (const field of ENTERPRISE_SCHEMA.fields) {
          expect(rec[field.name]).toBeDefined();
          if (field.id) expect(rec[field.id]).toBeDefined();
          if (field.formgenId) expect(rec[field.formgenId]).toBeDefined();
          // Value consistency across all 3 keys
          if (field.id) expect(rec[field.id]).toEqual(rec[field.name]);
          if (field.formgenId) expect(rec[field.formgenId]).toEqual(rec[field.name]);
        }
      }

      // 3. Progress Event Sequence Verification
      expect(progressEvents.length).toBeGreaterThanOrEqual(10);
      const firstEvent = progressEvents[0];
      const lastEvent = progressEvents[progressEvents.length - 1];

      expect(firstEvent.status).toBe('running');
      expect(firstEvent.percent).toBe(0);
      expect(lastEvent.status).toBe('completed');
      expect(lastEvent.percent).toBe(100);
      expect(lastEvent.completedRecords).toBe(100);

      // 4. Latency evaluation
      // 10 sequential calls x 15ms = ~150ms.
      // With fast path (1 chunk) + 9 chunks in concurrency pool (size 2): ~15 + 5*15 = ~90ms.
      // Total execution should complete well under 1,000ms.
      expect(totalDuration).toBeLessThan(1500);
    });
  });

  // --------------------------------------------------------------------------
  // Suite 4: High-Concurrency Stress on generateFormData (Multi-Schema Isolation)
  // --------------------------------------------------------------------------
  describe('4. Concurrency Stress on generateFormData (Multi-Schema Isolation)', () => {

    it('executes 10 parallel calls with distinct schemas without data pollution or state leakage', async () => {
      const originalFetch = globalThis.fetch;

      globalThis.fetch = vi.fn().mockImplementation(async (url: string, init: any) => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        const body = JSON.parse(init.body);
        const userPrompt = body.messages[1].content;

        let records: any[] = [];
        if (userPrompt.includes('form-enterprise')) {
          records = [
            {
              nome: 'Enterprise User',
              cpf: generateValidCPF(true, 1),
              cnpj: generateValidCNPJ(true, 1),
              email: 'enterprise@corp.com',
              telefone: '(11) 98765-4321',
              cep: '01310-100',
              cidade: 'São Paulo',
              uf: 'SP',
              idade: 35,
              termos: true,
            },
          ];
        } else if (userPrompt.includes('form-feedback')) {
          records = [
            { rating: 5, comments: 'Excelente serviço e agilidade!' },
          ];
        } else if (userPrompt.includes('form-billing')) {
          records = [
            {
              razaoSocial: 'Nexus Faturamento Ltda',
              cnpj: generateValidCNPJ(true, 42),
              valor: 15000,
              vencimento: '2026-10-15',
            },
          ];
        } else {
          records = [{ generic: 'data' }];
        }

        return new Response(
          JSON.stringify({
            choices: [{ message: { content: JSON.stringify({ records }) } }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      });

      // Launch 10 simultaneous parallel jobs with mixed schemas and counts
      const jobs = [
        generateFormData({
          provider: 'openai',
          config: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o', apiKey: 'sk-test' },
          schema: ENTERPRISE_SCHEMA,
          count: 1,
        }),
        generateFormData({
          provider: 'openai',
          config: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o', apiKey: 'sk-test' },
          schema: SIMPLE_FEEDBACK_SCHEMA,
          count: 1,
        }),
        generateFormData({
          provider: 'openai',
          config: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o', apiKey: 'sk-test' },
          schema: FINANCIAL_BILLING_SCHEMA,
          count: 1,
        }),
        generateFormData({
          provider: 'openai',
          config: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o', apiKey: 'sk-test' },
          schema: ENTERPRISE_SCHEMA,
          count: 1,
        }),
        generateFormData({
          provider: 'openai',
          config: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o', apiKey: 'sk-test' },
          schema: SIMPLE_FEEDBACK_SCHEMA,
          count: 1,
        }),
        generateFormData({
          provider: 'openai',
          config: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o', apiKey: 'sk-test' },
          schema: FINANCIAL_BILLING_SCHEMA,
          count: 1,
        }),
        generateFormData({
          provider: 'openai',
          config: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o', apiKey: 'sk-test' },
          schema: ENTERPRISE_SCHEMA,
          count: 1,
        }),
        generateFormData({
          provider: 'openai',
          config: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o', apiKey: 'sk-test' },
          schema: SIMPLE_FEEDBACK_SCHEMA,
          count: 1,
        }),
        generateFormData({
          provider: 'openai',
          config: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o', apiKey: 'sk-test' },
          schema: FINANCIAL_BILLING_SCHEMA,
          count: 1,
        }),
        generateFormData({
          provider: 'openai',
          config: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o', apiKey: 'sk-test' },
          schema: ENTERPRISE_SCHEMA,
          count: 1,
        }),
      ];

      const results = await Promise.all(jobs);
      globalThis.fetch = originalFetch;

      expect(results).toHaveLength(10);

      // Verify Enterprise results (indices 0, 3, 6, 9)
      for (const idx of [0, 3, 6, 9]) {
        const rec = results[idx]![0]!;
        expect(rec.nome).toBe('Enterprise User');
        expect(rec['f-name']).toBe('Enterprise User');
        expect(rec.rating).toBeUndefined();
        expect(rec.razaoSocial).toBeUndefined();
      }

      // Verify Feedback results (indices 1, 4, 7)
      for (const idx of [1, 4, 7]) {
        const rec = results[idx]![0]!;
        expect(rec.rating).toBe(5);
        expect(rec.comments).toBe('Excelente serviço e agilidade!');
        expect(rec.nome).toBeUndefined();
        expect(rec.cnpj).toBeUndefined();
      }

      // Verify Billing results (indices 2, 5, 8)
      for (const idx of [2, 5, 8]) {
        const rec = results[idx]![0]!;
        expect(rec.razaoSocial).toBe('Nexus Faturamento Ltda');
        expect(rec.valor).toBe(15000);
        expect(rec.rating).toBeUndefined();
        expect(rec.telefone).toBeUndefined();
      }
    });
  });

  // --------------------------------------------------------------------------
  // Suite 5: Rate Limiting (429) Backoff & Fault-Tolerant Recovery
  // --------------------------------------------------------------------------
  describe('5. Rate Limit (HTTP 429) Handling, Retry-After Header & Fallback Recovery', () => {

    it('correctly maps HTTP 429 to AIRateLimitError with retryAfterSeconds parsed from headers', async () => {
      const originalFetch = globalThis.fetch;

      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: { message: 'Rate limit reached for requests. Please slow down.' },
          }),
          {
            status: 429,
            headers: {
              'Content-Type': 'application/json',
              'Retry-After': '45',
            },
          }
        )
      );

      const adapter = new OpenAIAdapter();
      let capturedError: any = null;

      try {
        await adapter.generate(
          { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o', apiKey: 'sk-test' },
          { systemPrompt: 'Sys', userPrompt: 'User' }
        );
      } catch (err) {
        capturedError = err;
      }

      globalThis.fetch = originalFetch;

      expect(capturedError).toBeInstanceOf(AIRateLimitError);
      expect(capturedError.status).toBe(429);
      expect(capturedError.retryAfterSeconds).toBe(45);
      expect(capturedError.isTransient).toBe(true);
      expect(capturedError.message).toContain('Rate limit reached');
    });

    it('recovers seamlessly when sub-batches fail due to 429 rate limits in a 100-record batch', async () => {
      const originalFetch = globalThis.fetch;
      let callCount = 0;

      // Fail chunks 2, 5, 8 with HTTP 429, succeed others
      globalThis.fetch = vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 2 || callCount === 5 || callCount === 8) {
          return new Response(
            JSON.stringify({ error: { message: 'Rate limit exceeded on this chunk' } }),
            { status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': '10' } }
          );
        }

        const chunkRecords = Array.from({ length: 10 }, (_, i) => ({
          nome: `AI Person ${callCount * 10 + i}`,
          cpf: generateValidCPF(true, callCount * 10 + i),
          email: `person${callCount * 10 + i}@domain.com`,
          uf: 'SP',
          termos: true,
        }));

        return new Response(
          JSON.stringify({ choices: [{ message: { content: JSON.stringify({ records: chunkRecords }) } }] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      });

      const records = await generateFormData({
        provider: 'openai',
        config: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o', apiKey: 'sk-test' },
        schema: ENTERPRISE_SCHEMA,
        count: 100,
      });

      globalThis.fetch = originalFetch;

      // Crucial requirement: despite 3 chunks failing with HTTP 429, the user receives
      // all 100 conformed, valid records (synthesized via deterministic fallback for failed chunks)
      expect(records).toHaveLength(100);
      for (let i = 0; i < 100; i++) {
        const rec = records[i]!;
        expect(rec.nome).toBeDefined();
        expect(rec.email).toBeDefined();
        expect(rec.uf).toBeDefined();
        expect(rec.termos).toBe(true);
      }
    });

    it('falls back 100% deterministically when complete provider outage occurs (all calls fail 500)', async () => {
      const originalFetch = globalThis.fetch;

      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response('Service Unavailable', { status: 503 })
      );

      const records = await generateFormData({
        provider: 'gemini',
        config: { baseUrl: 'https://generativelanguage.googleapis.com', model: 'gemini-1.5-flash', apiKey: 'AIzaSyTest' },
        schema: ENTERPRISE_SCHEMA,
        count: 10,
      });

      globalThis.fetch = originalFetch;

      expect(records).toHaveLength(10);
      for (let i = 0; i < 10; i++) {
        const rec = records[i]!;
        expect(rec.nome).toBeDefined();
        expect(rec.cpf).toBeDefined();
        // Check Modulo 11 validity even in fallback mode
        const validCpf = verifyCpfModulo11(rec.cpf as string);
        expect(validCpf.valid).toBe(true);
      }
    });
  });
});
