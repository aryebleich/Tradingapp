// Shared HTTP client for every Alpaca API: auth headers, query strings, timeouts, retries, errors.
export const URLS = {
  broker: () => (process.env.BROKER_BASE_URL || 'https://broker-api.sandbox.alpaca.markets').replace(/\/$/, ''),
  trading: live => (live ? process.env.ALPACA_LIVE_URL || 'https://api.alpaca.markets' : process.env.ALPACA_TRADING_URL || 'https://paper-api.alpaca.markets').replace(/\/$/, ''),
  data: () => (process.env.ALPACA_DATA_URL || 'https://data.alpaca.markets').replace(/\/$/, ''),
  // Broker partners read market data from the data sandbox with their broker credentials.
  dataSandbox: () => (process.env.ALPACA_DATA_SANDBOX_URL || 'https://data.sandbox.alpaca.markets').replace(/\/$/, ''),
  stream: () => (process.env.ALPACA_STREAM_URL || 'wss://stream.data.alpaca.markets').replace(/\/$/, ''),
  oauthAuthorize: () => process.env.ALPACA_OAUTH_AUTHORIZE_URL || 'https://app.alpaca.markets/oauth/authorize',
  oauthToken: () => process.env.ALPACA_OAUTH_TOKEN_URL || 'https://api.alpaca.markets/oauth/token',
};

// auth: { basic: [key, secret] } (Broker API) | { keys: [id, secret] } (Trading/Data API) | { bearer: token } (OAuth)
export function authHeaders(auth) {
  if (auth.bearer) return { Authorization: 'Bearer ' + auth.bearer };
  if (auth.basic) return { Authorization: 'Basic ' + Buffer.from(auth.basic.join(':')).toString('base64') };
  return { 'APCA-API-KEY-ID': auth.keys[0], 'APCA-API-SECRET-KEY': auth.keys[1] };
}

export function qs(params = {}) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    p.set(k, Array.isArray(v) ? v.join(',') : String(v));
  }
  const s = p.toString();
  return s ? '?' + s : '';
}

export class AlpacaError extends Error {
  constructor(status, message, code) { super(message); this.status = status >= 500 ? 502 : status; this.alpacaStatus = status; this.code = code; }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function request(base, path, { auth, method = 'GET', query, body, timeout = 15000 } = {}) {
  const url = base + path + qs(query);
  for (let attempt = 0; ; attempt++) {
    let r;
    try {
      r = await fetch(url, {
        method,
        headers: { ...authHeaders(auth), Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeout),
      });
    } catch (e) {
      if (attempt < 1 && method === 'GET') { await sleep(500); continue; }
      throw new AlpacaError(503, 'Could not reach Alpaca. Please try again.');
    }
    // Rate limited: honour Retry-After once for reads.
    if (r.status === 429 && attempt < 1 && method === 'GET') { await sleep(Math.min(5000, (+r.headers.get('retry-after') || 1) * 1000)); continue; }
    const text = await r.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!r.ok) {
      const msg = (data && (data.message || data.error)) || (typeof data === 'string' && data.slice(0, 200)) || r.statusText;
      throw new AlpacaError(r.status, r.status === 401 || r.status === 403 ? `Alpaca refused the request (${r.status}): ${msg}` : msg, data?.code);
    }
    return data;
  }
}

// Follows next_page_token pagination used by the market data APIs, merging keyed results.
export async function paged(base, path, opts, key, maxPages = 20) {
  let token, out;
  for (let i = 0; i < maxPages; i++) {
    const d = await request(base, path, { ...opts, query: { ...opts.query, page_token: token } });
    const part = d[key];
    if (Array.isArray(part)) out = (out || []).concat(part);
    else if (part && typeof part === 'object') { out ||= {}; for (const [k, v] of Object.entries(part)) out[k] = Array.isArray(v) ? (out[k] || []).concat(v) : v; }
    token = d.next_page_token;
    if (!token) break;
  }
  return out ?? (key === 'bars' ? {} : []);
}
