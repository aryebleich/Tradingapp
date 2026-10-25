// QuantPocket web server: JSON API + static single-page app.
import express from 'express';
import compression from 'compression';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { one, all, run, now, audit } from './src/db.js';
import { encrypt, hashSecret, verifySecret, safeEqual } from './src/crypto.js';
import * as auth from './src/auth.js';
import crypto from 'node:crypto';
import { backtest, projectAnnual, walkForward, optimize, warmupFor, compile, PRESETS } from './src/engine.js';
import { getBars, getCred, accountSummary, placeOrder, listOrders, portfolioHistory, lastPrice, snapshotEquity, ACCOUNT_IDS } from './src/brokers.js';
import * as QC from './src/quantconnect.js';
import { PLANS, TRIAL_DAYS, REFERRAL_CREDIT, isPaid, adjustForCashflow, revenueSummary } from './src/fees.js';
import { llmEnabled, llmInfo } from './src/llm.js';
import { securityRouter, passkeyLoginRouter, stepUpGuard } from './src/security.js';
import { lessonsRouter } from './src/lessons.js';
import { execRouter } from './src/execution.js';
import { marginRouter } from './src/margin.js';
import { setSetting } from './src/settings.js';
import { prefsRouter } from './src/settings.js';
import { longtermRouter } from './src/longterm.js';
import { shedMiddleware, stats as relStats, metricsText, recommendedReplicas, jobAllowed, load as relLoad } from './src/reliability.js';
import { drain as drainQueue, queueStats, userQueue } from './src/orderqueue.js';
import { taxSummary, harvestCandidates, form8949Csv, scheduleD, scheduleDCsv, markToMarket } from './src/tax.js';
import { buildStrategy } from './src/ai.js';
import { handleCommand, userByPhone, normalize, HELP, KNOWN } from './src/commands.js';
import { aiEnabled, interpret, toCommand } from './src/assistant.js';
import { startScheduler, assessAllFees, runDueJobs, snapshotAll } from './src/scheduler.js';
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
import { halalRouter } from './src/halal.js';
import { institutionsRouter } from './src/institutions.js';
import { roundupRouter } from './src/roundup.js';
import { codeRouter } from './src/code.js';
import * as N from './src/notify.js';
import * as PAY from './src/payments.js';
import { router as alpacaRouter } from './src/routes/alpaca.js';
import { oauthCallback, oauthEnabled, tradingFor } from './src/alpaca/connections.js';
import { brokerEnabled } from './src/alpaca/broker.js';
import { dataEnabled } from './src/alpaca/data.js';
import { router as googleRouter, googleEnabled } from './src/google.js';
import { router as signalsRouter, receive as receiveSignal } from './src/signals.js';
import { router as strategiesRouter } from './src/rotation/routes.js';
import { router as pairsRouter } from './src/pairs.js';
import { router as sp500Router } from './src/sp500.js';
import { router as extRouter, oauthCallback as extOauthCallback, accountsFor } from './src/ext/routes.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_URL = (process.env.PUBLIC_URL || 'http://localhost:3000').replace(/\/$/, '');
export const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
// Server-Sent Events must not be buffered by compression.
app.use(compression({ filter: (req, res) => !String(req.headers.accept).includes('text/event-stream') && compression.filter(req, res) }));

