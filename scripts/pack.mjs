// scripts/pack.mjs
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const distDir = path.resolve(rootDir, 'dist');
const outZip = path.resolve(rootDir, 'formgen-extension.zip');

if (!fs.existsSync(distDir)) {
  console.error('[pack] dist directory does not exist. Run npm run build first.');
  process.exit(1);
}

if (fs.existsSync(outZip)) {
  fs.unlinkSync(outZip);
}

try {
  // Use system zip utility
  execSync(`cd "${distDir}" && zip -r "${outZip}" ./*`, { stdio: 'inherit' });
  console.log(`[pack] Successfully created extension bundle: ${outZip}`);
} catch (e) {
  console.error('[pack] Failed to package extension zip:', e);
  process.exit(1);
}
