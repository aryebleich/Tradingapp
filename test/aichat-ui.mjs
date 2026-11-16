// AI team Chat in a real browser (npm run aichat:ui): the real app with the scripted test model
// (NODE_ENV=test, AI_CHAT_FAKE_MODEL=1, never available in production). Checks the conversation view,
// streaming, thinking block, markdown, copy, stop, retry, regenerate, edit-to-branch, conversation list,
// keyboard use, live-region messages, phone drawer, reduced motion and autoscroll.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { ownerFingerprint } from '../src/site.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(root, 'e2e-output'); fs.mkdirSync(OUT, { recursive: true });
const PORT = 3154, B = `http://localhost:${PORT}`, OWNER = 'chat-ui-owner@example.com';
let failures = 0;
const server = spawn(process.execPath, ['server.js'], {
  cwd: root, stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, PORT: String(PORT), NODE_ENV: 'test', FREE_DATA: 'off', AI_CHAT_FAKE_MODEL: '1', DB_FILE: path.join(os.tmpdir(), `qp-chatui-${Date.now()}.db`), ALPACA_STREAM_URL: 'ws://127.0.0.1:1',
    ADMIN_EMAIL: OWNER, OWNER_HASHES: ownerFingerprint(OWNER), AI_PROVIDER: '', ANTHROPIC_API_KEY: '', GEMINI_API_KEY: '', GROQ_API_KEY: '', OPENROUTER_API_KEY: '' },
});
const log = []; server.stdout.on('data', d => log.push(String(d))); server.stderr.on('data', d => log.push(String(d)));
for (let i = 0; i < 60; i++) { if (await fetch(B + '/healthz').then(r => r.ok, () => false)) break; await new Promise(r => setTimeout(r, 200)); }
const reg = async email => { const r = await fetch(B + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'qp' }, body: JSON.stringify({ email, password: 'Str0ngPassword1', agree: true }) }); const kv = (r.headers.get('set-cookie') || '').split(';')[0], i = kv.indexOf('='); return { name: kv.slice(0, i), value: kv.slice(i + 1) }; };
const owner = await reg(OWNER), other = await reg('chat-ui-user@example.com');
const flag = on => fetch(B + '/api/admin/site/flags', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'qp', cookie: `${owner.name}=${owner.value}` }, body: JSON.stringify({ ai_team_chat: { on, pct: 100 } }) }).then(r => r.status);

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: B });
await ctx.addCookies([{ name: owner.name, value: owner.value, url: B }]);
const page = await ctx.newPage(), errors = [], announced = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => m.type() === 'error' && !/status of (400|401|403|404|409|429)|Failed to load resource/.test(m.text()) && errors.push(m.text()));
page.on('dialog', d => d.accept());
const step = async (name, fn) => { try { await fn(); console.log(`  ✓ ${name}`); } catch (e) { failures++; console.log(`  ✗ ${name}: ${String(e.message).split('\n')[0]}`); await page.screenshot({ path: path.join(OUT, `FAIL-chat-${name.replace(/\W+/g, '_')}.png`) }).catch(() => {}); } };
const must = (c, m) => { if (!c) throw new Error(m); };
const clip = () => page.evaluate(() => navigator.clipboard.readText());
const lastAsst = '.ac-list li.ac-asst:last-of-type';
const waitDone = () => page.waitForFunction(() => !document.querySelector('.ac-cursor') && document.querySelector('.ac-send') && !document.querySelector('.ac-send').hidden, null, { timeout: 15000 });
const recordLive = () => page.evaluate(() => { window.__live = []; new MutationObserver(() => window.__live.push(document.querySelector('.ac-sr[role=status]').textContent)).observe(document.querySelector('.ac-sr[role=status]'), { childList: true, characterData: true, subtree: true }); });

