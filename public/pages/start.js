// Get started: a short, guided walk-through for beginners, one plain question per screen.
//   1 What brings you here (learn and practice / invest for the long term / trade)
//   2 Practice money explained ($100,000 that is not real)
//   3 A first practice purchase, picked from a few well-known names, in dollars
//   4 Keep the account safe (two-factor login, optional)
//   5 What to do next, matched to the answer in step 1, and how to use real money when ready
// Progress is kept in this browser; nothing here moves real money.
let H;
export function registerStart(routes, helpers) { H = helpers; routes.start = page; }

const KEY = 'qp_start';
const get = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } };
const put = v => { try { localStorage.setItem(KEY, JSON.stringify({ ...get(), ...v })); } catch {} };
export const startDone = () => !!get().done;

const GOALS = [
  ['learn', 'Learn and practice', 'I am new to investing and want to try it safely first.', '🎓'],
  ['grow', 'Grow my money over years', 'Invest steadily for the future, without watching the market every day.', '🌱'],
  ['trade', 'Trade actively', 'Buy and sell more often, with charts and order types.', '📈'],
];
const PICKS = [
  ['SPY', 'S&P 500 fund', 'The 500 biggest US companies in one purchase. A common first investment.'],
  ['QQQ', 'Nasdaq 100 fund', '100 large companies, many of them in technology.'],
  ['AAPL', 'Apple', 'One company: the maker of the iPhone.'],
  ['MSFT', 'Microsoft', 'One company: Windows, Office and cloud services.'],
];
const AMOUNTS = [100, 500, 1000];
const STEPS = 5;

