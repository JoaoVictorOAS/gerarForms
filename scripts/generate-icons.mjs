// scripts/generate-icons.mjs
/**
 * Autonomous PNG Icon Generator for FormGen Chrome Extension.
 * Generates crisp 32-bit RGBA PNG icons (with alpha transparency) without external native canvas dependencies.
 *
 * Visual Motif:
 * FormGen Brand Rounded Squircle (#2563EB -> #1D4ED8)
 * White Document (#FFFFFF) with folded corner flap (#BFDBFE)
 * Form field lines (#93C5FD) and completed auto-fill checkmark (#2563EB)
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const iconsDir = path.resolve(__dirname, '../icons');

if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

/**
 * Creates a valid 32-bit RGBA PNG buffer in memory using Node's built-in zlib.
 */
function createPngRgba(width, height, getPixel) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  // IHDR: Color type 6 (RGBA), 8-bit depth
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8;
  ihdrData[9] = 6;
  ihdrData[10] = 0;
  ihdrData[11] = 0;
  ihdrData[12] = 0;

  const ihdrChunk = createChunk('IHDR', ihdrData);

  // Raw Image Data (1 filter byte per row + RGBA bytes)
  const rowSize = 1 + width * 4;
  const rawData = Buffer.alloc(height * rowSize);

  for (let y = 0; y < height; y++) {
    const rowOffset = y * rowSize;
    rawData[rowOffset] = 0; // Filter: None
    for (let x = 0; x < width; x++) {
      const pixelOffset = rowOffset + 1 + x * 4;
      const [r, g, b, a] = getPixel(x, y, width, height);
      rawData[pixelOffset] = r;
      rawData[pixelOffset + 1] = g;
      rawData[pixelOffset + 2] = b;
      rawData[pixelOffset + 3] = a;
    }
  }

  const idatChunk = createChunk('IDAT', zlib.deflateSync(rawData));
  const iendChunk = createChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

function createChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);

  const typeBuf = Buffer.from(type, 'ascii');
  const payload = Buffer.concat([typeBuf, data]);

  const crc = crc32(payload);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc >>> 0, 0);

  return Buffer.concat([len, payload, crcBuf]);
}

// CRC32 table & calculation
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  crcTable[n] = c;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return c ^ 0xffffffff;
}

// Distance from point (px, py) to line segment (ax, ay)-(bx, by)
function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// Signed distance to rounded rectangle
function sdRoundedBox(px, py, cx, cy, halfW, halfH, rad) {
  const qx = Math.abs(px - cx) - halfW + rad;
  const qy = Math.abs(py - cy) - halfH + rad;
  return Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - rad;
}

// Point-in-polygon ray-casting test
function pointInPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0];
    const yi = poly[i][1];
    const xj = poly[j][0];
    const yj = poly[j][1];
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Pixel-perfect 16x16 icon generator.
 * Specially tuned for clarity at toolbar size.
 */
function render16() {
  const size = 16;
  const docPoly = [
    [3.5, 2.0],
    [9.5, 2.0],
    [12.5, 5.0],
    [12.5, 14.0],
    [3.5, 14.0],
  ];
  const flapPoly = [
    [9.5, 2.0],
    [9.5, 5.0],
    [12.5, 5.0],
  ];
  const checkSegs = [
    [5.5, 9.5, 7.5, 11.5],
    [7.5, 11.5, 11.0, 7.5],
  ];
  const checkStroke = 1.6;

  return createPngRgba(16, 16, (x, y) => {
    let bgSamples = 0;
    let docSamples = 0;
    let flapSamples = 0;
    let checkSamples = 0;

    const sub = 4;
    for (let sy = 0; sy < sub; sy++) {
      for (let sx = 0; sx < sub; sx++) {
        const px = x + (sx + 0.5) / sub;
        const py = y + (sy + 0.5) / sub;

        const bgDist = sdRoundedBox(px, py, 8, 8, 7.2, 7.2, 3.2);
        if (bgDist <= 0) {
          bgSamples++;
          if (pointInPoly(px, py, docPoly)) {
            docSamples++;
            if (pointInPoly(px, py, flapPoly)) {
              flapSamples++;
            }
            for (const [x1, y1, x2, y2] of checkSegs) {
              if (distToSegment(px, py, x1, y1, x2, y2) <= checkStroke / 2) {
                checkSamples++;
                break;
              }
            }
          }
        }
      }
    }

    const total = sub * sub;
    const bgA = bgSamples / total;
    if (bgA === 0) return [0, 0, 0, 0];

    const docA = docSamples / total;
    const flapA = flapSamples / total;
    const checkA = checkSamples / total;

    const t = (x + y) / 32;
    let r = Math.round(37 * (1 - t) + 29 * t);
    let g = Math.round(99 * (1 - t) + 78 * t);
    let b = Math.round(235 * (1 - t) + 216 * t);

    if (docA > 0) {
      r = Math.round(r * (1 - docA) + 255 * docA);
      g = Math.round(g * (1 - docA) + 255 * docA);
      b = Math.round(b * (1 - docA) + 255 * docA);
    }
    if (flapA > 0) {
      r = Math.round(r * (1 - flapA) + 191 * flapA);
      g = Math.round(g * (1 - flapA) + 219 * flapA);
      b = Math.round(b * (1 - flapA) + 254 * flapA);
    }
    if (checkA > 0) {
      r = Math.round(r * (1 - checkA) + 37 * checkA);
      g = Math.round(g * (1 - checkA) + 99 * checkA);
      b = Math.round(b * (1 - checkA) + 235 * checkA);
    }

    return [r, g, b, Math.round(bgA * 255)];
  });
}

