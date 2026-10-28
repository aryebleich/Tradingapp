// Translate new app and homepage text through the Yiddish Labs website (Quick Action → Translate →
// To Yiddish), one string at a time, using the owner's own browser session. Run after each push:
//   YL_STATE=/path/to/state.json node scripts/yiddish-labs-web.mjs [--since REF] [--limit N] [--dry]
// --since REF: only the app text added since that commit (e.g. the last pushed commit before this
// update). The homepage, Admin and the README are never sent in that mode.
// YL_STATE is a Playwright storage-state file of a signed-in session (kept outside the repository).
// If it is missing or expired, sign in once with YL_EMAIL and YL_PASSWORD in the environment; the
// session is then saved to YL_STATE. Passwords are never written anywhere.
// Admin pages and anything already translated by Yiddish Labs are skipped. Results are checked
// (Hebrew letters present, names/tickers/HTML restored) and merged into public/i18n/yi-labs.js and
// scripts/yi_labs.json; the run stops cleanly when credits run out. Rebuild the homepage after:
//   python3 scripts/pages.py
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { protect, unmarkdown } from './yiddish-labs-lib.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2), limit = +(args[args.indexOf('--limit') + 1]) || Infinity, dry = args.includes('--dry');
const since = args.includes('--since') ? args[args.indexOf('--since') + 1] : null;
const STATE = process.env.YL_STATE;
const URL_ = (process.env.YIDDISH_LABS_URL || 'https://app.yiddishlabs.com') + '/app/quick-action';

