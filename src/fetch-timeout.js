// Every call to an outside service (brokers, market data, AI, payments, email) has a time limit
// (PERFORMANCE.md): a request made without its own signal gets FETCH_TIMEOUT_MS (default 30 s), so a
// hung provider can never hold a request, a job or a worker forever. Calls that need longer (AI
// streaming) pass their own signal. The circuit breakers in src/reliability.js stop calling a
// provider that keeps failing.
const original = globalThis.fetch;
const LIMIT = +process.env.FETCH_TIMEOUT_MS || 30000;
if (typeof original === 'function' && !original.qpTimeout) {
  const timed = (input, init) => (init?.signal ? original(input, init) : original(input, { ...(init || {}), signal: AbortSignal.timeout(LIMIT) }));
  timed.qpTimeout = true;
  globalThis.fetch = timed;
}
