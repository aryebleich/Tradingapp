// Brightolio web server: JSON API + static single-page app.
// First, before any module that opens the database: on Render this only redirects to Oracle.
import { rankTasks } from './src/setup-tasks.js';
import './src/render-redirect.js';
import './src/fetch-timeout.js'; // a time limit on every outside call (PERFORMANCE.md)
import * as SEO from './src/seo.js';
import { agentsRouter } from './src/agents.js';
import { overviewRouter } from './src/overview.js';
import { portfolioRiskRouter } from './src/portfoliorisk.js';
import { adminUsersRouter } from './src/adminusers.js';
import { retirementRouter, isIra, ACCOUNT_TYPES } from './src/retirement.js';
import { hostingRouter, isActiveHost, startKeepWarm, startHostingSync, thisHost } from './src/hosting.js';
import { plainResearchRouter } from './src/plainresearch.js';
import express from 'express';
import compression from 'compression';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { one, all, run, now, audit, persistentDb, needsHostedDb, schemaReport, dbStats, resetDbStats, dbKind, persistentDisk, dbHealth } from './src/db.js';
import { encrypt, hashSecret, verifySecret, safeEqual, publicName } from './src/crypto.js';
import * as auth from './src/auth.js';
import crypto from 'node:crypto';
import { backtest, projectAnnual, walkForward, optimize, warmupFor, compile, PRESETS } from './src/engine.js';
import { getBars, getCred, accountSummary, placeOrder, listOrders, portfolioHistory, lastPrice, snapshotEquity, ACCOUNT_IDS } from './src/brokers.js';
import * as QC from './src/quantconnect.js';
import { PLANS, COMPARE, GROWTH_COMPARE, TIERS, TRIAL_DAYS, isPaid, adjustForCashflow, revenueSummary } from './src/fees.js';
import { llmEnabled, llmInfo } from './src/llm.js';
import { securityRouter, passkeyLoginRouter, stepUpGuard } from './src/security.js';
import { lessonsRouter } from './src/lessons.js';
import { execRouter } from './src/execution.js';
import { marginRouter } from './src/margin.js';
import { setSetting, getSetting } from './src/settings.js';
import { prefsRouter } from './src/settings.js';
import { longtermRouter } from './src/longterm.js';
import { cpu } from './src/cpu.js';
import { shedMiddleware, recordRoute, countUnhandled, stats as relStats, metricsText, recommendedReplicas, load as relLoad } from './src/reliability.js';
import { queueStats, userQueue } from './src/orderqueue.js';
import { booksFor, booksCsv } from './src/books.js';
import { taxSummary, harvestCandidates, form8949Csv, scheduleD, scheduleDCsv, markToMarket } from './src/tax.js';
import { buildStrategy } from './src/ai.js';
import { handleCommand, userByPhone, normalize, HELP, KNOWN, CHAT_WORDS, FREE_COMMANDS } from './src/commands.js';
import { aiEnabled, interpret, toCommand } from './src/assistant.js';
import { startScheduler, assessAllFees, runDueJobs, snapshotAll, nextRunOf, recordRun } from './src/scheduler.js';
import { nyAt, nyTime } from './src/time.js';
import { planWhen } from './src/schedule-plan.js';
import { advancedOf } from './src/brokers.js';
import { closedDays, addDays } from './src/market-calendar.js';
import { startKycEvents } from './src/alpaca/kyc.js';
import { riskRouter } from './src/risk.js';
import { insightsRouter } from './src/insights.js';
import { mlRouter, forecastSymbol } from './src/ml.js';
import { chatRouter } from './src/chat.js';
import { scannerRouter } from './src/scanner.js';
import { basketsRouter } from './src/baskets.js';
import { fleetRouter, channelHook } from './src/fleet.js';
import { marketRouter } from './src/market.js';
import { optionsRouter } from './src/options.js';
import { sentimentRouter } from './src/sentiment.js';
import { valuesRouter } from './src/values.js';
import { altsRouter } from './src/alts.js';
import { moneyRouter } from './src/money.js';
import { trustPublicRouter, trustAdminRouter } from './src/trust.js';
import { luachRouter } from './src/luach.js';
import { deskRouter } from './src/desk.js';
import { fundamentalsRouter } from './src/fundamentals.js';
import { instrumentsRouter } from './src/instruments.js';
import { taxRatesRouter } from './src/taxrates.js';
import { commsAdminRouter, registerCalls, inboundSms } from './src/comms.js';
import { statScanRouter } from './src/statscan.js';
import { searchRouter } from './src/search.js';
import { paperOrdersRouter, place as placePaperOrder, TYPES as PAPER_TYPES } from './src/paperorders.js';
import { addonsRouter } from './src/addons.js';
import { altLiveRouter } from './src/altlive.js';
import { briefRouter } from './src/brief.js';
import { taxPilotRouter } from './src/taxpilot.js';
import { rulesRouter } from './src/rules.js';
import { combinedRouter } from './src/consolidate.js';
import { profilesRouter } from './src/profiles.js';
import { sponsoredRouter } from './src/sponsored.js';
import { investRouter } from './src/invest.js';
import { stockRouter } from './src/stock.js';
import { ratesRouter } from './src/rates.js';
import { diversifyRouter } from './src/diversify.js';
import { newspicksRouter } from './src/newspicks.js';
import { intradayRouter } from './src/intraday.js';
import { incomeRouter } from './src/income.js';
import { activeRouter } from './src/active.js';
import { hfofiRouter } from './src/hfofilab.js';
import { aiFundsRouter } from './src/aifunds.js';
import { aiTeamRouter } from './src/aiteam.js';
import { aiChatRouter } from './src/aichat/routes.js';
import { equalizeRouter } from './src/equalize.js';
import { filterErrors, listIssues, clearIssues } from './src/usererrors.js';
import { bizRouter, publicInvoiceRouter } from './src/business/routes.js';
import { scriptsRouter } from './src/scripts.js';
import { quickbooksRouter, finish as qboFinish } from './src/quickbooks.js';
import { institutionsRouter } from './src/institutions.js';
import { roundupRouter } from './src/roundup.js';
import { codeRouter } from './src/code.js';
import * as N from './src/notify.js';
import * as PAY from './src/payments.js';
import { router as alpacaRouter } from './src/routes/alpaca.js';
import { oauthCallback, oauthEnabled, tradingFor } from './src/alpaca/connections.js';
import { brokerEnabled } from './src/alpaca/broker.js';
import { dataEnabled, snapshots as dataSnapshots } from './src/alpaca/data.js';
import { router as googleRouter, googleEnabled } from './src/google.js';
import { ownHosts, publicUrl } from './src/origin.js';
import { edgeSecret } from './src/edgesetup.js';
import { router as githubRouter, githubEnabled } from './src/github.js';
import { adminSiteRouter } from './src/admin-site.js';
import * as SE from './src/stripe-events.js';
import { mountCommsWebhooks, commsRouter, commsAdminRouter as smsVoiceAdminRouter } from './src/sms-voice/routes.js';
import { logStripe } from './src/stripe-client.js';
import { toolsRouter, toolsAdminRouter } from './src/tradetools/routes.js';
import { tokensRouter, mcpHandler } from './src/mcp.js';
import { agentRouter } from './src/agentic.js';
import { aiBotsRouter } from './src/aibots.js';
import { aiSignalsRouter } from './src/aisignals.js';
import { intelRouter } from './src/intel.js';
import { chartCopilotRouter } from './src/chartcopilot.js';
import { aiPlanTable } from './src/aiplans.js';
import { notifyUser as notifyAgentUser } from './src/notify-user.js';
import { wealthRouter } from './src/wealth.js';
import { news as alpacaNews } from './src/alpaca/data.js';
import { settings as moneySettings, referralReward, nextMilestone, trialDaysFor } from './src/revenue.js';
import { nodeStatus } from './src/runtime-check.js';
import { loadSite, freshSite, applySavedEnv, adviserFor, normalizePhone, siteGet, siteSet } from './src/site.js';
import { version } from './src/upgrades.js';
import { statementRouter } from './src/statement.js';
import { router as signalsRouter, receive as receiveSignal } from './src/signals.js';
import { router as strategiesRouter } from './src/rotation/routes.js';
import { playbooksRouter } from './src/playbooks.js';
import { keysRouter as apiKeysRouter, v1Router } from './src/apiv1.js';
import { router as pairsRouter } from './src/pairs.js';
import { liveRouter as livePairsRouter } from './src/pairslive.js';
import { statArbRouter } from './src/statarb.js';
import { registerHotline } from './src/hotline.js';
import * as AIX from './src/aiaccess.js';
import { eventsRouter } from './src/events.js';
import * as CR from './src/credits.js';
import { router as sp500Router } from './src/sp500.js';
import { router as extRouter, oauthCallback as extOauthCallback, accountsFor } from './src/ext/routes.js';

const here = path.dirname(fileURLToPath(import.meta.url));
// On Render the service's own address is known (RENDER_EXTERNAL_URL) when PUBLIC_URL is not set, so
// payment return links and the Stripe webhook never point at localhost.
if (!process.env.PUBLIC_URL && process.env.RENDER_EXTERNAL_URL) process.env.PUBLIC_URL = process.env.RENDER_EXTERNAL_URL;
const PUBLIC_URL = (process.env.PUBLIC_URL || 'http://localhost:3000').replace(/\/$/, '');
// Node.js must carry the latest security fixes (security/node-floor.json). In production an
// unpatched runtime refuses to start, so a deploy on it fails its health check and the previous,
// patched one keeps serving. ALLOW_UNPATCHED_NODE=1 overrides this in an emergency.
const runtime = nodeStatus();
if (!runtime.ok) {
  console.error(`SECURITY: Node.js ${runtime.version} is older than the patched release ${runtime.min}. Update Node.js (Render: NODE_VERSION or .node-version) and redeploy.`);
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_UNPATCHED_NODE !== '1' && (process.argv[1] === fileURLToPath(import.meta.url) || process.env.QP_START === '1')) process.exit(1);
}
if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') {
  console.error('SECURITY: NODE_TLS_REJECT_UNAUTHORIZED=0 turns off HTTPS certificate checks. Remove it.');
  if (process.env.NODE_ENV === 'production' && process.argv[1] === fileURLToPath(import.meta.url)) process.exit(1);
}
// Site settings (admins, business mode, keys saved in Admin) load before the first request.
await loadSite().catch(e => console.warn('site settings', e.message));
await applySavedEnv();
// The key store (Admin → Keys): encrypted in the database, read first by secret(), live in every worker.
await (await import('./src/keystore.js')).initKeystore().catch(e => console.warn('key store:', e.message));
export const app = express();
app.set('trust proxy', 1);
// Behind the Cloudflare edge (edge/worker.js) every request comes from Cloudflare: the edge passes
// the visitor's own address, signed with EDGE_SECRET, so rate limits and the security log see the
// real visitor. Without the secret the header is ignored (nobody can fake their address).
// The edge also passes the public address the visitor used (e.g. app.brightolio.com), so sign-in
// return addresses and redirects use it rather than the server's own name.
app.use((req, res, next) => {
  const sec = edgeSecret(), ip = req.headers['x-edge-client-ip'];
  if (sec && req.headers['x-edge-secret'] && safeEqual(String(req.headers['x-edge-secret']), sec)) {
    if (ip && /^[0-9a-f:.]{3,45}$/i.test(String(ip))) Object.defineProperty(req, 'ip', { value: String(ip), configurable: true });
    // x-edge-host first: Caddy on the Oracle server replaces X-Forwarded-Host with its own name.
    const fh = String(req.headers['x-edge-host'] || req.headers['x-forwarded-host'] || '').toLowerCase();
    if (/^[a-z0-9.-]+(:\d+)?$/.test(fh)) req.headers.host = fh;
    req.viaEdge = true;
  }
  next();
});
// Is this request's edge secret the right one? Render asks before it forwards the main address here
// (src/render-redirect.js); the answer is only yes or no.
const BOOT_ID = crypto.randomBytes(8).toString('hex');
app.get('/internal/edge-check', (req, res) => res.json({ trusted: req.viaEdge === true, host: req.viaEdge ? req.headers.host : null, boot: BOOT_ID }));
// The one-address redirect below is on only while PUBLIC_URL really reaches this app (its edge-check
// answers with this process's id): if the main address pointed anywhere else, redirecting there could
// send visitors round in a loop. Checked at start and every 5 minutes.
let mainReachesUs = false;
const checkMain = async () => {
  try { const u = new URL(process.env.PUBLIC_URL); if (u.protocol !== 'https:') return (mainReachesUs = false); const r = await fetch(u.origin + '/internal/edge-check', { signal: AbortSignal.timeout(20000), headers: { 'user-agent': 'Brightolio-self-check' } }); mainReachesUs = r.ok && (await r.json()).boot === BOOT_ID; }
  catch { mainReachesUs = false; }
  return mainReachesUs;
};
export const mainAddressCheck = checkMain;
export const setMainReaches = v => { mainReachesUs = v === true; }; // for the tests
// One address for the site (PUBLIC_URL, e.g. https://app.brightolio.com): a page asked for on any of
// the server's other addresses (its sslip.io address, an old link) gets a 301 to the same path there,
// so sign-in with Google (registered for that address only), cookies and links all use one address.
// Not redirected: health checks and the workflows' /internal calls, this computer, and anything but
// GET/HEAD (a form post or an app's API call must not be turned into a GET). CANONICAL_REDIRECT=0 turns it off.
const canonicalHost = () => { try { return new URL(process.env.PUBLIC_URL).host.toLowerCase(); } catch { return null; } };
app.use((req, res, next) => {
  const want = canonicalHost(), host = String(req.get('host') || '').toLowerCase();
  if (!want || process.env.CANONICAL_REDIRECT === '0' || !host || host === want || !mainReachesUs) return next();
  // A request from a forwarder whose secret did not match: never redirected (it would come back here).
  if (req.headers['x-edge-secret'] && !req.viaEdge) return next();
  if (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host) || !/^https:/.test(process.env.PUBLIC_URL)) return next();
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  if (/^\/(healthz|readyz|internal|metrics)(\/|$)/.test(req.path)) return next();
  // The load test runs against this server's own address with its CRON_SECRET (never a visitor).
  if (req.headers['x-qp-loadtest'] && process.env.CRON_SECRET && safeEqual(String(req.headers['x-qp-loadtest']), process.env.CRON_SECRET)) return next();
  res.redirect(301, process.env.PUBLIC_URL.replace(/\/+$/, '') + req.originalUrl);
});
app.disable('x-powered-by');
// Server-Sent Events must not be buffered by compression.
app.use(compression({ filter: (req, res) => !String(req.headers.accept).includes('text/event-stream') && compression.filter(req, res) }));

// Minimal access log (no query strings: reset/verify tokens live in the URL fragment, but be safe).
app.use((req, res, next) => {
  const t = Date.now();
  const url = req.originalUrl.split('?')[0].replace(/^\/hook\/.*/, '/hook/[secret]');
  res.on('finish', () => { const ms = Date.now() - t; console.log(`${req.method} ${url} ${res.statusCode} ${ms}ms`); if (url.startsWith('/api/')) recordRoute(req.method, url, ms); });
  next();
});

// Load shedding: under heavy load, optional work is refused first so trading stays responsive.
app.use(shedMiddleware);
// Readiness for Kubernetes: a replica above 95% load stops taking new traffic until it recovers.
app.get('/readyz', (req, res) => (relLoad() >= 0.95 ? res.status(503).json({ ready: false, load: relLoad() }) : res.json({ ready: true, load: +relLoad().toFixed(3) })));
// Prometheus metrics (load, in-flight, shed requests, breakers, recommended replicas, order queue).
app.get('/metrics', async (req, res) => {
  const tok = process.env.METRICS_TOKEN;
  if (tok && !safeEqual(req.headers.authorization || '', `Bearer ${tok}`)) return res.status(401).end();
  const q = await queueStats().catch(() => ({}));
  res.type('text/plain; version=0.0.4').send(metricsText({ qp_order_queue_pending: q.pending || 0, qp_order_queue_oldest_sec: q.oldestPendingSec || 0 }));
});
// Capacity planner for the predictive scaler (deploy/k8s/predictive-scaler.yaml).
app.get('/internal/capacity', (req, res) => {
  const tok = process.env.METRICS_TOKEN;
  if (tok && !safeEqual(req.headers.authorization || '', `Bearer ${tok}`)) return res.status(401).end();
  res.json(recommendedReplicas());
});
// Android app: Digital Asset Links (the app opens the site without a browser address bar) and the
// download button (the latest build from the "Android app" workflow, or ANDROID_APK_URL).
app.get('/.well-known/assetlinks.json', async (req, res) => {
  const fs = await import('node:fs/promises');
  const fp = (process.env.ANDROID_CERT_SHA256 || (await fs.readFile(new URL('./android/cert-sha256.txt', import.meta.url), 'utf8').catch(() => ''))).trim();
  res.json(fp ? [{ relation: ['delegate_permission/common.handle_all_urls'], target: { namespace: 'android_app', package_name: 'com.brightfolio.app', sha256_cert_fingerprints: fp.split(/[\s,]+/).filter(Boolean) } }] : []);
});
export const androidApkUrl = () => process.env.ANDROID_APK_URL || `https://github.com/${process.env.GITHUB_REPO || 'aryebleich/Tradingapp'}/releases/download/android-latest/brightfolio.apk`;
app.get('/download/android', (req, res) => res.redirect(302, androidApkUrl()));

