/**
 * FormGen - Multi-Provider AI Service & Structured Generation
 * Domain Heuristics, Modulo 11 Document Generators & Strict Option Matcher
 * Path: src/shared/ai/heuristics.ts
 */

import { FormField, FieldOption } from '../types';

// ============================================================================
// 1. Semantic Field Classification
// ============================================================================

export type FieldSemanticCategory =
  | 'PERSON_NAME'
  | 'EMAIL'
  | 'CPF'
  | 'CNPJ'
  | 'PHONE'
  | 'DATE_BIRTH'
  | 'CEP'
  | 'STATE_UF'
  | 'CITY'
  | 'ADDRESS_STREET'
  | 'ADDRESS_NUMBER'
  | 'ADDRESS_COMPLEMENT'
  | 'ADDRESS_NEIGHBORHOOD'
  | 'COMPANY_NAME'
  | 'TERMS_ACCEPTANCE'
  | 'BIO_TEXT'
  | 'GENERIC_NUMBER'
  | 'GENERIC_DATE'
  | 'GENERIC_TEXT';

/**
 * Classifies a form field into a semantic category based on its label,
 * HTML name, id, placeholder, and validation rules.
 */
export function classifyFieldSemantics(field: FormField): FieldSemanticCategory {
  const text = `${field.label} ${field.name} ${field.id || ''} ${field.placeholder || ''}`.toLowerCase();
  const pattern = field.validation?.pattern || '';

  if (/cpf|cadastro.*pessoa.*f[ií]sica/i.test(text) || /\\d\{3\}.*\\d\{3\}.*\\d\{3\}/.test(pattern)) {
    return 'CPF';
  }
  if (/cnpj|cadastro.*pessoa.*jur[ií]dica/i.test(text) || /\\d\{2\}.*\\d\{3\}.*\\d\{3\}\/\\d\{4\}/.test(pattern)) {
    return 'CNPJ';
  }
  if (field.type === 'email' || /email|e-mail|correio/i.test(text)) {
    return 'EMAIL';
  }
  if (field.type === 'tel' || /tel|fone|phone|celular|whatsapp/i.test(text)) {
    return 'PHONE';
  }
  if (/nascimento|birth|anivers[aá]rio/i.test(text)) {
    return 'DATE_BIRTH';
  }
  if (/cep|postal|zip/i.test(text) || /\\d\{5\}-?\\d\{3\}/.test(pattern)) {
    return 'CEP';
  }
  if (/estado|uf|state/i.test(text)) {
    return 'STATE_UF';
  }
  if (/cidade|city|municipio|município/i.test(text)) {
    return 'CITY';
  }
  if (/rua|endereco|endereço|logradouro|street|address/i.test(text)) {
    return 'ADDRESS_STREET';
  }
  if (/numero|número|number|num/i.test(text)) {
    return 'ADDRESS_NUMBER';
  }
  if (/complemento|apto|sala|bloco/i.test(text)) {
    return 'ADDRESS_COMPLEMENT';
  }
  if (/bairro|neighborhood/i.test(text)) {
    return 'ADDRESS_NEIGHBORHOOD';
  }
  if (/razao.*social|empresa|company/i.test(text)) {
    return 'COMPANY_NAME';
  }
  if (/nome|fullname|name|first.*name|last.*name|colaborador/i.test(text)) {
    return 'PERSON_NAME';
  }
  if (/termo|aceite|concordo|politica|privacidade|terms|policy/i.test(text)) {
    return 'TERMS_ACCEPTANCE';
  }
  if (field.type === 'textarea' || /bio|sobre|descricao|descrição|mensagem|comentario/i.test(text)) {
    return 'BIO_TEXT';
  }
  if (field.type === 'number') return 'GENERIC_NUMBER';
  if (field.type === 'date') return 'GENERIC_DATE';

  return 'GENERIC_TEXT';
}

// ============================================================================
// 2. Strict Option Matching Algorithm (6-Tier Cascade)
// ============================================================================

/**
 * Resolves an AI-generated value against declared options for select and radio controls.
 * Ensures the returned value strictly exists in the field's options array.
 */
