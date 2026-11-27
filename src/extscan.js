// Premarket and after-hours scanners (queue row SCAN-01, registry S-02 and S-03): the biggest movers
// outside the regular session.
//   premarket:   from 4:00 New York time until the open, the last trade against yesterday's close;
//   after hours: from the close until 8:00 PM, the last trade against today's close.
// The list is the most active stocks plus a fixed set of liquid names, from market-data snapshots. Every
// answer says where the prices come from and how fresh they are: the IEX feed is real time but only one
// exchange (partial volume), the consolidated SIP feed needs a data subscription (registry flag licensed),
// and outside these hours the list shows the last session as it ended. Information, not advice.
import { marketStatus } from './market-calendar.js';
import { shared } from './shared-cache.js';

export const LIQUID = ['SPY', 'QQQ', 'IWM', 'DIA', 'AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'TSLA', 'AMD', 'AVGO', 'NFLX', 'JPM', 'BAC', 'XOM', 'COIN', 'PLTR', 'SMCI', 'MU', 'INTC', 'BA', 'DIS', 'UBER'];
const NY_OFFSET = t => { const s = new Date(t).toLocaleString('en-US', { timeZone: 'America/New_York', hour12: false, hour: '2-digit', minute: '2-digit' }); const [h, m] = s.split(':').map(Number); return (h % 24) * 60 + m; };
const nyDay = t => new Date(t).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

export function feedLabel(feed = process.env.ALPACA_STOCK_FEED || 'iex') {
  if (feed === 'sip') return { feed, label: 'Real time, all US exchanges (consolidated feed)', delayed: false };
  if (feed === 'delayed_sip') return { feed, label: '15-minute delayed, all US exchanges', delayed: true };
  return { feed: 'iex', label: 'Real time from IEX only: one exchange, so volume is partial', delayed: false };
}

// The movers from snapshots (pure, so it is tested without the network).
// session: 'pre' or 'after'. Only trades from that session today count; prices under $1 are left out.
export function extendedMovers(snaps, session, now = Date.now(), { limit = 25 } = {}) {
  const today = nyDay(now), rows = [];
  for (const [symbol, s] of Object.entries(snaps || {})) {
    const t = s?.latestTrade?.t ? Date.parse(s.latestTrade.t) : NaN, px = +s?.latestTrade?.p;
    if (!Number.isFinite(t) || !(px >= 1) || nyDay(t) !== today) continue;
    const min = NY_OFFSET(t);
    const inPre = min >= 240 && min < 570, inAfter = min >= 960 && min < 1200;
    if (session === 'pre' ? !inPre : !inAfter) continue;
    const base = session === 'pre' ? +s?.prevDailyBar?.c : +s?.dailyBar?.c;
    if (!(base > 0)) continue;
    const pct = (px / base - 1) * 100;
    rows.push({ symbol, last: +px.toFixed(4), base: +base.toFixed(4), gapPct: +pct.toFixed(2), lastTradeAt: new Date(t).toISOString(), dayVolume: +s?.dailyBar?.v || 0 });
  }
  return rows.sort((a, b) => Math.abs(b.gapPct) - Math.abs(a.gapPct)).slice(0, limit);
}

// The scan for this moment (shared by everyone for a minute).
export async function extendedScan(session, { now = Date.now(), data } = {}) {
  const ses = session === 'after' ? 'after' : 'pre';
  return shared(`extscan:${ses}`, 60e3, 300e3, async () => {
    const D = data || await import('./alpaca/data.js');
    if (D.dataEnabled && !D.dataEnabled()) return { session: ses, available: false, reason: 'Market data is not set up on this server.', rows: [] };
    const actives = await D.mostActives('volume', 50).catch(() => null);
    const symbols = [...new Set([...(actives?.most_actives || []).map(x => x.symbol), ...LIQUID])].slice(0, 80);
    const snaps = await D.snapshots(symbols);
    const m = marketStatus(now);
    const live = (ses === 'pre' && m.status === 'pre-market') || (ses === 'after' && m.status === 'after-hours');
    return { session: ses, available: true, live, status: m.label, data: feedLabel(), asOf: new Date(now).toISOString(), rows: extendedMovers(snaps, ses, now), note: live ? null : `Not ${ses === 'pre' ? 'premarket' : 'after hours'} right now: the list shows today's ${ses === 'pre' ? 'premarket' : 'after-hours'} trades, if any.` };
  });
}