// A short address for the server setup script (typed by hand on a new server): curl -L <site>/vm.sh
app.get('/vm.sh', (req, res) => res.redirect(302, 'https://raw.githubusercontent.com/aryebleich/Tradingapp/main/deploy/vm/setup.sh'));
// Paper stays paper and live stays live: checked by the deploy workflow after every push.
app.get('/healthz/routing', async (req, res) => { const { routingReport } = await import('./src/routingcheck.js'); const r = routingReport(); res.status(r.ok ? 200 : 500).json(r); });
// Company logos next to tickers (served from this site; see src/logos.js).
(await import('./src/logos.js')).logoRoute(app);
app.get('/healthz', (req, res) => {
  const d = dbHealth();
  res.json({ ok: true, time: new Date().toISOString(), database: { kind: dbKind(), ok: d.ok, lastOkAt: d.okAt, lastErrorAt: d.errAt } });
});
// /healthz says the server process answers; it runs no query (a check that reads spends database
// reads, and a restart would not fix a database outage). The database part is what the app's own
// statements saw last. /healthz/full does query the database.
// /healthz/full is the production check: lasting database, complete schema and paper/live
// routing, all at once (run by the deploy workflow after every push). Names only, never secrets.
app.get('/healthz/full', async (req, res) => {
  const { routingReport } = await import('./src/routingcheck.js');
  const problems = [];
  let reachable = false, schema = null;
  try { await one('SELECT 1 AS ok'); reachable = true; } catch { problems.push('The database does not answer.'); }
  if (!persistentDb && needsHostedDb()) problems.push('DATABASE_URL is not set and PERSISTENT_DISK is not 1: accounts and trading data are kept in a local file that is lost on restart.');
  if (reachable) {
    schema = await schemaReport().catch(e => ({ ok: false, error: e.message }));
    if (schema.missingColumns?.length) problems.push(`Database columns missing after migrations: ${schema.missingColumns.join(', ')}.`);
    if (schema.failedMigrations) problems.push(`${schema.failedMigrations} database migration(s) failed at start (see the server log).`);
    if (schema.error) problems.push('The schema check could not run: ' + schema.error);
  }
  const routing = routingReport();
  problems.push(...routing.problems);
  res.status(problems.length ? 500 : 200).json({
    ok: !problems.length, commit: routing.commit, checkedAt: new Date().toISOString(),
    database: { reachable, kind: dbKind(), lasting: persistentDb, persistentDisk: persistentDisk(), schemaOk: !!schema?.ok, checkedColumns: schema?.checkedColumns ?? null },
    routing: { ok: routing.ok, alpacaPaper: routing.paper.alpacaPaper, alpacaLive: routing.live.alpacaLive },
    problems,
  });
});

// Free hosts sleep idle apps, so a GitHub Actions cron calls this to run due jobs.
// Maintenance on or off, for the migration workflow (the same CRON_SECRET as the tick). It works while
// the database refuses reads: the switch is kept in memory first.
app.post('/internal/maintenance', express.json(), async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (!secret || !safeEqual(req.headers.authorization || '', `Bearer ${secret}`)) return res.status(401).json({ error: 'unauthorized' });
  const M = await import('./src/maintenance.js');
  res.json(await M.setMaintenance(req.body?.on === true, req.body?.reason || 'migration'));
});
app.get('/internal/maintenance', async (req, res) => res.json((await import('./src/maintenance.js')).maintenance()));
// The migration workflow's other calls (deploy/vm, .github/workflows/oracle-migrate.yml), all behind
// CRON_SECRET and none returning a secret value:
//   POST /internal/standby {on}            this server stops (or resumes) running jobs; on Render it
//                                          is also saved as STANDBY=1 in Render's settings when the
//                                          Render API key is there, so it holds after a restart
//   POST /internal/hosting {servers, active} register servers in this server's own database
//   POST /internal/hosting/activate {id}   the switch (edge or DNS when set up), as Admin → Hosting
//   GET  /internal/verify                  database, schema, row counts, credentials open, maintenance
//   POST /internal/backup                  one backup now
const internalAuth = (req, res, next) => { const secret = process.env.CRON_SECRET; if (!secret || !safeEqual(req.headers.authorization || '', `Bearer ${secret}`)) return res.status(401).json({ error: 'unauthorized' }); next(); };
app.post('/internal/standby', express.json(), internalAuth, async (req, res) => {
  const on = req.body?.on !== false;
  if (on) process.env.STANDBY = '1'; else delete process.env.STANDBY;
  let saved = 'memory only (until the next restart)';
  const S = await import('./src/site.js');
  if (process.env.RENDER && S.renderEnabled()) saved = await S.renderPut({ STANDBY: on ? '1' : null }).then(() => 'saved on Render too', e => 'not saved on Render: ' + e.message);
  res.json({ host: thisHost(), standby: on, saved });
});
app.post('/internal/hosting', express.json(), internalAuth, async (req, res) => {
  const H = await import('./src/hosting.js'), c = H.hostingConfig();
  const list = (Array.isArray(req.body?.servers) ? req.body.servers : []).filter(x => /^[a-z0-9-]{2,30}$/.test(x?.id || '') && H.KINDS[x.kind] && /^https:\/\/[a-z0-9.-]+$/i.test(x.url || ''));
  const servers = [...c.servers.filter(x => !list.some(y => y.id === x.id)), ...list.map(x => ({ id: x.id, name: String(x.name || H.KINDS[x.kind].name).slice(0, 40), kind: x.kind, url: x.url, hook: c.servers.find(y => y.id === x.id)?.hook || null, added: Date.now() }))];
  await H.saveHosting({ ...c, servers, active: req.body?.active && servers.some(x => x.id === req.body.active) ? req.body.active : c.active });
  res.json({ servers: servers.map(x => x.id), active: H.hostingConfig().active, thisHostActive: H.isActiveHost() });
});
app.post('/internal/hosting/activate', express.json(), internalAuth, async (req, res) => {
  const H = await import('./src/hosting.js');
  try { res.json(await H.switchTo(String(req.body?.id || ''))); } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});
app.get('/internal/verify', internalAuth, async (req, res) => {
  const A = await import('./src/server-admin.js'), M = await import('./src/maintenance.js'), H = await import('./src/hosting.js');
  const out = { host: thisHost(), active: H.isActiveHost(), standby: H.standby(), maintenance: M.maintenance(), database: {}, problems: [] };
  try {
    const d = await A.databaseStatus(); out.database = { kind: d.kind, bytes: d.bytes, persistentDisk: d.persistentDisk, tables: d.sizes.tables.length, counts: Object.fromEntries(d.sizes.tables.map(t => [t.name, t.rows])), backups: { last: d.backups.last || null, offsite: d.backups.offsite } };
    const sch = await schemaReport(); out.schema = { ok: sch.ok, checkedColumns: sch.checkedColumns, missingColumns: sch.missingColumns, failedMigrations: sch.failedMigrations };
    if (!sch.ok) out.problems.push('schema: ' + (sch.missingColumns || []).join(', '));
    out.credentials = await A.credentialCheck(); if (!out.credentials.ok) out.problems.push('stored credentials do not open with this ENCRYPTION_KEY');
    out.users = Number((await one('SELECT COUNT(*) AS n FROM users')).n);
    out.mergePending = process.env.TURSO_MERGE_PENDING === '1'; // merge-only
    if (!out.users && !out.mergePending) out.problems.push('no users in the database');
  } catch (e) { out.problems.push('database: ' + e.message); }
  out.keys = A.keyReport().missingRequired; if (out.keys.length) out.problems.push('missing settings: ' + out.keys.join(', '));
  out.ok = !out.problems.length; res.status(out.ok ? 200 : 500).json(out);
});
// A paper trade end to end (buy 1 SPY, sell 1 SPY) by a check account made here directly in the
// database: its address is on the reserved .invalid domain and no welcome email is sent. Paper
// orders never reach a broker.
app.post('/internal/check-trade', internalAuth, async (req, res) => {
  const email = 'paper-check@brightolio.invalid';
  try {
    let u = await one('SELECT id FROM users WHERE email = ?', email);
    if (!u) { await run("INSERT INTO users (email, pass_hash, role, plan, created_at, password_set) VALUES (?, ?, 'user', 'free', ?, 0)", email, 'disabled:' + Date.now(), now()); u = await one('SELECT id FROM users WHERE email = ?', email); }
    await run('INSERT OR IGNORE INTO paper_accounts (user_id, cash, start_cash) VALUES (?, 100000, 100000)', u.id);
    const { placeOrder } = await import('./src/brokers.js'), out = {};
    for (const side of ['buy', 'sell']) { const r = await placeOrder(u.id, 'paper', { symbol: 'SPY', side, qty: 1, type: 'market' }, 'check'); out[side] = { status: r.status || 'ok', price: r.fill_price ?? r.price ?? null }; }
    res.json({ ok: true, ...out });
  } catch (e) { res.status(e.status || 500).json({ ok: false, error: e.message }); }
});
// The load test (PERFORMANCE.md, .github/workflows/load-test.yml, CRON_SECRET): a session for one
// paper-only test account on the reserved .invalid domain (made in the database, no email), with
// a paper position or two so the pages have something to show. The load test only reads.
app.post('/internal/loadtest-session', internalAuth, async (req, res) => {
  const email = 'load-test@brightolio.invalid';
  let u = await one('SELECT id FROM users WHERE email = ?', email);
  if (!u) { await run("INSERT INTO users (email, pass_hash, role, plan, created_at, password_set) VALUES (?, ?, 'user', 'free', ?, 0)", email, 'disabled:' + Date.now(), now()); u = await one('SELECT id FROM users WHERE email = ?', email); }
  await run('INSERT OR IGNORE INTO paper_accounts (user_id, cash, start_cash) VALUES (?, 100000, 100000)', u.id);
  const { createSession } = await import('./src/auth.js');
  await createSession(res, req, u.id, false);
  res.json({ ok: true, cookie: 'qp_sid=' + res.locals.sessionToken });
});
// Load diagnosis (CRON_SECRET): the load and its three parts, the V8 heap and its real limit, the
// event-loop delay, requests in flight, the last refused requests and the process memory.
app.get('/internal/load', internalAuth, async (req, res) => {
  const R = await import('./src/reliability.js'), v8 = await import('node:v8'), { monitorEventLoopDelay } = await import('node:perf_hooks');
  const h = monitorEventLoopDelay({ resolution: 10 }); h.enable(); await new Promise(r => setTimeout(r, 2000)); h.disable();
  const hs = v8.getHeapStatistics(), mb = n => Math.round(n / 1048576), m = process.memoryUsage();
  res.json({ at: new Date().toISOString(), stats: (({ breakers, ...x }) => x)(R.stats()), parts: R.loadParts(),
    lagNow2s: { p50: +(h.percentile(50) / 1e6).toFixed(1), p90: +(h.percentile(90) / 1e6).toFixed(1), p99: +(h.percentile(99) / 1e6).toFixed(1), max: +(h.max / 1e6).toFixed(1) },
    heap: { usedMb: mb(hs.used_heap_size), totalMb: mb(hs.total_heap_size), limitMb: mb(hs.heap_size_limit) }, rssMb: mb(m.rss), externalMb: mb(m.external), arrayBuffersMb: mb(m.arrayBuffers),
    nodeOptions: process.env.NODE_OPTIONS || null, shed: R.shedEvents().slice(-20), routes: R.routeTimes(30), cpus: (await import('node:os')).cpus().length, totalMemMb: mb((await import('node:os')).totalmem()) });
});
app.post('/internal/backup', internalAuth, async (req, res) => {
  const B = await import('./src/backup.js');
  try { const b = await B.backupNow({ kind: 'manual' }); res.json({ ok: true, file: b.file, bytes: b.bytes, tables: b.tables, rows: b.rows }); } catch (e) { res.status(e.status || 500).json({ ok: false, error: e.message }); }
});
app.post('/internal/tick', async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (!secret || !safeEqual(req.headers.authorization || '', `Bearer ${secret}`)) return res.status(401).json({ error: 'unauthorized' });
  // Only the active server (Admin → Hosting) runs jobs, so nothing runs twice on two servers.
  if (!isActiveHost()) return res.json({ skipped: true, reason: `${thisHost()} is not the active server` });
  const out = await runDueJobs();
  if (req.query.snapshot) await snapshotAll();
  // Whether accounts and sign-ins live in a lasting database (a local file on Render is wiped on
  // every restart and deploy, which signs everyone out).
  res.json({ ...out, database: process.env.DATABASE_URL ? 'lasting (DATABASE_URL)' : persistentDisk() ? 'lasting (local file on a persistent disk)' : 'local file: wiped on restart' });
});

// What crawlers and AI tools may read (Admin → AI & privacy): AI crawlers blocked unless allowed.
app.get('/robots.txt', (req, res) => res.type('text/plain').send(AIX.robotsTxt() + `Sitemap: ${PUBLIC_URL}/sitemap.xml\n`));
app.get('/llms.txt', (req, res) => { const a = AIX.settings(); return a.llmsOn ? res.type('text/plain').send(SEO.llms(a.llms)) : res.status(404).type('text/plain').send('Not published.'); });
// IndexNow key file (Admin → SEO → Announce pages): only the current key, nothing else.
app.get(/^\/([A-Za-z0-9]{16,64})\.txt$/, async (req, res, next) => { const k = await SEO.indexnowKey(); return req.params[0] === k ? res.type('text/plain').send(k) : next(); });
app.use((req, res, next) => { const x = AIX.xRobots(); if (x) res.setHeader('X-Robots-Tag', x); next(); });
app.get('/sitemap.xml', async (req, res) => res.type('application/xml').send(await SEO.sitemap(PUBLIC_URL)));
// The browser demo on the landing page reuses the exact engine the server runs.
app.get('/config.js', (req, res) => res.type('text/javascript').send('window.QP = { api: "" };'));
app.get('/engine.js', (req, res) => res.type('text/javascript').sendFile(path.join(here, 'src/engine.js')));

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  // Pyodide (the code lab's Python) loads only from its own jsdelivr folder; Plaid Link from cdn.plaid.com.
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self'; script-src 'self' 'wasm-unsafe-eval' https://secure.helcim.app https://cdn.jsdelivr.net/pyodide/ https://cdn.plaid.com; frame-src 'self' https://secure.helcim.app https://cdn.plaid.com; connect-src 'self' https://cdn.jsdelivr.net/pyodide/; frame-ancestors 'none'; base-uri 'self'; form-action 'self' https://checkout.stripe.com https://accept.authorize.net https://test.authorize.net");
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(self), geolocation=()'); // microphone: the web dialer (src/sms-voice), same origin only
  if (process.env.NODE_ENV === 'production') res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

// Every request gets an id (X-Request-Id), so a customer's error can be found in the log. An id sent
// by a proxy is kept only when it is plain (letters, digits, - and _), up to 64 characters.
app.use((req, res, next) => {
  const given = String(req.get('x-request-id') || '');
  req.id = /^[\w-]{8,64}$/.test(given) ? given : crypto.randomUUID();
  res.setHeader('X-Request-Id', req.id);
  next();
});
// Stripe needs the raw body for signature checks, so mount it before the JSON parser.
// SMS and voice provider webhooks (flag comms_drawer, off by default): signature checked on the raw body.
mountCommsWebhooks(app);

