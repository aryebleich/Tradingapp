// When the server is overloaded it may refuse an API call with 503 and { shed: true } (never a page,
// an order or sign-in; src/reliability.js). Such a call is tried again quietly, after the wait the
// server asks for (Retry-After, at most 8 seconds) and a little more each time, up to 3 times. Only
// then does the caller see an error, marked shed, which the app shows as a small note on the page.
export const SHED_TEXT = 'This is taking longer than usual. Trying again…';
const pause = ms => new Promise(r => setTimeout(r, ms));
// send() does one request and returns { status, retryAfter, data }; it is called again for a retry.
export async function withShedRetry(send, { tries = 3, sleep = pause, onWait } = {}) {
  for (let i = 0; ; i++) {
    const res = await send();
    if (!(res.status === 503 && res.data?.shed) || i >= tries) return res;
    const ra = Number(res.retryAfter) || 2;
    const wait = Math.min(8, ra) * 1000 * (1 + i * 0.5) + Math.floor(Math.random() * 400);
    onWait?.(i + 1, wait);
    await sleep(wait);
  }
}