// ---------- what needs translating ----------
const app = (await import(pathToFileURL(path.join(root, 'public/i18n/yi.js')))).strings;
const home = JSON.parse(execFileSync('python3', ['-c', 'import json,sys; sys.path.insert(0, "scripts"); from yi_home import YI; print(json.dumps(YI))'], { cwd: root }));
const labsApp = (await import(pathToFileURL(path.join(root, 'public/i18n/yi-labs.js')))).default;
const homeFile = path.join(root, 'scripts/yi_labs.json'), labsHome = fs.existsSync(homeFile) ? JSON.parse(fs.readFileSync(homeFile, 'utf8')) : {};
function adminStrings() {
  const src = fs.readFileSync(path.join(root, 'public/app.js'), 'utf8'), prot = fs.readFileSync(path.join(root, 'public/protect.js'), 'utf8');
  const sections = [src.slice(src.indexOf('async function adminPage'), src.indexOf('\nfor (const [k] of ADMIN_TABS')), prot.slice(prot.indexOf('async function system')), fs.readFileSync(path.join(root, 'public/owner.js'), 'utf8')];
  const out = new Set();
  for (const s of sections) for (const m of s.matchAll(/(['"`])((?:(?!\1)[^\\]|\\.)*?)\1/g)) for (const piece of m[2].split(/<[^>]+>|\$\{[^}]*\}/)) { const t = piece.trim().replace(/\s+/g, ' '); if (/[A-Za-z]{2}/.test(t)) out.add(t); }
  return out;
}
const adminOnly = adminStrings();
// Any text that appears inside the admin pages' code stays English too.
const adminSrc = (() => { const a = fs.readFileSync(path.join(root, 'public/app.js'), 'utf8'), b = fs.readFileSync(path.join(root, 'public/protect.js'), 'utf8'); return a.slice(a.indexOf('async function adminPage'), a.indexOf('\nfor (const [k] of ADMIN_TABS')) + b.slice(b.indexOf('async function system')) + fs.readFileSync(path.join(root, 'public/owner.js'), 'utf8'); })();
// The app's Yiddish strings as they were at REF (the i18n files from that commit, loaded from a temp copy).
async function appStringsAt(ref) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'yl-since-'));
  for (const f of execFileSync('git', ['ls-tree', '--name-only', ref, 'public/i18n/'], { cwd: root, encoding: 'utf8' }).split('\n').filter(f => f.endsWith('.js')))
    fs.writeFileSync(path.join(tmp, path.basename(f)), execFileSync('git', ['show', `${ref}:${f}`], { cwd: root }));
  try { return (await import(pathToFileURL(path.join(tmp, 'yi.js')))).strings; } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}
const before = since ? await appStringsAt(since) : null;
const entries = [...Object.entries(app).filter(([en]) => !before || !(en in before)).map(([en, yi]) => ['app', en, yi]), ...(since ? [] : Object.entries(home).map(([en, yi]) => ['home', en, yi]))]
  .filter(([where, en, yi]) => !/\n/.test(en) && /[A-Za-z]{2}/.test(en) && yi !== en && !(where === 'app' ? labsApp[en] : labsHome[en]) && !(where === 'app' && (adminOnly.has(en) || adminSrc.includes(en))));
const todo = [...new Set(entries.map(([, en]) => en))].slice(0, limit);
console.log(`${todo.length} strings to translate on the Yiddish Labs website.`);
if (dry && process.env.YL_STATUS) fs.writeFileSync(process.env.YL_STATUS, JSON.stringify({ at: Date.now(), since, pending: todo.length, dry: true }, null, 1) + '\n');
if (dry || !todo.length) process.exit(0);

// ---------- the website ----------
// What the page shows when a step fails: address, title, headings, buttons and messages, with
// emails and long numbers removed (the run log is visible to anyone who can see the repository).
async function explain(why) {
  const info = await page.evaluate(() => ({
    path: location.pathname, title: document.title,
    headings: [...document.querySelectorAll('h1, h2, h3, [role=heading]')].map(e => e.innerText.trim()).filter(Boolean).slice(0, 8),
    buttons: [...document.querySelectorAll('button, a[role=button]')].map(e => e.innerText.trim()).filter(Boolean).slice(0, 15),
    messages: [...document.querySelectorAll('[role=alert], .p-message, .p-toast-message, .error, .p-error, small')].map(e => e.innerText.trim()).filter(Boolean).slice(0, 6),
    editors: document.querySelectorAll('[contenteditable], textarea').length,
  })).catch(e => ({ error: e.message }));
  const clean = v => JSON.stringify(v).replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[email]').replace(/\d{6,}/g, '[number]');
  console.error(`${why}\nPage: ${clean(info)}`);
  if (process.env.YL_STATUS) fs.writeFileSync(process.env.YL_STATUS, JSON.stringify({ at: Date.now(), since, stopped: why, page: JSON.parse(clean(info)) }, null, 1) + '\n');
  await browser.close(); process.exit(1);
}
if (!STATE) { console.error('Set YL_STATE to a file path for the signed-in session.'); process.exit(1); }
const browser = await chromium.launch();
const ctx = await browser.newContext({ ...(fs.existsSync(STATE) ? { storageState: STATE } : {}), viewport: { width: 1300, height: 900 } });
const page = await ctx.newPage();
await page.goto(URL_, { waitUntil: 'networkidle', timeout: 90000 });
if (!(await page.locator('[contenteditable=true]').count())) {
  if (!process.env.YL_EMAIL || !process.env.YL_PASSWORD) { console.error('Not signed in: set YL_EMAIL and YL_PASSWORD once.'); process.exit(1); }
  await page.fill('input[type=email]', process.env.YL_EMAIL); await page.fill('input[type=password]', process.env.YL_PASSWORD);
  // The site lives at app.yiddishlabs.com, so wait for the path to leave /login (not for "app" in the URL).
  await page.click('button[type=submit]:has-text("Login"), button:has-text("Login")');
  await page.waitForURL(u => !new URL(u).pathname.startsWith('/login'), { timeout: 60000 }).catch(async () => { await explain('Sign-in did not finish (wrong email or password, or an extra check on the Yiddish Labs side).'); });
  await page.goto(URL_, { waitUntil: 'networkidle', timeout: 90000 });
  await closePopups();
  await page.locator('[contenteditable=true]').first().waitFor({ timeout: 60000 }).catch(async () => { await explain('Signed in, but the translation editor did not appear.'); });
}
await ctx.storageState({ path: STATE });
// The site sometimes opens a pop-up (e.g. "what's new"); close it with the X at its top right so it
// does not block the editor.
async function closePopups() {
  for (let i = 0; i < 3; i++) {
    if (!(await page.locator('.p-dialog-mask, [role=dialog]').count())) return;
    // The X: the right-most clickable element in the top part of the dialog.
    const box = await page.evaluate(() => {
      const d = document.querySelector('.p-dialog-mask .p-dialog, .p-dialog, [role=dialog]');
      if (!d) return null;
      const r = d.getBoundingClientRect();
      const xs = [...d.querySelectorAll('button, [role=button], .p-dialog-header-close, svg')].map(e => e.getBoundingClientRect()).filter(b => b.width && b.top < r.top + 90);
      const b = xs.sort((a, c) => c.right - a.right)[0];
      return b ? { x: b.left + b.width / 2, y: b.top + b.height / 2 } : null;
    });
    if (box) await page.mouse.click(box.x, box.y); else await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  }
}
await closePopups();
const credits = async () => +((await page.evaluate(() => (document.body.innerText.match(/([\d,]+)\s*\n?\s*Available credits/i) || [])[1] || '')) || '').replace(/,/g, '') || null;
const resultText = () => page.evaluate(() => {
  const h = [...document.querySelectorAll('span')].find(e => e.textContent.trim() === 'Result');
  return (h?.parentElement?.nextElementSibling?.innerText || '').trim();
});
async function translateOne(text) {
  await closePopups();
  const ed = page.locator('[contenteditable=true]').first();
  await ed.click(); await page.keyboard.press('Control+A'); await page.keyboard.press('Delete');
  await page.keyboard.insertText(text);
  const before = await resultText();
  await page.click('button:has-text("Translate...")');
  // Exact text: after the first run the result panel also says "Translate to Yiddish".
  await page.click('text="To Yiddish"');
  // Wait until the result changes and stops changing.
  let last = before, same = 0;
  for (let i = 0; i < 180; i++) {
    await page.waitForTimeout(500);
    const t = await resultText();
    if (t && t !== before && !/will appear here/i.test(t)) { if (t === last) { if (++same >= 3) return t; } else { same = 0; last = t; } }
    if (await page.locator('text=/not enough credits|insufficient credits|out of credits|upgrade your plan/i').count()) throw Object.assign(new Error('Out of credits'), { credits: true });
  }
  return null;
}

const out = new Map();
let i = 0, kept = 0, sent = 0, stopped = null;
const why = { html: 0, short: 0, check: 0 };
const save = () => {
  const res = { app: {}, home: {} };
  for (const [where, en] of entries) if (out.has(en)) res[where][en] = out.get(en);
  const appFile = path.join(root, 'public/i18n/yi-labs.js');
  fs.writeFileSync(appFile, `// Translations made with Yiddish Labs (https://app.yiddishlabs.com), written by\n// scripts/yiddish-labs.mjs. They take precedence over the hand-written strings in yi.js.\nexport default ${JSON.stringify({ ...labsApp, ...res.app }, null, 1)};\n`);
  fs.writeFileSync(homeFile, JSON.stringify({ ...labsHome, ...res.home }, null, 1) + '\n');
};
// The site sometimes leaves a timing marker such as <|0:00.0|> in front of the text.
const tidy = t => unmarkdown(t).replace(/<\|[^|]*\|>/g, '').replace(/\n+/g, ' ').trim();
// Tickers and codes (all capitals or digits) must come back exactly; brand names may be written in
// Yiddish letters. A translation must contain Yiddish.
function accept(en, t) {
  const p = protect(en), r = t == null ? null : tidy(t);
  const ok = r && /[א-ת]/.test(r) && p.saved.filter(x => /^[A-Z0-9&./#-]+$/.test(x) && /[A-Z]{2}|\d/.test(x)).every(x => r.includes(x));
  if (process.env.YL_DEBUG) console.log(JSON.stringify({ en, got: t, ok: !!ok }));
  if (ok) out.set(en, r); else { kept++; why.check++; }
  return !!ok;
}
async function send(text) {
  // A long session slows the page down: start fresh every 20 requests.
  if (++sent % 20 === 0) { await page.goto(URL_, { waitUntil: 'networkidle', timeout: 90000 }); await closePopups(); }
  try { return await translateOne(text); }
  catch (e) { if (e.credits) throw e; console.log(`  error: ${e.message}`); await page.goto(URL_, { waitUntil: 'networkidle' }); return null; }
}
// Which strings go: text with HTML, entities or {variables} keeps its hand-written Yiddish (the
// site drops placeholders); one- and two-word labels ("Paper", "Fill rate") lose their trading
// meaning without context. Whole sentences travel together, numbered [[1]] [[2]] …, up to 8 at a
// time (about 160 words), so the site sees more context and fewer requests are needed.
const work = [];
for (const en of todo) {
  if (protect(en).saved.some(x => /[<&{]|https?:/.test(x))) { kept++; why.html++; continue; }
  const words = en.trim().split(/\s+/).length;
  if (words <= 2) { kept++; why.short++; continue; }
  work.push({ en, words, sentence: words >= 4 && /[.!?:)]$/.test(en.trim()) && !/^[.,;]/.test(en) });
}
const batches = [];
for (const w of work) {
  const last = batches.at(-1);
  if (w.sentence && last?.sentence && last.items.length < 8 && last.words + w.words <= 160) { last.items.push(w); last.words += w.words; }
  else batches.push({ sentence: w.sentence, items: [w], words: w.words });
}
try {
  for (const b of batches) {
    if (b.items.length === 1) { accept(b.items[0].en, await send(b.items[0].en)); i++; }
    else {
      const raw = await send(b.items.map((w, k) => `[[${k + 1}]] ${w.en}`).join('\n'));
      const lines = new Map();
      for (const line of String(raw || '').split('\n')) { const m = /^\s*\[\[\s*(\d+)\s*\]\]\s*(.*)$/.exec(unmarkdown(line)); if (m) lines.set(+m[1], m[2]); }
      // A line the site dropped or merged is sent again on its own.
      for (const [k, w] of b.items.entries()) { if (!(lines.has(k + 1) && accept(w.en, lines.get(k + 1)))) { if (lines.has(k + 1)) { kept--; why.check--; } accept(w.en, await send(w.en)); } i++; }
    }
    if (Math.floor(i / 25) !== Math.floor((i - b.items.length) / 25)) { save(); console.log(`${i} / ${work.length}: ${out.size} translated, ${kept} kept as before (${JSON.stringify(why)})`); }
  }
} catch (e) { stopped = e.message; console.log(`Stopped: ${e.message}`); }
save();
const left = await credits().catch(() => null);
console.log(`Done: ${out.size} translated, ${kept} kept as before, ${work.length - i} not reached. Credits left: ${left}`);
// A small status file for Admin → Yiddish Labs.
if (process.env.YL_STATUS) fs.writeFileSync(process.env.YL_STATUS, JSON.stringify({ at: Date.now(), since, translated: out.size, kept, notReached: work.length - i, requests: sent, credits: left, stopped }, null, 1) + '\n');
await ctx.storageState({ path: STATE });
await browser.close();