// What the event handlers need beyond the database: the audit log, an alert to the owner (event ids,
// amounts and reasons only, no card or personal data) and an e-mail to the customer.
const stripeDeps = {
  audit,
  alertOwner: async (subject, text) => { for (const to of auth.allAdminEmails()) await N.sendEmail(to, subject, text).catch(() => {}); },
  emailUser: (to, subject, text) => N.sendEmail(to, subject, text),
};
// OpenAI webhooks (src/openai-webhook.js): no login, CSRF-exempt, the raw body checked against the
// signing secret (OPENAI_WEBHOOK_SECRET). The answer goes out first; the work follows.
app.post('/api/webhooks/openai', express.raw({ type: '*/*', limit: '1mb' }), async (req, res) => {
  const W = await import('./src/openai-webhook.js'), K = await import('./src/keystore.js');
  const raw = req.body.toString('utf8');
  const v = W.verifyStandardWebhook({ raw, headers: req.headers, secret: K.secret('OPENAI_WEBHOOK_SECRET') });
  if (!v.ok) { siteSet('openaiBadSignature', { at: now(), reason: v.reason }).catch(() => {}); return res.status(400).json({ error: v.reason }); }
  let ev; try { ev = JSON.parse(raw); } catch { return res.status(400).json({ error: 'bad payload' }); }
  let state;
  try { state = await W.receive(ev); } catch (e) { return res.status(e.status || 400).json({ error: e.message }); }
  if (state === 'duplicate') return res.json({ received: true, duplicate: true });
  res.json({ received: true });
  setImmediate(() => W.processEvent(ev).catch(() => {}));
});
app.post('/webhooks/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  const raw = req.body.toString('utf8');
  // The signature is checked on the raw body before anything is parsed or trusted.
  if (!N.verifyStripe(raw, req.headers['stripe-signature'])) { siteSet('stripeBadSignature', { at: now() }).catch(() => {}); return res.status(400).send('bad signature'); }
  let ev; try { ev = JSON.parse(raw); } catch { return res.status(400).send('bad payload'); }
  if (!ev || typeof ev.type !== 'string') return res.status(400).send('bad payload');
  const o = ev.data?.object || {};
  // Shown in Admin → Money & fees → Stripe, so the owner can see events arriving.
  siteSet('stripeLastEvent', { type: ev.type, id: ev.id, livemode: !!ev.livemode, at: now() }).catch(() => {});
  // A live event on a test key (or the reverse) means the endpoint is wired to the wrong account: acknowledge and ignore it.
  if (SE.modeMismatch(ev)) { logStripe('warn', 'event_mode_mismatch', { eventId: ev.id, eventType: ev.type, livemode: !!ev.livemode }); return res.json({ received: true, ignored: 'mode' }); }
  // Each event id is processed once; a failed or abandoned one is processed again when Stripe retries it.
  if (await SE.claimEvent(ev) === 'duplicate') return res.json({ received: true, duplicate: true });
  try {
    // A late event never overwrites newer state (for example "updated" after "deleted").
    if (await SE.isStale(ev)) { await SE.finishEvent(ev); return res.json({ received: true, ignored: 'stale' }); }
    // Stripe retries deliveries, so every ledger write is keyed by a Stripe id (unique index ledger_ref).
    if (ev.type === 'checkout.session.completed' && o.metadata?.kind === 'subscription') {
      const plan = Object.hasOwn(PLANS, o.metadata.plan) ? o.metadata.plan : 'free';
      // A trial checkout charges $0 now; the first real charge arrives later as invoice.paid.
      const trialing = !(o.amount_total > 0);
      await run('UPDATE users SET plan = ?, plan_status = ?, plan_interval = ?, stripe_customer = ?, plan_renews = ?, trial_used = 1 WHERE id = ?',
        plan, trialing ? 'trialing' : 'active', o.metadata.interval === 'year' ? 'year' : 'month', o.customer, now() + (trialing ? TRIAL_DAYS : 31) * 86400e3, +o.client_reference_id);
      if (!trialing) await run('INSERT OR IGNORE INTO ledger (user_id, kind, amount, status, ref, memo, at) VALUES (?,?,?,?,?,?,?)', +o.client_reference_id, 'subscription', o.amount_total / 100, 'paid', o.invoice || o.id, `${PLANS[plan].name} plan`, now());
    } else if (ev.type === 'invoice.paid' && o.amount_paid > 0) {
      const u = await one('SELECT * FROM users WHERE stripe_customer = ?', o.customer);
      if (u) {
        await run("UPDATE users SET plan_status = 'active', plan_renews = ? WHERE id = ?", (o.lines?.data?.[0]?.period?.end ?? 0) * 1000 || now() + 31 * 86400e3, u.id);
        await run('INSERT OR IGNORE INTO ledger (user_id, kind, amount, status, ref, memo, at) VALUES (?,?,?,?,?,?,?)', u.id, 'subscription', o.amount_paid / 100, 'paid', o.id, `${PLANS[u.plan]?.name || 'Plan'} ${o.billing_reason === 'subscription_cycle' ? 'renewal' : 'payment'}`, now());
        await rewardReferral(u);
      }
    } else if (ev.type === 'customer.subscription.updated' || ev.type === 'customer.subscription.created') {
      // The plan comes from the price the customer pays now (a switch in the customer portal changes
      // the price, not the metadata saved at checkout); the metadata is the fallback.
      const { planFromPrice } = await import('./src/stripesetup.js');
      const byPrice = planFromPrice(o.items?.data?.[0]?.price?.id, Object.keys(PLANS).filter(k => k !== 'free'));
      const plan = byPrice?.plan || (Object.hasOwn(PLANS, o.metadata?.plan) ? o.metadata.plan : null);
      const ended = ['canceled', 'unpaid', 'incomplete_expired'].includes(o.status);
      // Newer Stripe API versions (a webhook made by hand in the dashboard) keep the period end on the item.
      await run('UPDATE users SET plan_status = ?, plan = CASE WHEN ? THEN \'free\' ELSE COALESCE(?, plan) END, plan_interval = COALESCE(?, plan_interval), plan_renews = ? WHERE stripe_customer = ?',
        o.status, ended ? 1 : 0, plan, byPrice?.interval || null, (o.current_period_end ?? o.items?.data?.[0]?.current_period_end) ? (o.current_period_end ?? o.items.data[0].current_period_end) * 1000 : null, o.customer);
    } else if (ev.type === 'checkout.session.completed' && o.metadata?.kind === 'credits') {
      // A credit pack: added once per checkout session, only when the payment went through.
      if (o.payment_status === 'paid') await CR.grant(+o.client_reference_id, +o.metadata.credits, 'purchase', `${(+o.metadata.credits).toLocaleString('en-US')} credits pack`, `stripe:${o.id}`);
    } else if (ev.type === 'checkout.session.completed' && o.metadata?.kind === 'deposit') {
      const id = +o.metadata.ledger_id;
      if ((await one('SELECT status FROM ledger WHERE id = ?', id))?.status !== 'pending') { await SE.finishEvent(ev); return res.json({ received: true }); }
      // The page shows the methods switched on in the Stripe dashboard, so what counts is how the
      // customer paid: a bank transfer is still processing here (it settles days later through
      // checkout.session.async_payment_succeeded / _failed); a payment that is already paid must
      // be a debit card, anything else is refunded.
      if (o.payment_status !== 'paid') {
        await run("UPDATE ledger SET status = 'processing', ref = ? WHERE id = ?", o.payment_intent, id);
      } else if (await N.cardFunding(o.payment_intent) !== 'debit') {
        await N.refund(o.payment_intent);
        await run("UPDATE ledger SET status = 'refunded', memo = 'Only debit cards or bank transfers are accepted' WHERE id = ?", id);
        await run("UPDATE ledger SET status = 'refunded' WHERE kind = 'deposit_fee' AND ref = ?", `fee:${id}`);
      } else {
        // Card funds land in the platform's Stripe balance; moving them into the user's
        // brokerage account requires the Alpaca Broker API (see Admin → README, "Funding").
        await depositReceived(id, o.payment_intent);
      }
    } else if (ev.type === 'checkout.session.async_payment_succeeded' && o.metadata?.kind === 'deposit') {
      await depositReceived(+o.metadata.ledger_id, o.payment_intent);
    } else if (ev.type === 'checkout.session.async_payment_failed' && o.metadata?.kind === 'deposit') {
      await run("UPDATE ledger SET status = 'failed', memo = 'The bank transfer failed' WHERE id = ?", +o.metadata.ledger_id);
      await run("UPDATE ledger SET status = 'failed' WHERE kind = 'deposit_fee' AND ref = ?", `fee:${+o.metadata.ledger_id}`);
    } else if (ev.type === 'customer.subscription.deleted') {
      await run("UPDATE users SET plan = 'free', plan_status = 'canceled', plan_renews = NULL WHERE stripe_customer = ?", o.customer);
    } else if (SE.EXTRA_EVENTS.has(ev.type)) {
      // payment_intent.*, charge.refunded, charge.dispute.created, invoice.payment_failed, checkout.session.expired
      await SE.handleExtra(ev, stripeDeps);
    }
    await SE.tagLivemode(ev);   // test-mode payments stay out of revenue reports
    await SE.commitOrder(ev);   // remember how far this subscription / customer's invoices have got
    await SE.finishEvent(ev);
  } catch (e) {
    await SE.failEvent(ev).catch(() => {}); // Stripe will deliver it again
    logStripe('error', 'webhook_failed', { eventId: ev.id, eventType: ev.type, livemode: !!ev.livemode, reason: e.name });
    return res.status(500).send('error');
  }
  res.json({ received: true });
});

// Identity documents (base64 images/PDFs) are only accepted on the two onboarding endpoints.
// Nothing sends us compressed request bodies, so none are unpacked: this closes the door on
// decompression bugs (e.g. the Brotli flaw patched in October 2026) whatever the runtime.
app.use((req, res, next) => {
  const enc = String(req.headers['content-encoding'] || 'identity').toLowerCase().trim();
  return enc === 'identity' ? next() : res.status(415).json({ error: 'Compressed request bodies are not accepted' });
});
// Square and Authorize.net confirm card deposits with signed webhooks (raw body needed for the check).
// A deposit counts only when the paid amount matches what was asked for.
async function cardDepositPaid(provider, ref, cents, txn) {
  const sess = await one("SELECT p.*, l.status FROM payment_sessions p JOIN ledger l ON l.id = p.ledger_id WHERE p.provider = ? AND p.secret = ?", provider, String(ref));
  if (!sess || sess.status !== 'pending') return false;
  if (Math.abs(cents / 100 - sess.total) > 0.005) { console.warn(`${provider}: amount mismatch for deposit ${sess.ledger_id}`); return false; }
  await depositReceived(sess.ledger_id, `${provider}:${txn}`);
  return true;
}
app.post('/webhooks/square', express.raw({ type: '*/*' }), async (req, res) => {
  const raw = req.body.toString('utf8');
  if (!PAY.squareValid(`${PUBLIC_URL}/webhooks/square`, raw, req.headers['x-square-hmacsha256-signature'])) return res.status(403).send('bad signature');
  let ev; try { ev = JSON.parse(raw); } catch { return res.status(400).send('bad json'); }
  const p = ev.data?.object?.payment;
  if (/^payment\.(created|updated)$/.test(ev.type) && p?.status === 'COMPLETED' && p.order_id) await cardDepositPaid('square', p.order_id, +p.amount_money?.amount || 0, p.id).catch(e => console.error('square', e));
  res.json({ ok: true });
});
app.post('/webhooks/authorizenet', express.raw({ type: '*/*' }), async (req, res) => {
  const raw = req.body.toString('utf8');
  if (!PAY.anetValid(raw, req.headers['x-anet-signature'])) return res.status(403).send('bad signature');
  let ev; try { ev = JSON.parse(raw); } catch { return res.status(400).send('bad json'); }
  const p = ev.payload || {}, id = /^QP-(\d+)$/.exec(p.invoiceNumber || '')?.[1];
  if (ev.eventType === 'net.authorize.payment.authcapture.created' && +p.responseCode === 1 && id) {
    const sess = await one("SELECT secret FROM payment_sessions WHERE ledger_id = ? AND provider = 'authorizenet'", +id);
    if (sess) await cardDepositPaid('authorizenet', sess.secret, Math.round(+p.authAmount * 100), p.id).catch(e => console.error('authorizenet', e));
  }
  res.json({ ok: true });
});
app.use(['/api/alpaca/broker/accounts', '/api/alpaca/broker/documents'], express.json({ limit: '30mb' }));
app.use('/api/admin/site/readme', express.json({ limit: '700kb' })); // the private README editor
app.use('/api/admin/site/phone/clips', express.json({ limit: '2200kb' })); // Yiddish voice recordings
app.use('/api/altlive/k1', express.json({ limit: '6mb' })); // K-1 PDFs
app.use('/api/biz/receipts', express.json({ limit: '4mb' })); // receipt photos
app.use('/api/biz/bank/import', express.json({ limit: '3mb' })); // bank CSV files
app.use(express.json({ limit: '200kb' }));
app.use(express.urlencoded({ extended: false, limit: '50kb' }));

// ---------- Twilio: SMS + voice hotline (validated by Twilio signature, not session) ----------
const twiml = (res, body) => res.type('text/xml').send(`<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`);
const twilioOk = req => N.validTwilioSignature(PUBLIC_URL + req.originalUrl, req.body, req.headers['x-twilio-signature']);

app.post('/twilio/sms', async (req, res) => {
  if (!twilioOk(req)) return res.status(403).send('forbidden');
  const user = await userByPhone(req.body.From);
  let reply;
  // Opening a brokerage account by text: whoever texts APPLY (customers without a brokerage
  // account, and people without a Brightolio account), and anyone with an application in progress.
  // Everyone else without an account gets the sign-up by text (src/smssignup.js).
  const TA = await import('./src/textapply.js'), text = String(req.body.Body || '').trim();
  const media = [...Array(Math.min(4, +req.body.NumMedia || 0))].map((_, i) => ({ url: req.body['MediaUrl' + i], type: req.body['MediaContentType' + i] })).filter(m => m.url);
  // TALK reaches a person instead (the business inbox).
  const applying = !/^talk\b/i.test(text) && (await TA.hasOpen(req.body.From)
    || (TA.settings().enabled && brokerEnabled() && /^apply$/i.test(text) && (!user || !(await one('SELECT 1 FROM broker_accounts WHERE user_id = ?', user.id)))));
  if (applying) {
    // The first message of a new conversation also shows in the business inbox (never one with a number that could be an SSN).
    if (!user && !(await TA.hasOpen(req.body.From)) && !/\d{3}\D?\d{2}\D?\d{4}/.test(text)) await import('./src/comms.js').then(C => C.record({ channel: 'sms', party: normalizePhone(req.body.From), body: (text || '(photo)') + '  [started Apply by text]', status: 'done' })).catch(() => {});
    if (!auth.rateLimit('textapply:' + req.body.From, 60, 3600e3)) reply = 'Too many messages, try again later.';
    else reply = await TA.handle(req.body.From, text, media, { ip: req.ip }).catch(e => { console.warn('text apply', e.message); return 'Sorry, something went wrong. Reply CONTINUE to try again.'; });
  }
  // Someone who is not a customer: the sign-up by text (welcome, then email + optional referral
  // code); TALK, or sign-up switched off, goes to the business inbox (Admin → Calls, texts & email).
  else if (!user) {
    if (!auth.rateLimit('smssignup:' + req.body.From, 20, 3600e3)) reply = 'Too many messages, try again later.';
    else {
      const SU = await import('./src/smssignup.js');
      reply = /^talk\b/i.test(text) ? null : await SU.handleSignup(req.body.From, text).catch(e => { console.warn('sms signup', e.message); return 'Sorry, something went wrong. Please reply with your email address again.'; });
      if (reply == null) reply = await inboundSms(req.body.From, String(req.body.Body || '')).catch(() => 'Thanks for your message to Brightolio. We will get back to you soon.');
      else if (!/@/.test(text) && !/^(help|start|stop)$/i.test(text) && text.length > 3) await import('./src/comms.js').then(C => C.record({ channel: 'sms', party: normalizePhone(req.body.From), body: text + '  [sent the sign-up welcome]' })).catch(() => {});
    }
  }
  // Starter (free): look-ups, watchlist, alerts, plan and their own trades by text; questions in
  // their own words, recurring buys and bots are Pro and up.
  else if (!isPaid(user) && !FREE_COMMANDS.includes(normalize(String(req.body.Body || '')).split(' ')[0]) && !isLookup(String(req.body.Body || ''))) reply = 'Questions in your own words, recurring buys and bots by text are part of Brightolio Pro. On your plan: any ticker (AAPL), AAPL CHART, AAPL INFO, WATCH AAPL, ALERT AAPL 250, BAL, PLAN. Text HELP for all.';
  else if (!auth.rateLimit('sms:' + user.id, 30, 3600e3)) reply = 'Too many messages, try again later.';
  else if (!(await CR.trySpend(user, 'sms', { memo: 'reply' }))) reply = 'You are out of credits for text replies. Buy a credit pack in the app under Plans & billing.';
  else {
    try { reply = await smsReply(user, String(req.body.Body || '')); } catch (e) { reply = 'Error: ' + e.message; }
    await audit(user.id, 'sms_command', { cmd: String(req.body.Body).split(/\s+/)[0] }, req.body.From);
  }
  twiml(res, `<Message>${N.xml(reply)}</Message>`);
});

// A stock look-up ("AAPL", "AAPL CHART", "CHART AAPL", "AAPL INFO"), answered without the AI.
const isLookup = body => (/^\s*[A-Za-z][A-Za-z0-9.]{0,5}\s*$/.test(body) && !CHAT_WORDS.has(body.trim().toUpperCase()))
  || /^\s*[A-Za-z][A-Za-z0-9.]{0,5}\s+(chart|earnings|news|price|quote|info)\s*$/i.test(body) || /^\s*(chart|earnings|news|info)\s+[A-Za-z][A-Za-z0-9.]{0,5}\s*$/i.test(body);
// Commands first; anything else goes to the AI assistant, which turns it into a command or answers.
// A trade the AI understood still needs the PIN, so the reply tells the user exactly what to send.
async function smsReply(user, body) {
  // Stock look-ups ("AAPL", "AAPL CHART", "TSLA EARNINGS") are answered directly, without the AI.
  const lookup = isLookup(body);
  if (lookup || KNOWN.includes(normalize(body).split(' ')[0]) || !aiEnabled()) return handleCommand(user, body);
  const r = await interpret(user, body), cmd = toCommand(r);
  if (!cmd) return (r.reply || HELP).slice(0, 600);
  const last = body.trim().split(/\s+/).pop(), pin = /^\d{4,8}$/.test(last) ? last : null;
  const out = await handleCommand(user, pin ? `${cmd} ${pin}` : cmd);
  return /needs your PIN/.test(out) ? `To do that, reply: ${cmd} <your PIN>` : out;
}

// The phone line's menus (IVR), account opening by phone and its Admin settings: src/hotline.js.
registerHotline(app, { twilioOk, twiml });
registerCalls(app, { twilioOk, twiml });

// Alerts from TradingView, TrendSpider, Zapier or any script. TradingView sends text/plain unless the
// message is valid JSON, so any body type is accepted.
// Signal channels: a leader's TradingView (or other) alerts broadcast to every follower.
// AI assistants (Claude, Cursor, VS Code) reach the user's account here with a personal token.
const agentDeps = { accountSummary, accountsFor, lastPrice, listOrders, placeOrder, news: alpacaNews, notify: notifyAgentUser };
const mcp = mcpHandler(agentDeps);
app.post('/mcp', (req, res, next) => mcp(req, res).catch(next));
app.get('/mcp', (req, res) => res.status(405).set('Allow', 'POST').json({ error: 'Use POST with JSON-RPC (MCP Streamable HTTP)' }));
app.post('/hook/c/:token', express.text({ type: () => true, limit: '20kb' }), async (req, res) => {
  try { await channelHook(req, res); } catch (e) { console.error('channel hook', e); res.status(500).json({ error: 'Could not process the signal' }); }
});
app.post('/hook/:token', express.text({ type: () => true, limit: '20kb' }), async (req, res) => {
  try { await receiveSignal(req, res); } catch (e) { console.error('webhook', e); res.status(500).json({ error: 'Could not process the signal' }); }
});
app.use('/auth/google', googleRouter);
// Invoices the businesses on Brightolio send to their customers (no sign-in needed to view and pay).
app.use('/i', publicInvoiceRouter);
app.use('/auth/github', githubRouter);
app.get(['/oauth/schwab/callback', '/oauth/tradestation/callback'], auth.sessionMiddleware, extOauthCallback);

