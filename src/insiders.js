// Insider trades from SEC Form 4 (queue row FEAT-02, registry S-11 and I-04; docs/research/insider-congressional.md).
// Officers, directors and 10% owners report most trades within two business days on Form 4. Two views:
//   - one stock: its latest Form 4 filings, read from EDGAR on request (cached for an hour);
//   - the market: a job reads EDGAR's "latest filings" feed every 30 minutes and keeps each filing's
//     transactions (insider_tx, one row per transaction, keyed by accession and line), so the list of
//     open-market buys and the cluster filter (2 or more insiders buying the same stock within 14 days)
//     read the database.
// Public data, labelled delayed: the trade date, the filing date and the days between are always shown,
// with the 10b5-1 flag (a scheduled plan, not a fresh decision) and a link to the filing. Not advice.
import { all, run, one, now } from './db.js';
import { get, secData, secWww, secCached } from './institutions.js';

export const NOTE = 'Public Form 4 filings from SEC EDGAR. Filings can lag the trade by up to two business days. This is not investment advice; insiders can and do lose money.';
export const CODES = { P: 'Buy (open market)', S: 'Sale (open market)', A: 'Grant or award', M: 'Option exercise', F: 'Shares withheld for tax', G: 'Gift', D: 'Disposed to the company', C: 'Conversion', X: 'Option exercise (in the money)' };
const DAY = 864e5;

// ---------- Form 4 XML, the parts the app reads (no XML library: the format is small and regular) ----------
const tag = (s, t) => { const m = new RegExp(`<${t}>\\s*(?:<value>)?\\s*([^<]*?)\\s*(?:</value>)?\\s*</${t}>`, 'i').exec(s || ''); return m ? m[1].trim() : ''; };
const blocks = (s, t) => [...String(s || '').matchAll(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`, 'gi'))].map(m => m[1]);
const yes = v => v === '1' || /^true$/i.test(v);
export function parseForm4(xml) {
  const owner = blocks(xml, 'reportingOwner')[0] || '';
  const rel = blocks(owner, 'reportingOwnerRelationship')[0] || '';
  const role = [yes(tag(rel, 'isDirector')) && 'Director', yes(tag(rel, 'isOfficer')) && (tag(rel, 'officerTitle') || 'Officer'), yes(tag(rel, 'isTenPercentOwner')) && '10% owner', yes(tag(rel, 'isOther')) && (tag(rel, 'otherText') || 'Other')].filter(Boolean).join(', ');
  const plan = yes(tag(xml, 'aff10b5One')) || /10b5-1/i.test(blocks(xml, 'footnotes').join(' '));
  const out = {
    form: tag(xml, 'documentType') || '4', symbol: tag(xml, 'issuerTradingSymbol').toUpperCase(), issuer: tag(xml, 'issuerName'), issuerCik: tag(xml, 'issuerCik'),
    insider: tag(owner, 'rptOwnerName'), role: role || 'Insider', plan10b51: plan, transactions: [],
  };
  for (const t of blocks(xml, 'nonDerivativeTransaction')) {
    const shares = +tag(t, 'transactionShares') || 0, price = +tag(t, 'transactionPricePerShare') || 0;
    out.transactions.push({ date: tag(t, 'transactionDate'), code: tag(t, 'transactionCode').toUpperCase(), shares, price, value: Math.round(shares * price), acquired: tag(t, 'transactionAcquiredDisposedCode').toUpperCase() === 'A' });
  }
  return out;
}
// Whole days between the trade and the filing (the delay a reader must see).
export const lagDays = (trade, filed) => (trade && filed ? Math.max(0, Math.round((Date.parse(filed) - Date.parse(trade)) / DAY)) : null);
const filingUrl = (cik, acc) => `${secWww()}/Archives/edgar/data/${+cik}/${String(acc).replace(/-/g, '')}/${acc}-index.htm`;

// ---------- one stock ----------
export async function forSymbol(symbol, { limit = 20 } = {}) {
  symbol = String(symbol || '').toUpperCase();
  if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(symbol)) throw Object.assign(new Error('Check the symbol'), { status: 400 });
  const { tickerCiks } = await import('./fundamentals.js');
  const hit = (await tickerCiks().catch(() => ({})))[symbol];
  if (!hit) return { symbol, rows: [], note: NOTE, reason: 'No SEC filer found for this symbol (funds and non-US companies file differently).' };
  const cik = String(hit.cik).padStart(10, '0');
  return secCached(`sec:form4:${cik}`, 3600e3, async () => {
    const sub = await get(`${secData()}/submissions/CIK${cik}.json`), r = sub.filings?.recent || {};
    const picks = (r.form || []).map((f, i) => ({ form: f, acc: r.accessionNumber[i], filed: r.filingDate[i], doc: r.primaryDocument[i] })).filter(x => x.form === '4' || x.form === '4/A').slice(0, 12);
    const rows = [];
    for (const p of picks) {
      const xml = await get(`${secWww()}/Archives/edgar/data/${+cik}/${p.acc.replace(/-/g, '')}/${String(p.doc).replace(/^xsl[^/]*\//, '')}`, 'text').catch(() => null);
      if (!xml) continue;
      const f = parseForm4(xml);
      for (const t of f.transactions) rows.push({ ...t, insider: f.insider, role: f.role, plan10b51: f.plan10b51, amended: p.form === '4/A', filed: p.filed, lag: lagDays(t.date, p.filed), url: filingUrl(cik, p.acc), codeName: CODES[t.code] || t.code });
    }
    return { symbol, issuer: sub.name, rows: rows.slice(0, limit), note: NOTE };
  });
}