async function page(view, q) {
  const s = get();
  let n = Math.min(STEPS, Math.max(1, +q.get('step') || s.step || 1));
  const go = k => { put({ step: k }); location.hash = '#/start?step=' + k; };
  const dots = `<div class="st-dots" aria-label="Step ${n} of ${STEPS}">${[...Array(STEPS)].map((_, i) => `<i class="${i + 1 < n ? 'done' : i + 1 === n ? 'on' : ''}"></i>`).join('')}<span>Step ${n} of ${STEPS}</span></div>`;
  const nav = (next = 'Next', { back = n > 1, skip = false, id = 'stNext' } = {}) => `<div class="st-nav">${back ? '<button type="button" class="ghost" id="stBack">Back</button>' : '<span></span>'}<span class="row" style="gap:8px">${skip ? '<button type="button" class="ghost" id="stSkip">Skip for now</button>' : ''}<button type="button" id="${id}">${next}</button></span></div>`;
  let body = '';
  if (n === 1) body = `<h1>Welcome to Brightolio 👋</h1><p class="st-lead">Let's set you up. It takes about two minutes, and nothing here uses real money.</p>
    <h2>What brings you here?</h2><div class="st-choices">${GOALS.map(([k, t, d, e]) => `<button type="button" class="st-choice ${s.goal === k ? 'on' : ''}" data-goal="${k}"><span class="st-emoji" aria-hidden="true">${e}</span><b>${t}</b><span class="mu">${d}</span></button>`).join('')}</div>${nav('Next')}`;
  if (n === 2) body = `<h1>You have $100,000 of practice money</h1><p class="st-lead">This is a <b>paper account</b>: it works like a real one, with real prices, but the money is not real. You can't lose anything here.</p>
    <div class="st-facts"><div><b>Buy</b><span>You pay today's price and own a piece of the company.</span></div><div><b>Price goes up</b><span>Your piece is worth more. You keep the gain when you sell.</span></div><div><b>Price goes down</b><span>Your piece is worth less. Prices go up and down every day; that's normal.</span></div></div>
    <p class="mu">When you're ready, you can open a real account. Your practice account stays, so you can always try ideas first. The <b>Paper / Live</b> switch at the top of the menu shows which one you're using.</p>${nav("Got it")}`;
  if (n === 3) {
    const pick = s.pick || 'SPY', amt = s.amount || 500;
    body = `<h1>Make your first practice purchase</h1><p class="st-lead">Pick one. You buy a dollar amount, so you don't need to afford a whole share.</p>
      <div class="st-choices two">${PICKS.map(([k, t, d]) => `<button type="button" class="st-choice ${pick === k ? 'on' : ''}" data-pick="${k}"><b>${t} <span class="mu" data-no-tr>${k}</span></b><span class="mu">${d}</span></button>`).join('')}</div>
      <h2>How much practice money?</h2><div class="chips" id="stAmt">${AMOUNTS.map(a => `<button type="button" class="${a === amt ? 'on' : ''}" data-amt="${a}">${H.money(a)}</button>`).join('')}</div>
      <p class="mu small-print">This is a <b>market order</b>: it buys right away at the current price (or when the market opens, if it is closed now). Other order types, like limit orders, are on the Trade page when you want them.</p>
      <div id="stOut"></div><div id="stErr"></div>${nav(s.bought ? 'Next' : `Buy ${H.money(amt)} of ${pick} with practice money`, { skip: !s.bought, id: s.bought ? 'stNext' : 'stBuy' })}`;
  }
  if (n === 4) body = `<h1>Keep your account safe</h1><p class="st-lead">Two-factor login asks for a code from your phone's authenticator app when you sign in, so a stolen password alone can't open your account.</p>
    ${H.me()?.totpEnabled ? '<p class="banner ok">Two-factor login is on. 👍</p>' : '<p><a href="#/settings"><button type="button" class="ghost">Turn on two-factor login in Settings</button></a></p>'}
    <p class="mu">You can also add your phone in Settings to get alerts by text, and a 4-digit PIN to trade by text or phone.</p>${nav('Next', { skip: !H.me()?.totpEnabled })}`;
  if (n === 5) {
    const NEXT = {
      learn: [['learn', 'Short lessons', 'Five-minute lessons: stocks, funds, risk, and how orders work.'], ['strategies', 'Try a ready-made strategy', 'See how a plan works, with practice money.'], ['dashboard', 'Watch your practice portfolio', 'See how your first purchase moves.']],
      grow: [['sp500', 'Build an S&P 500 plan', 'How much a monthly amount could grow, and set it to invest automatically.'], ['wealth', 'Investing toolkit', 'Compounding, dividends and keeping costs low, in plain words.'], ['learn', 'Short lessons', 'The basics, five minutes each.']],
      trade: [['trade', 'The Trade page', 'Prices, charts and every order type, with a guide for each.'], ['chart', 'Charts', 'Trends, signals and bull/bear markers.'], ['scanner', 'Scanner', 'Find stocks that match what you look for.']],
    }[s.goal || 'learn'];
    body = `<h1>You're all set 🎉</h1><p class="st-lead">Here's where to go next${s.goal ? ', based on what you told us' : ''}:</p>
      <div class="st-next">${NEXT.map(([k, t, d]) => `<a href="#/${k}" class="st-choice"><b>${t}</b><span class="mu">${d}</span><span class="st-go" aria-hidden="true">→</span></a>`).join('')}</div>
      <div class="card st-real"><h2>Ready for real money?</h2><p class="mu" style="margin-top:0">Connect the brokerage you already use, or open a new account in about 10 minutes (we suggest Alpaca: here in the app, or text <b>APPLY</b> to our number and we'll guide you). You choose when to switch from practice to real.</p><a href="#/brokers"><button type="button" class="ghost">Open a real account</button></a></div>
      <p class="mu small-print">Everything else is in the menu, grouped by what it's for. Open a group with its arrow. Search anything with Ctrl+K.</p>
      ${nav('Go to my portfolio', { id: 'stDone' })}`;
  }
  view.innerHTML = `<div class="st-wrap">${dots}<div class="card st-card">${body}</div><p class="st-exit"><a href="#/dashboard" id="stExit">Skip the setup</a></p></div>`;

  H.$$('[data-goal]', view).forEach(b => (b.onclick = () => { put({ goal: b.dataset.goal }); H.$$('[data-goal]', view).forEach(x => x.classList.toggle('on', x === b)); }));
  H.$$('[data-pick]', view).forEach(b => (b.onclick = () => { put({ pick: b.dataset.pick }); page(view, q); }));
  H.$$('[data-amt]', view).forEach(b => (b.onclick = () => { put({ amount: +b.dataset.amt }); page(view, q); }));
  const back = H.$('#stBack', view); if (back) back.onclick = () => go(n - 1);
  const skip = H.$('#stSkip', view); if (skip) skip.onclick = () => go(n + 1);
  const next = H.$('#stNext', view);
  if (next) next.onclick = () => { if (n === 1 && !get().goal) put({ goal: 'learn' }); go(n + 1); };
  const exit = H.$('#stExit', view); exit.onclick = () => put({ done: true });
  const done = H.$('#stDone', view); if (done) done.onclick = () => { put({ done: true }); try { localStorage.setItem('qp_onboard_done', '1'); } catch {} location.hash = '#/dashboard'; };
  const buy = H.$('#stBuy', view);
  if (buy) H.act(buy, async () => {
    const v = get(), sym = v.pick || 'SPY', amt = v.amount || 500;
    const o = await H.api('/orders', { body: { account: 'paper', symbol: sym, side: 'buy', type: 'market', notional: amt } });
    put({ bought: true });
    H.$('#stOut', view).innerHTML = `<p class="banner ok">Done! You bought ${o.qty ? `${(+o.qty).toFixed(4)} shares` : 'shares'} of ${sym}${o.price ? ` at ${H.money(o.price)} each` : ''}. You can see it under <a href="#/positions">Positions</a>.</p>`;
    buy.textContent = 'Next'; buy.onclick = () => go(4); H.$('#stSkip', view)?.remove();
    return '';
  }, H.$('#stErr', view));
}
