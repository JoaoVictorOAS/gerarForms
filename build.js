// build.js
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isWatch = process.argv.includes('--watch');
const isDev = isWatch || process.argv.includes('--dev');

const DIST_DIR = path.resolve(__dirname, 'dist');
const SRC_DIR = path.resolve(__dirname, 'src');

/**
 * Ensures a directory exists.
 */
function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * Copies static assets (manifest, HTML, CSS, icons) to dist.
 */
function copyStaticAssets() {
  ensureDir(DIST_DIR);

  // 1. manifest.json
  const manifestSrc = path.resolve(__dirname, 'manifest.json');
  if (fs.existsSync(manifestSrc)) {
    fs.copyFileSync(manifestSrc, path.resolve(DIST_DIR, 'manifest.json'));
  }

  // 2. Popup UI
  const popupHtml = path.resolve(SRC_DIR, 'popup/popup.html');
  if (fs.existsSync(popupHtml)) {
    fs.copyFileSync(popupHtml, path.resolve(DIST_DIR, 'popup.html'));
  } else {
    const distPopup = path.resolve(DIST_DIR, 'popup.html');
    if (!fs.existsSync(distPopup)) {
      fs.writeFileSync(distPopup, '<!DOCTYPE html><html><head><meta charset="utf-8"><title>FormGen</title></head><body>FormGen</body></html>');
    }
  }
  const popupCss = path.resolve(SRC_DIR, 'popup/popup.css');
  if (fs.existsSync(popupCss)) {
    fs.copyFileSync(popupCss, path.resolve(DIST_DIR, 'popup.css'));
  }

  // 3. Options UI
  const optionsHtml = path.resolve(SRC_DIR, 'options/options.html');
  if (fs.existsSync(optionsHtml)) {
    fs.copyFileSync(optionsHtml, path.resolve(DIST_DIR, 'options.html'));
  }
  const optionsCss = path.resolve(SRC_DIR, 'options/options.css');
  if (fs.existsSync(optionsCss)) {
    fs.copyFileSync(optionsCss, path.resolve(DIST_DIR, 'options.css'));
  }

  // 4. Icons
  const iconsSrcDir = path.resolve(__dirname, 'icons');
  const iconsDistDir = path.resolve(DIST_DIR, 'icons');
  if (fs.existsSync(iconsSrcDir)) {
    ensureDir(iconsDistDir);
    for (const file of fs.readdirSync(iconsSrcDir)) {
      if (file.endsWith('.png') || file.endsWith('.svg')) {
        fs.copyFileSync(path.resolve(iconsSrcDir, file), path.resolve(iconsDistDir, file));
      }
    }
  }

  // Content script stub if src/content/index.ts not yet present
  const contentEntry = path.resolve(SRC_DIR, 'content/index.ts');
  const distContent = path.resolve(DIST_DIR, 'content.js');
  if (!fs.existsSync(contentEntry) && !fs.existsSync(distContent)) {
    fs.writeFileSync(distContent, '(() => {\n  // FormGen content script stub (M1)\n})();\n');
  }
}

// Common esbuild config
const baseConfig = {
  bundle: true,
  target: 'chrome110',
  sourcemap: isDev ? 'inline' : false,
  minify: !isDev,
  legalComments: 'none',
  logLevel: 'info',
};

/**
 * List of compilation targets with their specific formats.
 */
function getTargets() {
  const targets = [];

  // Content script: MUST BE IIFE (Chrome MV3 content_scripts restriction)
  const contentEntry = path.resolve(SRC_DIR, 'content/index.ts');
  if (fs.existsSync(contentEntry)) {
    targets.push({
      name: 'content',
      config: {
        ...baseConfig,
        entryPoints: [contentEntry],
        outfile: path.resolve(DIST_DIR, 'content.js'),
        format: 'iife',
      },
    });
  }

  // Background service worker: ESM format
  const backgroundEntry = path.resolve(SRC_DIR, 'background/index.ts');
  if (fs.existsSync(backgroundEntry)) {
    targets.push({
      name: 'background',
      config: {
        ...baseConfig,
        entryPoints: [backgroundEntry],
        outfile: path.resolve(DIST_DIR, 'background.js'),
        format: 'esm',
      },
    });
  }

  // Popup logic: ESM format
  const popupEntry = path.resolve(SRC_DIR, 'popup/popup.ts');
  if (fs.existsSync(popupEntry)) {
    targets.push({
      name: 'popup',
      config: {
        ...baseConfig,
        entryPoints: [popupEntry],
        outfile: path.resolve(DIST_DIR, 'popup.js'),
        format: 'esm',
      },
    });
  }

  // Options logic: ESM format
  const optionsEntry = path.resolve(SRC_DIR, 'options/options.ts');
  if (fs.existsSync(optionsEntry)) {
    targets.push({
      name: 'options',
      config: {
        ...baseConfig,
        entryPoints: [optionsEntry],
        outfile: path.resolve(DIST_DIR, 'options.js'),
        format: 'esm',
      },
    });
  }

  return targets;
}

async function run() {
  const startTime = Date.now();
  console.log(`[build] Starting FormGen build (${isDev ? 'DEVELOPMENT' : 'PRODUCTION'})...`);

  copyStaticAssets();
  const targets = getTargets();

  if (targets.length === 0) {
    console.warn('[build] No TypeScript entrypoints found yet in src/. Copied static assets only.');
    return;
  }

  if (isWatch) {
    console.log('[build] Watch mode activated. Initializing context watchers...');
    const contexts = await Promise.all(
      targets.map((t) => esbuild.context(t.config))
    );

    await Promise.all(contexts.map((ctx) => ctx.watch()));

    // Watch static assets
    const watchPaths = [
      path.resolve(__dirname, 'manifest.json'),
      path.resolve(SRC_DIR, 'popup/popup.html'),
      path.resolve(SRC_DIR, 'popup/popup.css'),
      path.resolve(SRC_DIR, 'options/options.html'),
      path.resolve(SRC_DIR, 'options/options.css'),
    ];

    for (const p of watchPaths) {
      if (fs.existsSync(p)) {
        fs.watch(p, () => {
          console.log(`[watch] Asset changed: ${path.basename(p)}. Re-copying...`);
          copyStaticAssets();
        });
      }
    }

    console.log('[watch] Watching for changes. Extension ready at ./dist/');
  } else {
    await Promise.all(targets.map((t) => esbuild.build(t.config)));
    const duration = Date.now() - startTime;
    console.log(`[build] Completed in ${duration}ms! Extension bundled to ./dist/`);
  }
}

run().catch((err) => {
  console.error('[build] Fatal error during build:', err);
  process.exit(1);
});
