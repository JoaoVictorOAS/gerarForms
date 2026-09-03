/**
 * Challenger 2 Empirical Stress Test Harness for Milestone 2
 * Tests dist/content.js in real headless Google Chrome 149.
 * Validates SCAN_DOM IPC routing, real Blink layout geometry filtering,
 * 11 fields of #form-enterprise, data-formgen-id stamping, and edge cases.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');
const FIXTURE_PATH = path.join(ROOT_DIR, 'tests', 'fixtures', 'test-fixture.html');
const DIST_CONTENT_PATH = path.join(ROOT_DIR, 'dist', 'content.js');
const CHROME_PATH = process.env.CHROME_BIN || '/usr/bin/google-chrome';
const PORT = 9550;

// Assertion helper
let totalTests = 0;
let passedTests = 0;
let failedTests = 0;
const failures = [];

function assert(condition, message, details = null) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  \x1b[32m✔ [PASS]\x1b[0m ${message}`);
  } else {
    failedTests++;
    console.log(`  \x1b[31m✖ [FAIL]\x1b[0m ${message}`);
    if (details) console.log(`     Details: ${JSON.stringify(details)}`);
    failures.push({ message, details });
  }
}

// Lightweight HTTP server
function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = req.url.split('?')[0];
      if (url === '/' || url === '/test-fixture.html') {
        const content = fs.readFileSync(FIXTURE_PATH, 'utf-8');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(content);
      } else {
        res.writeHead(404);
        res.end('Not Found');
      }
    });
    server.listen(PORT, '127.0.0.1', () => {
      resolve(server);
    });
  });
}

// Simple CDP Client using native WebSocket
class SimpleCDP {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.msgId = 1;
    this.callbacks = new Map();
  }

  async connect() {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = reject;
    });

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.id && this.callbacks.has(msg.id)) {
          const { resolve, reject } = this.callbacks.get(msg.id);
          this.callbacks.delete(msg.id);
          if (msg.error) {
            reject(new Error(msg.error.message || JSON.stringify(msg.error)));
          } else {
            resolve(msg.result);
          }
        }
      } catch (err) {
        console.error('CDP parse error:', err);
      }
    };

    await this.send('Page.enable');
    await this.send('Runtime.enable');
    await this.send('DOM.enable');
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this.msgId++;
      this.callbacks.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(fnOrCode, ...args) {
    let expression;
    if (typeof fnOrCode === 'function') {
      const fnStr = fnOrCode.toString();
      const argsJson = JSON.stringify(args);
      expression = `(${fnStr})(...${argsJson})`;
    } else {
      expression = fnOrCode;
    }

    const res = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
      userGesture: true,
    });

    if (res.exceptionDetails) {
      const desc = res.exceptionDetails.exception?.description || res.exceptionDetails.text;
      throw new Error(`Evaluation failed: ${desc}`);
    }

    return res.result ? res.result.value : undefined;
  }

  async close() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

async function runChallengerSuite() {
  console.log('\n================================================================');
  console.log(' Challenger 2: Headless Chrome 149 Empirical Stress Harness');
  console.log(' Target: dist/content.js | Fixture: test-fixture.html');
  console.log('================================================================\n');

  // Verify dist/content.js exists
  assert(fs.existsSync(DIST_CONTENT_PATH), 'dist/content.js bundle exists on disk');
  const contentJsCode = fs.readFileSync(DIST_CONTENT_PATH, 'utf-8');
  assert(contentJsCode.length > 5000, `dist/content.js has valid bundle size (${contentJsCode.length} bytes)`);

  // Start HTTP fixture server
  console.log('[Setup] Starting HTTP fixture server on port', PORT);
  const server = await startServer();
  const fixtureUrl = `http://127.0.0.1:${PORT}/test-fixture.html`;

  // Launch real Google Chrome 149
  const chromePort = 9555;
  console.log('[Setup] Launching headless Chrome 149 on debug port', chromePort);
  const chromeProc = spawn(CHROME_PATH, [
    '--headless=new',
    `--remote-debugging-port=${chromePort}`,
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--window-size=1280,800',
    'about:blank',
  ]);

  // Wait for Chrome CDP ready
  let cdpReady = false;
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${chromePort}/json/version`);
      if (res.ok) {
        const v = await res.json();
        console.log(`[Chrome] Connected to ${v.Browser} (V8: ${v['V8-Version']})`);
        assert(v.Browser.includes('149'), `Chrome version is 149 (${v.Browser})`);
        cdpReady = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }

  if (!cdpReady) {
    chromeProc.kill();
    server.close();
    throw new Error('Could not connect to Chrome CDP.');
  }

  // Get or create page target
  const listRes = await fetch(`http://127.0.0.1:${chromePort}/json/list`);
  const targets = await listRes.json();
  let pageTarget = targets.find((t) => t.type === 'page');
  if (!pageTarget) {
    const newTargetRes = await fetch(`http://127.0.0.1:${chromePort}/json/new?about:blank`, { method: 'PUT' });
    pageTarget = await newTargetRes.json();
  }

  const cdp = new SimpleCDP(pageTarget.webSocketDebuggerUrl);
  await cdp.connect();
  console.log('[Setup] CDP WebSocket connected.');

  // Navigate to test fixture
  console.log('[Setup] Navigating to fixture:', fixtureUrl);
  await cdp.send('Page.navigate', { url: fixtureUrl });
  await new Promise((r) => setTimeout(r, 400));

  const pageTitle = await cdp.evaluate(() => document.title);
  assert(pageTitle.includes('FormGen'), `Fixture page loaded: "${pageTitle}"`);

  // ==========================================================================
  // SUITE 1: Content Script Injection & Message Protocol Routing
  // ==========================================================================
  console.log('\n\x1b[1m\x1b[34m--- SUITE 1: dist/content.js Injection & IPC Message Routing ---\x1b[0m');

  // Inject Chrome MV3 messaging harness and evaluate dist/content.js
  await cdp.evaluate((scriptCode) => {
    // Emulate Chrome MV3 chrome.runtime.onMessage bus
    window.__formgen_listeners = [];
    window.chrome = window.chrome || {};
    window.chrome.runtime = window.chrome.runtime || {};
    window.chrome.runtime.onMessage = {
      addListener: (fn) => {
        window.__formgen_listeners.push(fn);
      },
    };

    // Helper to send message and wait for async sendResponse
    window.__dispatchMessage = (msg) => {
      return new Promise((resolve) => {
        let responded = false;
        const sendResponse = (res) => {
          if (!responded) {
            responded = true;
            resolve(res);
          }
        };
        for (const listener of window.__formgen_listeners) {
          const keepOpen = listener(msg, { id: 'test_sender' }, sendResponse);
          if (!keepOpen && !responded) {
            // Synchronous completion if false returned
            responded = true;
            resolve({ success: false, error: 'Listener did not return true' });
          }
        }
      });
    };

    // Inject bundled content.js into page DOM
    const scriptEl = document.createElement('script');
    scriptEl.textContent = scriptCode;
    document.head.appendChild(scriptEl);
  }, contentJsCode);

  const listenersCount = await cdp.evaluate(() => window.__formgen_listeners.length);
  assert(listenersCount >= 1, `chrome.runtime.onMessage listener registered successfully (count: ${listenersCount})`);

  // Test 1.1: PING message
  const pingRes = await cdp.evaluate(() => window.__dispatchMessage({ action: 'PING' }));
  assert(pingRes && pingRes.success === true && pingRes.status === 'PONG', 'PING returns { success: true, status: "PONG" }');

  // Test 1.2: Unknown action
  const unknownRes = await cdp.evaluate(() => window.__dispatchMessage({ action: 'UNKNOWN_ACTION' }));
  assert(unknownRes && unknownRes.success === false && unknownRes.error.includes('Ação não suportada'), 'Unknown action returns { success: false, error: "Ação não suportada..." }');

  // Test 1.3: Malformed message
  const malformedRes = await cdp.evaluate(() => window.__dispatchMessage({}));
  assert(malformedRes && malformedRes.success === false && malformedRes.error.includes('Mensagem inválida'), 'Missing action returns { success: false, error: "Mensagem inválida..." }');

  // Test 1.4: INJECT_RECORD action (reserved for M5)
  const injectRes = await cdp.evaluate(() => window.__dispatchMessage({ action: 'INJECT_RECORD', record: {} }));
  assert(injectRes && injectRes.success === false && injectRes.error.includes('Milestone 5'), 'INJECT_RECORD returns Milestone 5 placeholder error');

  // ==========================================================================
  // SUITE 2: Canonical Form (#form-enterprise) Full Scan & Verification
  // ==========================================================================
  console.log('\n\x1b[1m\x1b[34m--- SUITE 2: #form-enterprise Full Scan (11 Fields Assertion) ---\x1b[0m');

  const scanEnterpriseRes = await cdp.evaluate(() =>
    window.__dispatchMessage({ action: 'SCAN_DOM', formSelector: '#form-enterprise' })
  );

  assert(scanEnterpriseRes && scanEnterpriseRes.success === true, 'SCAN_DOM on #form-enterprise returns success: true');
  const schema = scanEnterpriseRes.schema;
  assert(schema && schema.formId === 'form-enterprise', `schema.formId === 'form-enterprise' (got: ${schema?.formId})`);
  assert(schema.formSelector === '#form-enterprise', `schema.formSelector === '#form-enterprise'`);
  assert(Array.isArray(schema.fields), 'schema.fields is an Array');
  assert(schema.fields.length === 11, `schema.fields has exactly 11 fields (actual: ${schema.fields.length})`);

  // Map fields by name for detailed property checking
  const fieldsMap = new Map(schema.fields.map((f) => [f.name, f]));

  // Field 1: fullname
  const fFullname = fieldsMap.get('fullname');
  assert(Boolean(fFullname), 'Field 1 (fullname) exists in schema');
  if (fFullname) {
    assert(fFullname.type === 'text', `fullname type is 'text' (got: ${fFullname.type})`);
    assert(fFullname.label === 'Nome Completo', `fullname label normalized to 'Nome Completo' (got: "${fFullname.label}")`);
    assert(fFullname.required === true, 'fullname is required');
    assert(fFullname.validation?.minLength === 3, 'fullname minLength === 3');
    assert(fFullname.validation?.maxLength === 50, 'fullname maxLength === 50');
    assert(fFullname.validation?.autocomplete === 'name', 'fullname autocomplete === "name"');
    assert(fFullname.placeholder === 'Nome completo do colaborador', 'fullname placeholder preserved');
  }

  // Field 2: email
  const fEmail = fieldsMap.get('email');
  assert(Boolean(fEmail), 'Field 2 (email) exists in schema');
  if (fEmail) {
    assert(fEmail.type === 'email', `email type is 'email' (got: ${fEmail.type})`);
    assert(fEmail.label === 'E-mail Corporativo', `email label normalized to 'E-mail Corporativo' (got: "${fEmail.label}")`);
    assert(fEmail.required === true, 'email is required');
    assert(fEmail.validation?.autocomplete === 'email', 'email autocomplete === "email"');
    assert(fEmail.placeholder === 'colaborador@empresa.com.br', 'email placeholder preserved');
  }

  // Field 3: age
  const fAge = fieldsMap.get('age');
  assert(Boolean(fAge), 'Field 3 (age) exists in schema');
  if (fAge) {
    assert(fAge.type === 'number', `age type is 'number' (got: ${fAge.type})`);
    assert(fAge.label === 'Idade', `age label normalized to 'Idade' (got: "${fAge.label}")`);
    assert(fAge.required === true, 'age is required');
    assert(fAge.validation?.min === 18, `age validation min === 18 (got: ${fAge.validation?.min})`);
    assert(fAge.validation?.max === 120, `age validation max === 120 (got: ${fAge.validation?.max})`);
    assert(fAge.validation?.step === 1, `age validation step === 1 (got: ${fAge.validation?.step})`);
  }

  // Field 4: phone
  const fPhone = fieldsMap.get('phone');
  assert(Boolean(fPhone), 'Field 4 (phone) exists in schema');
  if (fPhone) {
    assert(fPhone.type === 'tel', `phone type is 'tel' (got: ${fPhone.type})`);
    assert(fPhone.label === 'Telefone Comercial', `phone label is 'Telefone Comercial' (got: "${fPhone.label}")`);
    assert(fPhone.required === false, 'phone is optional (required === false)');
    assert(fPhone.validation?.pattern === '\\(\\d{2}\\) \\d{4,5}-\\d{4}', 'phone pattern extracted');
  }

  // Field 5: birthdate
  const fBirthdate = fieldsMap.get('birthdate');
  assert(Boolean(fBirthdate), 'Field 5 (birthdate) exists in schema');
  if (fBirthdate) {
    assert(fBirthdate.type === 'date', `birthdate type is 'date' (got: ${fBirthdate.type})`);
    assert(fBirthdate.label === 'Data de Nascimento', `birthdate label is 'Data de Nascimento'`);
    assert(fBirthdate.validation?.min === '1950-01-01', 'birthdate min === 1950-01-01');
    assert(fBirthdate.validation?.max === '2026-12-31', 'birthdate max === 2026-12-31');
  }

  // Field 6: state (single select)
  const fState = fieldsMap.get('state');
  assert(Boolean(fState), 'Field 6 (state) exists in schema');
  if (fState) {
    assert(fState.type === 'select', `state type is 'select'`);
    assert(fState.label === 'Estado (UF)', `state label is 'Estado (UF)'`);
    assert(fState.required === true, 'state is required');
    assert(!fState.multiple, 'state multiple is false/undefined');
    assert(Array.isArray(fState.options) && fState.options.length === 5, `state has 5 valid options (actual: ${fState.options?.length})`);
    const stateVals = (fState.options || []).map((o) => o.value);
    assert(JSON.stringify(stateVals) === JSON.stringify(['SP', 'RJ', 'MG', 'RS', 'PR']), 'state options correctly filtered placeholder');
  }

  // Field 7: skills (multi select)
  const fSkills = fieldsMap.get('skills');
  assert(Boolean(fSkills), 'Field 7 (skills) exists in schema');
  if (fSkills) {
    assert(fSkills.type === 'select', `skills type is 'select'`);
    assert(fSkills.multiple === true, 'skills has multiple === true');
    assert(Array.isArray(fSkills.options) && fSkills.options.length === 5, `skills has 5 options`);
    const skillVals = (fSkills.options || []).map((o) => o.value);
    assert(skillVals.includes('javascript') && skillVals.includes('rust'), 'skills contains javascript and rust');
  }

  // Field 8: ent-contract (radio group)
  const fContract = fieldsMap.get('ent-contract');
  assert(Boolean(fContract), 'Field 8 (ent-contract) radio group exists in schema');
  if (fContract) {
    assert(fContract.type === 'radio', `ent-contract type is 'radio'`);
    assert(fContract.label === 'Tipo de Contrato', `ent-contract label from legend is 'Tipo de Contrato'`);
    assert(fContract.required === true, 'ent-contract is required');
    assert(Array.isArray(fContract.options) && fContract.options.length === 3, `ent-contract options length === 3 (actual: ${fContract.options?.length})`);
    const contractVals = (fContract.options || []).map((o) => o.value);
    assert(JSON.stringify(contractVals) === JSON.stringify(['clt', 'pj', 'estagio']), 'radio options are clt, pj, estagio');
  }

  // Field 9: newsletter (checkbox)
  const fNews = fieldsMap.get('newsletter');
  assert(Boolean(fNews), 'Field 9 (newsletter) exists in schema');
  if (fNews) {
    assert(fNews.type === 'checkbox', `newsletter type is 'checkbox'`);
    assert(fNews.label === 'Desejo receber boletim técnico quinzenal', 'newsletter label resolved via label[for]');
    assert(fNews.required === false, 'newsletter is not required');
  }

  // Field 10: terms (checkbox)
  const fTerms = fieldsMap.get('terms');
  assert(Boolean(fTerms), 'Field 10 (terms) exists in schema');
  if (fTerms) {
    assert(fTerms.type === 'checkbox', `terms type is 'checkbox'`);
    assert(fTerms.label === 'Declaro que li e concordo com os Termos de Uso', 'terms label normalized (asterisk stripped)');
    assert(fTerms.required === true, 'terms is required');
  }

  // Field 11: bio (textarea)
  const fBio = fieldsMap.get('bio');
  assert(Boolean(fBio), 'Field 11 (bio) exists in schema');
  if (fBio) {
    assert(fBio.type === 'textarea', `bio type is 'textarea'`);
    assert(fBio.label === 'Biografia Resumida', 'bio label resolved');
    assert(fBio.validation?.maxLength === 500, 'bio maxLength === 500');
    assert(fBio.placeholder === 'Fale brevemente sobre sua formação e objetivos...', 'bio placeholder preserved');
  }

  // ==========================================================================
  // SUITE 3: Real Browser Layout Geometry Filtering in Chrome 149
  // ==========================================================================
  console.log('\n\x1b[1m\x1b[34m--- SUITE 3: Real Blink Layout Geometry Filtering in Chrome 149 ---\x1b[0m');

  // Verify Chrome's real getBoundingClientRect on elements
  const layoutInfo = await cdp.evaluate(() => {
    const offscreen = document.getElementById('honeypot-offscreen');
    const hidden = document.getElementById('honeypot-hidden');
    const zero = document.getElementById('honeypot-zero');
    const normal = document.getElementById('ent-fullname');

    const offRect = offscreen ? offscreen.getBoundingClientRect() : null;
    const normalRect = normal ? normal.getBoundingClientRect() : null;
    const zeroRect = zero ? zero.getBoundingClientRect() : null;
    const zeroStyle = zero ? window.getComputedStyle(zero) : null;
    const zeroInline = zero ? { width: zero.style.width, height: zero.style.height } : null;

    return {
      offscreenRect: offRect ? { left: offRect.left, top: offRect.top, width: offRect.width, height: offRect.height } : null,
      normalRect: normalRect ? { left: normalRect.left, top: normalRect.top, width: normalRect.width, height: normalRect.height } : null,
      zeroRect: zeroRect ? { width: zeroRect.width, height: zeroRect.height } : null,
      zeroInline,
      zeroComputed: zeroStyle ? { width: zeroStyle.width, height: zeroStyle.height, opacity: zeroStyle.opacity, padding: zeroStyle.padding } : null,
      hiddenComputed: hidden ? window.getComputedStyle(hidden).display : null,
    };
  });

  assert(layoutInfo.normalRect && layoutInfo.normalRect.width > 200, `Normal input has real Chrome layout width (${layoutInfo.normalRect?.width}px)`);
  assert(layoutInfo.offscreenRect && layoutInfo.offscreenRect.left < -500, `Offscreen honeypot has real Chrome layout coordinate (${layoutInfo.offscreenRect?.left}px)`);
  assert(layoutInfo.zeroInline && layoutInfo.zeroInline.width === '0px' && layoutInfo.zeroInline.height === '0px', `Zero dimension honeypot inline style width/height is 0px`);
  assert(layoutInfo.zeroComputed && layoutInfo.zeroComputed.opacity === '0', `Zero dimension honeypot computed opacity is 0`);
  assert(layoutInfo.hiddenComputed === 'none', `Hidden honeypot computed style is display: none`);

  // Stress-test: Element with width: 0, height: 0, padding: 0 (pure 0x0 rect)
  const pureZeroRect = await cdp.evaluate(() => {
    const testEl = document.createElement('input');
    testEl.id = 'pure-zero-trap';
    testEl.style.cssText = 'width: 0px !important; height: 0px !important; padding: 0px !important; border: 0px !important; margin: 0px !important;';
    document.getElementById('form-edge-cases').appendChild(testEl);
    const r = testEl.getBoundingClientRect();
    const isExcluded = window.__formgen_listeners[0] ? true : false;
    return { width: r.width, height: r.height, top: r.top };
  });
  assert(pureZeroRect.width === 0 && pureZeroRect.height === 0, `Pure unpadded zero-dimension input has bounding rect width: 0, height: 0 (top: ${pureZeroRect.top}px)`);

  const pureZeroScan = await cdp.evaluate(() =>
    window.__dispatchMessage({ action: 'SCAN_DOM', formSelector: '#form-edge-cases' })
  );
  const pureZeroIncluded = pureZeroScan.schema.fields.some((f) => f.id === 'pure-zero-trap');
  assert(!pureZeroIncluded, 'Pure unpadded 0x0 input is strictly EXCLUDED by getBoundingClientRect layout filter');

  // Remove test element
  await cdp.evaluate(() => {
    const el = document.getElementById('pure-zero-trap');
    if (el) el.remove();
  });

  // Scan #form-edge-cases
  const edgeRes = await cdp.evaluate(() =>
    window.__dispatchMessage({ action: 'SCAN_DOM', formSelector: '#form-edge-cases' })
  );

  assert(edgeRes && edgeRes.success === true, 'SCAN_DOM on #form-edge-cases succeeded');
  const edgeSchema = edgeRes.schema;
  const edgeFieldIds = edgeSchema.fields.map((f) => f.id).filter(Boolean);
  const edgeFieldNames = edgeSchema.fields.map((f) => f.name);

  // Assert honeypot exclusions
  assert(!edgeFieldIds.includes('honeypot-offscreen'), 'Honeypot Trap 1 (offscreen) is strictly EXCLUDED');
  assert(!edgeFieldIds.includes('honeypot-hidden'), 'Honeypot Trap 2 (display: none) is strictly EXCLUDED');
  assert(!edgeFieldIds.includes('honeypot-zero'), 'Honeypot Trap 3 (0x0 dimension) is strictly EXCLUDED');
  assert(!edgeFieldIds.includes('csrf-token'), 'CSRF Token (type="hidden") is strictly EXCLUDED');
  assert(!edgeFieldIds.includes('edge-disabled'), 'Disabled input is strictly EXCLUDED');
  assert(!edgeFieldIds.includes('edge-readonly'), 'Readonly input is strictly EXCLUDED');
  assert(!edgeFieldIds.includes('edge-file'), 'File input is strictly EXCLUDED');

  // Dynamic Geometry Perturbation: Turn honeypot into visible input
  console.log('[Stress] Testing dynamic layout mutation: make honeypot visible...');
  await cdp.evaluate(() => {
    const el = document.getElementById('honeypot-hidden');
    el.removeAttribute('style');
    el.style.display = 'block';
    el.style.width = '200px';
    el.style.height = '30px';
    el.removeAttribute('tabindex');
    el.name = 'dynamic_now_visible';
  });

  const rescanDynamic = await cdp.evaluate(() =>
    window.__dispatchMessage({ action: 'SCAN_DOM', formSelector: '#form-edge-cases' })
  );
  const dynamicFieldNames = rescanDynamic.schema.fields.map((f) => f.name);
  assert(dynamicFieldNames.includes('dynamic_now_visible'), 'Dynamic mutation: Previously hidden input is detected when made visible');

  // Revert back
  await cdp.evaluate(() => {
    const el = document.getElementById('honeypot-hidden');
    el.style.display = 'none';
    el.setAttribute('tabindex', '-1');
    el.name = 'trap_display_none';
  });

  // Dynamic Geometry Perturbation: Turn visible input into offscreen input
  console.log('[Stress] Testing dynamic layout mutation: move visible input offscreen...');
  await cdp.evaluate(() => {
    const el = document.getElementById('edge-tier1-id');
    el.style.position = 'absolute';
    el.style.left = '-9999px';
  });

  const rescanOffscreen = await cdp.evaluate(() =>
    window.__dispatchMessage({ action: 'SCAN_DOM', formSelector: '#form-edge-cases' })
  );
  const offscreenFieldIds = rescanOffscreen.schema.fields.map((f) => f.id);
  assert(!offscreenFieldIds.includes('edge-tier1-id'), 'Dynamic mutation: Field moved offscreen (-9999px) is filtered out by layout geometry');

  // Revert back
  await cdp.evaluate(() => {
    const el = document.getElementById('edge-tier1-id');
    el.removeAttribute('style');
  });

  // ==========================================================================
  // SUITE 4: Real Browser DOM Stamping (data-formgen-id)
  // ==========================================================================
  console.log('\n\x1b[1m\x1b[34m--- SUITE 4: Real Browser DOM Stamping (data-formgen-id) ---\x1b[0m');

  // Rescan #form-enterprise to stamp DOM
  await cdp.evaluate(() =>
    window.__dispatchMessage({ action: 'SCAN_DOM', formSelector: '#form-enterprise' })
  );

  const stampingCheck = await cdp.evaluate(() => {
    const form = document.getElementById('form-enterprise');
    const stampedElements = Array.from(form.querySelectorAll('[data-formgen-id]'));

    const radioElements = Array.from(form.querySelectorAll('input[name="ent-contract"]'));
    const radioStamps = radioElements.map((r) => r.getAttribute('data-formgen-id'));

    const buttonElements = Array.from(form.querySelectorAll('button'));
    const buttonStamps = buttonElements.map((b) => b.getAttribute('data-formgen-id')).filter(Boolean);

    const stampMap = new Map();
    for (const el of stampedElements) {
      const stamp = el.getAttribute('data-formgen-id');
      if (!stampMap.has(stamp)) stampMap.set(stamp, []);
      stampMap.get(stamp).push(el.id || el.name);
    }

    return {
      totalStampedElements: stampedElements.length,
      radioStamps,
      buttonStampsCount: buttonStamps.length,
      uniqueStampsCount: stampMap.size,
      stampMap: Object.fromEntries(stampMap.entries()),
    };
  });

  assert(stampingCheck.totalStampedElements === 13, `Exactly 13 physical DOM elements stamped in #form-enterprise (actual: ${stampingCheck.totalStampedElements})`);
  assert(stampingCheck.uniqueStampsCount === 11, `Exactly 11 unique formgenId stamps (1 per logical field) (actual: ${stampingCheck.uniqueStampsCount})`);
  assert(
    stampingCheck.radioStamps.length === 3 &&
      stampingCheck.radioStamps[0] === stampingCheck.radioStamps[1] &&
      stampingCheck.radioStamps[1] === stampingCheck.radioStamps[2],
    `All 3 radio buttons share the identical data-formgen-id stamp (${stampingCheck.radioStamps[0]})`
  );
  assert(stampingCheck.buttonStampsCount === 0, 'Buttons are NOT stamped (0 buttons stamped)');

  // Test Idempotency: Rescan 10 times and assert stamp count remains exactly 13
  console.log('[Stress] Testing stamp cleanup and re-scan idempotency across 10 iterations...');
  let idempotencySuccess = true;
  for (let i = 0; i < 10; i++) {
    await cdp.evaluate(() =>
      window.__dispatchMessage({ action: 'SCAN_DOM', formSelector: '#form-enterprise' })
    );
    const count = await cdp.evaluate(() =>
      document.querySelectorAll('#form-enterprise [data-formgen-id]').length
    );
    if (count !== 13) {
      idempotencySuccess = false;
      break;
    }
  }
  assert(idempotencySuccess, 'DOM stamping is strictly idempotent across 10 consecutive re-scans (always 13 elements)');

  // ==========================================================================
  // SUITE 5: 7-Tier Label Resolution Cascade Completeness
  // ==========================================================================
  console.log('\n\x1b[1m\x1b[34m--- SUITE 5: 7-Tier Label Resolution Cascade Completeness ---\x1b[0m');

  const edgeScanFinal = await cdp.evaluate(() =>
    window.__dispatchMessage({ action: 'SCAN_DOM', formSelector: '#form-edge-cases' })
  );

  const edgeFields = edgeScanFinal.schema.fields;
  const getFieldById = (id) => edgeFields.find((f) => f.id === id);

  // Tier 1
  const t1 = getFieldById('edge-tier1-id');
  assert(t1 && t1.label === 'Tier 1: Explicit Label For', `Tier 1 resolved: "${t1?.label}"`);

  // Tier 2
  const t2 = getFieldById('edge-tier2-id');
  assert(t2 && t2.label === 'Tier 2: Nested Wrapping Label Text', `Tier 2 resolved: "${t2?.label}"`);

  // Tier 3
  const t3 = getFieldById('edge-tier3-id');
  assert(t3 && t3.label === 'Tier 3 Compound Aria LabelledBy', `Tier 3 resolved: "${t3?.label}"`);

  // Tier 4
  const t4 = getFieldById('edge-tier4-id');
  assert(t4 && t4.label === 'Tier 4 Accessible Name', `Tier 4 resolved: "${t4?.label}"`);

  // Tier 5
  const t5 = getFieldById('edge-tier5-id');
  assert(t5 && t5.label === 'Tier 5: Ancestor Fieldset Legend', `Tier 5 resolved: "${t5?.label}"`);

  // Tier 6
  const t6 = getFieldById('edge-tier6-id');
  assert(t6 && t6.label === 'Tier 6: Sibling Span Label', `Tier 6 resolved: "${t6?.label}"`);

  // Tier 7
  const t7 = getFieldById('edge-tier7-id');
  assert(t7 && t7.label === 'Tier 7: Placeholder Postal Code', `Tier 7 resolved: "${t7?.label}"`);

  // ==========================================================================
  // SUITE 6: Auto-Discovery & Heuristic Candidate Scoring
  // ==========================================================================
  console.log('\n\x1b[1m\x1b[34m--- SUITE 6: Auto-Discovery & Heuristic Candidate Scoring ---\x1b[0m');

  const autoScanRes = await cdp.evaluate(() =>
    window.__dispatchMessage({ action: 'SCAN_DOM' })
  );

  assert(autoScanRes && autoScanRes.success === true, 'SCAN_DOM without target executes auto-discovery');
  assert(autoScanRes.schema?.formId === 'form-enterprise', `Auto-discovery selects #form-enterprise (score leader)`);
  assert(autoScanRes.schema?.fields?.length === 11, `Auto-discovery extracts all 11 fields`);

  // ==========================================================================
  // SUITE 7: Token Optimization & Zero Raw HTML/Style Leakage
  // ==========================================================================
  console.log('\n\x1b[1m\x1b[34m--- SUITE 7: Token Optimization & Sanitization Audit ---\x1b[0m');

  const enterpriseHtmlLength = await cdp.evaluate(() =>
    document.getElementById('form-enterprise').outerHTML.length
  );
  const schemaJsonStr = JSON.stringify(schema);
  const schemaLength = schemaJsonStr.length;
  const tokenSavings = (1 - schemaLength / enterpriseHtmlLength) * 100;

  console.log(`[Metrics] Raw HTML length: ${enterpriseHtmlLength} chars | Lean Schema length: ${schemaLength} chars`);
  console.log(`[Metrics] Savings: ${tokenSavings.toFixed(1)}%`);

  assert(tokenSavings > 35, `Token savings > 35% on bare fixture form (actual: ${tokenSavings.toFixed(1)}%)`);

  // Test realistic styled enterprise form with modern CSS frameworks (Tailwind/Bootstrap wrapper overhead)
  const styledComparison = await cdp.evaluate(() => {
    const cardEl = document.getElementById('panel-enterprise');
    const bareForm = document.getElementById('form-enterprise');
    // Emulate realistic production container with Tailwind/Bootstrap classes and SVG icons
    const mockProductionHtml = `
      <div class="min-h-screen bg-gray-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
        <div class="sm:mx-auto sm:w-full sm:max-w-md">
          <svg class="mx-auto h-12 w-auto text-indigo-600" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
          <h2 class="mt-6 text-center text-3xl font-extrabold text-gray-900">Cadastro Corporativo</h2>
        </div>
        <div class="mt-8 sm:mx-auto sm:w-full sm:max-w-xl">
          <div class="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10 border border-slate-200">
            ${bareForm.outerHTML}
          </div>
        </div>
      </div>
    `;
    return {
      prodHtmlLength: mockProductionHtml.length,
    };
  });
  const prodSavings = (1 - schemaLength / styledComparison.prodHtmlLength) * 100;
  console.log(`[Metrics] Realistic Styled Form savings: ${prodSavings.toFixed(1)}%`);
  assert(prodSavings > 45, `Token savings on styled form container > 45% (actual: ${prodSavings.toFixed(1)}%)`);

  // Full page HTML vs Lean Schema token savings
  const fullPageSavings = await cdp.evaluate((schemaLen) => {
    const pageHtmlLen = document.documentElement.outerHTML.length;
    return (1 - schemaLen / pageHtmlLen) * 100;
  }, schemaLength);
  console.log(`[Metrics] Full Page HTML vs Lean Schema savings: ${fullPageSavings.toFixed(1)}%`);
  assert(fullPageSavings > 80, `Token savings over full page HTML > 80% (actual: ${fullPageSavings.toFixed(1)}%)`);

  assert(!schemaJsonStr.includes('<input'), 'Schema contains zero <input tags');
  assert(!schemaJsonStr.includes('<div'), 'Schema contains zero <div tags');
  assert(!schemaJsonStr.includes('<style'), 'Schema contains zero <style tags');
  assert(!schemaJsonStr.includes('style='), 'Schema contains zero style= attributes');
  assert(!schemaJsonStr.includes('class='), 'Schema contains zero class= attributes');
  assert(!schemaJsonStr.includes('onclick'), 'Schema contains zero inline event handlers');

  // ==========================================================================
  // SUITE 8: Stress & Performance Benchmarks in Chrome 149
  // ==========================================================================
  console.log('\n\x1b[1m\x1b[34m--- SUITE 8: Performance Benchmark & Rapid Concurrency ---\x1b[0m');

  // Benchmark 100 scans in Chrome
  const benchResult = await cdp.evaluate(async () => {
    const t0 = performance.now();
    for (let i = 0; i < 50; i++) {
      await window.__dispatchMessage({ action: 'SCAN_DOM', formSelector: '#form-enterprise' });
    }
    const t1 = performance.now();
    return {
      totalMs: t1 - t0,
      avgMsPerScan: (t1 - t0) / 50,
    };
  });

  console.log(`[Benchmark] 50 consecutive scans completed in ${benchResult.totalMs.toFixed(2)}ms (avg: ${benchResult.avgMsPerScan.toFixed(2)}ms per scan)`);
  assert(benchResult.avgMsPerScan < 5.0, `Scan latency < 5.0ms per scan (actual: ${benchResult.avgMsPerScan.toFixed(2)}ms)`);

  // Concurrent dispatch of 25 messages
  const concurrencyResult = await cdp.evaluate(async () => {
    const promises = [];
    for (let i = 0; i < 25; i++) {
      promises.push(window.__dispatchMessage({ action: 'SCAN_DOM', formSelector: '#form-enterprise' }));
    }
    const results = await Promise.all(promises);
    return results.every((r) => r && r.success && r.schema.fields.length === 11);
  });
  assert(concurrencyResult, '25 concurrent SCAN_DOM messages resolved simultaneously without race conditions');

  // Non-existent form selector error handling
  const nonExistentRes = await cdp.evaluate(() =>
    window.__dispatchMessage({ action: 'SCAN_DOM', formSelector: '#non-existent-form-xyz' })
  );
  assert(
    nonExistentRes && nonExistentRes.success === false && nonExistentRes.error.includes('não encontrado'),
    'Non-existent selector returns graceful error response'
  );

  // Cleanup
  console.log('\n[Teardown] Cleaning up CDP, Chrome process, and fixture server...');
  await cdp.close();
  chromeProc.kill('SIGTERM');
  server.close();

  console.log('\n================================================================');
  console.log(' Challenger 2 Headless Chrome 149 Test Summary');
  console.log('================================================================');
  console.log(` Total Assertions Executed: ${totalTests}`);
  console.log(` \x1b[32mPassed: ${passedTests}\x1b[0m`);
  console.log(` \x1b[${failedTests > 0 ? '31' : '32'}mFailed: ${failedTests}\x1b[0m`);
  console.log('================================================================\n');

  if (failedTests > 0) {
    console.error(`\x1b[31m[VERDICT] REQUEST_CHANGES — ${failedTests} assertion(s) failed.\x1b[0m`);
    process.exit(1);
  } else {
    console.log('\x1b[32m[VERDICT] APPROVE — 100% of empirical assertions passed in Chrome 149.\x1b[0m\n');
    process.exit(0);
  }
}

runChallengerSuite().catch((err) => {
  console.error('Fatal Test Execution Error:', err);
  process.exit(1);
});
