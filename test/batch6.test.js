// Chart colors by gain/loss state, AI & privacy controls, the adviser-only automatic strategies, and
// the owner's details staying out of the source.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { serve } from './client.js';
import { chartStates } from '../public/chartstates.js';
import { redact, robotsTxt, mayShareAccount } from '../src/aiaccess.js';
import { robotsTxt as defaultRobots } from '../src/crawlers.js';
import { ownerFingerprint } from '../src/site.js';

test('chart colors: new high, gain below its high, loss recovering, loss falling', () => {
  assert.deepEqual(chartStates([100, 105, 103, 108, 98, 99, 97, 97, 110], 100),
    ['high', 'high', 'pullback', 'high', 'loss', 'recover', 'loss', 'loss', 'high']);
  // Measured against the base given (a backtest's starting capital), not the first point.
  assert.deepEqual(chartStates([9000, 9500, 10500], 10000), ['loss', 'recover', 'high']);
});

test('AI privacy: personal details are removed, crawlers blocked by default', () => {
  const r = redact('Mail a.b+x@gmail.com, call +1 (845) 555-1234, card 4111 1111 1111 1111, key sk-ant-abcdefghijklmnop, AAPL 10 shares at $187.25 on 2026-10-27');
  assert.doesNotMatch(r, /gmail|845|4111|sk-ant/);
  assert.match(r, /AAPL 10 shares at \$187\.25 on 2026-10-27/);
  const robots = defaultRobots();
  for (const bot of ['Google-Extended', 'GPTBot', 'ClaudeBot', 'CCBot', 'PerplexityBot']) assert.match(robots, new RegExp(`User-agent: ${bot}\\n(?:User-agent: .*\\n)*Disallow: /\\n`));
  assert.match(robots, /User-agent: \*\n(?:Disallow: .*\n)*Disallow: \/app\n/);
  assert.equal(robots, robotsTxt());
  // Account figures only to providers that do not train on them (by default).
  assert.equal(mayShareAccount({ id: 'gemini', free: true }), false);
  assert.equal(mayShareAccount({ id: 'anthropic' }), true);
});

test('AI & privacy admin page drives robots.txt, the no-AI header and llms.txt', async () => {
  const s = await serve();
  try {
    const owner = s.client(); await owner.signup('site-owner@example.com');
    let r = await fetch(s.base + '/robots.txt'); let t = await r.text();
    assert.match(t, /User-agent: Google-Extended[\s\S]*?Disallow: \/\n/);
    assert.equal((await fetch(s.base + '/')).headers.get('x-robots-tag'), 'noai, noimageai');
    assert.equal((await fetch(s.base + '/llms.txt')).status, 404);
    const guest = s.client(); await guest.signup('ai-guest@example.com');
    assert.equal((await guest('/admin/site/ai')).status, 403);
    const put = await owner('/admin/site/ai', { allow: { google: true }, llmsOn: true, llms: 'Brightfolio is trading software. Contact boss@example.com', accountData: 'never' }, 'PUT');
    assert.equal(put.status, 200);
    t = await (await fetch(s.base + '/robots.txt')).text();
    assert.match(t, /AI crawlers allowed on the public pages\.\nUser-agent: Google-Extended\nUser-agent: GoogleOther\n(?:Disallow: .*\n)+Allow: \//);
    assert.match(t, /User-agent: GPTBot[\s\S]*?Disallow: \/\n/);
    assert.equal((await fetch(s.base + '/')).headers.get('x-robots-tag'), null);
    const llms = await (await fetch(s.base + '/llms.txt')).text();
    assert.match(llms, /trading software/); assert.doesNotMatch(llms, /boss@example\.com/);
    assert.equal((await owner('/admin/site/ai')).body.settings.accountData, 'never');
  } finally { s.close(); }
});

test('ready-made strategies trade real accounts by themselves only in registered-adviser mode', async () => {
  const s = await serve();
  try {
    const owner = s.client(); await owner.signup('site-owner2@example.com');
    const st = (await owner('/library', { templateId: 'bg_ensemble' })).body;
    assert.ok(st.id, JSON.stringify(st));
    // Automatic on paper is fine; on a real account it needs adviser mode.
    assert.equal((await owner('/library/' + st.id, { mode: 'auto', account: 'paper' }, 'PUT')).status, 200);
    const real = await owner('/library/' + st.id, { mode: 'auto', account: 'alpaca' }, 'PUT');
    assert.equal(real.status, 403); assert.match(real.body.error, /registered investment adviser/);
    assert.equal((await owner('/library/' + st.id)).body.autoRealAllowed, false);
    // By hand on the real account is fine.
    assert.equal((await owner('/library/' + st.id, { mode: 'manual', account: 'alpaca' }, 'PUT')).status, 200);
    // In adviser mode it is allowed.
    assert.equal((await owner('/admin/site/mode', { adviser: true, registered: true }, 'PUT')).status, 200);
    assert.equal((await owner('/library/' + st.id, { mode: 'auto', account: 'alpaca' }, 'PUT')).status, 200);
    await owner('/admin/site/mode', { adviser: false }, 'PUT');

    // Copying someone else's signal channel into a real account automatically: review only.
    const leader = s.client(); await leader.signup('leader@example.com');
    const ch = (await leader('/fleet/channels', { name: 'Leader signals' })).body;
    const sub = await owner(`/fleet/channels/${ch.id}/subscribe`, { accounts: ['alpaca'], mode: 'auto' });
    assert.equal(sub.status, 403); assert.match(sub.body.error, /review each signal/);
    assert.equal((await owner(`/fleet/channels/${ch.id}/subscribe`, { accounts: ['paper'], mode: 'auto' })).status, 200);
    assert.equal((await owner(`/fleet/channels/${ch.id}/subscribe`, { accounts: ['alpaca'], mode: 'review' })).status, 200);
    // Public pages show a nickname, never an email (admins also see the email: test/batch7).
    const pub = (await leader('/fleet')).body.public;
    const c = pub.find(x => x.id === ch.id);
    assert.match(c.creator, /^Trader [0-9A-F]{6}$/); assert.doesNotMatch(JSON.stringify(pub), /@/);
  } finally { s.close(); }
});

test('the owner\'s real addresses and phone appear nowhere in the source', () => {
  // The built-in fingerprints (first three lines of OWNER_FINGERPRINTS) must not match any email or
  // phone written in the repository.
  const src = fs.readFileSync('src/site.js', 'utf8');
  const fps = [...src.matchAll(/'([0-9a-f]{64})'/g)].map(m => m[1]);
  assert.equal(fps.length, 3);
  const seen = new Set();
  const walk = dir => { for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', 'e2e-output', 'data'].includes(f.name)) continue;
    const p = path.join(dir, f.name);
    if (f.isDirectory()) walk(p);
    else if (/\.(js|mjs|py|md|html|json|yaml|yml|txt|example)$/.test(f.name) && fs.statSync(p).size < 4e6) {
      const t = fs.readFileSync(p, 'utf8');
      for (const m of t.matchAll(/[A-Za-z0-9._%+-]+@gmail\.com/g)) seen.add(m[0].toLowerCase().replace(/\+.*@/, '@'));
      for (const m of t.matchAll(/\+1\d{10}\b/g)) seen.add(m[0]);
    }
  } };
  walk('.');
  for (const v of seen) assert.ok(!fps.includes(ownerFingerprint(v)), `an owner detail is written in the source: ${v.slice(0, 3)}…`);
});