export function resolveOptionMatch(
  aiValue: any,
  options: FieldOption[]
): string {
  if (!options || options.length === 0) return String(aiValue ?? '');
  if (aiValue === undefined || aiValue === null) return options[0]?.value ?? '';

  const rawCandidate = String(aiValue).trim();
  const lowerCandidate = rawCandidate.toLowerCase();

  // Tier 1: Exact case-sensitive match with option.value
  const exactVal = options.find((o) => o.value === rawCandidate);
  if (exactVal) return exactVal.value;

  // Tier 2: Case-insensitive match with option.value
  const ciVal = options.find((o) => o.value.toLowerCase() === lowerCandidate);
  if (ciVal) return ciVal.value;

  // Tier 3: Exact match with option.label (e.g. AI returned "São Paulo (SP)" instead of "SP")
  const exactLabel = options.find((o) => o.label === rawCandidate);
  if (exactLabel) return exactLabel.value;

  // Tier 4: Case-insensitive match with option.label
  const ciLabel = options.find((o) => o.label.toLowerCase() === lowerCandidate);
  if (ciLabel) return ciLabel.value;

  // Tier 5: Substring / Token containment match (e.g. "CLT" matches "CLT Efetivo")
  const tokenMatch = options.find(
    (o) =>
      o.label.toLowerCase().includes(lowerCandidate) ||
      lowerCandidate.includes(o.label.toLowerCase()) ||
      o.value.toLowerCase().includes(lowerCandidate) ||
      lowerCandidate.includes(o.value.toLowerCase())
  );
  if (tokenMatch) return tokenMatch.value;

  // Tier 6: Safe fallback to first declared option
  return options[0]?.value ?? '';
}

// ============================================================================
// 3. Algorithmic Checksum Generators (Modulo 11)
// ============================================================================

/**
 * Generates a mathematically valid Brazilian CPF with Modulo 11 check digits.
 * Deterministic when seed is provided, pseudorandom otherwise.
 */
export function generateValidCPF(formatted = true, seed?: number): string {
  const digits: number[] = [];
  for (let i = 0; i < 9; i++) {
    if (seed !== undefined) {
      digits.push((seed * 7 + i * 3 + 1) % 10);
    } else {
      digits.push(Math.floor(Math.random() * 10));
    }
  }

  // First check digit (Modulo 11)
  let s1 = 0;
  for (let i = 0; i < 9; i++) {
    s1 += digits[i]! * (10 - i);
  }
  const r1 = s1 % 11;
  const dv1 = r1 < 2 ? 0 : 11 - r1;
  digits.push(dv1);

  // Second check digit (Modulo 11)
  let s2 = 0;
  for (let i = 0; i < 10; i++) {
    s2 += digits[i]! * (11 - i);
  }
  const r2 = s2 % 11;
  const dv2 = r2 < 2 ? 0 : 11 - r2;
  digits.push(dv2);

  const raw = digits.join('');
  if (!formatted) return raw;
  return `${raw.slice(0, 3)}.${raw.slice(3, 6)}.${raw.slice(6, 9)}-${raw.slice(9, 11)}`;
}

/**
 * Generates a mathematically valid Brazilian CNPJ with Modulo 11 check digits.
 */
export function generateValidCNPJ(formatted = true, seed?: number): string {
  const digits: number[] = [];
  for (let i = 0; i < 8; i++) {
    if (seed !== undefined) {
      digits.push((seed * 5 + i * 2 + 1) % 10);
    } else {
      digits.push(Math.floor(Math.random() * 10));
    }
  }
  // Standard matriz branch: 0001
  digits.push(0, 0, 0, 1);

  const w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  let s1 = 0;
  for (let i = 0; i < 12; i++) {
    s1 += digits[i]! * w1[i]!;
  }
  const r1 = s1 % 11;
  const dv1 = r1 < 2 ? 0 : 11 - r1;
  digits.push(dv1);

  const w2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  let s2 = 0;
  for (let i = 0; i < 13; i++) {
    s2 += digits[i]! * w2[i]!;
  }
  const r2 = s2 % 11;
  const dv2 = r2 < 2 ? 0 : 11 - r2;
  digits.push(dv2);

  const raw = digits.join('');
  if (!formatted) return raw;
  return `${raw.slice(0, 2)}.${raw.slice(2, 5)}.${raw.slice(5, 8)}/${raw.slice(8, 12)}-${raw.slice(12, 14)}`;
}

/**
 * Generates a realistic Brazilian phone number with area code (DDD).
 */
export function generateValidPhone(mobile = true, formatted = true, seed = 0): string {
  const ddds = [11, 19, 21, 31, 41, 51, 61, 71, 81, 85, 92];
  const ddd = ddds[seed % ddds.length];
  const firstPart = mobile
    ? `9${String(1000 + (seed * 137) % 9000).padStart(4, '0')}`
    : `${String(2000 + (seed * 137) % 2000).padStart(4, '0')}`;
  const secondPart = String(1000 + (seed * 251) % 9000).padStart(4, '0');

  if (!formatted) return `${ddd}${firstPart}${secondPart}`;
  return `(${ddd}) ${firstPart}-${secondPart}`;
}

/**
 * Generates a realistic Brazilian CEP (postal code).
 */