// OAuth2 redirect target after the user approves access in Alpaca.
app.get('/oauth/alpaca/callback', auth.sessionMiddleware, async (req, res) => {
  try {
    if (req.query.error) throw new Error(String(req.query.error_description || req.query.error));
    const userId = await oauthCallback(String(req.query.state || ''), String(req.query.code || ''), req.user?.id);
    await audit(userId, 'alpaca_oauth_connected', null, req.ip);
    res.redirect('/app#/account?connected=oauth');
  } catch (e) { res.redirect('/app#/account?error=' + encodeURIComponent(e.message)); }
});

// Google Drive for the owner (Admin → README → Save to Drive): connect, then come back.
app.get('/oauth/google-drive/start', auth.requireUser, auth.requireAdmin, async (req, res) => {
  const D = await import('./src/drive.js');
  if (!D.driveReady()) return res.redirect('/app#/admin-readme?drive=' + encodeURIComponent('Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in Admin → Keys first'));
  res.redirect(D.authUrl(req.user.id));
});
app.get('/oauth/google-drive/callback', auth.requireUser, auth.requireAdmin, async (req, res) => {
  const D = await import('./src/drive.js');
  try {
    if (req.query.error) throw new Error(String(req.query.error) === 'access_denied' ? 'Drive access was not allowed' : String(req.query.error));
    await D.finish(req.user.id, { code: String(req.query.code || ''), state: String(req.query.state || '') });
    await audit(req.user.id, 'drive_connected', null, req.ip);
    res.redirect('/app#/admin-readme?drive=connected');
  } catch (e) { res.redirect('/app#/admin-readme?drive=' + encodeURIComponent(e.message)); }
});

// QuickBooks Online (Taxes → bookkeeping): connect, then come back to the tax page.
app.get('/oauth/quickbooks/callback', auth.requireUser, async (req, res) => {
  try {
    if (req.query.error) throw new Error(String(req.query.error) === 'access_denied' ? 'QuickBooks access was not allowed' : String(req.query.error));
    await qboFinish(req.user.id, { code: String(req.query.code || ''), state: String(req.query.state || ''), realmId: String(req.query.realmId || '') });
    await audit(req.user.id, 'quickbooks_connected', null, req.ip);
    res.redirect('/app#/tax?qbo=connected');
  } catch (e) { res.redirect('/app#/tax?qbo=' + encodeURIComponent(e.message)); }
});

// A deposit's money has arrived: mark it (and the owner's service fee on it) received.
async function depositReceived(ledgerId, ref) {
  await run("UPDATE ledger SET status = 'received', ref = ? WHERE id = ? AND status IN ('pending', 'processing')", ref, ledgerId);
  await run("UPDATE ledger SET status = 'collected' WHERE kind = 'deposit_fee' AND ref = ?", `fee:${ledgerId}`);
}

// Credits whoever invited this user, once, when the invited user's first real payment arrives.
async function rewardReferral(u) {
  if (!u.referred_by || u.referral_rewarded) return;
  const claim = await run('UPDATE users SET referral_rewarded = 1 WHERE id = ? AND referral_rewarded = 0', u.id);
  if (!claim.changes) return;
  const ref = await one('SELECT id, stripe_customer FROM users WHERE id = ?', u.referred_by);
  if (!ref) return;
  const r = await referralReward(ref.id);
  for (const [amount, memo] of [[r.credit, 'A friend you invited subscribed'], [r.bonus, `Bonus: ${r.paying} paying friends`]]) {
    if (!(amount > 0)) continue;
    let status = 'earned';
    if (ref.stripe_customer && N.stripeEnabled()) {
      try { await N.creditCustomer(ref.stripe_customer, amount, memo, N.idemKey('refcredit', ref.id, u.id, memo)); status = 'applied'; } catch (e) { console.warn('referral credit', e.message); }
    }
    await run('INSERT INTO ledger (user_id, kind, amount, status, memo, at) VALUES (?,?,?,?,?,?)', ref.id, 'referral_credit', amount, status, memo, now());
  }
}

// Owner metrics: where people drop off between signing up and paying.
async function funnel() {
  const since = d => now() - d * 86400e3;
  const n = async (sql, ...a) => (await one(sql, ...a)).n;
  const signups = await n('SELECT COUNT(*) n FROM users'), signups30 = await n('SELECT COUNT(*) n FROM users WHERE created_at > ?', since(30));
  const connected = await n("SELECT COUNT(DISTINCT user_id) n FROM (SELECT user_id FROM credentials WHERE provider IN ('alpaca', 'alpaca_oauth') UNION SELECT user_id FROM broker_accounts)");
  const traded = await n('SELECT COUNT(DISTINCT user_id) n FROM fills');
  const trialing = await n("SELECT COUNT(*) n FROM users WHERE plan != 'free' AND plan_status = 'trialing'");
  const paying = await n("SELECT COUNT(*) n FROM users WHERE plan != 'free' AND COALESCE(plan_status, 'active') = 'active'");
  const rows = await all("SELECT plan, plan_interval, COUNT(*) n FROM users WHERE plan != 'free' AND COALESCE(plan_status, 'active') = 'active' GROUP BY plan, plan_interval");
  const mrr = rows.reduce((a, r) => a + r.n * (r.plan_interval === 'year' ? (PLANS[r.plan]?.yearly || 0) / 12 : PLANS[r.plan]?.monthly || 0), 0);
  const revenue30 = (await one("SELECT COALESCE(SUM(amount), 0) n FROM ledger WHERE (kind IN ('subscription', 'performance_fee', 'deposit_fee') AND status IN ('paid', 'collected') OR kind = 'broker_commission') AND COALESCE(livemode, 1) = 1 AND at > ?", since(30))).n;
  return { signups, signups30, connected, traded, trialing, paying, mrr: +mrr.toFixed(2), arr: +(mrr * 12).toFixed(2), revenue30, conversion: signups ? +(paying / signups * 100).toFixed(1) : 0 };
}

