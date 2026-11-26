// "Require two-factor sign-in" (Admin → Security, src/mfa-policy.js): off by default and nothing changes
// while it is off; when on, the scope and the grace period decide who must set it up; passkeys count;
// the switch needs admin plus step-up and is audited; admins can't be locked out; recovery codes.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { serve } from './client.js';

const P = await import('../src/mfa-policy.js');
const { run, one, now } = await import('../src/db.js');
const S = await import('../src/site.js');
let srv;
before(async () => { srv = await serve(); await S.siteSet('mfaPolicy', null); });
after(async () => { await S.siteSet('mfaPolicy', null); srv?.close(); });
const DAY = 864e5;
const user = (o = {}) => ({ id: 999001, role: 'user', totp_enabled: 0, created_at: now(), ...o });
const policy = o => ({ required: true, scope: 'all', graceDays: 7, since: now(), ...o });

test('off by default: no member is asked for anything, and the gate lets every request through', async () => {
  assert.equal(P.mfaPolicy().required, false);
  assert.deepEqual(await P.mfaStatus(user()), { required: false });
  let passed = false;
  await P.mfaGate()({ user: user(), path: '/orders' }, { status: () => ({ json: () => {} }) }, () => { passed = true; });
  assert.equal(passed, true);
});

test('sign-in is unchanged while it is off: password sign-in goes straight in, no code asked', async () => {
  const c = srv.client(); await c.signup('mfa-off@example.com');
  const c2 = srv.client(); const r = await c2('/auth/login', { email: 'mfa-off@example.com', password: 'Str0ngPassword' });
  assert.equal(r.status, 200); assert.ok(r.body.user); assert.equal(r.body.mfaRequired, undefined);
  assert.deepEqual((await c2('/auth/me')).body.user.mfa, { required: false });
});

test('when on: a banner during the grace period, then set-up is required (set-up routes stay open)', async () => {
  const p = policy(), u = user({ created_at: now() - DAY });
  const during = await P.mfaStatus(u, now() + DAY, p);
  assert.equal(during.grace, true); assert.equal(during.mustSetUp, false);
  const afterGrace = await P.mfaStatus(u, now() + 8 * DAY, p);
  assert.equal(afterGrace.mustSetUp, true);
  // A member who joins later gets the full grace from the day they joined.
  assert.equal((await P.mfaStatus(user({ created_at: now() + 5 * DAY }), now() + 8 * DAY, p)).mustSetUp, false);
});

test('the gate blocks the app after the grace, but never sign-in, set-up or sign-out', async () => {
  await S.siteSet('mfaPolicy', policy({ since: now() - 10 * DAY, graceDays: 7 }));
  try {
    const u = user({ created_at: now() - 20 * DAY });
    const call = async path => { let code = 200, body = null, passed = false; await P.mfaGate()({ user: u, path }, { status: c => ({ json: b => { code = c; body = b; } }) }, () => { passed = true; }); return { passed, code, body }; };
    const blocked = await call('/orders');
    assert.equal(blocked.passed, false); assert.equal(blocked.code, 403); assert.equal(blocked.body.mfaSetupRequired, true);
    for (const path of ['/auth/me', '/auth/totp/setup', '/auth/totp/enable', '/auth/logout', '/security/passkeys/options', '/security/passkeys', '/security']) assert.equal((await call(path)).passed, true, path);
  } finally { await S.siteSet('mfaPolicy', null); }
});