export function generateValidCEP(formatted = true, seed = 0): string {
  const prefix = String(10000 + (seed * 349) % 89999).padStart(5, '0');
  const suffix = String(100 + (seed * 123) % 899).padStart(3, '0');
  if (!formatted) return `${prefix}${suffix}`;
  return `${prefix}-${suffix}`;
}

// ============================================================================
// 4. Deterministic Synthetic Field Fallback Generator
// ============================================================================

const FIRST_NAMES = [
  'Lucas',
  'Mariana',
  'Rodrigo',
  'Juliana',
  'Gabriel',
  'Camila',
  'Bruno',
  'Beatriz',
  'Felipe',
  'Fernanda',
  'Carlos',
  'Amanda',
  'Thiago',
  'Larissa',
  'Rafael',
];

const LAST_NAMES = [
  'Silva',
  'Santos',
  'Oliveira',
  'Souza',
  'Rodrigues',
  'Ferreira',
  'Albuquerque',
  'Costa',
  'Pereira',
  'Lima',
  'Alves',
  'Mendes',
  'Carvalho',
  'Ribeiro',
  'Gomes',
];

/**
 * Generates a realistic, schema-compliant synthetic fallback value for any form field.
 * Guarantees zero empty or invalid entries even when LLM output is partial or missing.
 */
export function generateDeterministicFallback(field: FormField, recordIndex = 0): any {
  if (field.options && field.options.length > 0) {
    return field.options[recordIndex % field.options.length]!.value;
  }

  if (field.type === 'checkbox') {
    return field.required ? true : recordIndex % 2 === 0;
  }

  const category = classifyFieldSemantics(field);
  const firstName = FIRST_NAMES[recordIndex % FIRST_NAMES.length]!;
  const lastName = LAST_NAMES[(recordIndex * 2 + 1) % LAST_NAMES.length]!;

  switch (category) {
    case 'PERSON_NAME':
      return `${firstName} ${lastName}`;

    case 'EMAIL':
      return `${firstName.toLowerCase()}.${lastName.toLowerCase()}${recordIndex + 1}@exemplo.com.br`;

    case 'CPF': {
      const isUnformatted = field.validation?.pattern?.includes('^\\d{11}$');
      return generateValidCPF(!isUnformatted, recordIndex);
    }

    case 'CNPJ':
      return generateValidCNPJ(true, recordIndex);

    case 'PHONE':
      return generateValidPhone(true, true, recordIndex);

    case 'DATE_BIRTH': {
      const year = 1975 + (recordIndex % 30);
      const month = String(1 + (recordIndex % 12)).padStart(2, '0');
      const day = String(10 + (recordIndex % 18)).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }

    case 'CEP':
      return generateValidCEP(true, recordIndex);

    case 'STATE_UF':
      return 'SP';

    case 'CITY':
      return 'São Paulo';

    case 'ADDRESS_STREET':
      return `Avenida Paulista, ${100 + recordIndex * 10}`;

    case 'ADDRESS_NUMBER':
      return String(100 + (recordIndex * 17) % 900);

    case 'ADDRESS_COMPLEMENT':
      return `Apto ${(recordIndex % 15) + 1}0${(recordIndex % 4) + 1}`;

    case 'ADDRESS_NEIGHBORHOOD':
      return 'Bela Vista';

    case 'COMPANY_NAME':
      return `Nexus ${lastName} Tecnologia Ltda`;

    case 'TERMS_ACCEPTANCE':
      return true;

    case 'BIO_TEXT':
      return `Profissional especializado com sólida experiência técnica e dedicação contínua em projetos de desenvolvimento de software e testes automatizados.`;

    case 'GENERIC_NUMBER': {
      const min = typeof field.validation?.min === 'number' ? field.validation.min : 18;
      const max = typeof field.validation?.max === 'number' ? field.validation.max : 65;
      const step = typeof field.validation?.step === 'number' ? field.validation.step : 1;
      const range = Math.max(1, Math.floor((max - min) / step + 1));
      return min + (recordIndex % range) * step;
    }

    case 'GENERIC_DATE': {
      const year = 2024;
      const month = String(1 + (recordIndex % 12)).padStart(2, '0');
      const day = String(1 + (recordIndex % 28)).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }

    default: {
      const base = field.label || field.name || 'Registro';
      let text = `${base} ${recordIndex + 1}`;
      if (field.validation?.minLength && text.length < field.validation.minLength) {
        text = text.padEnd(field.validation.minLength, 'x');
      }
      if (field.validation?.maxLength && text.length > field.validation.maxLength) {
        text = text.substring(0, field.validation.maxLength);
      }
      return text;
    }
  }
}
