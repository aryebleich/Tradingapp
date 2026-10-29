// Translating site strings through the Yiddish Labs Text Processing API
// (POST /api/v1/process/text, action "translate-yiddish", X-API-KEY header).
// Strings go in numbered batches; HTML, entities, brand names and tickers are swapped for
// placeholders first so they come back unchanged, and every result is checked before use.

// Names that must stay in Latin letters, plus anything with two or more capitals (tickers, ETFs, QuantConnect).
const KEEP = ['Brightfolio', 'Charles Schwab', 'S&P 500', 'S&amp;P 500', 'S&P', 'S&amp;P', 'Alpaca Securities LLC', 'FINRA/SIPC', 'Alpaca', 'Schwab', 'tastytrade', 'Tradier', 'Stripe', 'Helcim', 'Twilio', 'Google', 'Zapier', 'Apple', 'Nasdaq', 'Bollinger', 'Sharpe', 'Authy', 'Starter', 'Pro', 'Elite', 'bitcoin'];
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const PROTECT = new RegExp([
  '<[^>]+>', '&[a-z#0-9]+;', '\\{[^}]*\\}', 'https?://\\S+', '[\\w.-]+\\.(?:com|ai|markets)\\b[\\w/.-]*', '[\\w.+-]+@[\\w-]+\\.[\\w.]+',
  ...KEEP.map(k => '\\b' + esc(k) + '(?![\\w])'),
  '\\b[A-Za-z0-9]*[A-Z][A-Za-z0-9&./#-]*[A-Z0-9][A-Za-z0-9&./#-]*\\b', // TQQQ, ETFs, QuantConnect, QC #687, SPY/QQQ
].join('|'), 'g');

export function protect(text) {
  const saved = [];
  const out = text.replace(PROTECT, m => { saved.push(m); return `⟦${saved.length - 1}⟧`; });
  return { text: out, saved };
}
export function restore(text, saved) {
  let ok = true;
  const out = text.replace(/⟦\s*(\d+)\s*⟧/g, (_, i) => { if (saved[+i] === undefined) ok = false; return saved[+i] ?? ''; });
  // Every placeholder must come back exactly once.
  for (let i = 0; i < saved.length; i++) if ((text.match(new RegExp(`⟦\\s*${i}\\s*⟧`, 'g')) || []).length !== 1) ok = false;
  return ok ? out : null;
}
// The API answers in Markdown: drop emphasis and backslash escapes.
export const unmarkdown = s => s.replace(/\*\*(.+?)\*\*/g, '$1').replace(/__(.+?)__/g, '$1').replace(/\\([\\`*_{}[\]()#+\-.!|>~<])/g, '$1').trim();

export function buildBatch(list) {
  const parts = list.map(protect);
  return { parts, text: parts.map((p, i) => `[[${i + 1}]] ${p.text}`).join('\n') };
}
// Returns translations by position (null where a line is missing or failed its checks).
export function parseBatch(reply, parts) {
  const lines = new Map();
  for (const line of unmarkdown(String(reply || '')).split('\n')) {
    const m = /^\s*\[\[\s*(\d+)\s*\]\]\s*(.*)$/.exec(line);
    if (m) lines.set(+m[1], m[2].trim());
  }
  return parts.map((p, i) => {
    const t = lines.get(i + 1);
    if (!t) return null;
    const r = restore(t, p.saved);
    // A translation must actually be Yiddish (Hebrew letters) unless the source had none to translate.
    if (r == null || (/[A-Za-z]/.test(p.text.replace(/⟦\d+⟧/g, '')) && !/[\u05D0-\u05EA]/.test(r))) return null;
    return r;
  });
}

export async function callApi({ base, key, text, fetchImpl = fetch }) {
  const r = await fetchImpl(base.replace(/\/$/, '') + '/api/v1/process/text', {
    method: 'POST', headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text_content: text, action: 'translate-yiddish' }), signal: AbortSignal.timeout(180000),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(`Yiddish Labs ${r.status}: ${d.error?.message || d.message || r.statusText}`), { status: r.status });
  return { text: d.text || '', credits: +d.credits_consumed || 0 };
}

// Translates strings in batches; lines a batch loses are retried one by one.
// Stops cleanly (keeping what is done) when the account runs out of credits or the plan has no API.
export const outOfCredits = e => [402, 403].includes(e?.status) || /credit|quota|insufficient|upgrade/i.test(e?.message || '');
export async function translateAll(strings, { base, key, size = 25, log = () => {}, fetchImpl } = {}) {
  const out = new Map();
  let credits = 0;
  try { await loop(); } catch (e) {
    if (!outOfCredits(e)) throw e;
    log(`Stopped: ${e.message}. ${out.size} strings were translated before that.`);
    return { out, credits, stopped: e.message };
  }
  return { out, credits };
  async function loop() {
  for (let i = 0; i < strings.length; i += size) {
    const chunk = strings.slice(i, i + size), { parts, text } = buildBatch(chunk);
    const r = await callApi({ base, key, text, fetchImpl });
    credits += r.credits;
    const got = parseBatch(r.text, parts);
    for (let j = 0; j < chunk.length; j++) {
      if (got[j] != null) { out.set(chunk[j], got[j]); continue; }
      const one = buildBatch([chunk[j]]), r1 = await callApi({ base, key, text: one.text, fetchImpl });
      credits += r1.credits;
      const g = parseBatch(r1.text, one.parts)[0];
      if (g != null) out.set(chunk[j], g); else log(`  kept the current Yiddish for: ${chunk[j].slice(0, 70)}`);
    }
    log(`  ${Math.min(i + size, strings.length)} / ${strings.length} (credits so far: ${credits})`);
  }
  }
}
