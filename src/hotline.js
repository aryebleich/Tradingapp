// The stock-market phone line (IVR): what callers hear and press.
//
//   Welcome              new number: 1 = open a free account (text-message code, then a PIN)
//     1 paper / 2 live   (live needs a connected Alpaca account)
//   Main menu            1 account info · 2 positions · 3 market clock · 4 place a trade
//                        5 cancel open orders (PIN) · 6 close ALL positions (extra confirm + PIN)
//                        7 ask the assistant (when AI is on) · 9 switch paper/live · 0 hang up
//   Trade                pick a stock (1-9) → 1 buy / 2 sell → shares + # → 1 confirm / 2 cancel
//                        → 4-digit PIN → market order (risk rules apply as for any order)
//   Safety               PIN on every action that changes anything, extra confirm before closing
//                        everything, a share limit per order, 3 wrong PINs end the call, every
//                        Twilio request signature-checked, every action in the audit log
//
// Each step's choices travel in the next step's URL. Twilio signs the whole URL, so a caller
// cannot alter them, and any server instance can answer any step (no per-call memory).
// Admin → Phone line holds the settings: on/off, greeting, the 9 stocks, the share limit,
// sign-up by phone and whether free-plan callers may use the paper menu.
import { one, run, now, audit } from './db.js';
import { hashSecret, verifySecret, hmac, randomToken } from './crypto.js';
import { siteGet, siteSet, normalizePhone } from './site.js';
import { isPaid } from './fees.js';
import { accountSummary, placeOrder, lastPrice } from './brokers.js';
import { tradingForAccount } from './alpaca/connections.js';
import { userByPhone, handleCommand, KNOWN, normalize } from './commands.js';
import { createUser, rateLimit } from './auth.js';
import { nyTime, stockSession } from './time.js';
import * as N from './notify.js';
import { trySpend } from './credits.js';

export const DEFAULTS = {
  enabled: true,
  greeting: 'Welcome to Brightfolio.',
  tickers: ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'TSLA', 'SPY', 'QQQ'],
  maxQty: 10000,
  allowSignup: true,
  freePaper: false,
  voice: 'Polly.Joanna',
};
const NAMES = { AAPL: 'Apple', MSFT: 'Microsoft', NVDA: 'Nvidia', AMZN: 'Amazon', GOOGL: 'Google', GOOG: 'Google', META: 'Meta', TSLA: 'Tesla', SPY: 'the S and P 500 fund', QQQ: 'the Nasdaq 100 fund', VOO: 'the Vanguard S and P 500 fund', NFLX: 'Netflix', AMD: 'A M D', KO: 'Coca-Cola', PEP: 'Pepsi', DIA: 'the Dow fund', IWM: 'the Russell 2000 fund' };
export const settings = () => ({ ...DEFAULTS, ...(siteGet('ivr', {}) || {}) });
export async function saveSettings(b = {}) {
  const cur = settings(), out = { ...cur };
  if ('enabled' in b) out.enabled = !!b.enabled;
  if ('allowSignup' in b) out.allowSignup = !!b.allowSignup;
  if ('freePaper' in b) out.freePaper = !!b.freePaper;
  if ('greeting' in b) out.greeting = String(b.greeting || '').replace(/[<>&]/g, '').trim().slice(0, 200) || DEFAULTS.greeting;
  if ('voice' in b) out.voice = /^(Polly\.[A-Za-z-]+|man|woman|alice)$/.test(b.voice) ? b.voice : DEFAULTS.voice;
  if ('maxQty' in b) { const q = Math.floor(+b.maxQty); if (!(q >= 1 && q <= 10000)) throw Object.assign(new Error('The share limit must be between 1 and 10,000'), { status: 400 }); out.maxQty = q; }
  if ('tickers' in b) {
    const t = (Array.isArray(b.tickers) ? b.tickers : String(b.tickers).split(/[\s,]+/)).map(s => String(s).trim().toUpperCase()).filter(Boolean);
    if (!t.length || t.length > 9 || t.some(s => !/^[A-Z][A-Z0-9.]{0,9}$/.test(s))) throw Object.assign(new Error('Give 1 to 9 valid tickers'), { status: 400 });
    out.tickers = t;
  }
  await siteSet('ivr', out);
  return out;
}

