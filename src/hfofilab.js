// Order flow (OFI) lab, the server side: the synthetic sample, US stock quotes from Alpaca turned into
// ticks (top of book: bid/ask and sizes; equities, not the rb2305 future), and the downloads (the R
// project as a zip without any data, and the rendered PDF). The math runs in the browser
// (public/hfofi.js). Simulation only: nothing here places orders.
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { requireUser } from './auth.js';
import * as D from './alpaca/data.js';
import { nyAt } from './time.js';
import { isTradingDay } from './market-calendar.js';
import { NOTE } from './hfofi.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'research', 'hf-ofi');
const bad = (m, s = 400) => Object.assign(new Error(m), { status: s });

// ---------- a small zip writer (deflate, no extra library) ----------
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = buf => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
export function zip(files) { // files: [{ name, data: Buffer }]
  const parts = [], dir = []; let off = 0;
  for (const f of files) {
    const name = Buffer.from(f.name), raw = f.data, comp = zlib.deflateRawSync(raw), crc = crc32(raw);
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(8, 8); h.writeUInt32LE(0, 10);
    h.writeUInt32LE(crc, 14); h.writeUInt32LE(comp.length, 18); h.writeUInt32LE(raw.length, 22); h.writeUInt16LE(name.length, 26); h.writeUInt16LE(0, 28);
    parts.push(h, name, comp);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(8, 10); c.writeUInt32LE(0, 12);
    c.writeUInt32LE(crc, 16); c.writeUInt32LE(comp.length, 20); c.writeUInt32LE(raw.length, 24); c.writeUInt16LE(name.length, 28); c.writeUInt32LE(f.mode ? (f.mode << 16) >>> 0 : 0, 38); c.writeUInt32LE(off, 42);
    dir.push(c, name); off += 30 + name.length + comp.length;
  }
  const size = dir.reduce((a, b) => a + b.length, 0), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(size, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, ...dir, end]);
}
// The R project without the data (data/README.md is kept so people know where the file goes) and
// without rendered output.
export function projectFiles(root = ROOT) {
  const out = [];
  const walk = rel => { for (const e of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
    const r = path.posix.join(rel, e.name);
    if (e.isDirectory()) { if (r !== 'out') walk(r); continue; }
    if (r.startsWith('data/') && r !== 'data/README.md') continue;
    out.push({ name: 'hf-ofi/' + r, data: fs.readFileSync(path.join(root, r)), mode: r.endsWith('.sh') ? 0o100755 : 0o100644 });
  } };
  walk('');
  return out;
}

// Alpaca quotes → ticks in the lab's columns. last = the mid (quotes carry no trade price); volume
// and turnover stay 0. Quotes with a missing side are skipped.
export function quotesToTicks(qs) {
  return qs.filter(q => q.bp > 0 && q.ap > 0 && q.bs > 0 && q.as > 0).map(q => ({ t: Date.parse(q.t), last: (q.bp + q.ap) / 2, bid: q.bp, ask: q.ap, bidVol: q.bs, askVol: q.as, volume: 0, turnover: 0 }));
}

export const hfofiRouter = (() => {
  const r = express.Router(); r.use(requireUser);
  r.get('/sample', (req, res) => res.type('text/csv').set('Cache-Control', 'private, max-age=86400').send(fs.readFileSync(path.join(ROOT, 'data', 'sample.csv'))));
  // US stock quotes for one symbol and day: 30 minutes from a New York time (default 10:00).
  r.get('/quotes', async (req, res) => {
    try {
      const sym = String(req.query.symbol || '').toUpperCase(); if (!/^[A-Z]{1,5}(\.[A-Z])?$/.test(sym)) throw bad('Check the symbol (a US stock or ETF, for example SPY).');
      const day = /^\d{4}-\d{2}-\d{2}$/.test(req.query.day || '') ? req.query.day : null; if (!day) throw bad('Pick a day.');
      if (!isTradingDay(day)) throw bad('The market was closed that day (weekend or holiday).');
      const [h, m] = String(req.query.from || '10:00').split(':').map(Number), minutes = Math.min(120, Math.max(5, +req.query.minutes || 30));
      if (!D.dataEnabled()) throw bad('Market data is not set up on this server, so Alpaca quotes are not available. Use the sample or upload a file.', 503);
      const start = nyAt(day, h * 60 + (m || 0));
      const qs = await D.quotesRange(sym, { start: new Date(start).toISOString(), end: new Date(start + minutes * 60e3).toISOString(), limit: 20000 });
      const ticks = quotesToTicks(qs);
      if (ticks.length < 50) throw bad(`Only ${ticks.length} quotes for ${sym} in that window: pick a busier symbol or time.`, 404);
      res.json({ symbol: sym, day, ticks, source: 'Alpaca quotes (' + (process.env.ALPACA_STOCK_FEED || 'iex') + ' feed): US equities, not the rb2305 future', note: NOTE });
    } catch (e) { res.status(e.status || 502).json({ error: e.status ? e.message : 'Alpaca did not answer: ' + e.message }); }
  });
  r.get('/project.zip', (req, res) => res.type('application/zip').set('Content-Disposition', 'attachment; filename="hf-ofi.zip"').send(zip(projectFiles())));
  r.get('/report.pdf', (req, res) => { const f = path.join(ROOT, 'out', 'hf.pdf'); if (!fs.existsSync(f)) return res.status(404).json({ error: 'The report has not been rendered yet.' }); res.type('application/pdf').set('Content-Disposition', 'inline; filename="hf-ofi.pdf"').sendFile(f); });
  return r;
})();
