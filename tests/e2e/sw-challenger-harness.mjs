import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');
const distPath = path.join(ROOT_DIR, 'dist');
const port = 9465;

const proc = spawn('/usr/bin/google-chrome', [
  '--headless=new',
  `--remote-debugging-port=${port}`,
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  `--disable-extensions-except=${distPath}`,
  `--load-extension=${distPath}`,
  'about:blank'
], { stdio: ['ignore', 'pipe', 'pipe'] });

async function run() {
  await new Promise(r => setTimeout(r, 1200));

  const listRes = await fetch(`http://127.0.0.1:${port}/json/list`);
  const targets = await listRes.json();
  const swTarget = targets.find(t => t.type === 'service_worker');
  console.log('[Runner] Found SW Target:', swTarget?.url);

  if (!swTarget) {
    throw new Error('Service Worker target not found in Chrome targets: ' + JSON.stringify(targets));
  }

  const extId = swTarget.url.match(/chrome-extension:\/\/([a-z0-9]+)\//)[1];
  console.log('[Runner] Extension ID:', extId);

  // Connect to Service Worker CDP WebSocket
  const swWs = new WebSocket(swTarget.webSocketDebuggerUrl);
  await new Promise((res, rej) => { swWs.onopen = res; swWs.onerror = rej; });

  swWs.onmessage = (e) => {
    const d = JSON.parse(e.data);
    if (d.method === 'Runtime.consoleAPICalled') {
      console.log('[SW Console]', d.params.type, d.params.args.map(a => a.value ?? a.description));
    }
  };

  let swId = 1;
  const swSend = (method, params = {}) => new Promise((resolve, reject) => {
    const id = swId++;
    const handler = (e) => {
      const d = JSON.parse(e.data);
      if (d.id === id) {
        swWs.removeEventListener('message', handler);
        if (d.error) reject(new Error(JSON.stringify(d.error)));
        else resolve(d.result);
      }
    };
    swWs.addEventListener('message', handler);
    swWs.send(JSON.stringify({ id, method, params }));
  });

  await swSend('Runtime.enable');

  const swCheck = await swSend('Runtime.evaluate', {
    expression: `({
      hasListeners: chrome.runtime.onMessage.hasListeners(),
      location: self.location.href,
      chromeDefined: typeof chrome !== 'undefined'
    })`,
    returnByValue: true
  });
  console.log('[Runner] SW State:', swCheck.result.value);

  // Create an extension page tab (options.html) to test live chrome.runtime.sendMessage
  const optionsUrl = `chrome-extension://${extId}/options.html`;
  const tabRes = await fetch(`http://127.0.0.1:${port}/json/new?${optionsUrl}`, { method: 'PUT' });
  const tabTarget = await tabRes.json();

  const tabWs = new WebSocket(tabTarget.webSocketDebuggerUrl);
  await new Promise((res, rej) => { tabWs.onopen = res; tabWs.onerror = rej; });

  let tabId = 1;
  const tabSend = (method, params = {}) => new Promise((resolve, reject) => {
    const id = tabId++;
    const handler = (e) => {
      const d = JSON.parse(e.data);
      if (d.id === id) {
        tabWs.removeEventListener('message', handler);
        if (d.error) reject(new Error(JSON.stringify(d.error)));
        else resolve(d.result);
      }
    };
    tabWs.addEventListener('message', handler);
    tabWs.send(JSON.stringify({ id, method, params }));
  });

  await tabSend('Runtime.enable');
  await tabSend('Page.enable');
  await new Promise(r => setTimeout(r, 600));

  // Send PING message through Chrome's IPC broker
  const pingResult = await tabSend('Runtime.evaluate', {
    expression: `new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: "PING" }, (resp) => {
        resolve({ resp, lastError: chrome.runtime.lastError ? chrome.runtime.lastError.message : null });
      });
    })`,
    awaitPromise: true,
    returnByValue: true
  });
  console.log('[Runner] Chrome IPC PING Result:', pingResult.result.value);

  // Test invalid GENERATE_DATA (missing schema)
  const invalidResult1 = await tabSend('Runtime.evaluate', {
    expression: `new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: "GENERATE_DATA" }, (resp) => {
        resolve({ resp, lastError: chrome.runtime.lastError ? chrome.runtime.lastError.message : null });
      });
    })`,
    awaitPromise: true,
    returnByValue: true
  });
  console.log('[Runner] Chrome IPC Invalid GENERATE_DATA (no schema):', invalidResult1.result.value);

  swWs.close();
  tabWs.close();
}

try {
  await run();
} finally {
  proc.kill('SIGTERM');
}