// ---------- JSON API ----------
const api = express.Router();
// Customers read only errors about what they typed; set-up and server faults go to the owner (src/usererrors.js).
api.use(filterErrors);
// The landing page copy on GitHub Pages calls the public demo endpoints cross-origin (no cookies).
const PUBLIC_ORIGINS = (process.env.PUBLIC_ORIGINS || 'https://aryebleich.github.io').split(',').map(o => o.trim());
api.use('/public', (req, res, next) => {
  if (PUBLIC_ORIGINS.includes(req.headers.origin)) {
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Requested-With');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
api.use((req, res, next) => { freshSite().then(() => next(), next); });
// Maintenance (src/maintenance.js): every API answer says so, so the pages show the banner at once.
api.use(async (req, res, next) => { const M = await import('./src/maintenance.js'); if (M.inMaintenance()) res.set('X-Maintenance', '1'); next(); });
api.use(auth.csrfGuard);
// Only API calls look up the session; static files and pages skip the database round trip.
api.use(auth.sessionMiddleware);
// A session flagged by the behavior check confirms itself before trading or moving money.
api.use(['/orders', '/alpaca/orders', '/alpaca/positions', '/alpaca/broker/transfers', '/fleet/inbox', '/ai/live-order', '/positions/close-all'], stepUpGuard);
api.use('/auth', auth.router);
api.use('/alpaca', alpacaRouter);
api.use('/signals', signalsRouter);
api.use('/library', strategiesRouter);
api.use('/playbooks', auth.requireUser, playbooksRouter());
api.use('/apikeys', apiKeysRouter);
api.use('/pairslive', livePairsRouter);
api.use('/pairs', pairsRouter);
api.use('/statarb', statArbRouter);
api.use('/statement', statementRouter);
api.use('/events', eventsRouter);
api.use('/credits', CR.creditsRouter({ checkout: async (user, pack) => {
  if (!N.stripeEnabled()) throw Object.assign(new Error('Payments are not set up yet (STRIPE_SECRET_KEY)'), { status: 503 });
  const s = await N.checkoutCredits({ pack, email: user.email, userId: user.id, baseUrl: PUBLIC_URL });
  return { url: s.url };
} }));
api.use('/sp500', sp500Router);
api.use('/brokerages', extRouter);
api.use('/insights', insightsRouter({ summarize: accountSummary }));
api.use('/pnlwhy', (await import('./src/pnlwhy.js')).pnlWhyRouter);
api.use('/shortdesk', (await import('./src/shortdesk.js')).shortRouter);
api.use('/optdesk', (await import('./src/optionsdesk.js')).optionsDeskRouter);
api.use('/a', (await import('./src/analytics.js')).analyticsRouter);
api.use('/aitools', (await import('./src/aitools.js')).aiToolsRouter);
api.use('/ml', mlRouter);
api.use('/scanners', scannerRouter);
api.use('/baskets', basketsRouter);
api.use('/fleet', fleetRouter);
api.use('/market', marketRouter);
api.use('/options', optionsRouter);
api.use('/news', sentimentRouter);
api.use('/values', valuesRouter);
api.use('/alts', altsRouter);
api.use('/money', moneyRouter);
api.use('/public', trustPublicRouter);
// Everything under /api/admin is for admins only: one gate in front of it all, so a page or route
// added later can never be reached by a regular user. (The business books have their own gate:
// only the currency converter there is for everyone.)
api.use('/admin', auth.requireUser, auth.requireAdmin);
// Database read statistics (DB_READ_STATS=1): the top 30 statements by estimated rows read.
api.get('/admin/dbstats', (req, res) => res.json(dbStats(Math.min(100, +req.query.limit || 30))));
api.post('/admin/dbstats/reset', (req, res) => { resetDbStats(); res.json({ ok: true }); });
api.use('/admin/trust', trustAdminRouter);
api.use('/luach', luachRouter);
api.use('/desk', deskRouter);
api.use('/fundamentals', fundamentalsRouter);
api.use('/instruments', instrumentsRouter);
api.use('/taxrates', taxRatesRouter);
api.use('/admin/comms', commsAdminRouter);
api.use('/admin/sms-voice', smsVoiceAdminRouter);
api.use('/comms', commsRouter);
api.use('/admin/tools', toolsAdminRouter); // trading tools: AI kill switches and compliance log
api.use('/tools', toolsRouter);          // planning tools and the AI explainers (the AI ones have kill switches)
api.use('/statscan', statScanRouter);
api.use('/search', searchRouter);
api.use('/paper/orders', paperOrdersRouter);
api.use('/addons', addonsRouter);
api.use('/altlive', altLiveRouter);
api.use('/brief', briefRouter);
api.use('/taxpilot', taxPilotRouter);
api.use('/rules', rulesRouter);
api.use('/combined', combinedRouter);
api.use('/equalize', equalizeRouter);
// Optional features each user switches on in Settings (src/extras.js).
api.use('/extras', (req, res, next) => import('./src/extras.js').then(m => m.extrasRouter(req, res, next), next));
api.use('/biz', bizRouter);
api.use('/scripts', scriptsRouter);
api.use('/profiles', profilesRouter);
api.use('/sponsored', sponsoredRouter);
api.use('/invest', investRouter);
api.use('/stock', stockRouter);
api.use('/rates', ratesRouter);
api.use('/diversify', diversifyRouter);
api.use('/newspicks', newspicksRouter);
api.use('/intraday', intradayRouter);
api.use('/income', incomeRouter);
api.use('/active', activeRouter);
api.use('/hfofi', hfofiRouter);
// AI trading: agents and API, AI bots, AI signals, market intelligence, the chart co-pilot.
api.use('/agent', agentRouter(agentDeps));
api.use('/aibots', aiBotsRouter);
api.use('/aisignals', aiSignalsRouter);
api.use('/intel', intelRouter);
api.use('/chartai', chartCopilotRouter);
api.get('/aiplans', (req, res) => res.json(aiPlanTable()));
api.use('/aifunds', aiFundsRouter);
api.use('/admin/aiteam', aiTeamRouter);
api.use('/admin/aichat', aiChatRouter); // AI team Chat job (flag ai_team_chat, off by default)
api.use('/quickbooks', quickbooksRouter);
api.use('/institutions', institutionsRouter);
api.use('/roundups', roundupRouter);
api.use('/code', codeRouter);
api.use('/ai', chatRouter({ extraTools: user => ({
  forecast: { description: "AI model forecast: chance the symbol is higher after N days, from a model trained on its history and tested walk-forward. Mention it is a probability, not a promise.", schema: { symbol: { type: 'string' }, horizon: { type: 'number' } }, required: ['symbol'],
    run: async ({ symbol, horizon }) => { const r = await forecastSymbol(user.id, String(symbol).toUpperCase(), { horizon: horizon || 5 }); return { symbol: r.symbol, ...r.forecast, outOfSample: r.metrics, topFeatures: r.importance.slice(0, 4) }; } },
}) }));
const cancelAlpaca = async id => { const t = await tradingFor(id); return t ? t.cancelAllOrders() : null; };
api.use('/admin/agents', agentsRouter());
api.use('/market/overview', overviewRouter);
api.use('/portfolio-risk', portfolioRiskRouter);
api.use('/admin/users', adminUsersRouter);
api.use('/retirement', retirementRouter);
api.use('/admin/hosting', hostingRouter);
api.use('/admin/server', (await import('./src/server-admin.js')).serverAdminRouter);
api.use('/admin/keys', (await import('./src/keystore.js')).keysRouter);
api.use('/plain-research', plainResearchRouter);
// Live market-data stream (Admin → Market data → Live stream).
api.get('/admin/streams', auth.requireUser, auth.requireAdmin, async (req, res) => { const S = await import('./src/streams.js'); res.json(S.hub.status()); });
api.put('/admin/streams', auth.requireUser, auth.requireAdmin, async (req, res) => { const S = await import('./src/streams.js'); await S.saveSettings(req.body || {}); await audit(req.user.id, 'stream_settings', { provider: req.body?.provider }, req.ip); res.json(S.hub.status()); });
// Open questions from the audit: the owner records each answer and its status (Admin → SEO).
api.get('/admin/questions', async (req, res) => { const Q = await import('./src/questions.js'); res.json(Q.questionList()); });
api.put('/admin/questions/:id', async (req, res) => { const Q = await import('./src/questions.js'); const q = await Q.saveQuestion(req.params.id, req.body || {}); q ? res.json(q) : res.status(404).json({ error: 'Unknown question' }); });
api.use('/admin/seo', SEO.seoAdminRouter({ onChange: () => htmlCache.clear() }));
api.use('/admin/site', adminSiteRouter);
api.get('/admin/issues', (req, res) => res.json({ issues: listIssues() }));
api.delete('/admin/issues', async (req, res) => { await clearIssues(); res.json({ ok: true }); });
api.use('/admin/phone-accounts', (req, res, next) => import('./src/phoneaccounts.js').then(m => m.phoneAccountsRouter(req, res, next), next));
api.use('/tokens', tokensRouter);
api.use('/wealth', wealthRouter);
api.use('/security', securityRouter({ cancelAlpaca }));
api.use('/auth/passkey', passkeyLoginRouter());
api.use('/learn', lessonsRouter);
api.use('/margin', marginRouter);
api.use('/prefs', prefsRouter);
api.use('/longterm', longtermRouter);
api.use('/exec', execRouter({ accounts: accountsFor }));
api.use('/risk', riskRouter({ summarize: accountSummary, cancelAlpaca: async id => { const t = await tradingFor(id); return t ? t.cancelAllOrders() : null; } }));
const U = auth.requireUser;
api.get('/admin/system', U, auth.requireAdmin, async (req, res) => res.json({ ...relStats(), capacity: recommendedReplicas(), queue: await queueStats(), replicaId: process.env.HOSTNAME || null }));
// "View as plan" for the owner: menus, limits and upgrade prompts as a user on that plan sees them.
// Also "view as" the other business mode (display only). Any preview needs the password (or email
// for Google/GitHub sign-ins) and a confirmation; going back to the owner view does not.
api.put('/admin/preview-plan', U, auth.requireAdmin, async (req, res) => {
  const b = req.body || {};
  const plan = Object.hasOwn(PLANS, b.plan) ? b.plan : null, adviser = typeof b.adviser === 'boolean' ? b.adviser : null;
  if (plan || adviser !== null) {
    if (b.confirmed !== true) throw Object.assign(new Error('Confirm the preview first'), { status: 400 });
    if (!auth.confirmsIdentity(req.user, b)) throw Object.assign(new Error(req.user.password_set === 0 ? 'Type your email address to confirm' : 'Wrong password'), { status: 401 });
  }
  for (const [k, v] of [['previewPlan', plan], ['previewAdviser', adviser]]) {
    if (v !== null) await setSetting(req.user.id, k, v); else await run('DELETE FROM user_settings WHERE user_id = ? AND k = ?', req.user.id, k);
  }
  await audit(req.user.id, 'view_as', { plan, adviser }, req.ip);
  res.json({ previewPlan: plan, previewAdviser: adviser });
});
api.get('/queue', U, async (req, res) => res.json(await userQueue(req.user.id)));
api.get('/accounts', U, async (req, res) => res.json(await accountsFor(req.user.id)));
const wrap = fn => async (req, res) => Promise.resolve(fn(req, res)).catch(e => (e.name === 'StripeError' && logStripe(e.status >= 500 ? 'error' : 'warn', 'request_failed', { rid: req.id, method: req.method, path: req.path, status: e.stripeStatus, type: e.type, code: e.code, declineCode: e.declineCode, requestId: e.requestId }), res.status(e.status || 400).json({ error: e.message, ...(e.upgrade ? { upgrade: true, feature: e.feature } : {}), ...(e.needsAck ? { needsAck: e.needsAck } : {}), ...(e.needsLesson ? { needsLesson: e.needsLesson } : {}), ...(e.locked ? { locked: true } : {}) })));
const acct = req => { const a = req.query.account || req.body?.account; return ACCOUNT_IDS.includes(a) || (a === 'smart' && req.method === 'POST' && req.path === '/orders') ? a : 'paper'; };
// 402 with upgrade: true makes the app show the upgrade window instead of a plain error.
const upgrade = feature => Object.assign(new Error(`${feature} is part of the Pro plan`), { status: 402, upgrade: true, feature });
const needPlan = feature => (req, res, next) => (isPaid(req.user) ? next() : next(upgrade(feature)));

const publicPlans = () => Object.fromEntries(Object.entries(PLANS).map(([k, { perfFee, ...p }]) => [k, p]));
api.get('/config', async (req, res) => res.json({
  // Performance-fee rates are private: only admins receive them (Admin → Upgrades, Money & fees).
  plans: req.user?.role === 'admin' ? PLANS : publicPlans(), compare: COMPARE, growthCompare: GROWTH_COMPARE, tiers: TIERS, trialDays: TRIAL_DAYS, presets: PRESETS, twilio: N.twilioEnabled(), stripe: N.stripeEnabled(), ai: llmEnabled(), aiModel: llmInfo(), email: N.emailEnabled(),
  marketData: dataEnabled(), hotline: process.env.TWILIO_FROM || null, broker: brokerEnabled(), oauth: oauthEnabled(), google: googleEnabled(), github: githubEnabled(), assistant: aiEnabled(), adviser: adviserFor(req.user), version: version(),
  // The Google Play listing, once the app is published there (ANDROID_PLAY_URL, or ANDROID_PLAY=1 for the standard address).
  androidPlay: process.env.ANDROID_PLAY_URL || (process.env.ANDROID_PLAY === '1' ? 'https://play.google.com/store/apps/details?id=com.brightfolio.app' : null),
}));

// Lets the landing page (also the GitHub Pages copy) show only sign-up options that work.
api.get('/public/features', (req, res) => res.json({ version: version(), google: googleEnabled(), github: githubEnabled(), adviser: adviserFor(req.user), phone: N.twilioEnabled() ? process.env.TWILIO_FROM : null, ai: aiEnabled() }));
// Public, rate-limited demo backtest used by the landing page (also from the GitHub Pages copy).
api.post('/public/backtest', async (req, res) => {
  if (!auth.rateLimit('pub:' + req.ip, 20, 600e3)) return res.status(429).json({ error: 'Demo limit reached - create a free account for unlimited backtests' });
  const b = req.body || {}, symbol = String(b.symbol || 'SPY').toUpperCase().slice(0, 8);
  const preset = Object.hasOwn(PRESETS, b.preset) ? PRESETS[b.preset] : PRESETS['SMA cross'];
  const bars = await getBars(symbol, '2015-01-01', null);
  const cfg = { ...preset, capital: 10000 }, warm = warmupFor(cfg);
  const r = backtest(bars.closes, cfg, warm, bars.closes.length, bars.dates);
  const step = Math.max(1, Math.floor(r.eq.length / 200));
  res.json({ symbol, source: bars.source, m: r.m, projection: projectAnnual(r.eq), curve: r.eq.filter((_, i) => i % step === 0), bh: r.bh.filter((_, i) => i % step === 0) });
});
api.post('/public/contact', async (req, res) => {
  const { name, email, subject, body } = req.body || {};
  if (!auth.rateLimit('contact:' + req.ip, 5, 3600e3)) return res.status(429).json({ error: 'Too many messages, try later' });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(email)) || !String(body || '').trim()) return res.status(400).json({ error: 'Email and message are required' });
  await run('INSERT INTO messages (user_id, name, email, subject, body, at) VALUES (?,?,?,?,?,?)', req.user?.id ?? null, String(name || '').slice(0, 100), String(email).slice(0, 200), String(subject || '').slice(0, 200), String(body).slice(0, 5000), now());
  if (process.env.ADMIN_EMAIL) N.sendEmail(process.env.ADMIN_EMAIL, `[Brightolio] ${subject || 'New message'}`, `From: ${name} <${email}>\n\n${body}`).catch(() => {});
  res.json({ ok: true });
});

api.post('/backtest', U, wrap(async (req, res) => {
  const b = req.body, start = b.start || '2016-01-01';
  if (!auth.rateLimit('bt:' + req.user.id, 60, 60e3)) throw new Error('Slow down - too many backtests');
  const bars = await getBars(String(b.symbol || 'SPY'), start, req.user.id);
  const cfg = { entry: b.entry, exit: b.exit, sl: b.sl, tp: b.tp, ts: b.ts, size: b.size, cost: b.cost, capital: b.capital || 10000 };
  const warm = warmupFor(cfg);
  if (/\{/.test(cfg.entry + cfg.exit)) {
    if (!isPaid(req.user)) throw upgrade('The strategy optimizer');
    await CR.spend(req.user, 'optimize', { memo: String(req.body.symbol || '').slice(0, 10) });
    // The optimizer and the backtest run in the CPU pool (src/cpu.js): never on the request thread.
    return res.json({ optimize: await cpu('cpu-tasks', 'optimizeRun', [bars.closes, cfg, warm, bars.dates]), source: bars.source });
  }
  const r = await cpu('cpu-tasks', 'fullBacktest', [bars.closes, cfg, warm, bars.dates]);
  res.json({ source: bars.source, symbol: String(b.symbol).toUpperCase(), ...r });
}));

api.post('/ai/strategy', U, wrap(async (req, res) => {
  if (!auth.rateLimit('ai:' + req.user.id, 20, 3600e3)) throw new Error('AI builder limit reached for this hour');
  res.json(await buildStrategy(req.body.prompt));
}));

api.get('/strategies', U, async (req, res) => res.json(await all('SELECT * FROM strategies WHERE user_id = ? ORDER BY id DESC', req.user.id)));
api.post('/strategies', U, wrap(async (req, res) => {
  const b = req.body;
  if (!b.name || !b.symbol || !b.entry) throw new Error('Name, symbol and entry rules are required');
  if (/\{/.test(b.entry + (b.exit || ''))) throw new Error('Pick one setting from the optimizer before saving (remove the { } choices)');
  compile(b.entry, [1, 2, 3]); compile(b.exit || '', [1, 2, 3]); // throws a readable error for bad rules
  const r = await run('INSERT INTO strategies (user_id, name, symbol, entry, exit, sl, tp, ts, size, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
    req.user.id, String(b.name).slice(0, 80), String(b.symbol).toUpperCase(), b.entry, b.exit || '', +b.sl || 0, +b.tp || 0, +b.ts || 0, +b.size || 100, now());
  res.json({ id: Number(r.lastInsertRowid) });
}));
api.delete('/strategies/:id', U, async (req, res) => { await run('DELETE FROM strategies WHERE id = ? AND user_id = ?', +req.params.id, req.user.id); res.json({ ok: true }); });
api.post('/strategies/:id/deploy', U, wrap(async (req, res) => {
  const target = ACCOUNT_IDS.includes(req.body.account) ? req.body.account : null;
  if (target && target !== 'paper' && !isPaid(req.user)) throw upgrade('Running bots on your brokerage account');
  if (target === 'alpaca' && !(await tradingFor(req.user.id))) throw new Error('Connect Alpaca first');
  // How often the bot checks its rules: once a day near the close, hourly, or every 15 minutes
  // (intraday runs need the market-data source; crypto bots run around the clock).
  const freq = ['1Hour', '15Min'].includes(req.body.freq) ? req.body.freq : 'daily';
  if (freq !== 'daily' && !dataEnabled()) throw new Error('Hourly and 15-minute bots need the market-data source (ALPACA_KEY_ID / ALPACA_SECRET)');
  await run('UPDATE strategies SET deployed = ?, freq = ?, last_run = NULL, last_run_at = NULL WHERE id = ? AND user_id = ?', target, freq, +req.params.id, req.user.id);
  await audit(req.user.id, target ? 'bot_deployed' : 'bot_stopped', { id: +req.params.id, target }, req.ip);
  res.json({ ok: true });
}));

api.get('/account', U, wrap(async (req, res) => {
  const a = acct(req), s = a === 'paper' ? await snapshotEquity(req.user.id) : await accountSummary(req.user.id, a);
  // Today's change of each holding (last price against the previous close), for Home's positions
  // table. Only with market data on; without it the column shows "-".
  if (s?.positions?.length && dataEnabled()) {
    const snaps = await dataSnapshots(s.positions.map(p => p.symbol)).catch(() => ({}));
    for (const p of s.positions) { const prev = snaps[p.symbol]?.prevDailyBar?.c; p.dayPl = prev && p.price ? +(p.qty * (p.price - prev)).toFixed(2) : null; }
  }
  res.json({ ...s, history: await portfolioHistory(req.user.id, a).catch(() => []) });
}));
api.get('/orders', U, wrap(async (req, res) => res.json(await listOrders(req.user.id, acct(req)))));
api.post('/orders', U, wrap(async (req, res) => {
  const a = acct(req);
  // Paper limit, stop and stop-limit orders wait for their price (src/paperorders.js).
  if (a === 'paper' && PAPER_TYPES.includes(req.body?.type)) { const o = await placePaperOrder(req.user.id, req.body); await audit(req.user.id, 'paper_order', { id: o.id, type: o.type, status: o.status }, req.ip); return res.json({ ...o, status: o.status === 'filled' ? 'filled' : 'open (waiting for its price)' }); }
  const r = await placeOrder(req.user.id, a, req.body, 'web');
  await audit(req.user.id, 'order', { ...r }, req.ip);
  res.json(r);
}));
// "Close all positions" (the header button): sells everything in one account at the market price,
// after cancelling its open orders. Needs the word CLOSE, and the password for real money.
api.post('/positions/close-all', U, wrap(async (req, res) => {
  const a = String(req.body?.account || 'paper');
  if (!ACCOUNT_IDS.includes(a) && !/^alpaca/.test(a)) throw Object.assign(new Error('Pick an account'), { status: 400 });
  if (String(req.body?.confirmWord || '').trim().toUpperCase() !== 'CLOSE') throw Object.assign(new Error('Type CLOSE to confirm'), { status: 400 });
  const { accountsFor } = await import('./src/ext/routes.js');
  const acct = (await accountsFor(req.user.id)).find(x => x.id === a);
  if (!acct?.connected) throw Object.assign(new Error('That account is not connected'), { status: 409 });
  if (acct.live && !auth.confirmsIdentity(req.user, req.body || {})) throw Object.assign(new Error(req.user.password_set === 0 ? 'Type your email address to confirm' : 'Wrong password'), { status: 401 });
  const results = [];
  if (/^alpaca/.test(a)) {
    const { tradingForAccount } = await import('./src/alpaca/connections.js');
    const t = await tradingForAccount(req.user.id, a);
    if (!t) throw Object.assign(new Error('That Alpaca account is not connected'), { status: 409 });
    const r = await t.closeAllPositions(true);
    for (const x of Array.isArray(r) ? r : []) results.push({ symbol: x.symbol || x.body?.symbol, ok: !x.status || x.status < 300 });
  } else {
    if (a === 'paper') await run("UPDATE paper_orders SET status = 'cancelled' WHERE user_id = ? AND status = 'open'", req.user.id);
    const s = await accountSummary(req.user.id, a);
    for (const p of s.positions || []) {
      if (!p.qty) continue;
      // Longs are sold; shorts are bought back.
      try { await placeOrder(req.user.id, a, { symbol: p.symbol, side: p.qty > 0 ? 'sell' : 'buy', qty: Math.abs(p.qty) }, 'close-all'); results.push({ symbol: p.symbol, ok: true }); }
      catch (e) { results.push({ symbol: p.symbol, ok: false, error: e.message }); }
    }
  }
  await audit(req.user.id, 'positions_closed_all', { account: a, count: results.length }, req.ip);
  res.json({ account: acct.name, closed: results.filter(r => r.ok).length, failed: results.filter(r => !r.ok), results });
}));
api.get('/quote/:symbol', U, wrap(async (req, res) => res.json({ symbol: req.params.symbol.toUpperCase(), price: await lastPrice(req.params.symbol, req.user.id) })));
api.post('/paper/reset', U, async (req, res) => {
  await run("DELETE FROM positions WHERE user_id = ? AND account = 'paper'", req.user.id);
  await run("DELETE FROM fills WHERE user_id = ? AND account = 'paper'", req.user.id);
  await run("DELETE FROM equity_history WHERE user_id = ? AND account = 'paper'", req.user.id);
  await run('UPDATE paper_accounts SET cash = 100000, start_cash = 100000 WHERE user_id = ?', req.user.id);
  await run("UPDATE fee_state SET high_water = 100000, net_contrib = 100000 WHERE user_id = ? AND account = 'paper'", req.user.id);
  res.json({ ok: true });
});

api.get('/schedule', U, async (req, res) => res.json((await all('SELECT * FROM scheduled_orders WHERE user_id = ? ORDER BY active DESC, next_run', req.user.id)).map(o => { let runs = []; try { runs = JSON.parse(o.history || '[]'); } catch { runs = []; } const { history, ...rest } = o; return { ...rest, runs }; })));
// A scheduled trade. "When": a New York date and time (once or repeating: every trading day, chosen
// weekdays, monthly), at the close or N minutes before it, at the next open, or after a delay. Market or
// limit order (limit orders may run in extended hours on Alpaca). The plan (src/schedule-plan.js) gives
// the start time, the grace window (missed by more and the order expires, never sent late), Alpaca's
// own auction order for the open and the close, and how precise the timing is.
function schedulePlan(req, { preview = false } = {}) {
  const b = req.body || {};
  const w = b.when && typeof b.when === 'object' ? b.when : { kind: 'at', date: b.date, time: b.time };
  if (!['at', 'close', 'open', 'delay'].includes(w.kind)) throw Object.assign(new Error('Pick when it should run'), { status: 400 });
  const repeat = w.kind === 'at' ? (b.repeat || 'once') : 'once';
  if (!['once', 'daily', 'weekly', 'monthly'].includes(repeat)) throw new Error('Bad repeat');
  const close = b.close && ['all', 'qty', 'pct', 'steps'].includes(b.close.mode) ? { mode: b.close.mode, pct: b.close.mode === 'pct' ? Math.min(100, Math.max(0, +b.close.pct || 0)) : null } : null;
  if (close?.mode === 'pct' && !(close.pct > 0)) throw Object.assign(new Error('Enter the percentage to close'), { status: 400 });
  // Scale out: 2 to 10 equal parts of what is held at each run, at least 5 minutes apart.
  if (close?.mode === 'steps') {
    close.steps = Math.round(+b.close.steps); close.everyMin = Math.round(+b.close.everyMin);
    if (!(close.steps >= 2 && close.steps <= 10)) throw Object.assign(new Error('Scale out in 2 to 10 steps'), { status: 400 });
    if (!(close.everyMin >= 5 && close.everyMin <= 1440)) throw Object.assign(new Error('Put 5 minutes to 1 day between the steps'), { status: 400 });
  }
  // A price condition checked when the order runs.
  let cond = null;
  if (b.condition && b.condition.op) {
    if (!['above', 'below'].includes(b.condition.op) || !(+b.condition.price > 0)) throw Object.assign(new Error('Enter the price for the condition'), { status: 400 });
    cond = { op: b.condition.op, price: +b.condition.price };
  }
  // A close of the whole position or a percentage needs no amount: it is worked out at run time.
  const needsAmount = !close || close.mode === 'qty';
  if (close?.mode === 'steps' && (b.repeat || 'once') !== 'once') throw Object.assign(new Error('A scale-out runs once, in steps'), { status: 400 });
  if (!preview && needsAmount && !(+b.qty > 0) && !(+b.notional > 0)) throw new Error('Give a quantity or dollar amount');
  if (close && +b.notional > 0) throw Object.assign(new Error('A scheduled close is in shares, not dollars'), { status: 400 });
  const symbol = String(b.symbol || '').trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9.\/-]{0,14}$/.test(symbol)) throw new Error('Enter a valid symbol');
  const account = acct(req);
  let plan, at, minutes = null, weekdays = null, monthDay = null;
  if (w.kind === 'at' && !(w.date && w.time) && b.at) { at = Date.parse(b.at); plan = { kind: 'at', nextRun: at, tif: null, graceMin: 15, precision: '' }; }
  else {
    plan = planWhen(w, { account, qty: +b.qty, notional: +b.notional, t: now() });
    at = plan.nextRun;
    if (w.kind === 'at') {
      minutes = plan.minutes;
      weekdays = repeat === 'weekly' ? [...new Set((Array.isArray(b.weekdays) ? b.weekdays : String(b.weekdays || '').split(',')).map(Number).filter(d => d >= 1 && d <= 5))].sort().join(',') || null : null;
      monthDay = +w.date.slice(8);
      // A repeating order whose first chosen day is not a run day starts on the next one.
      if (repeat !== 'once') { const first = nextRunOf({ repeat, run_minutes: minutes, weekdays, month_day: monthDay }, at - 1); if (first) at = first; }
    }
  }
  if (!(at > now() - 60e3)) throw new Error('Pick a time in the future');
  // A scale-out's later parts run at intervals, so it is never an auction order (those run only at the open or close).
  if (close?.mode === 'steps' && plan.tif) plan = { ...plan, tif: null, precision: plan.precision + ' A scale-out uses timed market orders, not the closing auction.' };
  // An end date (repeating schedules only): no run after the end of that New York day.
  let endAt = null;
  if (b.endDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(b.endDate)) throw Object.assign(new Error('Pick a valid end date'), { status: 400 });
    if (repeat === 'once') throw Object.assign(new Error('An end date is for repeating schedules'), { status: 400 });
    endAt = nyAt(b.endDate, 24 * 60) - 1;
    if (endAt < at) throw Object.assign(new Error('The end date is before the first run'), { status: 400 });
  }
  const type = ['limit', 'stop', 'stop_limit', 'trailing_stop'].includes(b.orderType) ? b.orderType : 'market', limit = ['limit', 'stop_limit'].includes(type) ? +b.limitPrice : null;
  if (!preview && type === 'limit' && !(limit > 0)) throw new Error('Enter the limit price');
  // Stop, stop-limit, trailing-stop and bracket orders: the same checks placeOrder makes, done now so a
  // mistake shows on the form instead of failing at run time.
  const bracket = !!b.bracket;
  const adv = { stop: +b.stopPrice || null, trailPct: +b.trailPercent || null, trailPrice: +b.trailPrice || null, tp: +b.takeProfit || null, sl: +b.stopLoss || null, slLimit: +b.stopLossLimit || null, bracket };
  if (!preview && (type !== 'market' && type !== 'limit' || bracket)) {
    if (close) throw Object.assign(new Error('A scheduled close is a market order'), { status: 400 });
    advancedOf({ type, side: b.side === 'sell' ? 'sell' : 'buy', qty: +b.qty, limit_price: limit, stop_price: adv.stop, trail_percent: adv.trailPct, trail_price: adv.trailPrice, ...(bracket ? { order_class: 'bracket', take_profit: { limit_price: adv.tp }, stop_loss: { stop_price: adv.sl, limit_price: adv.slLimit } } : {}) });
    if (account !== 'paper' && !String(account).startsWith('alpaca')) throw Object.assign(new Error('Stop, trailing-stop and bracket orders can be scheduled on Alpaca and practice accounts'), { status: 400 });
    if (account === 'paper' && (bracket || type === 'trailing_stop')) throw Object.assign(new Error('Trailing-stop and bracket orders are available on Alpaca accounts; the practice account takes stop and stop-limit orders'), { status: 400 });
  }
  const extended = type === 'limit' && !b.bracket && !!b.extended && !plan.tif ? 1 : 0;
  if ((type !== 'market' || bracket) && plan.tif) plan = { ...plan, tif: null, precision: plan.precision + ' Sent as a timed order, not an auction order (auction orders are market orders).' };
  return { b, w, repeat, symbol, account, plan: { ...plan, nextRun: at }, at, minutes, weekdays, monthDay, type, limit, extended, close, endAt, cond, adv };
}
// What the review screen shows before a schedule is saved: when it runs (New York and the user's time),
// how precise that is, and the reminder that the price at run time may differ from the price now.
api.post('/schedule/preview', U, wrap(async (req, res) => {
  // An incomplete or past choice is shown on the form as a message, not as a failed request.
  let p; try { p = schedulePlan(req, { preview: true }); } catch (e) { if (e.status && e.status !== 400) throw e; return res.json({ error: e.message }); }
  res.json({ nextRun: p.at, kind: p.plan.kind, auction: p.plan.tif || null, graceMin: p.plan.graceMin, precision: p.plan.precision, repeat: p.repeat,
    priceNote: 'The price when the order runs may differ from the price now.', account: p.account, endAt: p.endAt,
    condition: p.cond ? `Only if ${p.symbol} is ${p.cond.op} ${p.cond.price.toFixed(2)} when it runs; otherwise nothing is sent.` : null,
    steps: p.close?.mode === 'steps' ? `In ${p.close.steps} equal parts of what is held then, ${p.close.everyMin} minutes apart; each part never exceeds the position.` : null });
}));
// Schedules on a real-money account need the same step-up confirmation as a live order.
const scheduleStepUp = (req, res, next) => (acct(req) === 'paper' ? next() : stepUpGuard(req, res, next));
// The columns a schedule's form sets (create and edit share them).
const scheduleCols = (p, userId) => {
  const { b, w, repeat, symbol, account, plan, at, minutes, weekdays, monthDay, type, limit, extended, close, endAt, cond, adv } = p;
  return {
    user_id: userId, account, symbol, side: b.side === 'sell' ? 'sell' : 'buy', qty: +b.qty || null, notional: +b.notional || null, repeat, next_run: at,
    run_minutes: minutes, weekdays, month_day: monthDay, order_type: type, limit_price: limit, extended,
    when_kind: w.kind, close_offset: w.kind === 'close' ? plan.offsetMin ?? 0 : null, grace_min: plan.graceMin ?? null, tif: plan.tif || null,
    close_mode: close?.mode || null, close_pct: close?.pct ?? null, end_at: endAt,
    cond_op: cond?.op || null, cond_price: cond?.price ?? null, close_steps: close?.steps ?? null, step_every_min: close?.everyMin ?? null, steps_done: 0,
    stop_price: ['stop', 'stop_limit'].includes(type) ? adv.stop : null, trail_percent: type === 'trailing_stop' ? adv.trailPct : null, trail_price: type === 'trailing_stop' ? adv.trailPrice : null,
    bracket: adv.bracket ? 1 : 0, tp_price: adv.bracket ? adv.tp : null, sl_price: adv.bracket ? adv.sl : null, sl_limit: adv.bracket ? adv.slLimit : null,
  };
};
const whenText = at => new Date(at).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' New York time';
api.post('/schedule', U, needPlan('Scheduled trades'), scheduleStepUp, wrap(async (req, res) => {
  const p = schedulePlan(req), c = { ...scheduleCols(p, req.user.id), created_at: now() };
  const r = await run(`INSERT INTO scheduled_orders (${Object.keys(c).join(', ')}) VALUES (${Object.keys(c).map(() => '?').join(',')})`, ...Object.values(c));
  const id = Number(r.lastInsertRowid);
  await recordRun(id, 'created', `first run ${whenText(p.at)}`);
  await notifyAgentUser(req.user.id, `Scheduled: ${c.close_mode ? 'close of' : c.side} ${c.symbol}, first run ${whenText(p.at)}. You can edit, pause or cancel it under Scheduled trades.`).catch(() => {});
  res.json({ id, nextRun: p.at, auction: p.plan.tif || null, graceMin: p.plan.graceMin, precision: p.plan.precision });
}));
// Editing or resuming a schedule that touches a real-money account (before or after the change)
// needs the same step-up confirmation as creating one.
const ownSchedule = async req => {
  const o = await one('SELECT * FROM scheduled_orders WHERE id = ? AND user_id = ?', +req.params.id, req.user.id);
  if (!o) throw Object.assign(new Error('No such scheduled order'), { status: 404 });
  return o;
};
const scheduleEditStepUp = (req, res, next) => ownSchedule(req).then(o => {
  const live = o.account !== 'paper' || (req.body?.account !== undefined && acct(req) !== 'paper');
  return live ? stepUpGuard(req, res, next) : next();
}, e => res.status(e.status || 400).json({ error: e.message }));
api.put('/schedule/:id', U, needPlan('Scheduled trades'), scheduleEditStepUp, wrap(async (req, res) => {
  const o = await ownSchedule(req);
  if (!o.active) throw Object.assign(new Error('This scheduled order has finished or was cancelled; create a new one'), { status: 409 });
  const p = schedulePlan(req), c = scheduleCols(p, req.user.id);
  delete c.user_id;
  // Conditional on the run time it was read with, so an edit can never collide with a run in progress.
  const u = await run(`UPDATE scheduled_orders SET ${Object.keys(c).map(k => k + ' = ?').join(', ')} WHERE id = ? AND user_id = ? AND active = 1 AND next_run = ?`, ...Object.values(c), o.id, req.user.id, o.next_run);
  if (!u.changes) throw Object.assign(new Error('This scheduled order just ran or changed; reload and try again'), { status: 409 });
  await recordRun(o.id, 'edited', `next run ${whenText(p.at)}`);
  await notifyAgentUser(req.user.id, `Scheduled ${c.close_mode ? 'close of' : c.side} ${c.symbol} was changed: next run ${whenText(p.at)}.`).catch(() => {});
  res.json({ id: o.id, nextRun: p.at, auction: p.plan.tif || null, graceMin: p.plan.graceMin, precision: p.plan.precision });
}));
// Pause and resume. Resuming a real-money schedule needs step-up; a paused order does not run, and on
// resume a time that has passed by more than its window expires (never sent late).
api.post('/schedule/:id/pause', U, (req, res, next) => ownSchedule(req).then(o => (req.body?.paused === false && o.account !== 'paper' ? stepUpGuard(req, res, next) : next()),
  e => res.status(e.status || 400).json({ error: e.message })), wrap(async (req, res) => {
  const o = await ownSchedule(req), paused = req.body?.paused !== false;
  if (!o.active) throw Object.assign(new Error('This scheduled order has finished or was cancelled'), { status: 409 });
  if (!paused && !isPaid(req.user)) throw upgrade('Scheduled trades');
  await run('UPDATE scheduled_orders SET paused = ? WHERE id = ? AND user_id = ?', paused ? 1 : 0, o.id, req.user.id);
  await recordRun(o.id, paused ? 'paused' : 'resumed');
  res.json({ ok: true, paused });
}));
// The market calendar for the date picker: closed days (holidays) and early closes between two dates.
api.get('/trading-calendar', async (req, res) => {
  const ok = d => /^\d{4}-\d{2}-\d{2}$/.test(d || '');
  const from = ok(req.query.from) ? req.query.from : nyTime(now()).day;
  const to = ok(req.query.to) && req.query.to >= from && req.query.to <= addDays(from, 400) ? req.query.to : addDays(from, 120);
  res.set('Cache-Control', 'public, max-age=3600').json({ from, to, days: closedDays(from, to), session: { open: '09:30', close: '16:00', earlyClose: '13:00' }, now: now(), ny: nyTime(now()) });
});
api.delete('/schedule/:id', U, wrap(async (req, res) => {
  const c = await run('UPDATE scheduled_orders SET active = 0 WHERE id = ? AND user_id = ? AND active = 1', +req.params.id, req.user.id);
  if (c.changes) await recordRun(+req.params.id, 'cancelled');
  res.json({ ok: true });
}));

