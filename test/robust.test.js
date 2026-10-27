// Damaged or stale stored data never breaks a page: an unreadable "view as plan" setting, a plan
// that no longer exists, a webhook token or card link saved under another encryption key.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serve } from './client.js';
import { run, one } from '../src/db.js';
import { tryDecrypt, encrypt } from '../src/crypto.js';

test('tryDecrypt gives null for damaged values instead of throwing', () => {
  assert.equal(tryDecrypt('not.a.blob'), null);
  assert.equal(tryDecrypt(null), null);
  assert.deepEqual(tryDecrypt(encrypt({ a: 1 })), { a: 1 });
});

test('damaged settings and encrypted values: pages still load', async () => {
  const s = await serve();
  try {
    const owner = s.client();
    const me = (await owner('/auth/register', { email: 'site-owner@example.com', password: 'Str0ngPassword' })).body.user;
    // A broken "view as plan" value, then a plan name that no longer exists: both ignored.
    await run("INSERT INTO user_settings (user_id, k, v, updated_at) VALUES (?, 'previewPlan', '{not json', 0) ON CONFLICT(user_id, k) DO UPDATE SET v = excluded.v", me.id);
    let r = await owner('/auth/me');
    assert.equal(r.status, 200); assert.equal(r.body.user.previewPlan, null);
    await run("UPDATE user_settings SET v = '\"platinum\"' WHERE user_id = ? AND k = 'previewPlan'", me.id);
    r = await owner('/auth/me');
    assert.equal(r.status, 200); assert.equal(r.body.user.previewPlan, null);
    assert.equal((await owner('/fees')).status, 200);
    // A webhook whose token was saved under another key, with damaged account data.
    await owner('/signals/hooks', { name: 'Test hook', accounts: ['paper'], sizeMode: 'shares', size: 1 });
    await run("UPDATE signal_hooks SET token_enc = 'bad.blob.here', accounts = 'oops' WHERE user_id = ?", me.id);
    const hooks = await owner('/signals/hooks');
    assert.equal(hooks.status, 200);
    assert.equal(hooks.body.hooks[0].broken, true); assert.equal(hooks.body.hooks[0].url, null); assert.deepEqual(hooks.body.hooks[0].accounts, ['paper']);
    // A card link that can no longer be read counts as not linked.
    await owner('/roundups', { mode: 'roundup', multiplier: 1, defaultSymbol: 'SPY', account: 'paper' }, 'PUT');
    await run("UPDATE roundup_settings SET plaid_token = 'bad.blob.here' WHERE user_id = ?", me.id);
    const ru = await owner('/roundups');
    assert.equal(ru.status, 200); assert.equal(ru.body.linked, false);
    assert.ok(await one('SELECT id FROM users WHERE id = ?', me.id));
  } finally { s.close(); }
});
