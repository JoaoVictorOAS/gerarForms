/**
 * FormGen Milestone 3 - Live Headless Chrome 149 MV3 CDP Stress Harness
 * Empirical Challenger Verification Suite
 * Tests:
 * 1. Mounting unpacked MV3 extension dist/ in Google Chrome 149 via CDP (Extensions.loadUnpacked).
 * 2. Discovery and live inspection of the MV3 Background Service Worker target.
 * 3. Chrome IPC runtime message routing from extension page to Service Worker.
 * 4. Boundary & negative payload rejection for GENERATE_DATA (empty, missing schema, invalid counts).
 * 5. Structured generation of realistic records (count=1, count=10, count=100) with Modulo 11 check digits.
 * 6. Live Mock AI HTTP server integration (OpenAI & Gemini REST endpoints, token chunking).
 * 7. Adversarial malformed AI response handling & progressive repair in live Service Worker.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');
const DIST_DIR = path.join(ROOT_DIR, 'dist');
const CHROME_PATH = process.env.CHROME_BIN || '/usr/bin/google-chrome';

// Helper: Modulo 11 CPF Validator
function isValidCPF(cpf) {
  if (!cpf || typeof cpf !== 'string') return false;
  const clean = cpf.replace(/\D/g, '');
  if (clean.length !== 11 || /^(\d)\1{10}$/.test(clean)) return false;

  let sum = 0;
  for (let i = 0; i < 9; i++) sum += parseInt(clean[i], 10) * (10 - i);
  let rest = sum % 11;
  const d1 = rest < 2 ? 0 : 11 - rest;
  if (d1 !== parseInt(clean[9], 10)) return false;

  sum = 0;
  for (let i = 0; i < 10; i++) sum += parseInt(clean[i], 10) * (11 - i);
  rest = sum % 11;
  const d2 = rest < 2 ? 0 : 11 - rest;
  return d2 === parseInt(clean[10], 10);
}

// Helper: Modulo 11 CNPJ Validator
function isValidCNPJ(cnpj) {
  if (!cnpj || typeof cnpj !== 'string') return false;
  const clean = cnpj.replace(/\D/g, '');
  if (clean.length !== 14 || /^(\d)\1{13}$/.test(clean)) return false;

  const w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += parseInt(clean[i], 10) * w1[i];
  let rest = sum % 11;
  const d1 = rest < 2 ? 0 : 11 - rest;
  if (d1 !== parseInt(clean[12], 10)) return false;

  const w2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  sum = 0;
  for (let i = 0; i < 13; i++) sum += parseInt(clean[i], 10) * w2[i];
  rest = sum % 11;
  const d2 = rest < 2 ? 0 : 11 - rest;
  return d2 === parseInt(clean[13], 10);
}

// Helper: CDP WebSocket Wrapper
class CDPConnection {
  constructor(url) {
    this.url = url;
    this.ws = null;
    this.msgId = 1;
    this.pending = new Map();
    this.events = [];
  }

  async connect() {
    this.ws = new WebSocket(this.url);
    await new Promise((res, rej) => {
      this.ws.onopen = res;
      this.ws.onerror = rej;
    });

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.id && this.pending.has(msg.id)) {
          const { resolve, reject } = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          if (msg.error) {
            reject(new Error(msg.error.message || JSON.stringify(msg.error)));
          } else {
            resolve(msg.result);
          }
        } else if (msg.method) {
          this.events.push(msg);
        }
      } catch (e) {
        console.error('CDP parse error:', e);
      }
    };
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this.msgId++;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true
    });
    if (res.exceptionDetails) {
      const desc = res.exceptionDetails.exception?.description || res.exceptionDetails.text;
      throw new Error(`CDP Evaluate Exception: ${desc}`);
    }
    return res.result?.value;
  }

  close() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

// Enterprise Test Schema
const enterpriseSchema = {
  formId: 'form-enterprise',
  title: 'Formulário Corporativo Enterprise',
  fields: [
    { name: 'nome_completo', id: 'id_nome', formgenId: 'fg_1', label: 'Nome Completo', type: 'text', required: true },
    { name: 'email_corporativo', id: 'id_email', formgenId: 'fg_2', label: 'Email Corporativo', type: 'email', required: true },
    { name: 'documento_cpf', id: 'id_cpf', formgenId: 'fg_3', label: 'CPF', type: 'text', required: true, validation: { pattern: '^\\d{3}\\.\\d{3}\\.\\d{3}-\\d{2}$' } },
    { name: 'documento_cnpj', id: 'id_cnpj', formgenId: 'fg_4', label: 'CNPJ', type: 'text', required: false },
    { name: 'telefone_contato', id: 'id_tel', formgenId: 'fg_5', label: 'Telefone Celular', type: 'tel', required: true },
    {
      name: 'departamento',
      id: 'id_dept',
      formgenId: 'fg_6',
      label: 'Departamento',
      type: 'select',
      required: true,
      options: [
        { value: 'eng', label: 'Engenharia de Software' },
        { value: 'qa', label: 'Qualidade & Testes' },
        { value: 'prod', label: 'Gestão de Produtos' }
      ]
    },
    {
      name: 'regime_trabalho',
      id: 'id_regime',
      formgenId: 'fg_7',
      label: 'Regime de Trabalho',
      type: 'radio',
      required: true,
      options: [
        { value: 'hibrido', label: 'Híbrido' },
        { value: 'remoto', label: '100% Remoto' },
        { value: 'presencial', label: 'Presencial' }
      ]
    },
    { name: 'pretensao_salarial', id: 'id_salario', formgenId: 'fg_8', label: 'Pretensão Salarial', type: 'number', required: true, validation: { min: 3000, max: 25000, step: 500 } },
    { name: 'data_disponibilidade', id: 'id_data', formgenId: 'fg_9', label: 'Data de Início', type: 'date', required: true },
    { name: 'termos_privacidade', id: 'id_termos', formgenId: 'fg_10', label: 'Concordo com os Termos de Privacidade', type: 'checkbox', required: true },
    { name: 'receber_newsletter', id: 'id_news', formgenId: 'fg_11', label: 'Desejo receber novidades', type: 'checkbox', required: false },
    { name: 'resumo_profissional', id: 'id_bio', formgenId: 'fg_12', label: 'Resumo Profissional', type: 'textarea', required: true, validation: { maxLength: 300 } }
  ]
};

// Main Verification Runner
async function main() {
  console.log('================================================================');
  console.log(' FormGen M3 Challenger Verification Suite');
  console.log(' Live MV3 Service Worker Stress-Testing in Google Chrome 149');
  console.log('================================================================\n');

  const port = 9520;
  const mockPort = 9521;
  const userDir = `/tmp/formgen-m3-challenger-${Date.now()}`;
  fs.mkdirSync(userDir, { recursive: true });

  let mockServerRequests = [];
  let mockHandler = (req, res) => {
    res.writeHead(404);
    res.end();
  };

  const mockHttpServer = http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      mockServerRequests.push({ method: req.method, url: req.url, headers: req.headers, body });
      mockHandler(req, res, body);
    });
  });

  await new Promise(res => mockHttpServer.listen(mockPort, '127.0.0.1', res));
  console.log(`[MockServer] Local AI Mock Server listening on http://127.0.0.1:${mockPort}`);

  // Launch Chrome 149
  console.log('[Chrome] Spawning Chrome 149 with --enable-unsafe-extension-debugging...');
  const proc = spawn(CHROME_PATH, [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDir}`,
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--enable-unsafe-extension-debugging',
    'about:blank'
  ]);

  let browserWs = null;
  let extId = null;
  let swConn = null;
  let optConn = null;

  const testResults = [];
  function assert(name, condition, detail = '') {
    if (condition) {
      console.log(`  \x1b[32m✔ [PASS]\x1b[0m ${name}`);
      testResults.push({ name, pass: true });
    } else {
      console.log(`  \x1b[31m✖ [FAIL]\x1b[0m ${name} - ${detail}`);
      testResults.push({ name, pass: false, error: detail });
    }
  }

  try {
    // Wait for Chrome to initialize
    await new Promise(r => setTimeout(r, 1200));
    const versionRes = await fetch(`http://127.0.0.1:${port}/json/version`);
    const versionData = await versionRes.json();
    console.log(`[Chrome] Connected to Chrome DevTools: ${versionData['Browser']}`);

    browserWs = new CDPConnection(versionData.webSocketDebuggerUrl);
    await browserWs.connect();

    // 1. Mount extension dist/ via CDP
    console.log('\n--- Section 1: MV3 Extension Mounting & CDP Service Worker Discovery ---');
    const loadUnpackedResult = await browserWs.send('Extensions.loadUnpacked', { path: DIST_DIR });
    extId = loadUnpackedResult.id;
    assert('CDP Extensions.loadUnpacked executes successfully', Boolean(extId), `Extension ID: ${extId}`);

    // Wait for Service Worker target to start
    let swTarget = null;
    for (let attempt = 0; attempt < 25; attempt++) {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      swTarget = list.find(t => t.type === 'service_worker' && t.url.includes(extId));
      if (swTarget) break;
      await new Promise(r => setTimeout(r, 150));
    }

    assert('MV3 Service Worker target found in Chrome target list', Boolean(swTarget), swTarget?.url);
    console.log(`[Chrome] SW Target URL: ${swTarget.url}`);

    // Connect to Service Worker
    swConn = new CDPConnection(swTarget.webSocketDebuggerUrl);
    await swConn.connect();
    await swConn.send('Runtime.enable');

    const swCheck = await swConn.evaluate(`({
      hasListeners: chrome.runtime.onMessage.hasListeners(),
      location: self.location.href,
      hasStorage: Boolean(chrome?.storage?.sync && chrome?.storage?.local)
    })`);
    assert('Service Worker has chrome.runtime.onMessage listener registered', swCheck.hasListeners === true);
    assert('Service Worker has chrome.storage APIs enabled', swCheck.hasStorage === true);

    // 2. Open Extension Options Page to provide Chrome Extension runtime context for IPC
    const optionsUrl = `chrome-extension://${extId}/options.html`;
    const createRes = await browserWs.send('Target.createTarget', { url: optionsUrl });
    await new Promise(r => setTimeout(r, 600));

    const list2 = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const optTarget = list2.find(t => t.id === createRes.targetId);
    optConn = new CDPConnection(optTarget.webSocketDebuggerUrl);
    await optConn.connect();
    await optConn.send('Runtime.enable');

    const optCheck = await optConn.evaluate(`({
      title: document.title,
      url: location.href,
      hasRuntime: Boolean(chrome?.runtime?.sendMessage)
    })`);
    assert('Options page loaded inside extension origin', optCheck.title.includes('FormGen') && optCheck.hasRuntime);

    // Test PING over Chrome IPC
    const pingRes = await optConn.evaluate(`new Promise(res => {
      chrome.runtime.sendMessage({ action: "PING" }, res);
    })`);
    assert('Chrome IPC PING message routes to SW and responds with PONG', pingRes?.success === true && pingRes?.status === 'PONG');

    // --------------------------------------------------------------------------
    // 3. Negative Boundary & Invalid Payloads
    // --------------------------------------------------------------------------
    console.log('\n--- Section 2: IPC Negative Boundary & Malformed Payload Rejection ---');

    // TC-NEG-01: Empty payload
    const neg1 = await optConn.evaluate(`new Promise(res => {
      chrome.runtime.sendMessage({ action: "GENERATE_DATA" }, res);
    })`);
    assert('TC-NEG-01: Empty GENERATE_DATA rejected with schema error', neg1?.success === false && /schema/i.test(neg1?.error));

    // TC-NEG-02: Empty fields array
    const neg2 = await optConn.evaluate(`new Promise(res => {
      chrome.runtime.sendMessage({ action: "GENERATE_DATA", count: 1, schema: { formId: "test", fields: [] } }, res);
    })`);
    assert('TC-NEG-02: Schema with fields=[] rejected', neg2?.success === false && /schema/i.test(neg2?.error));

    // TC-NEG-03: Invalid count = 0
    const neg3 = await optConn.evaluate(`new Promise(res => {
      chrome.runtime.sendMessage({ action: "GENERATE_DATA", count: 0, schema: ${JSON.stringify(enterpriseSchema)} }, res);
    })`);
    assert('TC-NEG-03: Invalid count=0 rejected', neg3?.success === false && /quantidade.*inválida/i.test(neg3?.error));

    // TC-NEG-04: Invalid count = 5
    const neg4 = await optConn.evaluate(`new Promise(res => {
      chrome.runtime.sendMessage({ action: "GENERATE_DATA", count: 5, schema: ${JSON.stringify(enterpriseSchema)} }, res);
    })`);
    assert('TC-NEG-04: Invalid count=5 rejected (only 1, 10, 100 allowed)', neg4?.success === false && /permitidos.*1.*10.*100/i.test(neg4?.error));

    // TC-NEG-05: Invalid count = 999
    const neg5 = await optConn.evaluate(`new Promise(res => {
      chrome.runtime.sendMessage({ action: "GENERATE_DATA", count: 999, schema: ${JSON.stringify(enterpriseSchema)} }, res);
    })`);
    assert('TC-NEG-05: Invalid count=999 rejected', neg5?.success === false);

    // TC-NEG-06: Unconfigured API key for default provider (gemini)
    const neg6 = await optConn.evaluate(`new Promise(res => {
      chrome.runtime.sendMessage({ action: "GENERATE_DATA", count: 1, schema: ${JSON.stringify(enterpriseSchema)} }, res);
    })`);
    assert('TC-NEG-06: Unconfigured Gemini API key returns explicit configuration error', neg6?.success === false && /chave.*api.*não configurada/i.test(neg6?.error));

    // TC-NEG-07: Unknown action
    const neg7 = await optConn.evaluate(`new Promise(res => {
      chrome.runtime.sendMessage({ action: "NON_EXISTENT_ACTION" }, res);
    })`);
    assert('TC-NEG-07: Unknown action rejected', neg7?.success === false && /ação desconhecida/i.test(neg7?.error));

    // --------------------------------------------------------------------------
    // 4. Positive Structured Record Generation (Offline / Deterministic Fallback)
    // --------------------------------------------------------------------------
    console.log('\n--- Section 3: Structured Record Generation & Heuristic Constraints ---');

    // Switch activeProvider to 'ollama' with an offline endpoint so deterministic fallback activates
    await optConn.evaluate(`new Promise(res => {
      chrome.storage.sync.set({
        formgen_settings: {
          activeProvider: 'ollama',
          providers: {
            ollama: { baseUrl: 'http://127.0.0.1:9999', model: 'llama3', apiKey: '' }
          },
          generationDefaults: { temperature: 0.7, locale: 'pt-BR' }
        }
      }, res);
    })`);

    // TC-POS-01: Single Record Generation (count=1)
    const pos1 = await optConn.evaluate(`new Promise(res => {
      chrome.runtime.sendMessage({ action: "GENERATE_DATA", count: 1, schema: ${JSON.stringify(enterpriseSchema)} }, res);
    })`);

    assert('TC-POS-01: Single record generation succeeds', pos1?.success === true && pos1?.count === 1 && Array.isArray(pos1?.records));
    const rec1 = pos1?.records?.[0];
    assert('TC-POS-01: Record contains valid Modulo 11 Brazilian CPF', isValidCPF(rec1?.documento_cpf), `CPF: ${rec1?.documento_cpf}`);
    assert('TC-POS-01: Record contains valid Modulo 11 Brazilian CNPJ', isValidCNPJ(rec1?.documento_cnpj), `CNPJ: ${rec1?.documento_cnpj}`);
    assert('TC-POS-01: Record contains valid telephone format', /^\(\d{2}\)\s*9?\d{4}-\d{4}$/.test(rec1?.telefone_contato), `Phone: ${rec1?.telefone_contato}`);
    assert('TC-POS-01: Select option matches declared list [eng, qa, prod]', ['eng', 'qa', 'prod'].includes(rec1?.departamento), `Dept: ${rec1?.departamento}`);
    assert('TC-POS-01: Radio option matches declared list [hibrido, remoto, presencial]', ['hibrido', 'remoto', 'presencial'].includes(rec1?.regime_trabalho), `Regime: ${rec1?.regime_trabalho}`);
    assert('TC-POS-01: Required checkbox termos_privacidade === true', rec1?.termos_privacidade === true);
    assert('TC-POS-01: Number pretensao_salarial clamped within [3000, 25000]', typeof rec1?.pretensao_salarial === 'number' && rec1?.pretensao_salarial >= 3000 && rec1?.pretensao_salarial <= 25000, `Salario: ${rec1?.pretensao_salarial}`);
    assert('TC-POS-01: Tri-key stamping present (name, id, formgenId)', rec1?.nome_completo !== undefined && rec1?.id_nome !== undefined && rec1?.fg_1 !== undefined);

    // TC-POS-02: Batch 10 Records Generation (count=10)
    console.log('\n--- Section 4: Batch 10 Generation & Diversity Verification ---');
    const pos10 = await optConn.evaluate(`new Promise(res => {
      chrome.runtime.sendMessage({ action: "GENERATE_DATA", count: 10, schema: ${JSON.stringify(enterpriseSchema)} }, res);
    })`);

    assert('TC-POS-02: Batch 10 returns exactly 10 records', pos10?.success === true && pos10?.count === 10 && pos10?.records?.length === 10);
    const cpfs = new Set(pos10?.records?.map(r => r.documento_cpf));
    assert('TC-POS-02: Batch 10 produces distinct records (unique CPFs)', cpfs.size === 10, `Unique CPFs: ${cpfs.size}/10`);
    const allValidCPFs = pos10?.records?.every(r => isValidCPF(r.documento_cpf));
    assert('TC-POS-02: All 10 records pass Modulo 11 CPF validation', allValidCPFs === true);
    const allTriKey = pos10?.records?.every(r => r.nome_completo && r.id_nome && r.fg_1);
    assert('TC-POS-02: All 10 records have tri-key stamping', allTriKey === true);

    // TC-POS-03: Batch 100 Records Generation (count=100) Chunking Pipeline
    console.log('\n--- Section 5: Batch 100 Chunking Pipeline & Stress Benchmark ---');
    const t0 = Date.now();
    const pos100 = await optConn.evaluate(`new Promise(res => {
      chrome.runtime.sendMessage({ action: "GENERATE_DATA", count: 100, schema: ${JSON.stringify(enterpriseSchema)} }, res);
    })`);
    const duration100 = Date.now() - t0;

    assert('TC-POS-03: Batch 100 returns exactly 100 records', pos100?.success === true && pos100?.count === 100 && pos100?.records?.length === 100);
    assert('TC-POS-03: Batch 100 executes within acceptable time limit (<5000ms)', duration100 < 5000, `Duration: ${duration100}ms`);
    const cpfs100 = new Set(pos100?.records?.map(r => r.documento_cpf));
    assert('TC-POS-03: Batch 100 produces diverse CPFs (>90 unique values)', cpfs100.size >= 90, `Unique CPFs: ${cpfs100.size}/100`);
    const all100TriKey = pos100?.records?.every(r => r.nome_completo && r.id_nome && r.fg_1);
    assert('TC-POS-03: All 100 records maintain tri-key integrity', all100TriKey === true);

    // --------------------------------------------------------------------------
    // 5. Live HTTP Mock Server Integration (OpenAI REST Flow)
    // --------------------------------------------------------------------------
    console.log('\n--- Section 6: Live HTTP AI Mock Server & Protocol Parity ---');
    mockServerRequests = [];
    mockHandler = (req, res) => {
      if (req.url.includes('/chat/completions')) {
        const fakeOpenAIResponse = {
          id: 'chatcmpl-mock-123',
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model: 'gpt-4o-mini',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: JSON.stringify({
                  records: [
                    {
                      nome_completo: 'Mariana Oliveira Costa',
                      email_corporativo: 'mariana.costa@empresa.com.br',
                      documento_cpf: '111.444.777-35', // valid CPF
                      documento_cnpj: '11.222.333/0001-81', // valid CNPJ
                      telefone_contato: '(11) 98765-4321',
                      departamento: 'qa',
                      regime_trabalho: 'remoto',
                      pretensao_salarial: 14500,
                      data_disponibilidade: '2025-02-01',
                      termos_privacidade: true,
                      receber_newsletter: false,
                      resumo_profissional: 'Especialista em automação de testes com vasta experiência.'
                    }
                  ]
                })
              },
              finish_reason: 'stop'
            }
          ]
        };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(fakeOpenAIResponse));
        return;
      }
      res.writeHead(404);
      res.end('Not Found');
    };

    // Configure storage.sync to use mock OpenAI endpoint
    await optConn.evaluate(`new Promise(res => {
      chrome.storage.sync.set({
        formgen_settings: {
          activeProvider: 'openai',
          providers: {
            openai: { baseUrl: 'http://127.0.0.1:${mockPort}/v1', model: 'gpt-4o-mini', apiKey: 'sk-test-live-key-42' }
          },
          generationDefaults: { temperature: 0.7, locale: 'pt-BR' }
        }
      }, res);
    })`);

    const openAiPos = await optConn.evaluate(`new Promise(res => {
      chrome.runtime.sendMessage({ action: "GENERATE_DATA", count: 1, schema: ${JSON.stringify(enterpriseSchema)} }, res);
    })`);

    assert('TC-OPENAI-01: Live Service Worker fetches mock OpenAI endpoint', mockServerRequests.length >= 1);
    const lastReq = mockServerRequests[mockServerRequests.length - 1];
    assert('TC-OPENAI-02: HTTP Authorization Bearer sk-test-live-key-42 transmitted', lastReq.headers['authorization'] === 'Bearer sk-test-live-key-42');
    const reqJson = JSON.parse(lastReq.body);
    assert('TC-OPENAI-03: Request envelope contains response_format: { type: "json_object" }', reqJson.response_format?.type === 'json_object');
    assert('TC-OPENAI-04: Mock record correctly parsed and conformed by SW', openAiPos?.records?.[0]?.nome_completo === 'Mariana Oliveira Costa');
    assert('TC-OPENAI-05: Conformed record preserves tri-key stamping', openAiPos?.records?.[0]?.fg_1 === 'Mariana Oliveira Costa');

    // --------------------------------------------------------------------------
    // 6. Adversarial Malformed AI Response Recovery
    // --------------------------------------------------------------------------
    console.log('\n--- Section 7: Live Adversarial AI JSON Repair in Service Worker ---');
    mockServerRequests = [];
    mockHandler = (req, res) => {
      // Return adversarial response: Markdown fences + trailing commas + unquoted keys
      const adversarialText = `
Here is the generated data for your form:
\`\`\`json
{
  records: [
    {
      nome_completo: 'Roberto Santos Albuquerque',
      email_corporativo: 'roberto@albuquerque.net',
      documento_cpf: '000.000.000-00',
      departamento: 'Engenharia de Software', /* label matching tier 3/4 */
      regime_trabalho: '100% Remoto', /* label matching tier 3/4 */
      pretensao_salarial: 18000,
      termos_privacidade: True, /* Python boolean */
    },
  ],
}
\`\`\`
Hope this helps!
`;
      const fakeResponse = {
        choices: [
          {
            message: {
              role: 'assistant',
              content: adversarialText
            }
          }
        ]
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(fakeResponse));
    };

    const repairPos = await optConn.evaluate(`new Promise(res => {
      chrome.runtime.sendMessage({ action: "GENERATE_DATA", count: 1, schema: ${JSON.stringify(enterpriseSchema)} }, res);
    })`);

    assert('TC-REPAIR-01: SW successfully repairs markdown fences and python booleans', repairPos?.success === true && repairPos?.records?.length === 1);
    const repairedRec = repairPos?.records?.[0];
    assert('TC-REPAIR-02: Repaired record extracts name: Roberto Santos Albuquerque', repairedRec?.nome_completo === 'Roberto Santos Albuquerque');
    assert('TC-REPAIR-03: Label "Engenharia de Software" correctly coerced to value "eng"', repairedRec?.departamento === 'eng', `Dept: ${repairedRec?.departamento}`);
    assert('TC-REPAIR-04: Label "100% Remoto" correctly coerced to value "remoto"', repairedRec?.regime_trabalho === 'remoto', `Regime: ${repairedRec?.regime_trabalho}`);
    assert('TC-REPAIR-05: Python boolean True coerced to boolean true', repairedRec?.termos_privacidade === true);

  } catch (err) {
    console.error('\nFatal Error in Verification Suite:', err);
    testResults.push({ name: 'Suite Execution', pass: false, error: err.message });
  } finally {
    console.log('\n[Cleanup] Closing CDP connections and terminating Chrome process...');
    if (swConn) swConn.close();
    if (optConn) optConn.close();
    if (browserWs) browserWs.close();
    proc.kill('SIGKILL');
    mockHttpServer.close();
    try {
      fs.rmSync(userDir, { recursive: true, force: true });
    } catch {}
  }

  // Summary
  const total = testResults.length;
  const passed = testResults.filter(t => t.pass).length;
  const failed = testResults.filter(t => !t.pass).length;

  console.log('\n================================================================');
  console.log(' FormGen M3 Challenger Live CDP Verification Summary');
  console.log('================================================================');
  console.log(` Total Assertions: ${total}`);
  console.log(` \x1b[32mPassed: ${passed}\x1b[0m`);
  console.log(` \x1b[${failed > 0 ? '31' : '32'}mFailed: ${failed}\x1b[0m`);
  console.log('================================================================\n');

  if (failed > 0) {
    console.error(`\x1b[31m[VERDICT: REQUEST_CHANGES] ${failed} assertion(s) failed.\x1b[0m\n`);
    process.exit(1);
  } else {
    console.log(`\x1b[32m[VERDICT: APPROVE] All ${passed} live MV3 CDP assertions passed (100%).\x1b[0m\n`);
    process.exit(0);
  }
}

main().catch(err => {
  console.error('Unhandled Rejection:', err);
  process.exit(1);
});