api.get('/alerts', U, async (req, res) => res.json(await all('SELECT * FROM alerts WHERE user_id = ? ORDER BY id DESC', req.user.id)));
api.post('/alerts', U, wrap(async (req, res) => {
  const { symbol, op, price } = req.body;
  if (!['above', 'below'].includes(op) || !(+price > 0)) throw new Error('Bad alert');
  await run('INSERT INTO alerts (user_id, symbol, op, price, created_at) VALUES (?,?,?,?,?)', req.user.id, String(symbol).toUpperCase(), op, +price, now());
  res.json({ ok: true });
}));
api.delete('/alerts/:id', U, async (req, res) => { await run('DELETE FROM alerts WHERE id = ? AND user_id = ?', +req.params.id, req.user.id); res.json({ ok: true }); });

// --- integrations: Alpaca + QuantConnect keys are encrypted at rest ---
api.get('/integrations', U, async (req, res) => {
  const a = await getCred(req.user.id, 'alpaca'), q = await getCred(req.user.id, 'quantconnect');
  res.json({ alpaca: a ? { connected: true, live: !!a.live, keyHint: a.k.slice(0, 4) + '…' } : { connected: false }, quantconnect: q ? { connected: true, userId: q.userId } : { connected: false } });
});
api.post('/integrations/alpaca', U, wrap(async (req, res) => {
  const { keyId, secret, live } = req.body;
  if (!keyId || !secret) throw new Error('Key id and secret are required');
  const c = { k: String(keyId).trim(), s: String(secret).trim(), live: !!live };
  const r = await fetch((c.live ? 'https://api.alpaca.markets' : 'https://paper-api.alpaca.markets') + '/v2/account', { headers: { 'APCA-API-KEY-ID': c.k, 'APCA-API-SECRET-KEY': c.s } });
  if (!r.ok) throw new Error('Alpaca rejected these keys (' + r.status + ')');
  const a = await r.json();
  await run('INSERT INTO credentials (user_id, provider, blob) VALUES (?,?,?) ON CONFLICT DO UPDATE SET blob = excluded.blob', req.user.id, 'alpaca', encrypt(c));
  if (!(await one("SELECT 1 FROM fee_state WHERE user_id = ? AND account = 'alpaca'", req.user.id))) await adjustForCashflow(req.user.id, 'alpaca', +a.equity);
  await audit(req.user.id, 'alpaca_connected', { live: c.live }, req.ip);
  res.json({ ok: true, equity: +a.equity });
}));
api.post('/integrations/quantconnect', U, needPlan('Connecting QuantConnect'), wrap(async (req, res) => {
  const c = { userId: String(req.body.userId).trim(), token: String(req.body.token).trim() };
  await QC.qc(c, '/authenticate');
  await run('INSERT INTO credentials (user_id, provider, blob) VALUES (?,?,?) ON CONFLICT DO UPDATE SET blob = excluded.blob', req.user.id, 'quantconnect', encrypt(c));
  res.json({ ok: true });
}));
api.delete('/integrations/:p', U, async (req, res) => { await run('DELETE FROM credentials WHERE user_id = ? AND provider = ?', req.user.id, req.params.p); res.json({ ok: true }); });

const qcCred = async req => { const c = await getCred(req.user.id, 'quantconnect'); if (!c) throw new Error('Connect QuantConnect in Settings first'); return c; };
api.get('/qc/templates', U, async (req, res) => res.json(Object.keys(QC.TEMPLATES)));
api.get('/qc/projects', U, wrap(async (req, res) => res.json(await QC.listProjects(await qcCred(req)))));
api.post('/qc/projects', U, needPlan('QuantConnect cloud projects'), wrap(async (req, res) => {
  const code = (Object.hasOwn(QC.TEMPLATES, req.body.template) && QC.TEMPLATES[req.body.template]) || req.body.code;
  if (!code) throw new Error('Pick a template or paste code');
  res.json({ id: await QC.createProject(await qcCred(req), String(req.body.name || req.body.template).slice(0, 60), code) });
}));
api.post('/qc/projects/:id/backtest', U, needPlan('QuantConnect cloud backtests'), wrap(async (req, res) => res.json({ backtestId: await QC.startBacktest(await qcCred(req), +req.params.id, req.body.name) })));
api.get('/qc/projects/:id/backtests', U, wrap(async (req, res) => res.json(await QC.listBacktests(await qcCred(req), +req.params.id))));
api.get('/qc/projects/:id/backtests/:bt', U, wrap(async (req, res) => res.json(await QC.readBacktest(await qcCred(req), +req.params.id, req.params.bt))));
api.get('/qc/live', U, wrap(async (req, res) => res.json(await QC.listLive(await qcCred(req)))));

// --- phone + PIN for SMS / hotline ---
api.post('/phone', U, wrap(async (req, res) => {
  const phone = normalizePhone(req.body.phone);
  if (!/^\+\d{10,15}$/.test(phone)) throw new Error('Enter your phone number, e.g. 718 555 1234 or +17185551234');
  if (await one('SELECT id FROM users WHERE phone = ? AND id != ?', phone, req.user.id)) throw new Error('Number already linked to another account');
  if (!auth.rateLimit('phone:' + req.user.id, 5, 3600e3)) throw new Error('Too many codes requested');
  const code = String(crypto.randomInt(100000, 1000000));
  await run('UPDATE users SET phone = ?, phone_verified = 0, phone_code = ?, phone_code_expires = ? WHERE id = ?', phone, hashSecret(code), now() + 10 * 60e3, req.user.id);
  const sent = await N.sendSms(phone, `Brightolio code: ${code}`);
  res.json({ ok: true, devCode: sent.simulated && process.env.NODE_ENV !== 'production' ? code : undefined });
}));
api.post('/phone/verify', U, wrap(async (req, res) => {
  if (!auth.rateLimit('phonev:' + req.user.id, 5, 15 * 60e3)) throw new Error('Too many attempts. Request a new code in 15 minutes.');
  if (!req.user.phone_code || req.user.phone_code_expires < now()) throw new Error('This code expired. Request a new one.');
  if (!verifySecret(String(req.body.code || ''), req.user.phone_code)) throw new Error('Wrong code');
  await run('UPDATE users SET phone_verified = 1, phone_code = NULL WHERE id = ?', req.user.id);
  await audit(req.user.id, 'phone_verified', null, req.ip);
  res.json({ ok: true });
}));
api.post('/pin', U, needPlan('Trading by text and phone'), wrap(async (req, res) => {
  if (!verifySecret(String(req.body.password || ''), req.user.pass_hash)) throw new Error('Wrong password');
  if (!/^\d{4,8}$/.test(String(req.body.pin))) throw new Error('PIN must be 4-8 digits');
  await run('UPDATE users SET pin_hash = ? WHERE id = ?', hashSecret(String(req.body.pin)), req.user.id);
  res.json({ ok: true });
}));
api.post('/command', U, wrap(async (req, res) => res.json({ reply: await smsReply(req.user, String(req.body.text || '')) })));
api.get('/command/help', U, async (req, res) => res.json({ help: HELP }));

