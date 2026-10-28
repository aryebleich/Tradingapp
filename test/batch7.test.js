// The private README in Admin (encrypted, imported from history, published to GitHub) and creator
// emails shown to admins next to the nickname.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import { serve } from './client.js';
import { one, run } from '../src/db.js';

let fake, calls = [];
before(async () => {
  fake = http.createServer((req, res) => {
    let b = ''; req.on('data', c => (b += c)); req.on('end', () => {
      calls.push({ method: req.method, url: req.url, body: b });
      if (req.url.endsWith('/README.md') && !req.url.startsWith('/repos')) return res.end('# QuantPocket\n\nThe full guide.\n\n## Setup\n- one\n- two\n');
      if (req.url.endsWith('/docs/pricing-comparison.md')) return res.end('# Pricing comparison\n\nPlans compared.\n');
      res.setHeader('Content-Type', 'application/json');
      if (req.method === 'GET' && req.url.startsWith('/repos/') && req.url.includes('/contents/README.md')) return res.end(JSON.stringify({ sha: 'oldsha' }));
      if (req.method === 'PUT' && req.url.includes('/contents/README.md')) return res.end(JSON.stringify({ commit: { sha: 'newsha123' }, content: { html_url: 'https://example.com/README.md' } }));
      res.statusCode = 404; res.end('{}');
    });
  });
  await new Promise(r => fake.listen(0, r));
  const url = `http://127.0.0.1:${fake.address().port}`;
  Object.assign(process.env, { GITHUB_RAW_URL: url, GITHUB_API_URL: url, GITHUB_REPO: 'owner/repo' });
  delete process.env.GITHUB_TOKEN;
});
after(() => fake.close());

test('the public README is short; the private one is edited, imported and published from Admin', async () => {
  const readme = fs.readFileSync('README.md', 'utf8');
  assert.ok(readme.length < 800, 'public README stays short');
  assert.match(readme, /being built/);
  assert.ok(!fs.existsSync('docs/pricing-comparison.md'));
  const s = await serve();
  try {
    const owner = s.client(); await owner.signup('site-owner@example.com');
    const guest = s.client(); await guest.signup('readme-guest@example.com');
    assert.equal((await guest('/admin/site/readme')).status, 403);
    assert.equal((await owner('/admin/site/readme')).body.text, '');
    // Import the last full guide (no token: the public raw file), with the pricing notes appended.
    const imp = await owner('/admin/site/readme/import', {});
    assert.equal(imp.status, 200, JSON.stringify(imp.body));
    assert.match(imp.body.text, /The full guide[\s\S]*## Pricing comparison/);
    assert.ok(calls.some(c => c.url.includes('/owner/repo/cfdd4ed96a7b9f400821ba15b07d3101a19ff144/README.md')));
    // Saved encrypted: the database never holds the text as plain words.
    const row = await one("SELECT v FROM site_settings WHERE k = 'privateReadme'");
    assert.doesNotMatch(row.v, /full guide/);
    assert.equal((await owner('/admin/site/readme', { text: '# Edited\n\nNew text.' }, 'PUT')).status, 200);
    assert.equal((await owner('/admin/site/readme')).body.text, '# Edited\n\nNew text.');
    // A large guide fits.
    assert.equal((await owner('/admin/site/readme', { text: 'x'.repeat(300e3) }, 'PUT')).status, 200);
    await owner('/admin/site/readme', { text: '# Edited\n\nNew text.' }, 'PUT');
    // Publishing needs GITHUB_TOKEN and the password.
    assert.equal((await owner('/admin/site/readme')).body.canPublish, false);
    process.env.GITHUB_TOKEN = 'test-token';
    try {
      assert.equal((await owner('/admin/site/readme/publish', { password: 'wrong' })).status, 401);
      const pub = await owner('/admin/site/readme/publish', { password: 'Str0ngPassword' });
      assert.equal(pub.status, 200, JSON.stringify(pub.body)); assert.equal(pub.body.commit, 'newsha123');
      const put = calls.find(c => c.method === 'PUT');
      const body = JSON.parse(put.body);
      assert.equal(body.sha, 'oldsha'); assert.equal(Buffer.from(body.content, 'base64').toString(), '# Edited\n\nNew text.');
      assert.ok((await owner('/admin/site/readme')).body.publishedAt);
    } finally { delete process.env.GITHUB_TOKEN; }
  } finally { s.close(); }
});

test('admins see creator emails next to the nickname; other users see only the nickname', async () => {
  const s = await serve();
  try {
    const owner = s.client(); await owner.signup('site-owner2@example.com');
    const leader = s.client(); await leader.signup('leader7@example.com');
    const ch = (await leader('/fleet/channels', { name: 'Leader seven' })).body;
    const asAdmin = (await owner('/fleet')).body.public.find(c => c.id === ch.id);
    assert.match(asAdmin.creator, /^Trader [0-9A-F]{6}$/); assert.equal(asAdmin.creatorEmail, 'leader7@example.com');
    const asUser = (await leader('/fleet')).body.public.find(c => c.id === ch.id);
    assert.equal(asUser.creatorEmail, undefined);
    const users = (await owner('/admin/summary')).body.users;
    const u = users.find(x => x.email === 'leader7@example.com');
    assert.equal(u.nickname, asAdmin.creator);
  } finally { s.close(); }
});
