// Translate new app and homepage text through the Yiddish Labs website (Quick Action → Translate →
// To Yiddish), one string at a time, using the owner's own browser session. Run after each push:
//   YL_STATE=/path/to/state.json node scripts/yiddish-labs-web.mjs [--limit N] [--dry]
// YL_STATE is a Playwright storage-state file of a signed-in session (kept outside the repository).
// If it is missing or expired, sign in once with YL_EMAIL and YL_PASSWORD in the environment; the
// session is then saved to YL_STATE. Passwords are never written anywhere.
// Admin pages and anything already translated by Yiddish Labs are skipped. Results are checked
// (Hebrew letters present, names/tickers/HTML restored) and merged into public/i18n/yi-labs.js and
// scripts/yi_labs.json; the run stops cleanly when credits run out. Rebuild the homepage after:
//   python3 scripts/pages.py
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { protect, unmarkdown } from './yiddish-labs-lib.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2), limit = +(args[args.indexOf('--limit') + 1]) || Infinity, dry = args.includes('--dry');
const STATE = process.env.YL_STATE;
const URL_ = (process.env.YIDDISH_LABS_URL || 'https://app.yiddishlabs.com') + '/app/quick-action';

// ---------- what needs translating ----------
const app = (await import(pathToFileURL(path.join(root, 'public/i18n/yi.js')))).strings;
const home = JSON.parse(execFileSync('python3', ['-c', 'import json,sys; sys.path.insert(0, "scripts"); from yi_home import YI; print(json.dumps(YI))'], { cwd: root }));
const labsApp = (await import(pathToFileURL(path.join(root, 'public/i18n/yi-labs.js')))).default;
const homeFile = path.join(root, 'scripts/yi_labs.json'), labsHome = fs.existsSync(homeFile) ? JSON.parse(fs.readFileSync(homeFile, 'utf8')) : {};
function adminStrings() {
  const src = fs.readFileSync(path.join(root, 'public/app.js'), 'utf8'), prot = fs.readFileSync(path.join(root, 'public/protect.js'), 'utf8');
  const sections = [src.slice(src.indexOf('async function adminPage'), src.indexOf('\nfor (const [k] of ADMIN_TABS')), prot.slice(prot.indexOf('async function system'))];
  const out = new Set();
  for (const s of sections) for (const m of s.matchAll(/(['"`])((?:(?!\1)[^\\]|\\.)*?)\1/g)) for (const piece of m[2].split(/<[^>]+>|\$\{[^}]*\}/)) { const t = piece.trim().replace(/\s+/g, ' '); if (/[A-Za-z]{2}/.test(t)) out.add(t); }
  return out;
}
const adminOnly = adminStrings();
const entries = [...Object.entries(app).map(([en, yi]) => ['app', en, yi]), ...Object.entries(home).map(([en, yi]) => ['home', en, yi])]
  .filter(([where, en, yi]) => !/\n/.test(en) && /[A-Za-z]{2}/.test(en) && yi !== en && !(where === 'app' ? labsApp[en] : labsHome[en]) && !(where === 'app' && adminOnly.has(en)));
const todo = [...new Set(entries.map(([, en]) => en))].slice(0, limit);
console.log(`${todo.length} strings to translate on the Yiddish Labs website.`);
if (dry || !todo.length) process.exit(0);

// ---------- the website ----------
if (!STATE) { console.error('Set YL_STATE to a file path for the signed-in session.'); process.exit(1); }
const browser = await chromium.launch();
const ctx = await browser.newContext({ ...(fs.existsSync(STATE) ? { storageState: STATE } : {}), viewport: { width: 1300, height: 900 } });
const page = await ctx.newPage();
await page.goto(URL_, { waitUntil: 'networkidle', timeout: 90000 });
if (!(await page.locator('[contenteditable=true]').count())) {
  if (!process.env.YL_EMAIL || !process.env.YL_PASSWORD) { console.error('Not signed in: set YL_EMAIL and YL_PASSWORD once.'); process.exit(1); }
  await page.fill('input[type=email]', process.env.YL_EMAIL); await page.fill('input[type=password]', process.env.YL_PASSWORD);
  await page.keyboard.press('Enter'); await page.waitForURL(/\/app/, { timeout: 60000 });
  await page.goto(URL_, { waitUntil: 'networkidle' });
  await page.locator('[contenteditable=true]').waitFor({ timeout: 30000 });
}
await ctx.storageState({ path: STATE });
const credits = async () => +((await page.evaluate(() => (document.body.innerText.match(/([\d,]+)\s*\n?\s*Available credits/i) || [])[1] || '')) || '').replace(/,/g, '') || null;
const resultText = () => page.evaluate(() => {
  const h = [...document.querySelectorAll('span')].find(e => e.textContent.trim() === 'Result');
  return (h?.parentElement?.nextElementSibling?.innerText || '').trim();
});
async function translateOne(text) {
  const ed = page.locator('[contenteditable=true]').first();
  await ed.click(); await page.keyboard.press('Control+A'); await page.keyboard.press('Delete');
  await page.keyboard.insertText(text);
  const before = await resultText();
  await page.click('button:has-text("Translate...")');
  await page.click('text=To Yiddish');
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
let i = 0, kept = 0, sent = 0;
const why = { html: 0, short: 0, timeout: 0, check: 0 };
const save = () => {
  const res = { app: {}, home: {} };
  for (const [where, en] of entries) if (out.has(en)) res[where][en] = out.get(en);
  const appFile = path.join(root, 'public/i18n/yi-labs.js');
  fs.writeFileSync(appFile, `// Translations made with Yiddish Labs (https://app.yiddishlabs.com), written by\n// scripts/yiddish-labs.mjs. They take precedence over the hand-written strings in yi.js.\nexport default ${JSON.stringify({ ...labsApp, ...res.app }, null, 1)};\n`);
  fs.writeFileSync(homeFile, JSON.stringify({ ...labsHome, ...res.home }, null, 1) + '\n');
};
try {
  for (const en of todo) {
    i++;
    // The site drops placeholders, so plain text goes as is and every protected name/ticker must come
    // back unchanged; text with HTML, entities or {variables} keeps its hand-written Yiddish.
    const p = protect(en);
    if (p.saved.some(x => /[<&{]|https?:/.test(x))) { kept++; why.html++; continue; }
    // One- and two-word labels ("Paper", "Fill rate") lose their trading meaning without context:
    // they keep the reviewed hand-written Yiddish.
    if (en.trim().split(/\s+/).length <= 2) { kept++; why.short++; continue; }
    // A long session slows the page down: start fresh every 20 translations.
    if (++sent % 20 === 0) await page.goto(URL_, { waitUntil: 'networkidle', timeout: 90000 });
    let t = null;
    try { t = await translateOne(en); } catch (e) { if (e.credits) throw e; console.log(`  error on ${i}: ${e.message}`); await page.goto(URL_, { waitUntil: 'networkidle' }); }
    // The site sometimes leaves a timing marker such as <|0:00.0|> in front of the text.
    const clean = t == null ? null : unmarkdown(t).replace(/<\|[^|]*\|>/g, '').replace(/\n+/g, ' ').trim();
    // Tickers and codes (all capitals or digits) must stay exactly; brand names may be written in Yiddish letters.
    const r = clean != null && p.saved.filter(x => /^[A-Z0-9&./#-]+$/.test(x) && /[A-Z]{2}|\d/.test(x)).every(x => clean.includes(x)) ? clean : null;
    if (process.env.YL_DEBUG) console.log(JSON.stringify({ en, sent: p.text, got: t, r }));
    if (r && /[א-ת]/.test(r)) out.set(en, r); else kept++;
    if (i % 25 === 0) { save(); console.log(`${i} / ${todo.length}: ${out.size} translated, ${kept} kept as before (${JSON.stringify(why)})`); }
  }
} catch (e) { console.log(`Stopped: ${e.message}`); }
save();
console.log(`Done: ${out.size} translated, ${kept} kept as before, ${todo.length - i} not reached. Credits left: ${await credits()}`);
await ctx.storageState({ path: STATE });
await browser.close();