// --- billing, funding, fees ---
api.post('/billing/checkout', U, wrap(async (req, res) => {
  if (!Object.hasOwn(PLANS, req.body.plan) || req.body.plan === 'free') throw new Error('Pick a paid plan');
  // A member who already pays changes plan in the billing portal (one subscription, prorated). A second
  // checkout would start a second subscription next to the first, and both would be charged.
  if (req.user.plan !== 'free' && req.user.stripe_customer && ['active', 'trialing', 'past_due'].includes(req.user.plan_status)) {
    throw Object.assign(new Error('You already have a plan. Change it in Manage billing, so you are never charged twice.'), { status: 409, portal: true });
  }
  if (!N.stripeEnabled()) throw new Error('Payments are not configured (STRIPE_SECRET_KEY)');
  const interval = req.body.interval === 'year' ? 'year' : 'month';
  const s = await N.checkoutSubscription({
    plan: req.body.plan, interval, trialDays: req.user.trial_used ? 0 : trialDaysFor(req.user, TRIAL_DAYS),
    email: req.user.email, customer: req.user.stripe_customer || undefined, userId: req.user.id, baseUrl: PUBLIC_URL,
  });
  await audit(req.user.id, 'checkout_started', { plan: req.body.plan, interval }, req.ip);
  res.json({ url: s.url });
}));
// Self-service: change card, switch or cancel plan, download invoices (Stripe Billing Portal).
api.post('/billing/portal', U, wrap(async (req, res) => {
  if (!req.user.stripe_customer) throw new Error('No billing account yet - choose a plan first');
  res.json({ url: (await N.billingPortal({ customer: req.user.stripe_customer, baseUrl: PUBLIC_URL })).url });
}));

