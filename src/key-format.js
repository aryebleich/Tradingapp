// What a key looks like, so a value saved in the wrong place is caught (Part 1 of the OpenAI brief).
// Only the prefix is ever looked at, never the value itself. Pure functions: the key store calls them.
//   "sk-"      an API key (OpenAI keys start with sk-, for example sk-proj-)
//   "whsec_"   a webhook signing secret (Standard Webhooks, used by OpenAI and others)
// Rules: a signing secret is refused in an API-key field, and an API key is refused in a signing-secret field.

export const kindOf = value => {
  const v = String(value ?? '').trim();
  if (/^whsec_/.test(v)) return 'whsec';
  if (/^sk-/.test(v)) return 'sk';
  return null;
};

const isApiKeyField = name => /_API_KEY$/.test(name);
const isSecretField = name => /_WEBHOOK_SECRET$/.test(name);

// { ok: true } or { ok: false, message } for a value being saved under a name.
export function checkFormat(name, value) {
  const kind = kindOf(value);
  if (kind === 'whsec' && isApiKeyField(name)) {
    const target = name.replace(/_API_KEY$/, '_WEBHOOK_SECRET');
    return { ok: false, message: `That is a webhook signing secret (it starts with whsec_), not an API key. Save it in ${target} instead.` };
  }
  if (kind === 'sk' && isSecretField(name)) {
    const target = name.replace(/_WEBHOOK_SECRET$/, '_API_KEY');
    return { ok: false, message: `That is an API key (it starts with sk-), not a webhook signing secret. Save it in ${target} instead.` };
  }
  return { ok: true };
}

// Where a value saved under the wrong name belongs, or null when it is in the right place.
export function misfileTarget(name, value) {
  const kind = kindOf(value);
  if (kind === 'whsec' && isApiKeyField(name)) return name.replace(/_API_KEY$/, '_WEBHOOK_SECRET');
  if (kind === 'sk' && isSecretField(name)) return name.replace(/_WEBHOOK_SECRET$/, '_API_KEY');
  return null;
}

// The warnings Admin → Keys and Admin → AI show about the OpenAI keys. getValue(name) returns the
// current values (passed in, never shown; only the state is reported). movedFrom: true when a
// signing secret was moved out of OPENAI_API_KEY at start.
export function openAIWarnings({ apiKey = '', signingSecret = '', movedFrom = false } = {}) {
  const out = [];
  const kind = kindOf(apiKey);
  if (kind !== 'sk') {
    if (kind === 'whsec' || movedFrom) {
      out.push('The OpenAI API key is missing (the value saved was a webhook signing secret). Add your API key from platform.openai.com → API keys.');
    } else if (!String(apiKey).trim()) {
      out.push('The OpenAI API key is missing. Add your API key from platform.openai.com → API keys.');
    } else {
      out.push('The OpenAI API key does not look like an API key (it should start with sk-). Check it in Admin → Keys.');
    }
  }
  if (!String(signingSecret).trim()) out.push('The OpenAI webhook signing secret is not set, so OpenAI events are refused. Save it in OPENAI_WEBHOOK_SECRET (starts with whsec_).');
  return out;
}
