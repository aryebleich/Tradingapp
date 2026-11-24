// Explaining a failed AI reply (the admin chat). Every failure gets a plain, specific reason naming the
// provider and, where it helps, the setting to check. Only the provider's name, a status code, a short
// code from the provider and a redacted, shortened message are used: never the key, never the text of
// the user's message, never the reply. Also the small helpers the reply stream uses: the keep-alive
// comment, and answering with the next model when the first one fails before any text.
import { redact } from '../aiaccess.js';
import { reasonOf } from './diagnose.js';

export const KEY_NAME = { openai: 'OPENAI_API_KEY', anthropic: 'ANTHROPIC_API_KEY', gemini: 'GEMINI_API_KEY', groq: 'GROQ_API_KEY', openrouter: 'OPENROUTER_API_KEY', custom: 'AI_API_KEY' };

// The provider's own short code (for example rate_limit_exceeded), kept only when it is a plain word.
const shortCode = e => {
  const c = String(e?.providerCode || '');
  return /^[a-z][a-z_]{2,40}$/.test(c) ? c : '';
};

// { text, code, status } for a failure. name: the provider's name; provider: its id (for the key name).
export function failureInfo(name, provider, e, { seconds = 60, midReply = false } = {}) {
  const r = reasonOf(e), st = e?.status || null, key = KEY_NAME[provider];
  const pc = shortCode(e), via = pc ? ` (${pc})` : '';
  let text;
  if (r.code === 'timeout') text = `${name} took too long to answer (timeout after ${seconds} s).`;
  else if (r.code === 'http-401' || r.code === 'http-403') text = `${name} refused the key (${st}). Check ${key || 'its key'} in Admin → Keys.`;
  else if (r.code === 'http-429-quota') text = `${name} is out of credit or over its quota (429)${via}. Add credit at ${name}, or pick another model.`;
  else if (r.code === 'http-429') text = `${name} is over its limit right now (429)${via}. Try again later, or pick another model.`;
  else if (r.code === 'http-404') text = `${name} does not have that model or address (404). Check the model in Admin → AI.`;
  else if (r.code === 'http-400') text = `${name} rejected the request (400)${via}.`;
  else if (st >= 500) text = `${name} had a server error (${st}). Try again, or pick another model.`;
  else if (r.code.startsWith('network')) text = midReply
    ? `The connection to ${name} closed during the reply. The text so far is kept.`
    : `${name} could not be reached from this server (${e?.cause?.code || 'network error'}). Try again, or pick another model.`;
  else text = `${name} did not answer: ${r.text}.`;
  // A short, redacted provider message for the log and the admin view (never the user's text).
  return { text: redact(text).slice(0, 400), code: r.code, status: st };
}
export const failureText = (name, provider, e, opts) => failureInfo(name, provider, e, opts).text;

// Sends a comment line (": ping") every interval ms while a reply is being written, so no proxy or
// browser closes an idle stream. Returns the function that stops it.
export function startPing(write, intervalMs = 15000) {
  const t = setInterval(() => { try { write(': ping\n\n'); } catch { /* the reply has ended */ } }, intervalMs);
  t.unref?.();
  return () => clearInterval(t);
}

// Tries the models in order. A model that fails before any text arrived is skipped (and reported);
// a failure after text has started is not retried: the text so far is kept and the failure is returned.
// run(candidate, onText) must resolve when the reply is complete, and reject on failure.
// Returns { answered: candidate, skipped: [{ candidate, error }] } or throws { skipped, error }.
export async function answerWithFallback(candidates, run, { onFail = () => {} } = {}) {
  const skipped = [];
  for (const c of candidates) {
    let started = false;
    try {
      await run(c, () => { started = true; });
      return { answered: c, skipped };
    } catch (error) {
      if (started || error?.name === 'AbortError') throw Object.assign(error, { skipped, failedAfterText: started && error?.name !== 'AbortError' });
      skipped.push({ candidate: c, error });
      onFail(c, error);
    }
  }
  const last = skipped.at(-1)?.error || new Error('No model is available');
  throw Object.assign(last, { skipped });
}