const xml = N.xml;
const money = x => `${x < 0 ? 'minus ' : ''}${Math.abs(x).toLocaleString('en-US', { maximumFractionDigits: 2 })} dollars`;
const spell = s => NAMES[s] ? `${NAMES[s]}, ${s.split('').join(' ')}` : s.split('').join(' ');
const q = o => '?' + new URLSearchParams(Object.entries(o).filter(([, v]) => v != null && v !== '')).toString();
const ENVS = { paper: 'paper trading', live: 'live trading' };
const acctOf = e => (e === 'live' ? 'alpaca' : 'paper');

export function registerHotline(app, { twilioOk, twiml }) {
  const say = (text, o = settings()) => `<Say voice="${xml(o.voice)}">${xml(text)}</Say>`;
  const gather = (action, text, { digits = 1, finish = '', timeout = 8 } = {}) =>
    `<Gather input="dtmf" ${digits ? `numDigits="${digits}"` : ''} ${finish ? `finishOnKey="${finish}"` : ''} timeout="${timeout}" action="${xml(action)}" method="POST">${say(text)}</Gather>`;
  const bye = text => `${text ? say(text) : ''}<Hangup/>`;

  const menuText = (e, o) => `Main menu, ${ENVS[e]}. Press 1 for account info. 2 for positions. 3 for the market clock. 4 to place a trade. 5 to cancel open orders. 6 to close all positions.${o.ai ? ' 7 to ask the assistant.' : ''} 9 to switch to ${ENVS[e === 'paper' ? 'live' : 'paper']}. 0 to hang up.`;
  const menu = (e, lead = '') => { const o = { ...settings(), ai: aiOn() }; return gather(`/twilio/voice/menu${q({ e })}`, `${lead ? lead + ' ' : ''}${menuText(e, o)}`) + bye('Goodbye.'); };
  let aiOn = () => false;
  import('./assistant.js').then(m => { aiOn = m.aiEnabled; }).catch(() => {});

  // Who may use which menus.
  const access = u => (isPaid(u) ? 'full' : settings().freePaper ? 'paper' : null);
  const liveTrading = u => tradingForAccount(u.id, 'alpaca').catch(() => null);
  // Every step: Twilio signature, the line switched on, and the caller's linked account.
  const step = handler => async (req, res) => {
    if (!twilioOk(req)) return res.status(403).send('forbidden');
    const o = settings();
    if (!o.enabled) return twiml(res, bye('The Brightfolio phone line is closed right now. Please use the app. Goodbye.'));
    try { await handler(req, res, o); } catch (e) {
      console.warn('hotline', e.message);
      twiml(res, say('Sorry, something went wrong.') + (req.query.e ? menu(req.query.e) : bye('Goodbye.')));
    }
  };
  const caller = async req => {
    const u = await userByPhone(normalizePhone(req.body.From));
    return u && access(u) ? u : null;
  };
  // Paper or live for this step; free-plan callers always stay on paper.
  const envOf = (req, u) => (req.query.e === 'live' && access(u) === 'full' ? 'live' : 'paper');

  // ---------- welcome ----------
  app.post('/twilio/voice', step(async (req, res, o) => {
    const u = await userByPhone(normalizePhone(req.body.From));
    if (!u) {
      if (!o.allowSignup) return twiml(res, bye(`${o.greeting} This phone number is not linked to an account. Add it in the app under Settings, Phone. Goodbye.`));
      return twiml(res, gather('/twilio/voice/signup', `${o.greeting} This phone number does not have an account yet. Press 1 to open a free account. Press 0 to hang up.`) + bye('Goodbye.'));
    }
    const a = access(u);
    if (!a) return twiml(res, bye(`${o.greeting} The phone line is part of the Pro plan. You can start a free trial in the app under Plans and billing. Goodbye.`));
    // Each call costs credits (Plans & billing → Credits).
    if (!(await trySpend(u, 'call', { memo: 'phone line' }))) return twiml(res, bye(`${o.greeting} You are out of credits for phone calls. You can buy a credit pack in the app under Plans and billing. Goodbye.`));
    await audit(u.id, 'hotline_call', null, req.body.From);
    if (a === 'paper') return twiml(res, menu('paper', `${o.greeting} On your plan the phone line uses your paper account.`));
    twiml(res, gather('/twilio/voice/env', `${o.greeting} Press 1 for paper trading. Press 2 for live trading.`) + bye('Goodbye.'));
  }));
  app.post('/twilio/voice/env', step(async (req, res) => {
    const u = await caller(req); if (!u) return twiml(res, bye('Goodbye.'));
    if (req.body.Digits === '2') return twiml(res, (await liveTrading(u)) ? menu('live') : menu('paper', 'You do not have a live brokerage account connected yet, so you are in paper trading.'));
    twiml(res, menu('paper'));
  }));

  // ---------- main menu ----------
  app.post('/twilio/voice/menu', step(async (req, res, o) => {
    const u = await caller(req); if (!u) return twiml(res, bye('Goodbye.'));
    const e = envOf(req, u), acct = acctOf(e), d = req.body.Digits;
    if (d === '1') {
      const s = await accountSummary(u.id, acct);
      return twiml(res, menu(e, `Your ${e} account: equity ${money(s.equity)}, cash ${money(s.cash)}${s.buyingPower != null ? `, buying power ${money(s.buyingPower)}` : ''}, ${s.positions.length} positions.`));
    }
    if (d === '2') {
      const s = await accountSummary(u.id, acct), p = s.positions.slice(0, 10);
      const text = p.length ? p.map(x => `${spell(x.symbol)}, ${x.qty} shares, ${x.pnl >= 0 ? 'up' : 'down'} ${money(Math.abs(x.pnl || 0))}`).join('. ') + (s.positions.length > 10 ? `. And ${s.positions.length - 10} more.` : '.') : 'You have no positions.';
      return twiml(res, menu(e, text));
    }
    if (d === '3') return twiml(res, menu(e, await clockText(u)));
    if (d === '4') return twiml(res, gather(`/twilio/voice/trade/ticker${q({ e })}`, 'Pick a stock. ' + o.tickers.map((s, i) => `Press ${i + 1} for ${spell(s)}.`).join(' ') + ' Press star to go back.', { digits: 1 }) + menu(e));
    if (d === '5') return twiml(res, pinPrompt(u, { e, do: 'cancel' }, 'To cancel all open orders,'));
    if (d === '6') return twiml(res, gather(`/twilio/voice/closeall${q({ e })}`, `This sells every position in your ${e} account at the market price. Press 1 to continue. Press 2 to go back.`) + menu(e));
    if (d === '7' && aiOn()) return twiml(res, `<Gather input="speech" speechTimeout="auto" timeout="6" action="${xml(`/twilio/voice/ask${q({ e })}`)}" method="POST">${say('Ask your question after the tone. For example: how is my account doing?')}</Gather>${menu(e)}`);
    if (d === '9') {
      const to = e === 'paper' ? 'live' : 'paper';
      if (to === 'live' && (access(u) !== 'full' || !(await liveTrading(u)))) return twiml(res, menu(e, access(u) !== 'full' ? 'Live trading by phone is part of the Pro plan.' : 'You do not have a live brokerage account connected yet.'));
      return twiml(res, menu(to, `Switched to ${ENVS[to]}.`));
    }
    if (d === '0') return twiml(res, bye('Thank you for calling Brightfolio. Goodbye.'));
    twiml(res, menu(e, 'Sorry, that is not an option.'));
  }));

  // ---------- trade ----------
  app.post('/twilio/voice/trade/ticker', step(async (req, res, o) => {
    const u = await caller(req); if (!u) return twiml(res, bye('Goodbye.'));
    const e = envOf(req, u), s = o.tickers[+req.body.Digits - 1];
    if (!s) return twiml(res, menu(e));
    twiml(res, gather(`/twilio/voice/trade/side${q({ e, s })}`, `${spell(s)}. Press 1 to buy. Press 2 to sell.`) + menu(e));
  }));
  app.post('/twilio/voice/trade/side', step(async (req, res) => {
    const u = await caller(req); if (!u) return twiml(res, bye('Goodbye.'));
    const e = envOf(req, u), s = req.query.s, side = { 1: 'buy', 2: 'sell' }[req.body.Digits];
    if (!side) return twiml(res, menu(e));
    twiml(res, gather(`/twilio/voice/trade/qty${q({ e, s, side })}`, `How many shares do you want to ${side}? Enter the number, then press pound.`, { digits: 0, finish: '#', timeout: 10 }) + menu(e));
  }));
  app.post('/twilio/voice/trade/qty', step(async (req, res, o) => {
    const u = await caller(req); if (!u) return twiml(res, bye('Goodbye.'));
    const e = envOf(req, u), { s, side } = req.query, qty = Math.floor(+String(req.body.Digits || '').replace(/\D/g, ''));
    if (!(qty >= 1)) return twiml(res, menu(e, 'No quantity entered.'));
    if (qty > o.maxQty) return twiml(res, gather(`/twilio/voice/trade/qty${q({ e, s, side })}`, `The phone line allows up to ${o.maxQty.toLocaleString('en-US')} shares per order. Enter a smaller number, then press pound.`, { digits: 0, finish: '#', timeout: 10 }) + menu(e));
    const px = await lastPrice(s, u.id).catch(() => null);
    twiml(res, gather(`/twilio/voice/trade/confirm${q({ e, s, side, n: qty })}`, `${side === 'buy' ? 'Buy' : 'Sell'} ${qty} ${qty === 1 ? 'share' : 'shares'} of ${spell(s)} at the market price${px ? `, about ${money(px * qty)} in total` : ''}, in your ${e} account. Press 1 to confirm. Press 2 to cancel.`) + menu(e));
  }));
  app.post('/twilio/voice/trade/confirm', step(async (req, res) => {
    const u = await caller(req); if (!u) return twiml(res, bye('Goodbye.'));
    const e = envOf(req, u);
    if (req.body.Digits !== '1') return twiml(res, menu(e, 'Order cancelled.'));
    twiml(res, pinPrompt(u, { e, do: 'trade', s: req.query.s, side: req.query.side, n: req.query.n }, 'To place the order,'));
  }));
  app.post('/twilio/voice/closeall', step(async (req, res) => {
    const u = await caller(req); if (!u) return twiml(res, bye('Goodbye.'));
    const e = envOf(req, u);
    if (req.body.Digits !== '1') return twiml(res, menu(e, 'Nothing was closed.'));
    twiml(res, pinPrompt(u, { e, do: 'closeall' }, 'To close all positions,'));
  }));

  // ---------- PIN gate for everything that changes the account ----------
  const pinPrompt = (u, p, lead) => (u.pin_hash
    ? gather(`/twilio/voice/pin${q(p)}`, `${lead} enter your 4-digit PIN.`, { digits: 4, timeout: 10 }) + menu(p.e)
    : menu(p.e, 'You need a PIN for that. Set one in the app under Settings, Phone.'));
  app.post('/twilio/voice/pin', step(async (req, res, o) => {
    const u = await caller(req); if (!u) return twiml(res, bye('Goodbye.'));
    const p = { ...req.query }, e = envOf(req, u), acct = acctOf(e);
    const ok = rateLimit('ivrpin:' + u.id, 10, 3600e3) && verifySecret(String(req.body.Digits || ''), u.pin_hash);
    if (!ok) {
      const tries = (+p.t || 0) + 1;
      await audit(u.id, 'hotline_pin_failed', { do: p.do, tries }, req.body.From);
      if (tries >= 3) { N.sendSms(u.phone, 'Brightfolio: 3 wrong PINs were entered on the phone line for your account. If this was not you, change your PIN in Settings.').catch(() => {}); return twiml(res, bye('Too many wrong PINs. Goodbye.')); }
      return twiml(res, gather(`/twilio/voice/pin${q({ ...p, t: tries })}`, 'Wrong PIN. Try again.', { digits: 4, timeout: 10 }) + menu(e));
    }
    if (p.do === 'trade') {
      const n = Math.floor(+p.n);
      if (!o.tickers.includes(p.s) || !['buy', 'sell'].includes(p.side) || !(n >= 1 && n <= o.maxQty)) return twiml(res, menu(e, 'That order is no longer valid.'));
      try {
        const r = await placeOrder(u.id, acct, { symbol: p.s, side: p.side, qty: n, type: 'market' }, 'hotline');
        await audit(u.id, 'hotline_order', { account: acct, symbol: p.s, side: p.side, qty: n }, req.body.From);
        const filled = r?.price || r?.filled_avg_price;
        return twiml(res, menu(e, `Done. ${p.side === 'buy' ? 'Bought' : 'Sell order for'} ${n} ${spell(p.s)}${filled ? ` at ${money(+filled)} a share` : ', sent to your broker'}.`));
      } catch (x) { return twiml(res, menu(e, `The order was not placed. ${String(x.message).slice(0, 180)}`)); }
    }
    if (p.do === 'cancel') {
      if (acct === 'paper') return twiml(res, menu(e, 'Paper orders fill right away, so there are no open orders to cancel.'));
      const t = await liveTrading(u); if (!t) return twiml(res, menu('paper', 'No live account is connected.'));
      const r = await t.cancelAllOrders();
      await audit(u.id, 'hotline_cancel_all', { account: acct, count: Array.isArray(r) ? r.length : null }, req.body.From);
      return twiml(res, menu(e, `Cancel requests sent for ${Array.isArray(r) ? r.length : 'all'} open orders.`));
    }
    if (p.do === 'closeall') {
      let count = 0, failed = 0;
      if (acct === 'paper') {
        for (const x of (await accountSummary(u.id, 'paper')).positions) {
          try { await placeOrder(u.id, 'paper', { symbol: x.symbol, side: x.qty > 0 ? 'sell' : 'buy', qty: Math.abs(x.qty), type: 'market' }, 'hotline'); count++; } catch { failed++; }
        }
      } else {
        const t = await liveTrading(u); if (!t) return twiml(res, menu('paper', 'No live account is connected.'));
        const r = await t.closeAllPositions(true); count = Array.isArray(r) ? r.length : 0;
      }
      await audit(u.id, 'hotline_close_all', { account: acct, count, failed }, req.body.From);
      return twiml(res, menu(e, count || failed ? `Closing ${count} positions.${failed ? ` ${failed} could not be closed.` : ''}` : 'You have no positions to close.'));
    }
    twiml(res, menu(e));
  }));

  // ---------- assistant (questions only; trades go through the keypad and the PIN) ----------
  app.post('/twilio/voice/ask', step(async (req, res) => {
    const u = await caller(req); if (!u) return twiml(res, bye('Goodbye.'));
    const e = envOf(req, u), text = String(req.body.SpeechResult || '');
    if (!text) return twiml(res, menu(e));
    let reply = 'Sorry, I did not get that.';
    try {
      const { interpret, toCommand } = await import('./assistant.js');
      const r = await interpret(u, text), cmd = toCommand(r);
      if (cmd && /^(BUY|SELL|DCA|CANCEL|PAUSE)\b/.test(normalize(cmd))) reply = 'To trade, press 4 from the main menu. Every trade needs your PIN.';
      else if (cmd && KNOWN.includes(normalize(cmd).split(' ')[0])) reply = await handleCommand(u, cmd + (e === 'live' ? ' LIVE' : ''));
      else reply = r.reply || reply;
    } catch (x) { console.warn('hotline ai', x.message); }
    await audit(u.id, 'hotline_ai', { text }, req.body.From);
    twiml(res, menu(e, String(reply).replace(/\$/g, ' dollars ').replace(/\n/g, '. ').slice(0, 600)));
  }));

  // ---------- open an account by phone ----------
  // 1: text a 6-digit code to the calling number (proves the caller holds that phone).
  app.post('/twilio/voice/signup', step(async (req, res, o) => {
    if (req.body.Digits !== '1' || !o.allowSignup) return twiml(res, bye('Goodbye.'));
    const phone = normalizePhone(req.body.From), sid = req.body.CallSid;
    if (!/^\+\d{10,15}$/.test(phone) || await userByPhone(phone)) return twiml(res, bye('This number cannot open an account by phone. Please use the app. Goodbye.'));
    if (!rateLimit('ivrsignup:' + phone, 3, 24 * 3600e3)) return twiml(res, bye('Too many sign-up attempts today. Please use the app. Goodbye.'));
    const code = String(Math.floor(100000 + Math.random() * 900000)), x = now() + 10 * 60e3;
    await N.sendSms(phone, `Brightfolio code: ${code}. Enter it on the call to open your account.`);
    twiml(res, gather(`/twilio/voice/signup/code${q({ h: hmac(`${sid}|${phone}|${code}|${x}`), x })}`, 'We just texted you a 6-digit code. Enter it now.', { digits: 6, timeout: 30 }) + bye('No code entered. Goodbye.'));
  }));
  app.post('/twilio/voice/signup/code', step(async (req, res) => {
    const phone = normalizePhone(req.body.From), sid = req.body.CallSid, { h, x } = req.query, tries = +req.query.t || 0;
    if (now() > +x) return twiml(res, bye('The code expired. Please call again. Goodbye.'));
    if (hmac(`${sid}|${phone}|${String(req.body.Digits || '')}|${x}`) !== h) {
      if (tries >= 2) return twiml(res, bye('That code is not right. Please call again. Goodbye.'));
      return twiml(res, gather(`/twilio/voice/signup/code${q({ h, x, t: tries + 1 })}`, 'That code is not right. Enter the 6-digit code again.', { digits: 6, timeout: 30 }) + bye('Goodbye.'));
    }
    twiml(res, gather(`/twilio/voice/signup/pin${q({ v: hmac(`${sid}|${phone}|verified`) })}`, 'Thank you. Now choose a 4-digit PIN. You will need it for every trade by phone or text.', { digits: 4, timeout: 15 }) + bye('Goodbye.'));
  }));
  app.post('/twilio/voice/signup/pin', step(async (req, res) => {
    const phone = normalizePhone(req.body.From), sid = req.body.CallSid, pin = String(req.body.Digits || '');
    if (req.query.v !== hmac(`${sid}|${phone}|verified`)) return twiml(res, bye('Goodbye.'));
    if (!/^\d{4}$/.test(pin) || /^(\d)\1{3}$/.test(pin) || ['1234', '4321', '0123', '9876'].includes(pin)) return twiml(res, gather(`/twilio/voice/signup/pin${q({ v: req.query.v })}`, 'Please choose a PIN that is harder to guess, not the same digit four times or a simple sequence. Enter 4 digits.', { digits: 4, timeout: 15 }) + bye('Goodbye.'));
    twiml(res, gather(`/twilio/voice/signup/done${q({ v: req.query.v, p: hmac(`${sid}|pin|${pin}`) })}`, 'Enter the same PIN again.', { digits: 4, timeout: 15 }) + bye('Goodbye.'));
  }));
  app.post('/twilio/voice/signup/done', step(async (req, res, o) => {
    const phone = normalizePhone(req.body.From), sid = req.body.CallSid, pin = String(req.body.Digits || '');
    if (req.query.v !== hmac(`${sid}|${phone}|verified`)) return twiml(res, bye('Goodbye.'));
    if (req.query.p !== hmac(`${sid}|pin|${pin}`)) return twiml(res, gather(`/twilio/voice/signup/pin${q({ v: req.query.v })}`, 'The PINs did not match. Choose a 4-digit PIN.', { digits: 4, timeout: 15 }) + bye('Goodbye.'));
    if (await userByPhone(phone)) return twiml(res, bye('This number already has an account. Goodbye.'));
    // The account's sign-in is the phone number (text-message code); the user adds an email later.
    const id = await createUser({ email: `p${phone.replace(/\D/g, '')}.${randomToken(4).toLowerCase().replace(/[^a-z0-9]/g, '')}@phone.invalid` });
    await run('UPDATE users SET phone = NULL WHERE phone = ? AND phone_verified = 0', phone);
    await run('UPDATE users SET phone = ?, phone_verified = 1, pin_hash = ? WHERE id = ?', phone, hashSecret(pin), id);
    await audit(id, 'hotline_signup', null, req.body.From);
    const base = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
    N.sendSms(phone, `Welcome to Brightfolio! Your free account with a $100,000 paper account is ready. Sign in with this phone number: ${base}/app#/login-phone . To open a real brokerage account, finish the short application in the app under Open an account.`).catch(() => {});
    const u = await one('SELECT * FROM users WHERE id = ?', id);
    if (!access(u)) return twiml(res, bye('Your account is ready. We texted you a link to sign in. Trading by phone is part of the Pro plan, and you can start a free trial in the app. Goodbye.'));
    twiml(res, menu('paper', 'Your account is ready, with 100,000 dollars of paper money. We texted you a link to the app.'));
  }));

  app.post('/twilio/voice/status', (req, res) => res.sendStatus(204));
}

// Market clock: the broker's clock when the caller has an Alpaca account, else New York time.
async function clockText(u) {
  const t = await tradingForAccount(u.id, 'alpaca').catch(() => null);
  const c = t ? await t.clock().catch(() => null) : null;
  const fmt = iso => new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'long', hour: 'numeric', minute: '2-digit' });
  if (c) return c.is_open ? `The market is open. It closes ${fmt(c.next_close)} New York time.` : `The market is closed. It opens ${fmt(c.next_open)} New York time.`;
  const n = nyTime();
  return `${stockSession() ? 'The market is open' : 'The market is closed'}. It is ${String(Math.floor(n.minutes / 60) % 12 || 12)}:${String(n.minutes % 60).padStart(2, '0')} ${n.minutes >= 720 ? 'PM' : 'AM'} in New York. Regular hours are 9:30 AM to 4 PM, Monday to Friday.`;
}