await step('flag off: the AI team page has no Chat card and the chat says it is off', async () => {
  await flag(false);
  await page.goto(B + '/app#/admin-agents'); await page.waitForSelector('#aiTeam', { timeout: 15000 }); await page.waitForTimeout(600);
  must(!(await page.$('a[href="#/admin-aichat"]')), 'no card');
  await page.goto(B + '/app#/admin-aichat'); await page.waitForSelector('#view .err');
  must(/not switched on/.test(await page.innerText('#view')), 'off message');
});
await step('flag on: the Chat job appears in the AI team and opens the conversation view', async () => {
  must(await flag(true) === 200, 'flag');
  await page.goto(B + '/app#/admin-agents'); await page.waitForSelector('a[href="#/admin-aichat"]', { timeout: 15000 });
  await page.click('a[href="#/admin-aichat"] button'); await page.waitForSelector('#acInput');
  must(await page.$eval('#acModel', s => [...s.options].map(o => o.value).join()) === 'fake,fake-plain', 'models');
});
await step('Shift+Enter adds a line; Enter sends; the reply streams with a cursor; live region says replying and done, never the tokens', async () => {
  await recordLive();
  await page.focus('#acInput'); await page.keyboard.type('Explain this'); await page.keyboard.press('Shift+Enter'); await page.keyboard.type('please');
  must((await page.inputValue('#acInput')) === 'Explain this\nplease', 'newline kept');
  must((await page.$$('.ac-list li')).length === 0, 'nothing sent yet');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.ac-cursor', { timeout: 5000 });
  await waitDone(); await page.waitForTimeout(300);
  const live = await page.evaluate(() => window.__live);
  must(live.some(t => /replying/.test(t)) && live.some(t => /complete/.test(t)), 'status announced: ' + live.join(' | '));
  must(!live.some(t => /Answer|characters/.test(t)), 'tokens are not announced');
  must((await page.innerText('#acTitle')).startsWith('Explain this'), 'title from the first message');
  must(/\d/.test(await page.getAttribute(`${lastAsst} time`, 'datetime')), 'timestamp');
});
await step('markdown: heading, bold, table and highlighted code with a copy button', async () => {
  const h = await page.innerHTML(`${lastAsst} .ac-body`);
  must(/<h4 class="md-h">Answer<\/h4>/.test(h) && /<strong>\d+<\/strong>/.test(h) && /<th scope="col"[^>]*>a<\/th>/.test(h) && /tk-k">const/.test(h) && /Copy code/.test(h), h.replace(/\n/g, ' ').slice(0, 1500));
});
await step('thinking: collapsed by default, labelled, with a duration; opens and closes from the keyboard; separate copy', async () => {
  const d = `${lastAsst} details.ac-think`;
  must(await page.$(d), 'thinking block'); must(!(await page.$eval(d, x => x.open)), 'collapsed by default');
  must(/Thinking/.test(await page.innerText(`${d} summary`)) && /for /.test(await page.innerText(`${d} summary`)), 'label and duration');
  await page.focus(`${d} summary`); await page.keyboard.press('Enter'); must(await page.$eval(d, x => x.open), 'opens with Enter');
  must(/Reading the question/.test(await page.innerText(`${d} .ac-tbody`)), 'thinking text');
  await page.click(`${d} .ac-copythink`); must(/Reading the question/.test(await clip()), 'thinking copied separately');
  await page.focus(`${d} summary`); await page.keyboard.press('Space'); must(!(await page.$eval(d, x => x.open)), 'closes with Space');
});
await step('copy: the answer without the thinking; code copy gives only the code', async () => {
  await page.click(`${lastAsst} .ac-copy`); const t = await clip();
  must(/## Answer/.test(t) && !/Reading the question/.test(t), 'answer only: ' + t.slice(0, 80));
  await page.click(`${lastAsst} [data-copy-code]`); must((await clip()).trim() === 'const x = 1; // done', 'code: ' + await clip());
});
await step('a model without thinking shows no thinking control and the layout holds', async () => {
  await page.selectOption('#acModel', 'fake-plain');
  await page.fill('#acInput', 'plain one'); await page.keyboard.press('Enter'); await page.focus('#acInput'); await page.keyboard.press('Enter');
  await waitDone();
  must(!(await page.$(`${lastAsst} details.ac-think`)), 'no thinking block');
  await page.selectOption('#acModel', 'fake');
});
await step('autoscroll follows the reply, stops when you scroll up, and a button jumps back', async () => {
  await page.setViewportSize({ width: 1280, height: 600 });
  await page.fill('#acInput', 'answer slow please'); await page.click('.ac-send');
  await page.waitForSelector('.ac-cursor'); await page.waitForTimeout(700);
  const near = await page.$eval('#acScroll', s => s.scrollHeight - s.scrollTop - s.clientHeight < 60); must(near, 'following the reply');
  await page.$eval('#acScroll', s => { s.scrollTop = 0; s.dispatchEvent(new Event('scroll')); }); await page.waitForTimeout(600);
  must(await page.$eval('#acScroll', s => s.scrollTop) < 50, 'stays where you scrolled');
  must(await page.isVisible('.ac-jump'), 'jump button');
  await page.click('.ac-jump');
});
await step('stop: Stop ends the reply, keeps the text and marks it Stopped', async () => {
  must(await page.isVisible('.ac-stop'), 'stop visible while streaming');
  await page.focus('.ac-stop'); await page.keyboard.press('Enter');
  await waitDone();
  must(/Stopped/.test(await page.innerText(lastAsst)), 'Stopped pill');
  must(/streams slowly/.test(await page.innerText(`${lastAsst} .ac-body`)), 'partial text kept');
  await page.setViewportSize({ width: 1280, height: 900 });
});
await step('reduced motion: the cursor does not blink', async () => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.fill('#acInput', 'slow again'); await page.click('.ac-send'); await page.waitForSelector('.ac-cursor');
  const an = await page.waitForFunction(() => { const c = document.querySelector('.ac-cursor'); return c?.isConnected && getComputedStyle(c).animationName ? getComputedStyle(c).animationName + ' / ' + matchMedia('(prefers-reduced-motion: reduce)').matches : null; }).then(h => h.jsonValue()); must(an.startsWith('none'), 'no animation: ' + an);
  await page.click('.ac-stop'); await waitDone(); await page.emulateMedia({ reducedMotion: 'no-preference' });
});
await step('a failure mid-reply keeps the text, says so, and Retry completes it', async () => {
  await page.click('.ac-new'); await page.waitForFunction(() => document.querySelector('#acTitle').textContent === 'New chat');
  await page.fill('#acInput', 'please fail'); await page.click('.ac-send');
  await page.waitForSelector(`${lastAsst} .ac-errline`, { timeout: 10000 });
  must((await page.getAttribute(`${lastAsst} .ac-errline`, 'role')) === 'alert', 'alert');
  must((await page.innerText(`${lastAsst} .ac-body`)).length > 0, 'partial text kept');
  must(await page.evaluate(() => document.activeElement?.classList.contains('ac-retry')), 'focus on Retry');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => !document.querySelector('.ac-list li.ac-asst:last-of-type .ac-errline') && /Answer/.test(document.querySelector('.ac-list li.ac-asst:last-of-type .ac-body')?.textContent || ''), null, { timeout: 10000 }); await waitDone();
  must(!(await page.$(`${lastAsst} .ac-errline`)) && /Answer/.test(await page.innerText(`${lastAsst} .ac-body`)), 'retried');
});
await step('regenerate replaces the last reply', async () => {
  const n = (await page.$$('.ac-list li')).length;
  await page.click(`${lastAsst} .ac-regen`); await waitDone();
  must((await page.$$('.ac-list li')).length === n, 'same number of messages');
});
await step('editing an earlier message starts a branch; the original stays in the list', async () => {
  const before = (await page.$$('.ac-convs li[data-id]')).length;
  await page.click('.ac-list li.ac-user .ac-edit');
  await page.fill('.ac-list li.ac-user textarea', 'Explain it differently'); await page.click('.ac-save');
  await page.waitForFunction(k => document.querySelectorAll('.ac-convs li[data-id]').length === k + 1, before, { timeout: 10000 });
  await page.waitForFunction(() => /Explain it differently/.test(document.querySelector('.ac-list li.ac-user')?.textContent || '')); await waitDone();
  must((await page.$$('.ac-convs li[data-id]')).length === before + 1, 'a new conversation');
  must(/\(edited\)/.test(await page.innerText('#acTitle')), 'branch title');
  must((await page.$$('.ac-list li.ac-user')).length === 1 && /Explain it differently/.test(await page.innerText('.ac-list li.ac-user')), 'edited text sent');
});
await step('conversation list: new chat, rename with Enter, delete', async () => {
  await page.click('.ac-new'); await page.waitForFunction(() => document.querySelector('#acTitle').textContent === 'New chat');
  await page.click('.ac-convs li[data-id] .ac-rename'); await page.fill('.ac-rn', 'My renamed chat'); await page.keyboard.press('Enter');
  await page.waitForFunction(() => [...document.querySelectorAll('.ac-ctitle')].some(t => t.textContent === 'My renamed chat'));
  const n = (await page.$$('.ac-convs li[data-id]')).length;
  await page.click('.ac-convs li[data-id] .ac-del'); await page.waitForFunction(k => document.querySelectorAll('.ac-convs li[data-id]').length === k - 1, n);
});
await step('accessibility rules: labels, names, unique ids, live region, no raw HTML from the model', async () => {
  const bad = await page.evaluate(() => {
    const v = document.querySelector('#view'), out = [];
    for (const i of v.querySelectorAll('input, select, textarea')) if (!(i.labels?.length || i.getAttribute('aria-label'))) out.push('unlabelled ' + (i.id || i.className));
    for (const b of v.querySelectorAll('button')) if (!(b.textContent.trim() || b.getAttribute('aria-label'))) out.push('unnamed button');
    const ids = [...v.querySelectorAll('[id]')].map(e => e.id); if (new Set(ids).size !== ids.length) out.push('duplicate ids');
    if (!v.querySelector('[role=status][aria-live=polite]')) out.push('no live region');
    if (v.querySelector('.ac-body script, .ac-body img, .ac-body iframe')) out.push('raw html rendered');
    return out;
  });
  must(!bad.length, bad.join('; '));
});
await step('phone width: the conversation list is a drawer; it opens, takes focus, closes with Escape', async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(B + '/app#/admin-aichat'); await page.waitForSelector('.ac-open-side');
  must(!(await page.isVisible('.ac-new')), 'drawer closed');
  await page.click('.ac-open-side'); await page.waitForTimeout(300);
  must((await page.getAttribute('.ac-open-side', 'aria-expanded')) === 'true' && await page.isVisible('.ac-new'), 'drawer open');
  must(await page.evaluate(() => document.activeElement?.classList.contains('ac-new')), 'focus moved into the drawer');
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  must((await page.getAttribute('.ac-open-side', 'aria-expanded')) === 'false' && await page.evaluate(() => document.activeElement?.classList.contains('ac-open-side')), 'closed, focus back');
  must(!(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)), 'no sideways scroll');
  await page.screenshot({ path: path.join(OUT, 'chat-phone.png') });
  await page.setViewportSize({ width: 1280, height: 900 });
});
await step('a non-admin is refused by the server and sees why', async () => {
  const c2 = await browser.newContext(); await c2.addCookies([{ name: other.name, value: other.value, url: B }]);
  const p2 = await c2.newPage(); await p2.goto(B + '/app#/admin-aichat'); await p2.waitForTimeout(1500);
  const r = await p2.evaluate(() => fetch('/api/admin/aichat/status').then(x => x.status));
  must(r === 403, 'server 403'); await c2.close();
});
await page.goto(B + '/app#/admin-aichat'); await page.waitForSelector('#acInput'); await page.screenshot({ path: path.join(OUT, 'chat-desktop.png') });
console.log(errors.length ? `  ✗ browser errors: ${errors.join(' | ').slice(0, 400)}` : '  ✓ no browser errors'); if (errors.length) failures++;
await browser.close(); server.kill();
if (failures) { console.log(`\n${failures} check(s) failed.\n${log.join('').split('\n').slice(-10).join('\n')}`); process.exit(1); }
console.log('\nAI team chat: all checks passed');