// ---------- referrals ----------
api.get('/referrals', U, wrap(async (req, res) => {
  let code = req.user.ref_code;
  if (!code) { code = crypto.randomBytes(6).toString('hex').slice(0, 8); await run('UPDATE users SET ref_code = ? WHERE id = ?', code, req.user.id); }
  const invited = await one('SELECT COUNT(*) n, SUM(CASE WHEN referral_rewarded = 1 THEN 1 ELSE 0 END) paid FROM users WHERE referred_by = ?', req.user.id);
  const credit = await one("SELECT COALESCE(SUM(amount), 0) total FROM ledger WHERE user_id = ? AND kind = 'referral_credit'", req.user.id);
  const m = moneySettings();
  res.json({ code, link: `${PUBLIC_URL}/?ref=${code}`, invited: invited.n || 0, paying: invited.paid || 0, credit: credit.total, reward: m.referralCredit, friendDays: TRIAL_DAYS + m.friendTrialBonusDays, milestones: m.milestones, next: nextMilestone(invited.paid || 0) });
}));
api.post('/funding/deposit', U, wrap(async (req, res) => {
  const amount = +req.body.amount, a = acct(req);
  if (!(amount >= 10 && amount <= 10000)) throw new Error('Deposits are $10 - $10,000');
  if (a === 'paper') {
    await run('UPDATE paper_accounts SET cash = cash + ?, start_cash = start_cash + ? WHERE user_id = ?', amount, amount, req.user.id);
    await adjustForCashflow(req.user.id, 'paper', amount);
    await run('INSERT INTO ledger (user_id, kind, amount, status, memo, at) VALUES (?,?,?,?,?,?)', req.user.id, 'deposit', amount, 'simulated', 'Paper deposit', now());
    return res.json({ ok: true, simulated: true });
  }
  // Real deposits: the cheapest enabled method unless the user picked one; the owner's service fee is added on top.
  const avail = PAY.methods();
  if (!avail.length) throw new Error('Deposits are not configured yet (Stripe, Helcim, Square or Authorize.net keys in Admin → Keys)');
  const method = avail.find(m => m.id === req.body.method)?.id || avail[0].id, fee = PAY.serviceFee(amount);
  const l = await run('INSERT INTO ledger (user_id, kind, amount, status, memo, at) VALUES (?,?,?,?,?,?)', req.user.id, 'deposit', amount, 'pending', `${PAY.PROVIDERS[method].name} deposit (${PAY.PROVIDERS[method].via})`, now());
  const ledgerId = Number(l.lastInsertRowid);
  if (fee > 0) await run('INSERT INTO ledger (user_id, kind, amount, status, ref, memo, at) VALUES (?,?,?,?,?,?,?)', req.user.id, 'deposit_fee', fee, 'pending', `fee:${ledgerId}`, `Service fee for deposit #${ledgerId}`, now());
  if (method === 'square') {
    const q = await PAY.squareStart({ total: amount + fee, ledgerId, baseUrl: PUBLIC_URL });
    await run('INSERT INTO payment_sessions (ledger_id, provider, secret, total, created_at) VALUES (?,?,?,?,?)', ledgerId, 'square', q.orderId, amount + fee, now());
    return res.json({ url: q.url, fee });
  }
  if (method === 'authorizenet') {
    const a = await PAY.anetStart({ total: amount + fee, ledgerId, baseUrl: PUBLIC_URL });
    await run('INSERT INTO payment_sessions (ledger_id, provider, secret, total, created_at) VALUES (?,?,?,?,?)', ledgerId, 'authorizenet', a.token, amount + fee, now());
    return res.json({ url: `/api/funding/authorizenet/${ledgerId}`, fee });
  }
  if (method === 'helcim') {
    const h = await PAY.helcimStart({ total: amount + fee, ledgerId });
    await run('INSERT INTO payment_sessions (ledger_id, provider, secret, total, created_at) VALUES (?,?,?,?,?)', ledgerId, 'helcim', h.secretToken, amount + fee, now());
    return res.json({ helcim: { checkoutToken: h.checkoutToken }, ledgerId, fee });
  }
  const s = await PAY.stripeDeposit({ method, amount, fee, email: req.user.email, userId: req.user.id, ledgerId, baseUrl: PUBLIC_URL });
  res.json({ url: s.url, fee });
}));
// Authorize.net's payment page takes the token by form POST; this page carries it there.
api.get('/funding/authorizenet/:id', U, wrap(async (req, res) => {
  const sess = await one("SELECT p.secret, p.total, l.user_id, l.status FROM payment_sessions p JOIN ledger l ON l.id = p.ledger_id WHERE p.ledger_id = ? AND p.provider = 'authorizenet'", +req.params.id);
  if (!sess || sess.user_id !== req.user.id || sess.status !== 'pending') return res.redirect('/app#/funding');
  res.type('html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Secure payment</title><link rel="stylesheet" href="/theme.css"></head>
<body style="display:grid;place-items:center;min-height:100vh;margin:0;padding:16px"><form class="card" method="post" action="${PAY.anetPayUrl()}" style="max-width:420px;text-align:center"><h2>Pay $${sess.total.toFixed(2)}</h2>
<p class="mu">You will enter your card on Authorize.net's secure page.</p><input type="hidden" name="token" value="${N.xml(sess.secret)}"><button>Continue to secure payment</button> <a href="/app#/funding">Cancel</a></form></body></html>`);
}));
api.get('/funding/methods', U, (req, res) => res.json({ methods: PAY.methods(), fee: PAY.feeTerms() }));
// HelcimPay.js result, checked against the secret token Helcim gave this session.
api.post('/funding/helcim/confirm', U, wrap(async (req, res) => {
  const id = +req.body.ledgerId, sess = await one('SELECT p.*, l.user_id, l.status FROM payment_sessions p JOIN ledger l ON l.id = p.ledger_id WHERE p.ledger_id = ?', id);
  if (!sess || sess.user_id !== req.user.id) throw new Error('Payment not found');
  if (sess.status !== 'pending') return res.json({ ok: true, status: sess.status });
  const d = req.body.data || {};
  if (!PAY.helcimValid(d, req.body.hash, sess.secret)) throw new Error('The payment response could not be verified');
  if (String(d.status).toUpperCase() !== 'APPROVED' || Math.abs(+d.amount - sess.total) > 0.005) throw new Error('The payment was not approved');
  await depositReceived(id, `helcim:${d.transactionId}`);
  res.json({ ok: true, status: 'received' });
}));
api.get('/ledger', U, async (req, res) => res.json(await all('SELECT * FROM ledger WHERE user_id = ? ORDER BY id DESC LIMIT 100', req.user.id)));
api.get('/fees', U, wrap(async (req, res) => {
  const rows = await all('SELECT * FROM fee_state WHERE user_id = ?', req.user.id);
  const plan = PLANS[req.user.plan];
  res.json({ plan: req.user.plan, rate: adviserFor(req.user) ? plan.perfFee : 0, adviser: adviserFor(req.user), monthly: plan.monthly, accounts: rows });
}));

// --- tax ---
api.get('/tax', U, wrap(async (req, res) => {
  const a = acct(req), year = +req.query.year || new Date().getUTCFullYear();
  const fills = await all('SELECT * FROM fills WHERE user_id = ? AND account = ?', req.user.id, a);
  const s = taxSummary(fills, { year, bracket: req.user.tax_bracket, stateRate: req.user.state_tax });
  const pos = await accountSummary(req.user.id, a).then(x => x.positions).catch(() => []);
  if (req.query.format === 'csv') return res.type('text/csv').attachment(`form8949-${a}-${year}.csv`).send(form8949Csv(s.rows));
  const d = scheduleD(s);
  if (req.query.format === 'scheduled') return res.type('text/csv').attachment(`schedule-d-${a}-${year}.csv`).send(scheduleDCsv(d));
  const mtm = markToMarket(fills, year === new Date().getUTCFullYear() ? pos : [], { year, bracket: req.user.tax_bracket, stateRate: req.user.state_tax });
  // An account marked as an IRA (Retirement & IRAs) is tax-sheltered: no capital-gains tax on trades.
  const accountType = (await getSetting(req.user.id, 'accountTax', {}))?.[a] || 'taxable';
  const ira = isIra(accountType) ? { type: accountType, name: ACCOUNT_TYPES[accountType], note: accountType === 'roth_ira' ? 'Trades inside a Roth IRA are not taxed, and qualified withdrawals (after age 59½ and 5 years) are tax-free. Nothing here goes on Schedule D.' : 'Trades inside a Traditional IRA are not taxed when you make them; withdrawals are taxed as ordinary income later. Nothing here goes on Schedule D.' } : null;
  res.json({ ...s, harvest: ira ? [] : harvestCandidates(pos), scheduleD: d, mtmElection: !!req.user.mtm_election, markToMarket: mtm, accountType, ira, ...(ira ? { estimatedTax: 0 } : {}) });
}));
// Monthly bookkeeping: month-by-month totals, estimated-tax periods and a journal CSV.
api.get('/tax/books', U, wrap(async (req, res) => {
  const a = acct(req), year = +req.query.year || new Date().getUTCFullYear();
  const b = await booksFor(req.user, a, year);
  if (req.query.format === 'csv') return res.type('text/csv').attachment(`books-${a}-${year}.csv`).send(booksCsv(b));
  res.json({ ...b, journal: b.journal.slice(-200), email: !!(await getSetting(req.user.id, 'booksMonthly', false)) });
}));
api.put('/tax/books/email', U, wrap(async (req, res) => { await setSetting(req.user.id, 'booksMonthly', !!req.body.on); res.json({ ok: true }); }));
api.post('/tax/settings', U, wrap(async (req, res) => {
  const b = +req.body.bracket, st = +req.body.stateTax;
  if (!(b >= 0 && b <= 0.5 && st >= 0 && st <= 0.15)) throw new Error('Out of range');
  // The mark-to-market election changes only when sent (the Settings form leaves it alone).
  await run('UPDATE users SET tax_bracket = ?, state_tax = ?, mtm_election = COALESCE(?, mtm_election) WHERE id = ?', b, st, req.body.mtm === undefined ? null : req.body.mtm ? 1 : 0, req.user.id);
  res.json({ ok: true });
}));

// --- admin (platform owner) ---
api.get('/admin/summary', U, auth.requireAdmin, async (req, res) => res.json({
  ...(await revenueSummary()),
  funnel: await funnel(),
  pendingTransfers: await all("SELECT l.*, u.email FROM ledger l JOIN users u ON u.id = l.user_id WHERE l.kind = 'deposit' AND l.status = 'received' ORDER BY l.id DESC"),
  feesDue: await all("SELECT l.*, u.email FROM ledger l JOIN users u ON u.id = l.user_id WHERE l.kind = 'performance_fee' AND l.status = 'due' ORDER BY l.id DESC"),
  users: (await all('SELECT id, email, plan, plan_status, role, totp_enabled, phone_verified, google_sub IS NOT NULL AS google, github_id IS NOT NULL AS github, phone, created_at FROM users ORDER BY id DESC LIMIT 500')).map(u => ({ ...u, nickname: publicName(u.id) })),
  payments: Object.values(PAY.PROVIDERS).map(p => ({ id: p.id, name: p.name, via: p.via, cost: p.cost, enabled: p.enabled(), on500: +p.costOf(500).toFixed(2) })),
  depositFee: { ...PAY.feeTerms(), collected: (await one("SELECT COALESCE(SUM(amount), 0) n FROM ledger WHERE kind = 'deposit_fee' AND status = 'collected' AND COALESCE(livemode, 1) = 1")).n },
}));
api.get('/admin/messages', U, auth.requireAdmin, async (req, res) => res.json(await all('SELECT * FROM messages ORDER BY id DESC LIMIT 100')));
api.post('/admin/messages/:id', U, auth.requireAdmin, async (req, res) => { await run("UPDATE messages SET status = 'closed' WHERE id = ?", +req.params.id); res.json({ ok: true }); });
api.post('/admin/assess-fees', U, auth.requireAdmin, wrap(async (req, res) => res.json(await assessAllFees())));
// Which services are set up in the environment (names only, never the values).
api.get('/admin/setup', U, auth.requireAdmin, async (req, res) => {
  const has = (...k) => k.every(x => !!process.env[x]);
  const body = { admins: auth.allAdminEmails(), emailError: siteGet('emailError'), googleRedirects: ownHosts().filter(h => !/^(localhost|127\.)/.test(h)).map(h => `https://${h}/auth/google/callback`), githubRedirect: publicUrl() + '/auth/github/callback', items: [
    ['Admin email', 'ADMIN_EMAIL', auth.allAdminEmails().length > 0],
    [`Node.js ${runtime.version} (patched: ${runtime.min} or later)`, 'NODE_VERSION / .node-version', runtime.ok],
    ['Database (a lasting file on this server, or a shared server)', 'PERSISTENT_DISK or DATABASE_URL', persistentDb],
    ['Encryption key', 'ENCRYPTION_KEY', has('ENCRYPTION_KEY')],
    ['Alpaca Broker API (account opening)', 'BROKER_API_KEY, BROKER_API_SECRET', brokerEnabled()],
    ['Alpaca market data', 'ALPACA_KEY_ID, ALPACA_SECRET', dataEnabled()],
    ['Connect existing Alpaca accounts (OAuth)', 'ALPACA_OAUTH_CLIENT_ID, ALPACA_OAUTH_CLIENT_SECRET', oauthEnabled()],
    ['Sign in with Google', 'GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET', googleEnabled()],
    ['Sign in with GitHub', 'GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET', githubEnabled()],
    ['Keys sync with Render', 'RENDER_API_KEY', !!(process.env.RENDER_API_KEY && process.env.RENDER_SERVICE_ID)],
    ['Plans and card payments (Stripe)', 'STRIPE_SECRET_KEY', N.stripeEnabled()],
    ['Stripe webhook', 'STRIPE_WEBHOOK_SECRET', has('STRIPE_WEBHOOK_SECRET')],
    ['Text messages and hotline (Twilio)', 'TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM', N.twilioEnabled()],
    ['Emails (Resend): password resets, welcome emails', 'RESEND_API_KEY', N.emailEnabled()],
    ['Email sender on your own verified domain', 'EMAIL_FROM', has('EMAIL_FROM')],
    ['AI assistant, free (Groq or Gemini)', 'GROQ_API_KEY / GEMINI_API_KEY', !!(process.env.GROQ_API_KEY || process.env.GEMINI_API_KEY || process.env.OPENROUTER_API_KEY || process.env.AI_BASE_URL)],
    ['AI assistant upgrade (Claude)', 'ANTHROPIC_API_KEY', !!process.env.ANTHROPIC_API_KEY],
    ...Object.values(PAY.PROVIDERS).map(p => [`Deposits: ${p.name} (${p.via})`, ({ stripe_ach: 'STRIPE_SECRET_KEY', stripe_card: 'STRIPE_SECRET_KEY', helcim: 'HELCIM_API_TOKEN', square: 'SQUARE_ACCESS_TOKEN, SQUARE_LOCATION_ID, SQUARE_WEBHOOK_SIGNATURE_KEY', authorizenet: 'ANET_LOGIN_ID, ANET_TRANSACTION_KEY, ANET_SIGNATURE_KEY' })[p.id] || '', p.enabled()]),
  ].map(([name, env, on]) => ({ name, env, on: !!on })) };
  res.json({ ...body, ranked: rankTasks(body.items) }); // the ranked task list (src/setup-tasks.js)
});
// Admin → AI: the active provider, the key warnings and the OpenAI webhook status (names and states only).
api.get('/admin/ai/status', U, auth.requireAdmin, wrap(async (req, res) => {
  const W = await import('./src/openai-webhook.js'), K = await import('./src/keystore.js'), L = await import('./src/llm.js');
  const webhook = await W.webhookStatus(publicUrl(), K.has('OPENAI_WEBHOOK_SECRET'));
  res.json({ active: { setting: L.activeId() || 'auto', inUse: L.llmInfo(), providers: L.providers().map(p => ({ id: p.id, name: p.name, model: p.model || null })) }, warnings: K.report().warnings, webhook });
}));
// Admin → AI: the active provider ("auto" clears it). Saved in the key store as AI_PROVIDER: it applies at once, no restart.
api.post('/admin/ai/active', U, auth.requireAdmin, wrap(async (req, res) => {
  const v = String(req.body?.value || 'auto').trim().toLowerCase();
  const L = await import('./src/llm.js'), K = await import('./src/keystore.js');
  const allowed = ['auto', 'openai', 'anthropic', 'gemini', 'groq', 'openrouter', 'custom'];
  if (!allowed.includes(v)) return res.status(400).json({ error: 'Choose a provider from the list.' });
  if (v !== 'auto' && !L.providers().some(p => p.id === v)) return res.status(400).json({ error: 'That provider has no key yet. Add its key in Admin → Keys first.' });
  if (v === 'auto') await K.removeSecret('AI_PROVIDER'); else await K.setSecret('AI_PROVIDER', v, req.user);
  await audit(req.user.id, 'ai_active_provider', { value: v }, req.ip);
  res.json({ active: v });
}));
// Admin → AI → Routing: the recent router decisions, which models answered and how often they finished, and the catalog.
api.get('/admin/ai/routing', U, auth.requireAdmin, wrap(async (req, res) => {
  const R = await import('./src/ai/router.js');
  const answered = await all("SELECT model, status, COUNT(*) AS n, AVG(output_tokens) AS avgOut FROM ai_chat_messages WHERE role = 'assistant' AND model IS NOT NULL AND model != 'auto' GROUP BY model, status ORDER BY n DESC LIMIT 200");
  res.json({ decisions: await R.recentDecisions(100), answered, catalog: R.catalogSummary() });
}));
// Sends a test email to the signed-in owner and reports exactly what the email service answered.
api.post('/admin/test-email', U, auth.requireAdmin, wrap(async (req, res) => {
  if (!N.emailEnabled()) throw new Error('RESEND_API_KEY is not set (Admin → Keys).');
  try { await N.sendEmail(req.user.email, 'Brightolio test email', 'Emails from Brightolio work. Password resets will arrive.'); }
  catch (e) { await siteSet('emailError', { msg: e.message.slice(0, 300), at: now() }); throw new Error(`The email service refused it: ${e.message}`); }
  await siteSet('emailError', null);
  res.json({ ok: true, to: req.user.email });
}));
// Change a user's plan (e.g. a free Pro account for a friend) or admin role.
api.post('/admin/users/:id', U, auth.requireAdmin, wrap(async (req, res) => {
  const u = await one('SELECT id, email, role FROM users WHERE id = ?', +req.params.id);
  if (!u) throw Object.assign(new Error('No such user'), { status: 404 });
  const { plan, role } = req.body || {};
  if (plan !== undefined) {
    if (!Object.keys(PLANS).includes(plan)) throw new Error('Unknown plan');
    await run("UPDATE users SET plan = ?, plan_status = CASE WHEN ? = 'free' THEN NULL ELSE 'active' END WHERE id = ?", plan, plan, u.id);
  }
  if (role !== undefined) {
    if (!['user', 'admin'].includes(role)) throw new Error('Unknown role');
    if (role === 'user' && (u.id === req.user.id || auth.isAdminEmail(u.email))) throw new Error(u.id === req.user.id ? 'You cannot remove your own admin access' : 'This address is on the admin list; remove it under Admin → Admins first');
    await run('UPDATE users SET role = ? WHERE id = ?', role, u.id);
  }
  await audit(req.user.id, 'admin_user_update', { user: u.id, plan, role }, req.ip);
  res.json({ ok: true });
}));
api.post('/admin/ledger/:id', U, auth.requireAdmin, wrap(async (req, res) => {
  if (!['transferred', 'collected', 'waived'].includes(req.body.status)) throw new Error('Bad status');
  await run('UPDATE ledger SET status = ? WHERE id = ?', req.body.status, +req.params.id);
  await audit(req.user.id, 'ledger_update', { id: +req.params.id, status: req.body.status }, req.ip);
  res.json({ ok: true });
}));

api.use((req, res) => res.status(404).json({ error: 'Not found' }));
api.use((err, req, res, _next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
  // Payment errors are logged as one safe line (request ids, codes, no bodies); the customer sees err.message, which is plain language.
  if (err.name === 'StripeError') logStripe(err.status >= 500 ? 'error' : 'warn', 'request_failed', { rid: req.id, method: req.method, path: req.path, status: err.stripeStatus, type: err.type, code: err.code, declineCode: err.declineCode, requestId: err.requestId });
  else if (!err.status || (err.status >= 500 && err.status !== 503)) console.error(`[${req.id}] ${req.method} ${req.path}`, err);
  else if (err.status === 503) console.warn(`[${req.id}] 503 ${req.method} ${req.path}: ${err.message}`);
  res.status(err.status || 400).json({ error: err.expose === false ? 'Something went wrong' : err.message, ...(err.upgrade ? { upgrade: true, feature: err.feature } : {}), ...(err.needsAck ? { needsAck: err.needsAck } : {}), ...(err.needsLesson ? { needsLesson: err.needsLesson } : {}), ...(err.locked ? { locked: true } : {}), ...(err.shed ? { shed: true } : {}) });
});
// The developer API (personal API keys, no cookies, so no CSRF header): before the session API.
app.use('/api/v1', v1Router({ accountsFor, accountSummary }));
app.get('/developers', (req, res) => res.redirect(302, '/app#/developers'));
app.use('/api', api);
const pub = path.join(here, 'public');
// Marketing pages get absolute social-preview image URLs (crawlers ignore relative ones).
const htmlCache = new Map();
// Public pages: the owner's SEO settings (titles, descriptions, canonical, structured data) applied.
const page = base => async (req, res) => {
  const file = base;
  if (!htmlCache.has(file) || process.env.NODE_ENV !== 'production') {
    const raw = (await fs.readFile(path.join(pub, file), 'utf8')).replace('content="og-brightolio.png"', `content="${PUBLIC_URL}/og-brightolio.png"`);
    htmlCache.set(file, SEO.transform(raw, base.replace(/\.html$/, ''), SEO.settings(), PUBLIC_URL));
  }
  res.type('html').set('X-QP-Build', BUILD).send(htmlCache.get(file));
};
// The app page lists every module it imports (modulepreload), so the browser downloads them all at
// once instead of one import level after another.
let appHtml = null;
// The version of the app's files: a hash of their contents, so every server running the same code
// (Render, Oracle) gives the same version, and a change gives a new one at once.
const ASSET_V = await (async () => {
  const h = crypto.createHash('sha1');
  const walk = async d => { for (const e of (await fs.readdir(d, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) { const f = path.join(d, e.name); if (e.isDirectory()) await walk(f); else if (/\.(js|css)$/.test(e.name)) h.update(e.name).update(await fs.readFile(f)); } };
  await walk(pub).catch(() => {}); return h.digest('hex').slice(0, 10);
})();
const BUILD = process.env.RENDER_GIT_COMMIT || ASSET_V;
// Every import inside the app's code carries the version (app.js?v=…, ./pages/x.js?v=…). Those
// addresses never change their content, so the browser, the offline cache and the Cloudflare edge
// keep them without asking again: repeat visits open at once, and a new version is never mixed with
// an old one (the cause of pages looking like the previous version after an update).
const versioned = new Map();
const withVersion = src => src
  .replace(/(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])(\.{1,2}\/[^'"?]+\.js)\2/g, (m, pre, q, spec) => `${pre}${q}${spec}?v=${ASSET_V}${q}`);
app.get(/\.(js|css)$/, async (req, res, next) => {
  if (req.path === '/sw.js' || req.path === '/config.js' || req.path === '/engine.js') return next();
  const file = path.join(pub, path.posix.normalize(req.path));
  if (!file.startsWith(pub + path.sep)) return next();
  let body = process.env.NODE_ENV === 'production' ? versioned.get(file) : null;
  if (!body) { try { body = await fs.readFile(file, 'utf8'); } catch { return next(); } if (file.endsWith('.js')) body = withVersion(body); versioned.set(file, body); }
  res.type(file.endsWith('.css') ? 'css' : 'application/javascript');
  res.set('Cache-Control', req.query.v === ASSET_V ? 'public, max-age=31536000, immutable' : 'no-cache');
  res.send(body);
});
// The app as one file: every page module bundled and minified (esbuild, at start, in memory), with
// the Yiddish translations and other on-demand parts in their own chunks. One download instead of
// dozens; the file names carry a content hash, so browsers and the edge keep them forever. If the
// bundler is missing, the separate files above are used as before.
const BUNDLE = await (async () => {
  if (process.env.NO_BUNDLE === '1') return null;
  try {
    const esbuild = await import('esbuild');
    const r = await esbuild.build({ entryPoints: [path.join(pub, 'app.js')], bundle: true, splitting: true, format: 'esm', outdir: '/bundle', write: false, minify: true, target: 'es2022', chunkNames: 'c-[hash]', entryNames: '[name]-[hash]', logLevel: 'silent', legalComments: 'none' });
    const files = new Map(r.outputFiles.map(f => [path.basename(f.path), f.text]));
    // The app's three style sheets as one minified file: one render-blocking request instead of three
    // (a phone's first paint waits for them). Font paths are made absolute for the /bundle/ address.
    let css = null;
    try {
      const src = (await Promise.all(['styles', 'theme', 'layout'].map(n => fs.readFile(path.join(pub, n + '.css'), 'utf8')))).join('\n')
        .replace(/url\((['"]?)(?!data:|\/|https?:)/g, 'url($1/');
      const out = (await esbuild.transform(src, { loader: 'css', minify: true, logLevel: 'silent' })).code;
      css = `app-${crypto.createHash('sha256').update(out).digest('hex').slice(0, 10)}.css`; files.set(css, out);
    } catch (e) { console.warn('bundle: separate style sheets,', e.message); }
    return { files, css, entry: [...files.keys()].find(k => k.startsWith('app-') && k.endsWith('.js')) };
  } catch (e) { console.warn('bundle: using separate files,', e.message); return null; }
})();
// Each app file is also kept compressed at the strongest Brotli level (done once, in the background
// after start), about a fifth smaller than the on-the-fly compression; browsers that cannot take
// Brotli get the usual gzip.
const BUNDLE_BR = new Map();
if (BUNDLE) setTimeout(async () => {
  const { brotliCompress, constants } = await import('node:zlib');
  for (const [name, text] of BUNDLE.files) {
    const buf = Buffer.from(text);
    await new Promise(r => brotliCompress(buf, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: buf.length } }, (e, out) => { if (!e) BUNDLE_BR.set(name, out); r(); }));
  }
}, 500).unref?.();
app.get('/bundle/:file', (req, res, next) => {
  const body = BUNDLE?.files.get(req.params.file); if (!body) return next();
  res.type(req.params.file.endsWith('.css') ? 'text/css' : 'application/javascript').set({ 'Cache-Control': 'public, max-age=31536000, immutable', Vary: 'Accept-Encoding' });
  const br = BUNDLE_BR.get(req.params.file);
  if (br && /\bbr\b/.test(String(req.headers['accept-encoding'] || ''))) return res.set('Content-Encoding', 'br').send(br);
  res.send(body);
});
async function appPage() {
  const html = await fs.readFile(path.join(pub, 'app.html'), 'utf8');
  if (BUNDLE) return html.replace('src="/app.js"', `src="/bundle/${BUNDLE.entry}"`)
    .replace(/(\s*<link rel="stylesheet" href="\/(styles|theme|layout)\.css">)+/, m => BUNDLE.css ? `\n  <link rel="stylesheet" href="/bundle/${BUNDLE.css}">` : m.replace(/href="\/(styles|theme|layout)\.css"/g, `href="/$1.css?v=${ASSET_V}"`)).replace('src="/layout.js"', `src="/layout.js?v=${ASSET_V}"`)
    .replace('</head>', `  <link rel="modulepreload" href="/bundle/${BUNDLE.entry}">\n</head>`);
  // Every module the app imports, followed through public/pages/ and back (static imports only).
  const mods = new Set(), todo = ['app.js'];
  while (todo.length) {
    const f = todo.shift(); if (mods.has(f)) continue; mods.add(f);
    const src = await fs.readFile(path.join(pub, f), 'utf8').catch(() => '');
    for (const m of src.matchAll(/from '(\.\.?\/[\w./-]+\.js)'/g)) {
      const dep = path.posix.normalize(path.posix.join(path.posix.dirname(f), m[1]));
      if (!dep.startsWith('..') && !dep.startsWith('i18n/')) todo.push(dep);
    }
  }
  return html.replace('src="/app.js"', `src="/app.js?v=${ASSET_V}"`).replace(/href="\/(styles|theme|layout)\.css"/g, `href="/$1.css?v=${ASSET_V}"`).replace('src="/layout.js"', `src="/layout.js?v=${ASSET_V}"`)
    .replace('</head>', [...mods].map(m => `  <link rel="modulepreload" href="/${m}?v=${ASSET_V}">`).join('\n') + '\n</head>');
}
app.get('/app', async (req, res) => {
  if (!appHtml || process.env.NODE_ENV !== 'production') appHtml = await appPage();
  // The background loader (the app's own hidden, read-only copy) may be framed by the app itself;
  // every other page still refuses to be framed by anyone.
  if ('prefetch' in req.query) res.set({ 'X-Frame-Options': 'SAMEORIGIN', 'Content-Security-Policy': String(res.getHeader('Content-Security-Policy') || '').replace("frame-ancestors 'none'", "frame-ancestors 'self'") });
  // A request with a session cookie (most likely signed in): the header and side menu hold their
  // place from the first paint (layout.css, html.was-in), so the page does not jump when the app shows
  // them. Only the cookie's presence is read here; the session itself is checked by the API as always.
  const was = /(?:^|;\s*)qp_sid=[^;]/.test(String(req.headers.cookie || ''));
  res.type('html').set({ 'Cache-Control': 'no-cache', 'X-QP-Build': BUILD, Vary: 'Cookie' }).send(was ? appHtml.replace('<html lang="en" class="lv2">', '<html lang="en" class="lv2 was-in">') : appHtml);
});
// Admin → Analytics: page views and visitors of the public pages (counted privately, see src/analytics.js).
{ const A = await import('./src/analytics.js'); app.use(A.webMiddleware); A.start(); }
app.get(['/', '/index.html', '/pricing'], page('index.html'));
app.get(['/yi', '/yi.html'], page('yi.html'));
for (const p of ['terms', 'privacy', 'risk', 'contact', 'status', 'security', 'insurance']) app.get(['/' + p, `/${p}.html`], page(p + '.html'));
// Code and pages revalidate on every load (cheap 304s via ETag) so a deploy reaches users at once;
// images rarely change and are cached for a week.
app.use(express.static(pub, {
  index: 'index.html', extensions: ['html'],
  // Font files never change under the same name: kept for a year.
  setHeaders: (res, file) => res.setHeader('Cache-Control', /\.woff2$/.test(file) ? 'public, max-age=31536000, immutable' : /\.(png|svg|webmanifest|mp4|webm|jpg)$/.test(file) ? 'public, max-age=604800' : 'no-cache'),
}));
app.use(async (req, res) => res.status(404).sendFile(path.join(pub, '404.html')));

// Started directly (node server.js) or by cluster.js (QP_START=1): listen and start the background work.
const isMain = process.argv[1] === fileURLToPath(import.meta.url) || process.env.QP_START === '1';
if (isMain && process.env.REDIRECT_ONLY !== '1') {
  // A promise somebody forgot to catch (a background job, a fire-and-forget email) is logged and
  // counted, instead of stopping the whole server as Node.js does by default.
  process.on('unhandledRejection', e => { countUnhandled(); console.error('Unhandled promise rejection (server keeps running):', e?.stack || e); });
  const port = +process.env.PORT || 3000;
  const server = app.listen(port, () => console.log(`Brightolio on http://localhost:${port}`));
  // Startup check: the same as GET /healthz/full, written to the log so a missing hosted database,
  // a failed migration or wrong paper/live servers are visible right after every deploy.
  setTimeout(async () => {
    try {
      const { routingReport } = await import('./src/routingcheck.js');
      const r = routingReport(), sch = await schemaReport();
      for (const p of r.problems) console.error('STARTUP CHECK (routing):', p);
      if (sch.missingColumns.length) console.error('STARTUP CHECK (database): missing columns', sch.missingColumns.join(', '));
      if (!persistentDb && needsHostedDb()) console.error('STARTUP CHECK (database): no DATABASE_URL; data is lost on restart.');
      if (r.ok && sch.ok && (persistentDb || !needsHostedDb())) console.log(`Startup check OK: ${persistentDb ? 'hosted' : 'local'} database, ${sch.checkedColumns} migrated columns present, paper and live routing correct.`);
    } catch (e) { console.error('STARTUP CHECK could not run:', e.message); }
  }, 1500).unref();
  // Background work runs in exactly one process: the leader (src/bus.js, cluster.js). Helpers only
  // answer requests, so no job, backup or stream ever runs twice.
  const { isLeader } = await import('./src/bus.js');
  let timer = null, stopKyc = null;
  if (isLeader()) {
  startHostingSync();
  checkMain().then(ok => console.log('One address (' + (process.env.PUBLIC_URL || '-') + '):', ok ? 'reaches this server, other addresses redirect there' : 'does not reach this server yet, no redirect')); setInterval(checkMain, 5 * 60e3).unref();
  timer = startScheduler(isActiveHost);
  (await import('./src/backup.js')).startBackups();
  startKeepWarm();
  stopKyc = startKycEvents();
  // Each deploy brings the private README's generated overview up to date (a few seconds after start).
  setTimeout(() => import('./src/admin-site.js').then(m => m.refreshReadme()).catch(() => {}), 5000).unref();
  } else { checkMain().catch(() => {}); }
  const stop = () => { if (timer) clearInterval(timer); stopKyc?.(); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 8000).unref(); };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
