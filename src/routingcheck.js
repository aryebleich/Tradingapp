// "Paper is paper, live is live": a self-check the deploy workflow runs against the live site after
// every push (GET /healthz/routing). It reports only server names, never keys or accounts.
//   paper          the built-in practice account: filled inside Brightolio, never sent anywhere
//   alpaca paper   keys/OAuth saved as paper → paper-api.alpaca.markets
//   alpaca live    keys/OAuth saved as live  → api.alpaca.markets
//   broker         accounts Brightolio opened → live only on broker-api.alpaca.markets
// On every order the account's own number is checked too (Alpaca paper numbers start with "PA").
import { URLS } from './alpaca/http.js';
import { assertVenue } from './alpaca/trading.js';

export function routingReport() {
  const host = u => { try { return new URL(u).hostname; } catch { return null; } };
  const paperHost = host(URLS.trading(false)), liveHost = host(URLS.trading(true)), brokerHost = host(URLS.broker());
  const problems = [];
  try { assertVenue(URLS.trading(false), false); } catch (e) { problems.push(e.message); }
  try { assertVenue(URLS.trading(true), true); } catch (e) { problems.push(e.message); }
  if (URLS.trading(false) === URLS.trading(true)) problems.push('Paper and live Alpaca orders would go to the same server.');
  const production = process.env.NODE_ENV === 'production';
  // On the real site the servers must be Alpaca's own (tests point them at a local fake).
  if (production && paperHost !== 'paper-api.alpaca.markets') problems.push(`Paper orders go to ${paperHost}, not paper-api.alpaca.markets.`);
  if (production && liveHost !== 'api.alpaca.markets') problems.push(`Real-money orders go to ${liveHost}, not api.alpaca.markets.`);
  return {
    ok: !problems.length, commit: (process.env.RENDER_GIT_COMMIT || '').slice(0, 40) || null, checkedAt: new Date().toISOString(),
    paper: { practiceAccount: 'filled inside Brightolio (never sent to a broker)', alpacaPaper: paperHost },
    live: { alpacaLive: liveHost, brokerApi: brokerHost, brokerAccountsLive: brokerHost === 'broker-api.alpaca.markets' },
    perOrder: 'Each Alpaca order first checks the account number: paper (PA…) only with paper keys, real money only with live keys.',
    problems,
  };
}