// ---------- the market: the job and the list ----------
// EDGAR's latest Form 4 filings (Atom). Each filing appears twice (issuer and reporting owner): one per accession.
export function parseCurrentFeed(atom) {
  const seen = new Set(), out = [];
  for (const e of blocks(atom, 'entry')) {
    const href = /<link[^>]*href="([^"]+)"/i.exec(e)?.[1] || '', acc = /(\d{10}-\d{2}-\d{6})/.exec(href)?.[1], filed = tag(e, 'updated').slice(0, 10);
    const cik = /\/data\/(\d+)\//.exec(href)?.[1];
    if (!acc || !cik || seen.has(acc)) continue;
    seen.add(acc); out.push({ acc, cik, filed, form: /<category[^>]*term="([^"]+)"/i.exec(e)?.[1] || '4' });
  }
  return out;
}
export async function ingest({ max = 40 } = {}) {
  const atom = await get(`${secWww()}/cgi-bin/browse-edgar?action=getcurrent&type=4&owner=include&count=100&output=atom`, 'text');
  let added = 0;
  for (const f of parseCurrentFeed(atom).slice(0, max)) {
    if (await one('SELECT 1 FROM insider_tx WHERE accession = ? LIMIT 1', f.acc)) continue;
    const idx = await get(`${secWww()}/Archives/edgar/data/${+f.cik}/${f.acc.replace(/-/g, '')}/index.json`).catch(() => null);
    const doc = idx?.directory?.item?.map(i => i.name).find(n => /\.xml$/i.test(n) && !/^xsl/i.test(n));
    if (!doc) continue;
    const xml = await get(`${secWww()}/Archives/edgar/data/${+f.cik}/${f.acc.replace(/-/g, '')}/${doc}`, 'text').catch(() => null);
    if (!xml) continue;
    const p = parseForm4(xml);
    if (!p.symbol) continue;
    // An amendment replaces the original's rows for the same insider, stock and trade dates.
    if (/\/A$/.test(p.form)) for (const t of p.transactions) await run('DELETE FROM insider_tx WHERE symbol = ? AND insider = ? AND trade_date = ? AND code = ?', p.symbol, p.insider, t.date, t.code);
    for (const [i, t] of p.transactions.entries()) {
      await run(`INSERT INTO insider_tx (accession, line, symbol, issuer, insider, role, code, trade_date, filed, shares, price, value, plan10b51, amended, url, at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(accession, line) DO NOTHING`,
      f.acc, i, p.symbol, p.issuer, p.insider, p.role, t.code, t.date, f.filed, t.shares, t.price, t.value, p.plan10b51 ? 1 : 0, /\/A$/.test(p.form) ? 1 : 0, filingUrl(p.issuerCik || f.cik, f.acc), now());
      added++;
    }
  }
  return added;
}

// Open-market buys (code P) by default; cluster = 2 or more insiders buying the same stock within 14 days.
export async function marketList({ code = 'P', minValue = 0, role = '', cluster = false, days = 30, limit = 100 } = {}, t = Date.now()) {
  const since = new Date(t - days * DAY).toISOString().slice(0, 10);
  let rows = await all('SELECT * FROM insider_tx WHERE code = ? AND filed >= ? AND value >= ? ORDER BY filed DESC, value DESC LIMIT 500', String(code).toUpperCase().slice(0, 1) || 'P', since, Math.max(0, +minValue || 0));
  if (role) rows = rows.filter(r => r.role.toLowerCase().includes(String(role).toLowerCase()));
  if (cluster) {
    const by = new Map();
    for (const r of rows) (by.get(r.symbol) || by.set(r.symbol, []).get(r.symbol)).push(r);
    rows = [...by.values()].filter(list => {
      const dates = list.map(r => Date.parse(r.trade_date)).sort((a, b) => a - b);
      return new Set(list.map(r => r.insider)).size >= 2 && dates[dates.length - 1] - dates[0] <= 14 * DAY;
    }).flat();
  }
  return { note: NOTE, rows: rows.slice(0, limit).map(r => ({ symbol: r.symbol, issuer: r.issuer, insider: r.insider, role: r.role, code: r.code, codeName: CODES[r.code] || r.code, date: r.trade_date, filed: r.filed, lag: lagDays(r.trade_date, r.filed), shares: r.shares, price: r.price, value: r.value, plan10b51: !!r.plan10b51, amended: !!r.amended, url: r.url })) };
}