// Minimal access log (no query strings: reset/verify tokens live in the URL fragment, but be safe).
app.use((req, res, next) => {
  const t = Date.now();
  const url = req.originalUrl.split('?')[0].replace(/^\/hook\/.*/, '/hook/[secret]');
  res.on('finish', () => console.log(`${req.method} ${url} ${res.statusCode} ${Date.now() - t}ms`));
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
app.get('/healthz', async (req, res) => {
  try { await one('SELECT 1 AS ok'); res.json({ ok: true, time: new Date().toISOString() }); }
  catch (e) { res.status(503).json({ ok: false }); }
});

// Free hosts sleep idle apps, so a GitHub Actions cron calls this to run due jobs.
app.post('/internal/tick', async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (!secret || !safeEqual(req.headers.authorization || '', `Bearer ${secret}`)) return res.status(401).json({ error: 'unauthorized' });
  const out = await runDueJobs();
  if (req.query.snapshot) await snapshotAll();
  res.json(out);
});

app.get('/robots.txt', (req, res) => res.type('text/plain').send(`User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /app\nSitemap: ${PUBLIC_URL}/sitemap.xml\n`));
app.get('/sitemap.xml', (req, res) => res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${['/', '/yi', '/pricing', '/terms', '/privacy', '/risk', '/contact'].map(u => `<url><loc>${PUBLIC_URL}${u}</loc></url>`).join('')}</urlset>`));
// The browser demo on the landing page reuses the exact engine the server runs.
app.get('/config.js', (req, res) => res.type('text/javascript').send('window.QP = { api: "" };'));
app.get('/engine.js', (req, res) => res.type('text/javascript').sendFile(path.join(here, 'src/engine.js')));

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  // Pyodide (the code lab's Python) loads only from its own jsdelivr folder; Plaid Link from cdn.plaid.com.
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self' 'wasm-unsafe-eval' https://secure.helcim.app https://cdn.jsdelivr.net/pyodide/ https://cdn.plaid.com; frame-src https://secure.helcim.app https://cdn.plaid.com; connect-src 'self' https://cdn.jsdelivr.net/pyodide/; frame-ancestors 'none'; base-uri 'self'; form-action 'self' https://checkout.stripe.com");
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (process.env.NODE_ENV === 'production') res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

// Stripe needs the raw body for signature checks, so mount it before the JSON parser.
app.post('/webhooks/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  const raw = req.body.toString('utf8');
  if (!N.verifyStripe(raw, req.headers['stripe-signature'])) return res.status(400).send('bad signature');
  const ev = JSON.parse(raw), o = ev.data.object;
  try {
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
      const plan = Object.hasOwn(PLANS, o.metadata?.plan) ? o.metadata.plan : null;
      const ended = ['canceled', 'unpaid', 'incomplete_expired'].includes(o.status);
      await run('UPDATE users SET plan_status = ?, plan = CASE WHEN ? THEN \'free\' ELSE COALESCE(?, plan) END, plan_renews = ? WHERE stripe_customer = ?',
        o.status, ended ? 1 : 0, plan, o.current_period_end ? o.current_period_end * 1000 : null, o.customer);
    } else if (ev.type === 'checkout.session.completed' && o.metadata?.kind === 'deposit') {
      const id = +o.metadata.ledger_id;
      if ((await one('SELECT status FROM ledger WHERE id = ?', id))?.status !== 'pending') return res.json({ received: true });
      if (o.metadata.method === 'stripe_ach' || o.payment_method_types?.includes('us_bank_account')) {
        // Bank transfers settle days later (checkout.session.async_payment_succeeded / _failed).
        if (o.payment_status === 'paid') await depositReceived(id, o.payment_intent);
        else await run("UPDATE ledger SET status = 'processing', ref = ? WHERE id = ?", o.payment_intent, id);
      } else if (await N.cardFunding(o.payment_intent) !== 'debit') {
        await N.refund(o.payment_intent);
        await run("UPDATE ledger SET status = 'refunded', memo = 'Only debit cards are accepted' WHERE id = ?", id);
        await run("UPDATE ledger SET status = 'refunded' WHERE kind = 'deposit_fee' AND ref = ?", `fee:${id}`);
      } else {
        // Card funds land in the platform's Stripe balance; moving them into the user's
        // brokerage account requires the Alpaca Broker API (see README, "Funding").
        await depositReceived(id, o.payment_intent);
      }
    } else if (ev.type === 'checkout.session.async_payment_succeeded' && o.metadata?.kind === 'deposit') {
      await depositReceived(+o.metadata.ledger_id, o.payment_intent);
    } else if (ev.type === 'checkout.session.async_payment_failed' && o.metadata?.kind === 'deposit') {
      await run("UPDATE ledger SET status = 'failed', memo = 'The bank transfer failed' WHERE id = ?", +o.metadata.ledger_id);
      await run("UPDATE ledger SET status = 'failed' WHERE kind = 'deposit_fee' AND ref = ?", `fee:${+o.metadata.ledger_id}`);
    } else if (ev.type === 'customer.subscription.deleted') {
      await run("UPDATE users SET plan = 'free', plan_status = 'canceled', plan_renews = NULL WHERE stripe_customer = ?", o.customer);
    }
  } catch (e) { console.error('stripe webhook', e); return res.status(500).send('error'); }
  res.json({ received: true });
});

// Identity documents (base64 images/PDFs) are only accepted on the two onboarding endpoints.
app.use(['/api/alpaca/broker/accounts', '/api/alpaca/broker/documents'], express.json({ limit: '30mb' }));
app.use(express.json({ limit: '200kb' }));
app.use(express.urlencoded({ extended: false, limit: '50kb' }));

// ---------- Twilio: SMS + voice hotline (validated by Twilio signature, not session) ----------
const twiml = (res, body) => res.type('text/xml').send(`<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`);
const twilioOk = req => N.validTwilioSignature(PUBLIC_URL + req.originalUrl, req.body, req.headers['x-twilio-signature']);

app.post('/twilio/sms', async (req, res) => {
  if (!twilioOk(req)) return res.status(403).send('forbidden');
  const user = await userByPhone(req.body.From);
  let reply;
  if (!user) reply = 'This number is not linked to a QuantPocket account. Add it under Settings > Phone.';
  else if (!auth.rateLimit('sms:' + user.id, 30, 3600e3)) reply = 'Too many messages, try again later.';
  else {
    try { reply = await smsReply(user, String(req.body.Body || '')); } catch (e) { reply = 'Error: ' + e.message; }
    await audit(user.id, 'sms_command', { cmd: String(req.body.Body).split(/\s+/)[0] }, req.body.From);
  }
  twiml(res, `<Message>${N.xml(reply)}</Message>`);
});

// Commands first; anything else goes to the AI assistant, which turns it into a command or answers.
// A trade the AI understood still needs the PIN, so the reply tells the user exactly what to send.
async function smsReply(user, body) {
  if (KNOWN.includes(normalize(body).split(' ')[0]) || !aiEnabled()) return handleCommand(user, body);
  const r = await interpret(user, body), cmd = toCommand(r);
  if (!cmd) return (r.reply || HELP).slice(0, 600);
  const last = body.trim().split(/\s+/).pop(), pin = /^\d{4,8}$/.test(last) ? last : null;
  const out = await handleCommand(user, pin ? `${cmd} ${pin}` : cmd);
  return /needs your PIN/.test(out) ? `To do that, reply: ${cmd} <your PIN>` : out;
}

const calls = new Map(); // CallSid -> { userId, tries, ok, pending, at }
// Drop call state after 30 minutes in case Twilio's status callback is not configured.
setInterval(() => { for (const [k, c] of calls) if (now() - c.at > 30 * 60e3) calls.delete(k); }, 5 * 60e3).unref();
app.post('/twilio/voice', async (req, res) => {
  if (!twilioOk(req)) return res.status(403).send('forbidden');
  const user = await userByPhone(req.body.From);
  if (!user || !user.pin_hash) return twiml(res, '<Say>This phone number is not linked to an account with a PIN. Goodbye.</Say><Hangup/>');
  calls.set(req.body.CallSid, { userId: user.id, tries: 0, ok: false, at: now() });
  twiml(res, '<Gather input="dtmf" finishOnKey="#" action="/twilio/voice/pin" timeout="8"><Say>Welcome to QuantPocket. Enter your PIN, then press pound.</Say></Gather><Say>No input. Goodbye.</Say>');
});
app.post('/twilio/voice/pin', async (req, res) => {
  if (!twilioOk(req)) return res.status(403).send('forbidden');
  const c = calls.get(req.body.CallSid);
  if (!c) return twiml(res, '<Hangup/>');
  const u = await one('SELECT * FROM users WHERE id = ?', c.userId);
  if (!verifySecret(String(req.body.Digits || ''), u.pin_hash)) {
    if (++c.tries >= 3) { calls.delete(req.body.CallSid); await audit(u.id, 'hotline_pin_failed', null, req.body.From); return twiml(res, '<Say>Too many attempts. Goodbye.</Say><Hangup/>'); }
    return twiml(res, '<Gather input="dtmf" finishOnKey="#" action="/twilio/voice/pin"><Say>Wrong PIN. Try again.</Say></Gather>');
  }
  c.ok = true;
  twiml(res, menu());
});
const menu = () => '<Gather input="dtmf speech" numDigits="1" action="/twilio/voice/cmd" speechTimeout="auto" timeout="8"><Say>Press 1 for balance, 2 for positions, 3 for scheduled trades, 9 to pause all bots. Or just say what you need, like: how is my account doing, or buy five shares of Apple.</Say></Gather><Say>Goodbye.</Say>';
app.post('/twilio/voice/cmd', async (req, res) => {
  if (!twilioOk(req)) return res.status(403).send('forbidden');
  const c = calls.get(req.body.CallSid);
  if (!c?.ok) return twiml(res, '<Hangup/>');
  const u = await one('SELECT * FROM users WHERE id = ?', c.userId);
  let text = { 1: 'BAL', 2: 'POS', 3: 'ORDERS', 9: 'PAUSE' }[req.body.Digits] || req.body.SpeechResult || 'HELP';
  // Free speech the command words don't cover goes to the AI assistant.
  if (req.body.SpeechResult && !KNOWN.includes(normalize(text).split(' ')[0]) && aiEnabled()) {
    try {
      const r = await interpret(u, text), cmd = toCommand(r);
      if (!cmd) { await audit(u.id, 'hotline_ai', { text }, req.body.From); return twiml(res, `<Say>${N.xml((r.reply || 'Sorry, I did not get that.').replace(/\$/g, ' dollars '))}</Say>${menu()}`); }
      text = cmd;
    } catch (e) { console.warn('hotline ai', e.message); }
  }
  // Speech recognition can mishear, so anything that trades or cancels is read back first.
  const words = normalize(text);
  if (/^(BUY|SELL|DCA|CANCEL)\b/.test(words)) {
    c.pending = words;
    return twiml(res, `<Gather input="dtmf" numDigits="1" action="/twilio/voice/confirm" timeout="8"><Say>I heard: ${N.xml(words.replace(/\$/g, ' dollars ').toLowerCase())}. Press 1 to confirm, or 2 to cancel.</Say></Gather>${menu()}`);
  }
  let reply;
  try { reply = await handleCommand(u, text, { pinVerified: true }); } catch (e) { reply = 'Error. ' + e.message; }
  await audit(u.id, 'hotline_command', { text }, req.body.From);
  twiml(res, `<Say>${N.xml(reply.replace(/\$/g, ' dollars ').replace(/\n/g, '. '))}</Say>${menu()}`);
});
app.post('/twilio/voice/confirm', async (req, res) => {
  if (!twilioOk(req)) return res.status(403).send('forbidden');
  const c = calls.get(req.body.CallSid);
  if (!c?.ok) return twiml(res, '<Hangup/>');
  const text = c.pending; c.pending = null;
  if (!text || req.body.Digits !== '1') return twiml(res, `<Say>Cancelled.</Say>${menu()}`);
  const u = await one('SELECT * FROM users WHERE id = ?', c.userId);
  let reply;
  try { reply = await handleCommand(u, text, { pinVerified: true }); } catch (e) { reply = 'Error. ' + e.message; }
  await audit(u.id, 'hotline_command', { text, confirmed: true }, req.body.From);
  twiml(res, `<Say>${N.xml(reply.replace(/\$/g, ' dollars ').replace(/\n/g, '. '))}</Say>${menu()}`);
});
app.post('/twilio/voice/status', async (req, res) => { calls.delete(req.body.CallSid); res.sendStatus(204); });

// Alerts from TradingView, TrendSpider, Zapier or any script. TradingView sends text/plain unless the
// message is valid JSON, so any body type is accepted.
// Signal channels: a leader's TradingView (or other) alerts broadcast to every follower.
app.post('/hook/c/:token', express.text({ type: () => true, limit: '20kb' }), async (req, res) => {
  try { await channelHook(req, res); } catch (e) { console.error('channel hook', e); res.status(500).json({ error: 'Could not process the signal' }); }
});
app.post('/hook/:token', express.text({ type: () => true, limit: '20kb' }), async (req, res) => {
  try { await receiveSignal(req, res); } catch (e) { console.error('webhook', e); res.status(500).json({ error: 'Could not process the signal' }); }
});
app.use('/auth/google', googleRouter);
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
  let status = 'earned';
  if (ref.stripe_customer && N.stripeEnabled()) {
    try { await N.creditCustomer(ref.stripe_customer, REFERRAL_CREDIT, 'Referral credit'); status = 'applied'; } catch (e) { console.warn('referral credit', e.message); }
  }
  await run('INSERT INTO ledger (user_id, kind, amount, status, memo, at) VALUES (?,?,?,?,?,?)', ref.id, 'referral_credit', REFERRAL_CREDIT, status, 'A friend you invited subscribed', now());
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
  const revenue30 = (await one("SELECT COALESCE(SUM(amount), 0) n FROM ledger WHERE kind IN ('subscription', 'performance_fee', 'deposit_fee') AND status IN ('paid', 'collected') AND at > ?", since(30))).n;
  return { signups, signups30, connected, traded, trialing, paying, mrr: +mrr.toFixed(2), arr: +(mrr * 12).toFixed(2), revenue30, conversion: signups ? +(paying / signups * 100).toFixed(1) : 0 };
}

// ---------- JSON API ----------
const api = express.Router();
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
api.use(auth.csrfGuard);
// Only API calls look up the session; static files and pages skip the database round trip.
api.use(auth.sessionMiddleware);
// A session flagged by the behavior check confirms itself before trading or moving money.
api.use(['/orders', '/alpaca/orders', '/alpaca/positions', '/alpaca/broker/transfers', '/fleet/inbox'], stepUpGuard);
api.use('/auth', auth.router);
api.use('/alpaca', alpacaRouter);
api.use('/signals', signalsRouter);
api.use('/library', strategiesRouter);
api.use('/pairs', pairsRouter);
api.use('/sp500', sp500Router);
api.use('/brokerages', extRouter);
api.use('/insights', insightsRouter({ summarize: accountSummary }));
api.use('/ml', mlRouter);
api.use('/scanners', scannerRouter);
api.use('/baskets', basketsRouter);
api.use('/fleet', fleetRouter);
api.use('/market', marketRouter);
api.use('/options', optionsRouter);
api.use('/news', sentimentRouter);
api.use('/halal', halalRouter);
api.use('/institutions', institutionsRouter);
api.use('/roundups', roundupRouter);
api.use('/code', codeRouter);
api.use('/ai', chatRouter({ extraTools: user => ({
  forecast: { description: "AI model forecast: chance the symbol is higher after N days, from a model trained on its history and tested walk-forward. Mention it is a probability, not a promise.", schema: { symbol: { type: 'string' }, horizon: { type: 'number' } }, required: ['symbol'],
    run: async ({ symbol, horizon }) => { const r = await forecastSymbol(user.id, String(symbol).toUpperCase(), { horizon: horizon || 5 }); return { symbol: r.symbol, ...r.forecast, outOfSample: r.metrics, topFeatures: r.importance.slice(0, 4) }; } },
}) }));
const cancelAlpaca = async id => { const t = await tradingFor(id); return t ? t.cancelAllOrders() : null; };
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
api.put('/admin/preview-plan', U, auth.requireAdmin, async (req, res) => {
  const plan = Object.hasOwn(PLANS, req.body?.plan) ? req.body.plan : null;
  if (plan) await setSetting(req.user.id, 'previewPlan', plan); else await run("DELETE FROM user_settings WHERE user_id = ? AND k = 'previewPlan'", req.user.id);
  res.json({ previewPlan: plan });
});
api.get('/queue', U, async (req, res) => res.json(await userQueue(req.user.id)));
api.get('/accounts', U, async (req, res) => res.json(await accountsFor(req.user.id)));
const wrap = fn => async (req, res) => Promise.resolve(fn(req, res)).catch(e => res.status(e.status || 400).json({ error: e.message, ...(e.upgrade ? { upgrade: true, feature: e.feature } : {}), ...(e.needsAck ? { needsAck: e.needsAck } : {}), ...(e.needsLesson ? { needsLesson: e.needsLesson } : {}), ...(e.locked ? { locked: true } : {}) }));
const acct = req => { const a = req.query.account || req.body?.account; return ACCOUNT_IDS.includes(a) || (a === 'smart' && req.method === 'POST' && req.path === '/orders') ? a : 'paper'; };
// 402 with upgrade: true makes the app show the upgrade window instead of a plain error.
const upgrade = feature => Object.assign(new Error(`${feature} is part of the Pro plan`), { status: 402, upgrade: true, feature });
const needPlan = feature => (req, res, next) => (isPaid(req.user) ? next() : next(upgrade(feature)));

api.get('/config', async (req, res) => res.json({
  plans: PLANS, trialDays: TRIAL_DAYS, presets: PRESETS, twilio: N.twilioEnabled(), stripe: N.stripeEnabled(), ai: llmEnabled(), aiModel: llmInfo(), email: N.emailEnabled(),
  marketData: dataEnabled(), hotline: process.env.TWILIO_FROM || null, broker: brokerEnabled(), oauth: oauthEnabled(), google: googleEnabled(), assistant: aiEnabled(),
}));

// Lets the landing page (also the GitHub Pages copy) show only sign-up options that work.
api.get('/public/features', (req, res) => res.json({ google: googleEnabled(), phone: N.twilioEnabled() ? process.env.TWILIO_FROM : null, ai: aiEnabled(), yiddishCredit: process.env.YIDDISH_CREDIT || null }));
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
  if (process.env.ADMIN_EMAIL) N.sendEmail(process.env.ADMIN_EMAIL, `[QuantPocket] ${subject || 'New message'}`, `From: ${name} <${email}>\n\n${body}`).catch(() => {});
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
    return res.json({ optimize: optimize(bars.closes, cfg, warm, bars.dates), source: bars.source });
  }
  const r = backtest(bars.closes, cfg, warm, bars.closes.length, bars.dates);
  const step = Math.max(1, Math.floor(r.eq.length / 400));
  const idx = r.eq.map((_, i) => i).filter(i => i % step === 0 || i === r.eq.length - 1);
  res.json({
    source: bars.source, symbol: String(b.symbol).toUpperCase(), m: r.m, holding: r.holding, trades: r.trades.slice(-100),
    curve: idx.map(i => ({ d: r.dates[i], eq: r.eq[i], bh: r.bh[i] })),
    projection: projectAnnual(r.eq), walkForward: walkForward(bars.closes, cfg, warm, 4, bars.dates),
  });
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
  res.json({ ...s, history: await portfolioHistory(req.user.id, a).catch(() => []) });
}));
api.get('/orders', U, wrap(async (req, res) => res.json(await listOrders(req.user.id, acct(req)))));
api.post('/orders', U, wrap(async (req, res) => {
  const a = acct(req);
  if (a !== 'paper' && !isPaid(req.user)) throw upgrade('Trading your brokerage account from the simulator page');
  const r = await placeOrder(req.user.id, a, req.body, 'web');
  await audit(req.user.id, 'order', { ...r }, req.ip);
  res.json(r);
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

api.get('/schedule', U, async (req, res) => res.json(await all('SELECT * FROM scheduled_orders WHERE user_id = ? ORDER BY active DESC, next_run', req.user.id)));
api.post('/schedule', U, needPlan('Scheduled trades'), wrap(async (req, res) => {
  const b = req.body, at = Date.parse(b.at);
  if (!(at > now() - 60e3)) throw new Error('Pick a time in the future');
  if (!['once', 'daily', 'weekly', 'monthly'].includes(b.repeat)) throw new Error('Bad repeat');
  if (!(+b.qty > 0) && !(+b.notional > 0)) throw new Error('Give a quantity or dollar amount');
  const r = await run('INSERT INTO scheduled_orders (user_id, account, symbol, side, qty, notional, repeat, next_run, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
    req.user.id, acct(req), String(b.symbol).toUpperCase(), b.side === 'sell' ? 'sell' : 'buy', +b.qty || null, +b.notional || null, b.repeat, at, now());
  res.json({ id: Number(r.lastInsertRowid) });
}));
api.delete('/schedule/:id', U, async (req, res) => { await run('UPDATE scheduled_orders SET active = 0 WHERE id = ? AND user_id = ?', +req.params.id, req.user.id); res.json({ ok: true }); });

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
api.post('/integrations/quantconnect', U, wrap(async (req, res) => {
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
  const phone = String(req.body.phone || '').replace(/[^\d+]/g, '');
  if (!/^\+\d{10,15}$/.test(phone)) throw new Error('Use international format, e.g. +17185551234');
  if (await one('SELECT id FROM users WHERE phone = ? AND id != ?', phone, req.user.id)) throw new Error('Number already linked to another account');
  if (!auth.rateLimit('phone:' + req.user.id, 5, 3600e3)) throw new Error('Too many codes requested');
  const code = String(crypto.randomInt(100000, 1000000));
  await run('UPDATE users SET phone = ?, phone_verified = 0, phone_code = ?, phone_code_expires = ? WHERE id = ?', phone, hashSecret(code), now() + 10 * 60e3, req.user.id);
  const sent = await N.sendSms(phone, `QuantPocket code: ${code}`);
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
api.post('/pin', U, wrap(async (req, res) => {
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
  if (!N.stripeEnabled()) throw new Error('Payments are not configured (STRIPE_SECRET_KEY)');
  const interval = req.body.interval === 'year' ? 'year' : 'month';
  const s = await N.checkoutSubscription({
    plan: req.body.plan, interval, trialDays: req.user.trial_used ? 0 : TRIAL_DAYS,
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
  res.json({ code, link: `${PUBLIC_URL}/?ref=${code}`, invited: invited.n || 0, paying: invited.paid || 0, credit: credit.total, reward: REFERRAL_CREDIT });
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
  if (!avail.length) throw new Error('Deposits are not configured yet (STRIPE_SECRET_KEY or HELCIM_API_TOKEN)');
  const method = avail.find(m => m.id === req.body.method)?.id || avail[0].id, fee = PAY.serviceFee(amount);
  const l = await run('INSERT INTO ledger (user_id, kind, amount, status, memo, at) VALUES (?,?,?,?,?,?)', req.user.id, 'deposit', amount, 'pending', `${PAY.PROVIDERS[method].name} deposit (${PAY.PROVIDERS[method].via})`, now());
  const ledgerId = Number(l.lastInsertRowid);
  if (fee > 0) await run('INSERT INTO ledger (user_id, kind, amount, status, ref, memo, at) VALUES (?,?,?,?,?,?,?)', req.user.id, 'deposit_fee', fee, 'pending', `fee:${ledgerId}`, `Service fee for deposit #${ledgerId}`, now());
  if (method === 'helcim') {
    const h = await PAY.helcimStart({ total: amount + fee, ledgerId });
    await run('INSERT INTO payment_sessions (ledger_id, provider, secret, total, created_at) VALUES (?,?,?,?,?)', ledgerId, 'helcim', h.secretToken, amount + fee, now());
    return res.json({ helcim: { checkoutToken: h.checkoutToken }, ledgerId, fee });
  }
  const s = await PAY.stripeDeposit({ method, amount, fee, email: req.user.email, userId: req.user.id, ledgerId, baseUrl: PUBLIC_URL });
  res.json({ url: s.url, fee });
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
  res.json({ plan: req.user.plan, rate: plan.perfFee, monthly: plan.monthly, accounts: rows });
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
  res.json({ ...s, harvest: harvestCandidates(pos), scheduleD: d, mtmElection: !!req.user.mtm_election, markToMarket: mtm });
}));
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
  users: await all('SELECT id, email, plan, plan_status, role, totp_enabled, phone_verified, google_sub IS NOT NULL AS google, created_at FROM users ORDER BY id DESC LIMIT 500'),
  payments: Object.values(PAY.PROVIDERS).map(p => ({ id: p.id, name: p.name, via: p.via, cost: p.cost, enabled: p.enabled(), on500: +p.costOf(500).toFixed(2) })),
  depositFee: { ...PAY.feeTerms(), collected: (await one("SELECT COALESCE(SUM(amount), 0) n FROM ledger WHERE kind = 'deposit_fee' AND status = 'collected'")).n },
}));
api.get('/admin/messages', U, auth.requireAdmin, async (req, res) => res.json(await all('SELECT * FROM messages ORDER BY id DESC LIMIT 100')));
api.post('/admin/messages/:id', U, auth.requireAdmin, async (req, res) => { await run("UPDATE messages SET status = 'closed' WHERE id = ?", +req.params.id); res.json({ ok: true }); });
api.post('/admin/assess-fees', U, auth.requireAdmin, wrap(async (req, res) => res.json(await assessAllFees())));
// Which services are set up in the environment (names only, never the values).
api.get('/admin/setup', U, auth.requireAdmin, async (req, res) => {
  const has = (...k) => k.every(x => !!process.env[x]);
  res.json({ admins: auth.adminEmails(), items: [
    ['Admin email', 'ADMIN_EMAIL', auth.adminEmails().length > 0],
    ['Database (Turso)', 'DATABASE_URL', has('DATABASE_URL')],
    ['Encryption key', 'ENCRYPTION_KEY', has('ENCRYPTION_KEY')],
    ['Alpaca Broker API (account opening)', 'BROKER_API_KEY, BROKER_API_SECRET', brokerEnabled()],
    ['Alpaca market data', 'ALPACA_KEY_ID, ALPACA_SECRET', dataEnabled()],
    ['Connect existing Alpaca accounts (OAuth)', 'ALPACA_OAUTH_CLIENT_ID, ALPACA_OAUTH_CLIENT_SECRET', oauthEnabled()],
    ['Sign in with Google', 'GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET', googleEnabled()],
    ['Plans and card payments (Stripe)', 'STRIPE_SECRET_KEY', N.stripeEnabled()],
    ['Stripe webhook', 'STRIPE_WEBHOOK_SECRET', has('STRIPE_WEBHOOK_SECRET')],
    ['Text messages and hotline (Twilio)', 'TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM', N.twilioEnabled()],
    ['Emails (Resend)', 'RESEND_API_KEY', N.emailEnabled()],
    ['AI assistant, free (Groq or Gemini)', 'GROQ_API_KEY / GEMINI_API_KEY', !!(process.env.GROQ_API_KEY || process.env.GEMINI_API_KEY || process.env.OPENROUTER_API_KEY || process.env.AI_BASE_URL)],
    ['AI assistant upgrade (Claude)', 'ANTHROPIC_API_KEY', !!process.env.ANTHROPIC_API_KEY],
    ...Object.values(PAY.PROVIDERS).map(p => [`Deposits: ${p.name} (${p.via})`, ({ stripe_ach: 'STRIPE_SECRET_KEY', stripe_card: 'STRIPE_SECRET_KEY', helcim: 'HELCIM_API_TOKEN' })[p.id] || '', p.enabled()]),
    ['Yiddish Labs credit line', 'YIDDISH_CREDIT', has('YIDDISH_CREDIT')],
  ].map(([name, env, on]) => ({ name, env, on: !!on })) });
});
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
    if (role === 'user' && (u.id === req.user.id || auth.isAdminEmail(u.email))) throw new Error(u.id === req.user.id ? 'You cannot remove your own admin access' : 'This address is in ADMIN_EMAIL; remove it there first');
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
  if (!err.status || err.status >= 500) console.error(err);
  res.status(err.status || 400).json({ error: err.expose === false ? 'Something went wrong' : err.message, ...(err.upgrade ? { upgrade: true, feature: err.feature } : {}), ...(err.needsAck ? { needsAck: err.needsAck } : {}), ...(err.needsLesson ? { needsLesson: err.needsLesson } : {}), ...(err.locked ? { locked: true } : {}), ...(err.shed ? { shed: true } : {}) });
});
app.use('/api', api);
const pub = path.join(here, 'public');
// Marketing pages get absolute social-preview image URLs (crawlers ignore relative ones).
const htmlCache = new Map();
const page = file => async (req, res) => {
  if (!htmlCache.has(file) || process.env.NODE_ENV !== 'production')
    htmlCache.set(file, (await fs.readFile(path.join(pub, file), 'utf8')).replace('content="og.png"', `content="${PUBLIC_URL}/og.png"`));
  res.type('html').send(htmlCache.get(file));
};
app.get('/app', async (req, res) => res.sendFile(path.join(pub, 'app.html')));
app.get(['/', '/index.html', '/pricing'], page('index.html'));
app.get(['/yi', '/yi.html'], page('yi.html'));
for (const p of ['terms', 'privacy', 'risk', 'contact']) app.get(['/' + p, `/${p}.html`], page(p + '.html'));
// Code and pages revalidate on every load (cheap 304s via ETag) so a deploy reaches users at once;
// images rarely change and are cached for a week.
app.use(express.static(pub, {
  index: 'index.html', extensions: ['html'],
  setHeaders: (res, file) => res.setHeader('Cache-Control', /\.(png|svg|webmanifest)$/.test(file) ? 'public, max-age=604800' : 'no-cache'),
}));
app.use(async (req, res) => res.status(404).sendFile(path.join(pub, '404.html')));

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = +process.env.PORT || 3000;
  const server = app.listen(port, () => console.log(`QuantPocket on http://localhost:${port}`));
  const timer = startScheduler();
  const stopKyc = startKycEvents();
  const stop = () => { clearInterval(timer); stopKyc(); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 8000).unref(); };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
