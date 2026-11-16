// Layout redesign rollout (src/layout-rollout.js): starts at 10%, goes to 100% after 30 clean minutes,
// switches the flag off and alerts on a regression, and serves the layout only inside the rollout.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { serve } from './client.js';

const F = await import('../src/flags.js');
const LR = await import('../src/layout-rollout.js');
const { siteSet } = await import('../src/site.js');
const S = await serve();
after(() => S.close());
const vid = inside => { for (let i = 0; i < 5000; i++) { const v = i.toString(16).padStart(16, '0'); if ((F.bucketOf(v, 'layout_v2') < F.flagSettings().layout_v2.pct) === inside) return v; } return 'ffffffffffffffff'; };
const fake = (o, n) => { // one minute of traffic per variant
  const req = (v, path, method, status) => { const ev = {}; const res = { statusCode: status, on: (_, f) => (ev.f = f) };
    LR.middleware({ path, method, headers: { cookie: `qp_vb=${v}` } }, res, () => {}); ev.f(); };
  for (const [v, spec] of [[vid(false), o], [vid(true), n]]) {
    for (let i = 0; i < spec.req; i++) req(v, '/api/me', 'GET', i < spec.err ? 500 : 200);
    for (let i = 0; i < (spec.money || 0); i++) req(v, '/api/orders', 'POST', i < (spec.moneyFail || 0) ? 422 : 200);
  }
};

test('flag off: pages are unchanged and carry no layout layer', async () => {
  await F.saveFlags({ layout_v2: { on: false, pct: 0 } });
  const html = await (await fetch(S.base + '/app')).text();
  assert.ok(!html.includes('layout.css') && !html.includes('class="lv2"'));
});

test('flag on: only visitors in the rollout get the layer; disclosures are in both', async () => {
  await F.saveFlags({ layout_v2: { on: true, pct: 50 } });
  for (const [inside, has] of [[true, true], [false, false]]) {
    for (const url of ['/app', '/', '/risk', '/no-such-page']) {
      const r = await fetch(S.base + url, { headers: { cookie: `qp_vb=${vid(inside)}` } });
      const html = await r.text();
      assert.equal(html.includes('href="/layout.css'), has, url);
      assert.match(r.headers.get('cache-control') || '', /private/, url);
    }
    const app = await (await fetch(S.base + '/app', { headers: { cookie: `qp_vb=${vid(inside)}` } })).text();
    for (const s of ['Trading involves risk of loss', 'not a broker or investment adviser']) assert.ok(app.includes(s));
  }
  assert.deepEqual(await LR.liveCheck(S.base, vid(true)), []);
});

test('rollout: 10% → 100% after 30 clean minutes', async () => {
  await siteSet('flags', {}); await siteSet('layoutRollout', null); LR._reset();
  const t0 = Date.now();
  await LR.start({ now: t0, log: { log() {}, error() {} } });
  assert.deepEqual([F.flagSettings().layout_v2.on, F.flagSettings().layout_v2.pct, LR.state().stage], [true, 10, '10']);
  for (let m = 1; m < 30; m++) { fake({ req: 100, err: 1 }, { req: 60, err: 0 }); await LR.tick({ now: t0 + m * 60e3 }); }
  assert.equal(F.flagSettings().layout_v2.pct, 10);
  fake({ req: 100, err: 1 }, { req: 60, err: 0 }); await LR.tick({ now: t0 + 30 * 60e3 });
  assert.deepEqual([F.flagSettings().layout_v2.pct, LR.state().stage], [100, '100']);
});

test('rollback: errors above twice the old layout switch the flag off and alert', async () => {
  await siteSet('flags', {}); await siteSet('layoutRollout', null); LR._reset();
  const alerts = [];
  await LR.start({ now: Date.now(), alert: async (s, t) => alerts.push(s + t), log: { log() {}, error() {} } });
  fake({ req: 200, err: 2 }, { req: 100, err: 5 }); await LR.tick({});
  assert.equal(F.flagSettings().layout_v2.on, false);
  assert.equal(LR.state().stage, 'rolled_back');
  assert.match(alerts.join(), /rolled back automatically[\s\S]*server errors 5\/100/);
  // It never switches itself back on.
  fake({ req: 10, err: 0 }, { req: 10, err: 0 }); await LR.tick({ now: Date.now() + 3600e3 });
  assert.equal(F.flagSettings().layout_v2.on, false);
});

test('rollback: failed order or payment attempts above twice the old layout', async () => {
  await siteSet('flags', {}); await siteSet('layoutRollout', null); LR._reset();
  await LR.start({ log: { log() {}, error() {} } });
  fake({ req: 10, money: 50, moneyFail: 1 }, { req: 10, money: 20, moneyFail: 3 }); await LR.tick({});
  assert.equal(LR.state().stage, 'rolled_back');
  assert.match(LR.state().why.join(), /failed order\/payment attempts 3\/20/);
});

test('the owner\'s own flag setting wins over the automatic start', async () => {
  await siteSet('layoutRollout', null); await F.saveFlags({ layout_v2: { on: false, pct: 0 } }); LR._reset();
  await LR.start({ log: { log() {}, error() {} } });
  assert.equal(F.flagSettings().layout_v2.on, false);
  assert.equal(LR.state().stage, 'manual');
});
