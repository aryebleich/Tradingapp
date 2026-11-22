// Rows read by the scheduler: on weekends and holidays the market-hours work reads nothing (the
// calendar decides before any query), a slot is claimed once per process, and scheduled orders are
// loaded only when they are due (an index search on next_run).
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { nyAt } from '../src/time.js';

process.env.DB_READ_STATS = '1';
let D, S, J;
before(async () => { D = await import('../src/db.js'); await D.ready; S = await import('../src/scheduler.js'); J = await import('../src/jobs.js'); });
const MARKET_TABLES = /\b(user_strategies|equalize|paper_orders|live_pairs|pair_bots|strategies|signal_trades|baskets|income_bots|newspicks_log|newspicks_trades|ai_funds|rules|scripts|alerts)\b/;
const touched = () => D.dbStats(500).top.filter(x => MARKET_TABLES.test(x.sql)).map(x => x.sql);

test('the job windows come from the calendar', () => {
  assert.equal(J.jobWindowOpen('session', nyAt('2026-11-21', 600)), false); // Saturday
  assert.equal(J.jobWindowOpen('session', nyAt('2026-11-26', 600)), false); // Thanksgiving
  assert.equal(J.jobWindowOpen('session', nyAt('2026-11-24', 600)), true);
  assert.equal(J.jobWindowOpen('extended', nyAt('2026-11-24', 300)), true); assert.equal(J.jobWindowOpen('extended', nyAt('2026-11-24', 1230)), false);
  assert.equal(J.jobWindowOpen('tradingDay', nyAt('2026-12-25', 600)), false); assert.equal(J.jobWindowOpen(undefined, nyAt('2026-12-25', 600)), true);
  assert.equal(new Set(J.JOBS.map(j => j[0])).size, J.JOBS.length, 'job names are unique (a shared name shares its time slots)');
});

test('no market-hours table is read on a Saturday, a Sunday or a holiday', async () => {
  for (const [day, min] of [['2026-11-21', 600], ['2026-11-22', 900], ['2026-11-26', 600], ['2026-11-26', 950]]) {
    D.resetDbStats();
    await S.runDueJobs(nyAt(day, min));
    assert.deepEqual(touched(), [], `${day} ${min}`);
  }
  // The control: a Tuesday afternoon in the session does read them.
  D.resetDbStats(); await S.runDueJobs(nyAt('2026-11-24', 940));
  assert.ok(touched().length > 0, 'a trading-day tick reads the market-hours tables');
});

test('a slot is claimed once per process, not on every 30-second tick', async () => {
  D.resetDbStats();
  const t = nyAt('2026-11-21', 700);
  await S.runDueJobs(t); const first = D.dbStats(500).top.find(x => /INSERT OR IGNORE INTO job_runs/.test(x.sql))?.calls || 0;
  D.resetDbStats();
  await S.runDueJobs(t + 30e3); // the same minute: every claim was already tried
  const second = D.dbStats(500).top.find(x => /INSERT OR IGNORE INTO job_runs/.test(x.sql))?.calls || 0;
  assert.ok(first > 3, String(first)); assert.equal(second, 0);
});

test('scheduled orders: only the due ones are loaded, through the next_run index', async () => {
  const { run, db } = D, t = nyAt('2026-11-21', 700);
  const u = Number((await run("INSERT INTO users (email, pass_hash, created_at) VALUES ('sched-reads@example.com', 'x', ?)", t)).lastInsertRowid);
  for (let i = 0; i < 40; i++) await run("INSERT INTO scheduled_orders (user_id, account, symbol, side, qty, repeat, next_run, active, created_at) VALUES (?, 'paper', 'SPY', 'buy', 1, 'weekly', ?, 1, ?)", u, i < 3 ? t - 60e3 : t + (i + 1) * 864e5, t);
  D.resetDbStats();
  await S.runScheduledOrders(t);
  const q = D.dbStats(500).top.find(x => /FROM scheduled_orders WHERE/.test(x.sql) && /next_run <=/.test(x.sql));
  assert.ok(q, 'the due query ran'); assert.equal(q.rows, 3); assert.deepEqual(q.fullScans, []);
  const plan = (await db.execute({ sql: 'EXPLAIN QUERY PLAN SELECT * FROM scheduled_orders WHERE active = 1 AND COALESCE(paused, 0) = 0 AND next_run <= ?', args: [t] })).rows.map(r => String(r.detail ?? r[3])).join(' ');
  assert.match(plan, /USING INDEX ix_scheduled_orders_active_next_run/);
});