test('the scopes: admins only, live-trading accounts, everyone; a passkey counts as two-factor', async () => {
  const admin = user({ role: 'admin' }), member = user();
  assert.equal(await P.inScope(admin, policy({ scope: 'admins' })), true);
  assert.equal(await P.inScope(member, policy({ scope: 'admins' })), false);
  assert.equal(await P.inScope(member, policy({ scope: 'live' }), { isLive: async () => false }), false);
  assert.equal(await P.inScope(member, policy({ scope: 'live' }), { isLive: async () => true }), true);
  assert.equal(await P.inScope(member, policy({ scope: 'all' })), true);
  assert.deepEqual(await P.mfaStatus(user({ totp_enabled: 1 }), now() + 30 * DAY, policy()), { required: true, done: true });
  const c = srv.client(); const u = await c.signup('mfa-passkey@example.com');
  await run('INSERT INTO passkeys (user_id, cred_id, public_key, counter, created_at) VALUES (?,?,?,?,?)', u.id, 'test-cred-' + u.id, 'x', 0, now());
  const row = await one('SELECT * FROM users WHERE id = ?', u.id);
  assert.equal((await P.mfaStatus(row, now() + 30 * DAY, policy())).done, true);
});

test('the switch: admin + step-up, written to the audit log with who and when; refused while no admin has a second factor', async () => {
  const c = srv.client(); const a = await c.signup('mfa-admin@example.com');
  await run("UPDATE users SET role = 'admin' WHERE id = ?", a.id);
  const member = srv.client(); await member.signup('mfa-member@example.com');
  assert.equal((await member('/admin/security/mfa-policy', { required: true }, 'PUT')).status, 403, 'members never reach it');
  const locked = await c('/admin/security/mfa-policy', { required: true, scope: 'all', graceDays: 7 }, 'PUT');
  assert.equal(locked.status, 403); assert.equal(locked.body.adminUnlock, true, 'needs the password step-up first');
  assert.equal((await c('/admin/server/unlock', { password: 'Str0ngPassword' })).status, 200);
  // No admin has two-factor or a passkey yet: refused, so nobody can be locked out.
  await run("UPDATE users SET totp_enabled = 0 WHERE role = 'admin'"); await run("DELETE FROM passkeys WHERE user_id IN (SELECT id FROM users WHERE role = 'admin')");
  const lockout = await c('/admin/security/mfa-policy', { required: true, scope: 'admins', graceDays: 7 }, 'PUT');
  assert.equal(lockout.status, 409); assert.equal(lockout.body.lockout, true);
  assert.equal(P.mfaPolicy().required, false);
  await run('INSERT INTO passkeys (user_id, cred_id, public_key, counter, created_at) VALUES (?,?,?,?,?)', a.id, 'admin-cred-' + a.id, 'x', 0, now());
  const on = await c('/admin/security/mfa-policy', { required: true, scope: 'live', graceDays: 5 }, 'PUT');
  assert.equal(on.status, 200); assert.equal(on.body.policy.required, true); assert.equal(on.body.policy.scope, 'live'); assert.equal(on.body.policy.graceDays, 5);
  const view = (await c('/admin/security/mfa-policy')).body;
  assert.equal(view.policy.changedBy, 'mfa-admin@example.com'); assert.ok(view.policy.changedAt);
  assert.ok(view.log.some(l => l.email === 'mfa-admin@example.com' && JSON.parse(l.detail).required === true));
  const off = await c('/admin/security/mfa-policy', { required: false }, 'PUT');
  assert.equal(off.body.policy.required, false);
  assert.equal((await one("SELECT COUNT(*) n FROM audit_log WHERE event = 'mfa_policy_changed' AND user_id = ?", a.id)).n, 2);
});

test('recovery codes: ten one-time codes made once, each signs in once', async () => {
  const c = srv.client(); const u = await c.signup('mfa-recovery@example.com');
  const codes = await P.ensureRecoveryCodes(u.id);
  assert.equal(codes.length, 10); assert.equal(new Set(codes).size, 10);
  assert.equal(await P.ensureRecoveryCodes(u.id), null, 'not made again while some are left');
  assert.equal(await P.useRecoveryCode(u.id, codes[0].toLowerCase()), true);
  assert.equal(await P.useRecoveryCode(u.id, codes[0]), false, 'each code works once');
  assert.equal(await P.useRecoveryCode(u.id, 'NOT-A-CODE'), false);
  assert.equal(await P.recoveryCodesLeft(u.id), 9);
});
