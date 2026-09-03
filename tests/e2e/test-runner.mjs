/**
 * FormGen Headless Automated E2E Test Runner
 * Executes against tests/fixtures/test-fixture.html using Google Chrome 149 in headless mode.
 * Compatible with Node.js 26+ native WebSocket & CDP, with zero external dependencies required.
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
const EXTENSION_DIST = path.join(ROOT_DIR, 'dist');
const CHROME_PATH = process.env.CHROME_BIN || '/usr/bin/google-chrome';
const DEFAULT_PORT = parseInt(process.env.TEST_PORT || '8080', 10);

// CLI Arguments parsing
const args = process.argv.slice(2);
let tierFilter = null;
let grepFilter = null;
let specFilter = null;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--tier' || args[i] === '-t') {
    tierFilter = parseInt(args[++i], 10);
  } else if (args[i].startsWith('--tier=')) {
    tierFilter = parseInt(args[i].split('=')[1], 10);
  } else if (args[i] === '--grep' || args[i] === '-g') {
    grepFilter = new RegExp(args[++i], 'i');
  } else if (args[i].startsWith('--grep=')) {
    grepFilter = new RegExp(args[i].split('=')[1], 'i');
  } else if (args[i] === '--spec' || args[i] === '-s') {
    specFilter = args[++i];
  } else if (args[i].startsWith('--spec=')) {
    specFilter = args[i].split('=')[1];
  }
}

// Minimal Test Runner State
const suiteRegistry = [];
let currentSuite = null;

export function describe(name, fn) {
  const suite = {
    name,
    tests: [],
    beforeAll: [],
    afterAll: [],
    beforeEach: [],
    afterEach: []
  };
  const prev = currentSuite;
  currentSuite = suite;
  suiteRegistry.push(suite);
  fn();
  currentSuite = prev;
}

export function test(name, fn) {
  if (!currentSuite) {
    describe('Default Suite', () => test(name, fn));
    return;
  }
  currentSuite.tests.push({ name, fn });
}
export const it = test;

export function beforeAll(fn) {
  if (currentSuite) currentSuite.beforeAll.push(fn);
}

export function afterAll(fn) {
  if (currentSuite) currentSuite.afterAll.push(fn);
}

export function beforeEach(fn) {
  if (currentSuite) currentSuite.beforeEach.push(fn);
}

export function afterEach(fn) {
  if (currentSuite) currentSuite.afterEach.push(fn);
}

// Expect Assertion Utility
class Expectation {
  constructor(actual, isNot = false) {
    this.actual = actual;
    this.isNot = isNot;
  }

  get not() {
    return new Expectation(this.actual, !this.isNot);
  }

  _assert(condition, message) {
    const pass = this.isNot ? !condition : condition;
    if (!pass) {
      throw new Error(this.isNot ? `Expected NOT: ${message}` : `Assertion failed: ${message}`);
    }
  }

  toBe(expected) {
    this._assert(
      Object.is(this.actual, expected),
      `Expected ${JSON.stringify(expected)}, received ${JSON.stringify(this.actual)}`
    );
  }

  toEqual(expected) {
    const deepEqual = (a, b) => {
      if (Object.is(a, b)) return true;
      if (typeof a !== typeof b || a === null || b === null) return false;
      if (Array.isArray(a) !== Array.isArray(b)) return false;
      if (Array.isArray(a)) {
        if (a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) {
          if (!deepEqual(a[i], b[i])) return false;
        }
        return true;
      }
      if (typeof a === 'object') {
        const keysA = Object.keys(a);
        const keysB = Object.keys(b);
        if (keysA.length !== keysB.length) return false;
        for (const k of keysA) {
          if (!Object.prototype.hasOwnProperty.call(b, k) || !deepEqual(a[k], b[k])) return false;
        }
        return true;
      }
      return false;
    };

    this._assert(
      deepEqual(this.actual, expected),
      `Expected deep equality to ${JSON.stringify(expected)}, received ${JSON.stringify(this.actual)}`
    );
  }

  toBeNull() {
    this._assert(this.actual === null, `Expected null, received ${this.actual}`);
  }

  toBeDefined() {
    this._assert(this.actual !== undefined, `Expected defined, received undefined`);
  }

  toBeUndefined() {
    this._assert(this.actual === undefined, `Expected undefined, received ${this.actual}`);
  }

  toBeTruthy() {
    this._assert(Boolean(this.actual), `Expected truthy, received ${this.actual}`);
  }

  toBeFalsy() {
    this._assert(!this.actual, `Expected falsy, received ${this.actual}`);
  }

  toBeGreaterThan(expected) {
    this._assert(this.actual > expected, `Expected ${this.actual} > ${expected}`);
  }

  toBeGreaterThanOrEqual(expected) {
    this._assert(this.actual >= expected, `Expected ${this.actual} >= ${expected}`);
  }

  toBeLessThan(expected) {
    this._assert(this.actual < expected, `Expected ${this.actual} < ${expected}`);
  }

  toBeLessThanOrEqual(expected) {
    this._assert(this.actual <= expected, `Expected ${this.actual} <= ${expected}`);
  }

  toContain(expected) {
    if (typeof this.actual === 'string' || Array.isArray(this.actual)) {
      this._assert(
        this.actual.includes(expected),
        `Expected ${JSON.stringify(this.actual)} to contain ${JSON.stringify(expected)}`
      );
    } else if (this.actual instanceof Set || this.actual instanceof Map) {
      this._assert(this.actual.has(expected), `Expected collection to contain ${expected}`);
    } else if (typeof this.actual === 'object' && this.actual !== null) {
      this._assert(expected in this.actual, `Expected object to contain property ${expected}`);
    } else {
      this._assert(false, `toContain target is not iterable: ${this.actual}`);
    }
  }

  toMatch(pattern) {
    const regex = typeof pattern === 'string' ? new RegExp(pattern) : pattern;
    this._assert(regex.test(String(this.actual)), `Expected "${this.actual}" to match ${regex}`);
  }

  toHaveLength(expected) {
    const len = this.actual && this.actual.length !== undefined ? this.actual.length : undefined;
    this._assert(len === expected, `Expected length ${expected}, received ${len}`);
  }

  toThrow(expectedPattern) {
    let threw = false;
    let thrownError = null;
    if (typeof this.actual !== 'function') {
      this._assert(false, `Expected target to be a function, received ${typeof this.actual}`);
      return;
    }
    try {
      this.actual();
    } catch (e) {
      threw = true;
      thrownError = e;
    }
    if (expectedPattern) {
      const msg = thrownError ? thrownError.message : '';
      const regex = typeof expectedPattern === 'string' ? new RegExp(expectedPattern) : expectedPattern;
      this._assert(threw && regex.test(msg), `Expected function to throw matching ${regex}, caught: ${msg}`);
    } else {
      this._assert(threw, `Expected function to throw`);
    }
  }
}

export function expect(actual) {
  return new Expectation(actual);
}

// Lightweight HTTP Server for Test Fixture
export function createFixtureServer(preferredPort = DEFAULT_PORT) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = req.url.split('?')[0];
      if (url === '/' || url === '/test-fixture.html') {
        if (fs.existsSync(FIXTURE_PATH)) {
          const content = fs.readFileSync(FIXTURE_PATH, 'utf-8');
          res.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-cache, no-store'
          });
          res.end(content);
        } else {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end(`Fixture not found at ${FIXTURE_PATH}`);
        }
      } else {
        res.writeHead(404);
        res.end('Not Found');
      }
    });

    const tryListen = (port) => {
      server.once('error', (err) => {
        if (err.code === 'EADDRINUSE' && port < preferredPort + 20) {
          tryListen(port + 1);
        } else {
          reject(err);
        }
      });
      server.listen(port, '127.0.0.1', () => {
        const actualPort = server.address().port;
        resolve({
          server,
          port: actualPort,
          url: `http://127.0.0.1:${actualPort}/test-fixture.html`,
          close: () => new Promise(r => server.close(r))
        });
      });
    };

    tryListen(preferredPort);
  });
}

// Chrome 149 CDP Page Driver (Native Node 26 WebSocket)
export class ChromePage {
  constructor(wsUrl, browser) {
    this.wsUrl = wsUrl;
    this.browser = browser;
    this.ws = null;
    this.msgId = 1;
    this.callbacks = new Map();
    this.eventListeners = new Map();
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
        } else if (msg.method) {
          const handlers = this.eventListeners.get(msg.method) || [];
          for (const h of handlers) h(msg.params);
        }
      } catch (err) {
        console.error('[CDP Page] Message parse error:', err);
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

  on(eventName, handler) {
    if (!this.eventListeners.has(eventName)) {
      this.eventListeners.set(eventName, []);
    }
    this.eventListeners.get(eventName).push(handler);
  }

  async goto(url) {
    const loadPromise = new Promise((resolve) => {
      const handler = () => {
        const list = this.eventListeners.get('Page.loadEventFired') || [];
        const idx = list.indexOf(handler);
        if (idx !== -1) list.splice(idx, 1);
        resolve();
      };
      this.on('Page.loadEventFired', handler);
      // Fallback timeout in case event was already fired
      setTimeout(resolve, 3000);
    });

    await this.send('Page.navigate', { url });
    await loadPromise;
    // Allow microtasks and DOM initialization
    await new Promise(r => setTimeout(r, 100));
  }

  async reload() {
    await this.send('Page.reload');
    await new Promise((resolve) => {
      const handler = () => {
        const list = this.eventListeners.get('Page.loadEventFired') || [];
        const idx = list.indexOf(handler);
        if (idx !== -1) list.splice(idx, 1);
        resolve();
      };
      this.on('Page.loadEventFired', handler);
      setTimeout(resolve, 2500);
    });
    await new Promise(r => setTimeout(r, 100));
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
      userGesture: true
    });

    if (res.exceptionDetails) {
      const desc = res.exceptionDetails.exception?.description || res.exceptionDetails.text;
      throw new Error(`Evaluation failed: ${desc}`);
    }

    return res.result ? res.result.value : undefined;
  }

  async waitForFunction(fn, options = {}, ...args) {
    const timeout = options.timeout || 5000;
    const interval = options.polling || 50;
    const start = Date.now();

    while (Date.now() - start < timeout) {
      try {
        const val = await this.evaluate(fn, ...args);
        if (val) return val;
      } catch {
        // continue polling
      }
      await new Promise(r => setTimeout(r, interval));
    }
    throw new Error(`Timeout of ${timeout}ms exceeded waiting for function.`);
  }

  async waitForSelector(selector, options = {}) {
    return this.waitForFunction(
      (sel) => Boolean(document.querySelector(sel)),
      options,
      selector
    );
  }

  async click(selector) {
    const success = await this.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return false;
      el.focus();
      el.click();
      return true;
    }, selector);
    if (!success) throw new Error(`Cannot click: element '${selector}' not found`);
  }

  async type(selector, text) {
    const success = await this.evaluate((sel, txt) => {
      const el = document.querySelector(sel);
      if (!el) return false;
      el.focus();
      el.value = txt;
      el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
      return true;
    }, selector, text);
    if (!success) throw new Error(`Cannot type into '${selector}': element not found`);
  }

  async close() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

// Chrome Browser Launcher & CDP Coordinator
export class ChromeBrowser {
  constructor(proc, debugPort, distPath = null) {
    this.proc = proc;
    this.debugPort = debugPort;
    this.distPath = distPath;
    this.pages = [];
  }

  static async launch(options = {}) {
    const distPath = fs.existsSync(path.join(EXTENSION_DIST, 'manifest.json')) ? EXTENSION_DIST : null;
    const port = options.port || (9400 + Math.floor(Math.random() * 500));

    const chromeArgs = [
      '--headless=new',
      `--remote-debugging-port=${port}`,
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--window-size=1280,800',
      'about:blank'
    ];

    if (distPath) {
      chromeArgs.push(`--disable-extensions-except=${distPath}`);
      chromeArgs.push(`--load-extension=${distPath}`);
    }

    const proc = spawn(CHROME_PATH, chromeArgs, {
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let ready = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/json/version`);
        if (res.ok) {
          ready = true;
          break;
        }
      } catch {
        // Wait and retry
      }
      await new Promise(r => setTimeout(r, 100));
    }

    if (!ready) {
      proc.kill();
      throw new Error(`Failed to launch Google Chrome on port ${port}`);
    }

    return new ChromeBrowser(proc, port, distPath);
  }

  async newPage() {
    const listRes = await fetch(`http://127.0.0.1:${this.debugPort}/json/list`);
    const targets = await listRes.json();
    let pageTarget = targets.find(t => t.type === 'page' && !this.pages.some(p => p.wsUrl === t.webSocketDebuggerUrl));

    if (!pageTarget) {
      const newTargetRes = await fetch(`http://127.0.0.1:${this.debugPort}/json/new?about:blank`, { method: 'PUT' });
      pageTarget = await newTargetRes.json();
    }

    const page = new ChromePage(pageTarget.webSocketDebuggerUrl, this);
    await page.connect();
    this.pages.push(page);
    return page;
  }

  async close() {
    for (const p of this.pages) {
      try { await p.close(); } catch {}
    }
    this.proc.kill('SIGTERM');
    await new Promise(r => setTimeout(r, 200));
  }
}

// Global Context for Spec Files
export const e2eContext = {
  browser: null,
  page: null,
  fixtureServer: null,
  fixtureUrl: ''
};

// Test Runner Execution Engine
export async function runAllTests() {
  console.log('\n================================================================');
  console.log(' FormGen 4-Tier Automated E2E Test Suite');
  console.log(' Chrome 149 Headless Runner (/usr/bin/google-chrome)');
  console.log('================================================================\n');

  // Start Fixture Server
  console.log('[Runner] Starting local HTTP fixture server...');
  e2eContext.fixtureServer = await createFixtureServer();
  e2eContext.fixtureUrl = e2eContext.fixtureServer.url;
  console.log(`[Runner] Fixture URL: ${e2eContext.fixtureUrl}`);

  // Launch Chrome 149
  console.log('[Runner] Launching Google Chrome 149 in headless mode...');
  e2eContext.browser = await ChromeBrowser.launch();
  e2eContext.page = await e2eContext.browser.newPage();
  console.log('[Runner] Navigating to test fixture...');
  await e2eContext.page.goto(e2eContext.fixtureUrl);
  console.log('[Runner] Environment initialized successfully.\n');

  // Load Spec Files
  const specs = [
    { tier: 1, file: './specs/tier1_features.spec.mjs' },
    { tier: 2, file: './specs/tier2_boundaries.spec.mjs' },
    { tier: 3, file: './specs/tier3_combinations.spec.mjs' },
    { tier: 4, file: './specs/tier4_scenarios.spec.mjs' }
  ];

  const specsToRun = specs.filter(s => {
    if (tierFilter && s.tier !== tierFilter) return false;
    if (specFilter && !s.file.includes(specFilter)) return false;
    return true;
  });

  for (const spec of specsToRun) {
    const specPath = path.resolve(__dirname, spec.file);
    if (fs.existsSync(specPath)) {
      await import(`file://${specPath}?t=${Date.now()}`);
    }
  }

  // Execute Suites
  let totalCount = 0;
  let passedCount = 0;
  let failedCount = 0;
  const failureDetails = [];
  const tierSummary = { 1: { pass: 0, fail: 0 }, 2: { pass: 0, fail: 0 }, 3: { pass: 0, fail: 0 }, 4: { pass: 0, fail: 0 } };

  const startTime = Date.now();

  for (const suite of suiteRegistry) {
    const isTierSuite = suite.name.match(/Tier\s*(\d)/i);
    const tierNum = isTierSuite ? parseInt(isTierSuite[1], 10) : 1;

    console.log(`\n\x1b[1m\x1b[34m--- Suite: ${suite.name} ---\x1b[0m`);

    const ctx = { page: e2eContext.page, browser: e2eContext.browser, url: e2eContext.fixtureUrl };

    for (const hook of suite.beforeAll) await hook(ctx);

    for (const testCase of suite.tests) {
      if (grepFilter && !grepFilter.test(testCase.name)) {
        continue;
      }

      totalCount++;
      for (const hook of suite.beforeEach) await hook(ctx);

      const testStart = Date.now();
      try {
        await testCase.fn(ctx);
        const dur = Date.now() - testStart;
        passedCount++;
        if (tierSummary[tierNum]) tierSummary[tierNum].pass++;
        console.log(`  \x1b[32m✔ [PASS]\x1b[0m ${testCase.name} \x1b[90m(${dur}ms)\x1b[0m`);
      } catch (err) {
        const dur = Date.now() - testStart;
        failedCount++;
        if (tierSummary[tierNum]) tierSummary[tierNum].fail++;
        console.log(`  \x1b[31m✖ [FAIL]\x1b[0m ${testCase.name} \x1b[90m(${dur}ms)\x1b[0m`);
        console.log(`     \x1b[31mError: ${err.message}\x1b[0m`);
        failureDetails.push({ name: testCase.name, suite: suite.name, error: err });
      }

      for (const hook of suite.afterEach) await hook(ctx);
    }

    for (const hook of suite.afterAll) await hook(ctx);
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(2);

  // Cleanup Environment
  console.log('\n[Runner] Cleaning up Chrome process and HTTP server...');
  if (e2eContext.browser) await e2eContext.browser.close();
  if (e2eContext.fixtureServer) await e2eContext.fixtureServer.close();

  // Print Summary
  console.log('\n================================================================');
  console.log(' FormGen E2E Verification Summary');
  console.log('================================================================');
  console.log(` Total Tests Executed: ${totalCount}`);
  console.log(` \x1b[32mPassed: ${passedCount}\x1b[0m`);
  console.log(` \x1b[${failedCount > 0 ? '31' : '32'}mFailed: ${failedCount}\x1b[0m`);
  console.log(` Duration: ${duration}s`);
  console.log('----------------------------------------------------------------');
  console.log(' Tier Breakdown:');
  console.log(`   Tier 1 (Feature Coverage):       ${tierSummary[1].pass} pass, ${tierSummary[1].fail} fail`);
  console.log(`   Tier 2 (Boundary & Corner Cases):${tierSummary[2].pass} pass, ${tierSummary[2].fail} fail`);
  console.log(`   Tier 3 (Cross-Feature Combos):   ${tierSummary[3].pass} pass, ${tierSummary[3].fail} fail`);
  console.log(`   Tier 4 (Real-World Scenarios):   ${tierSummary[4].pass} pass, ${tierSummary[4].fail} fail`);
  console.log('================================================================\n');

  if (failedCount > 0) {
    console.error(`\x1b[31m[FAILED] ${failedCount} test(s) failed in E2E suite.\x1b[0m`);
    for (const f of failureDetails) {
      console.error(`\n✖ [${f.suite}] ${f.name}`);
      console.error(f.error.stack || f.error.message);
    }
    process.exit(1);
  } else {
    console.log('\x1b[32m[SUCCESS] All E2E tests passed (100%) without failures.\x1b[0m\n');
    process.exit(0);
  }
}

// Auto-run when executed directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runAllTests().catch((err) => {
    console.error('Fatal Runner Error:', err);
    process.exit(1);
  });
}