/**
 * Scalable vector-style icon renderer for 32px, 48px, 128px+.
 */
function renderScalable(size) {
  const iconScale = (size * 0.7) / 24;
  const originX = size / 2 - 12 * iconScale;
  const originY = size / 2 - 12 * iconScale;

  const tx = (gx) => originX + gx * iconScale;
  const ty = (gy) => originY + gy * iconScale;

  // Document polygon
  const docPoly = [
    [tx(5), ty(2)],
    [tx(14), ty(2)],
    [tx(19), ty(7)],
    [tx(19), ty(22)],
    [tx(5), ty(22)],
  ];

  // Folded flap triangle
  const flapPoly = [
    [tx(14), ty(2)],
    [tx(14), ty(7)],
    [tx(19), ty(7)],
  ];

  // Checkmark segments
  const checkStroke = Math.max(1.6, 2.2 * iconScale);
  const checkSegs = [
    [tx(8), ty(14.5), tx(11), ty(17.5)],
    [tx(11), ty(17.5), tx(16), ty(12.5)],
  ];

  // Form field lines (for size >= 32)
  const lineStroke = Math.max(1.0, 1.4 * iconScale);
  const formLines =
    size >= 32
      ? [
          [tx(8), ty(7.5), tx(12), ty(7.5)],
          [tx(8), ty(11), tx(16), ty(11)],
        ]
      : [];

  return createPngRgba(size, size, (x, y) => {
    let bgSamples = 0;
    let docSamples = 0;
    let flapSamples = 0;
    let checkSamples = 0;
    let lineSamples = 0;

    const sub = 3;
    for (let sy = 0; sy < sub; sy++) {
      for (let sx = 0; sx < sub; sx++) {
        const px = x + (sx + 0.5) / sub;
        const py = y + (sy + 0.5) / sub;

        const bgDist = sdRoundedBox(px, py, size / 2, size / 2, size * 0.44, size * 0.44, size * 0.22);
        if (bgDist <= 0) {
          bgSamples++;

          if (pointInPoly(px, py, docPoly)) {
            docSamples++;

            if (pointInPoly(px, py, flapPoly)) {
              flapSamples++;
            }

            for (const [x1, y1, x2, y2] of formLines) {
              if (distToSegment(px, py, x1, y1, x2, y2) <= lineStroke / 2) {
                lineSamples++;
                break;
              }
            }

            for (const [x1, y1, x2, y2] of checkSegs) {
              if (distToSegment(px, py, x1, y1, x2, y2) <= checkStroke / 2) {
                checkSamples++;
                break;
              }
            }
          }
        }
      }
    }

    const total = sub * sub;
    const bgA = bgSamples / total;
    if (bgA === 0) return [0, 0, 0, 0];

    const docA = docSamples / total;
    const flapA = flapSamples / total;
    const checkA = checkSamples / total;
    const lineA = lineSamples / total;

    // Background gradient: #2563EB to #1D4ED8
    const t = (x + y) / (2 * size);
    let r = Math.round(37 * (1 - t) + 29 * t);
    let g = Math.round(99 * (1 - t) + 78 * t);
    let b = Math.round(235 * (1 - t) + 216 * t);

    // Document body (White #FFFFFF)
    if (docA > 0) {
      r = Math.round(r * (1 - docA) + 255 * docA);
      g = Math.round(g * (1 - docA) + 255 * docA);
      b = Math.round(b * (1 - docA) + 255 * docA);
    }

    // Folded flap (Soft blue #BFDBFE)
    if (flapA > 0) {
      r = Math.round(r * (1 - flapA) + 191 * flapA);
      g = Math.round(g * (1 - flapA) + 219 * flapA);
      b = Math.round(b * (1 - flapA) + 254 * flapA);
    }

    // Form field lines (Sky blue #93C5FD)
    if (lineA > 0) {
      r = Math.round(r * (1 - lineA) + 147 * lineA);
      g = Math.round(g * (1 - lineA) + 197 * lineA);
      b = Math.round(b * (1 - lineA) + 253 * lineA);
    }

    // Auto-fill checkmark (FormGen Brand Blue #2563EB)
    if (checkA > 0) {
      r = Math.round(r * (1 - checkA) + 37 * checkA);
      g = Math.round(g * (1 - checkA) + 99 * checkA);
      b = Math.round(b * (1 - checkA) + 235 * checkA);
    }

    return [r, g, b, Math.round(bgA * 255)];
  });
}

const sizes = [16, 32, 48, 128];
for (const size of sizes) {
  const iconPath = path.resolve(iconsDir, `icon-${size}.png`);
  const buf = size === 16 ? render16() : renderScalable(size);
  fs.writeFileSync(iconPath, buf);
  console.log(`[icons] Generated FormGen icon (${size}x${size} RGBA): icons/icon-${size}.png (${buf.length} bytes)`);
}
