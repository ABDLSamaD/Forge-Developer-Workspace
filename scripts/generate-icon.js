"use strict";

/*
 * Generates the Forge application icon without any external dependency.
 * Outputs:
 *   build/icon.ico  (16..256, multi-size, Windows)
 *   build/icon.png  (512, generic)
 */

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

/* ----------------------------- png codec ---------------------------- */

let CRC_TABLE;
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c;
    }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([head, body, crc]);
}

function encodePng(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* ------------------------------ drawing ----------------------------- */

const ACCENT = [108, 140, 255]; // #6c8cff
const ACCENT_2 = [154, 108, 255]; // #9a6cff

// Feather "zap" bolt outline in a 24x24 box.
const BOLT_24 = [
  [13, 2],
  [3, 14],
  [12, 14],
  [11, 22],
  [21, 10],
  [12, 10],
];

function pointInPoly(px, py, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function roundedRectDist(nx, ny, r) {
  const qx = Math.abs(nx - 0.5) - (0.5 - r);
  const qy = Math.abs(ny - 0.5) - (0.5 - r);
  const ox = Math.max(qx, 0);
  const oy = Math.max(qy, 0);
  return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - r;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

/**
 * Renders the icon at `size` px with SSx supersampling.
 * Returns { width, height, rgba }.
 */
function render(size) {
  const SS = 4;
  const N = size * SS;
  const out = Buffer.alloc(size * size * 4);

  const radius = 0.225;
  const boltScale = 0.58 / 24; // bolt occupies ~58% of icon height
  const boltOffsetX = 0.5 - 12 * boltScale * (24 / 20) * 0; // centered below
  const cx = 0.5;
  const cy = 0.5;

  const bolt = BOLT_24.map(([x, y]) => [
    cx + (x - 12) * boltScale,
    cy + (y - 12) * boltScale,
  ]);
  const shadow = bolt.map(([x, y]) => [x + 0.018, y + 0.03]);

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;

      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const nx = (px * SS + sx + 0.5) / N;
          const ny = (py * SS + sy + 0.5) / N;

          if (roundedRectDist(nx, ny, radius) >= 0) continue;

          // diagonal brand gradient + soft top-left sheen
          const t = Math.min(1, Math.max(0, (nx + ny) / 2));
          let cr = lerp(ACCENT[0], ACCENT_2[0], t);
          let cg = lerp(ACCENT[1], ACCENT_2[1], t);
          let cb = lerp(ACCENT[2], ACCENT_2[2], t);
          const sheen = Math.max(0, 1 - Math.hypot(nx - 0.24, ny - 0.18) / 0.95) * 0.13;
          cr = lerp(cr, 255, sheen);
          cg = lerp(cg, 255, sheen);
          cb = lerp(cb, 255, sheen);

          if (pointInPoly(nx, ny, shadow)) {
            cr = lerp(cr, 18, 0.28);
            cg = lerp(cg, 16, 0.28);
            cb = lerp(cb, 52, 0.28);
          }
          if (pointInPoly(nx, ny, bolt)) {
            cr = 255;
            cg = 255;
            cb = 255;
          }

          r += cr;
          g += cg;
          b += cb;
          a += 255;
        }
      }

      const samples = SS * SS;
      const o = (py * size + px) * 4;
      out[o] = Math.round(r / samples);
      out[o + 1] = Math.round(g / samples);
      out[o + 2] = Math.round(b / samples);
      out[o + 3] = Math.round(a / samples);
    }
  }
  return { width: size, height: size, rgba: out };
}

/* ------------------------------- ico -------------------------------- */

function bmpEntry(img) {
  const { width: w, height: h, rgba } = img;
  const andStride = Math.ceil(w / 32) * 4;
  const dataSize = 40 + w * h * 4 + andStride * h;
  const buf = Buffer.alloc(dataSize);

  buf.writeUInt32LE(40, 0);
  buf.writeInt32LE(w, 4);
  buf.writeInt32LE(h * 2, 8); // XOR + AND mask
  buf.writeUInt16LE(1, 12);
  buf.writeUInt16LE(32, 14);

  let o = 40;
  for (let y = h - 1; y >= 0; y--) {
    for (let x = 0; x < w; x++) {
      const s = (y * w + x) * 4;
      buf[o++] = rgba[s + 2];
      buf[o++] = rgba[s + 1];
      buf[o++] = rgba[s];
      buf[o++] = rgba[s + 3];
    }
  } // AND mask stays zeroed (alpha comes from the 32bpp channel)
  return buf;
}

function buildIco(images) {
  const sorted = [...images].sort((a, b) => a.width - b.width);
  const payloads = sorted.map((img) =>
    img.width <= 64 ? bmpEntry(img) : encodePng(img.width, img.height, img.rgba)
  );

  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sorted.length, 4);

  let offset = 6 + sorted.length * 16;
  const entries = [];
  for (let i = 0; i < sorted.length; i++) {
    const e = Buffer.alloc(16);
    const dim = sorted[i].width >= 256 ? 0 : sorted[i].width;
    e[0] = dim;
    e[1] = dim;
    e[2] = 0; // palette
    e[3] = 0; // reserved
    e.writeUInt16LE(1, 4); // planes
    e.writeUInt16LE(32, 6); // bpp
    e.writeUInt32LE(payloads[i].length, 8);
    e.writeUInt32LE(offset, 12);
    offset += payloads[i].length;
    entries.push(e);
  }
  return Buffer.concat([header, ...entries, ...payloads]);
}

/* ------------------------------- main ------------------------------- */

const root = path.join(__dirname, "..");
const buildDir = path.join(root, "build");
fs.mkdirSync(buildDir, { recursive: true });

const SIZES = [16, 24, 32, 48, 64, 128, 256];
const images = SIZES.map(render);

fs.writeFileSync(path.join(buildDir, "icon.ico"), buildIco(images));

const p512 = render(512);
fs.writeFileSync(
  path.join(buildDir, "icon.png"),
  encodePng(p512.width, p512.height, p512.rgba)
);

console.log(
  "icon.ico:",
  fs.statSync(path.join(buildDir, "icon.ico")).size,
  "bytes |",
  "icon.png:",
  fs.statSync(path.join(buildDir, "icon.png")).size,
  "bytes"
);
