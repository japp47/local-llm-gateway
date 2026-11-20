// Scrape every problem from Razorpay's "Fix My Itch" page (https://razorpay.com/m/fix-my-itch/).
//
// The page is built with Framer. The problem list is a Framer CMS collection, shipped as a
// binary ".framercms" chunk that the page's JavaScript fetches. This script finds that chunk
// from the live page (file names change on every redeploy), decodes it, and writes
// problems.json and problems.csv next to this file.
//
// Run: node spikes/fix-my-itch/scrape.mjs
// Polite: a handful of requests, one per second (robots.txt asks for Crawl-delay: 1).

import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PAGE = 'https://razorpay.com/m/fix-my-itch/';
const OUT = dirname(fileURLToPath(import.meta.url));
const UA = 'Mozilla/5.0 (research script)';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(url) {
  await sleep(1000);
  const res = await fetch(url, { headers: { 'user-agent': UA } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res;
}

// 1. Find the Framer module that declares the CMS chunk.
async function findChunkUrls() {
  const html = await (await get(PAGE)).text();
  const modules = [...new Set(html.match(/https:\/\/framerusercontent\.com\/sites\/[^"']+?\.mjs/g) ?? [])];
  const found = [];
  for (const m of modules) {
    if (/\/(react|motion|framer|rolldown-runtime)\.[^/]+\.mjs$/.test(m)) continue; // libraries
    const js = await (await get(m)).text();
    // new URL(`./X-chunk-default-0.framercms`,`https://framerusercontent.com/modules/.../X.js`).href.replace(`/modules/`,`/cms/`)
    for (const [, file, base] of js.matchAll(/new URL\(`\.\/([\w-]+-chunk-[\w-]+\.framercms)`,`([^`]+)`\)/g)) {
      found.push({ url: new URL(`./${file}`, base).href.replace('/modules/', '/cms/'), module: js });
    }
  }
  if (found.length === 0) throw new Error('No .framercms chunk found; the page layout may have changed.');
  return found;
}

// 2. Decode the chunk. Format (from Framer's runtime): big-endian.
//    uint32 itemCount; per item: uint16 fieldCount; per field: string key, tagged value.
//    string = uint32 byteLength + UTF-8 bytes. Tags: 0 null, 1 array, 2 bool, 3 color,
//    4 date (int64 ms), 5 enum, 6 file, 7 link (json), 8 number (float64), 9 object,
//    10 image (json), 11 rich text, 12 string, 13 vector item.
function decode(buf) {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const dec = new TextDecoder();
  let o = 0;
  const u8 = () => view.getUint8(o++);
  const u16 = () => { const v = view.getUint16(o); o += 2; return v; };
  const u32 = () => { const v = view.getUint32(o); o += 4; return v; };
  const str = () => { const n = u32(); const s = dec.decode(buf.subarray(o, o + n)); o += n; return s; };
  const value = () => {
    const tag = u8();
    switch (tag) {
      case 0: return null;
      case 1: { const n = u16(); return Array.from({ length: n }, value); }
      case 2: return u8() !== 0;
      case 3: case 5: case 6: case 12: return str();
      case 4: { const v = Number(view.getBigInt64(o)); o += 8; return new Date(v).toISOString(); }
      case 7: case 10: return JSON.parse(str());
      case 8: { const v = view.getFloat64(o); o += 8; return v; }
      case 9: { const n = u16(); const obj = {}; for (let i = 0; i < n; i++) obj[str()] = value(); return obj; }
      case 11: { const kind = view.getInt8(o++); if (kind === 0) return u32(); if (kind === 1) return str(); throw new Error('bad rich text'); }
      case 13: return u32();
      default: throw new Error(`unknown tag ${tag} at ${o - 1}`);
    }
  };
  const items = [];
  const count = u32();
  for (let i = 0; i < count; i++) {
    const fields = u16();
    const item = {};
    for (let f = 0; f < fields; f++) item[str()] = value();
    items.push(item);
  }
  return items;
}

// Framer field ids are opaque (e.g. "I35WjSkI0"). The page module declares each field's
// CMS title: `I35WjSkI0:{defaultValue:``,title:`Title`,type:...}`. Use those, normalised to
// snake_case (e.g. "Itch Score" -> itch_score).
function nameFields(items, moduleSource) {
  const titles = {};
  for (const [, id, title] of moduleSource.matchAll(/(\w+):\{defaultValue:[^{}]*?title:`([^`]+)`/g)) {
    titles[id] = title.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  }
  const ids = [...new Set(items.flatMap(Object.keys))];
  return Object.fromEntries(ids.map((id) => [id, titles[id] ?? id]));
}

const csvCell = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const chunks = await findChunkUrls();
const all = [];
for (const { url } of chunks) {
  const buf = new Uint8Array(await (await get(url)).arrayBuffer());
  all.push(...decode(buf));
}
const names = nameFields(all, chunks.map((c) => c.module).join('\n'));
const rows = all
  .map((it) => Object.fromEntries(Object.entries(it).map(([k, v]) => [names[k], v])))
  .map((r) => ({ ...r, itch_score: r.itch_score == null ? null : Number(r.itch_score) })) // stored as text
  .sort((a, b) => (b.itch_score ?? -1) - (a.itch_score ?? -1));
const first = ['itch_score', 'category', 'title'];
const cols = [...new Set([...first, ...Object.values(names)])]
  .filter((c) => !['nextItemId', 'previousItemId'].includes(c));
await writeFile(join(OUT, 'problems.json'), JSON.stringify({ source: PAGE, scrapedAt: new Date().toISOString(), fieldIds: names, items: rows }, null, 2));
await writeFile(join(OUT, 'problems.csv'), [cols.join(','), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(','))].join('\n') + '\n');
console.log(`${rows.length} problems from ${chunks.length} chunk(s). Fields:`, names);
