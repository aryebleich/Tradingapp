// The ranked setup list for Admin → Setup (Part A6). Each setting the site can use becomes a task
// with its status, why it matters, how long it takes, and the page that does it. Tasks are ranked:
// blockers first (things that break the site or money flows), then what unlocks the most revenue or
// users, then quick wins, then nice-to-haves. Values are never included: only names and on/off.
// Pure functions, so the order can be tested (test/setuptasks.test.js).

export const TIERS = ['blocker', 'revenue', 'quick', 'nice'];
const TIER_LABEL = { blocker: 'Blocker', revenue: 'Unlocks revenue or users', quick: 'Quick win', nice: 'Nice to have' };
export { TIER_LABEL };

// Meta for each setting, keyed by the environment variable names shown in Admin → Setup.
// why: one plain sentence. min: rough minutes. go: the Admin page or action that does it.
const META = {
  ENCRYPTION_KEY: { tier: 'blocker', why: 'Keeps every stored key and secret encrypted. Without it the key store cannot open.', min: 2, go: '#/admin-keys' },
  'PERSISTENT_DISK or DATABASE_URL': { tier: 'blocker', why: 'Your data must live on a disk that survives restarts (or a shared database), or it is lost.', min: 5, go: '#/admin-database' },
  ADMIN_EMAIL: { tier: 'blocker', why: 'Without an admin email nobody can open Admin or approve money-moving changes.', min: 1, go: '#/admin-keys' },
  'NODE_VERSION / .node-version': { tier: 'blocker', why: 'The server must run a patched Node.js version.', min: 5, go: '#/admin-hosting' },
  'STRIPE_SECRET_KEY': { tier: 'revenue', why: 'Turns on paid plans and card payments.', min: 15, go: '#/admin-keys' },
  'STRIPE_WEBHOOK_SECRET': { tier: 'revenue', why: 'Stripe tells the site about payments only through this signed webhook.', min: 5, go: '#/admin-keys' },
  'BROKER_API_KEY, BROKER_API_SECRET': { tier: 'revenue', why: 'Lets people open a brokerage account inside the app.', min: 30, go: '#/admin-keys' },
  'ALPACA_KEY_ID, ALPACA_SECRET': { tier: 'blocker', why: 'Market prices and the paper account depend on this.', min: 5, go: '#/admin-data' },
  'ALPACA_OAUTH_CLIENT_ID, ALPACA_OAUTH_CLIENT_SECRET': { tier: 'revenue', why: 'Lets existing Alpaca customers connect their account.', min: 20, go: '#/admin-keys' },
  'GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET': { tier: 'revenue', why: 'One-tap sign-in with Google brings in more sign-ups.', min: 10, go: '#/admin-keys' },
  'GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET': { tier: 'quick', why: 'Sign-in with GitHub, a second option for developers.', min: 10, go: '#/admin-keys' },
  RESEND_API_KEY: { tier: 'blocker', why: 'Password-reset emails cannot be sent without it: people get locked out.', min: 10, go: '#/admin-setup' },
  EMAIL_FROM: { tier: 'blocker', why: 'Emails must come from a domain you verified, or they land in spam or are refused.', min: 15, go: '#/admin-setup' },
  'TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM': { tier: 'quick', why: 'Text-message alerts and sign-in codes by text.', min: 15, go: '#/admin-keys' },
  'GROQ_API_KEY / GEMINI_API_KEY': { tier: 'quick', why: 'A free AI assistant. Free tiers have limits.', min: 5, go: '#/admin-agents' },
  ANTHROPIC_API_KEY: { tier: 'nice', why: 'The paid, higher-quality AI assistant. Optional.', min: 5, go: '#/admin-agents' },
  RENDER_API_KEY: { tier: 'nice', why: 'Keeps keys in sync with the old Render host. Not needed on Oracle.', min: 5, go: '#/admin-keys' },
};
const ORDER = { blocker: 0, revenue: 1, quick: 2, nice: 3 };

// Turns the settings list from /admin/setup into ranked tasks.
export function rankTasks(items = []) {
  const tasks = items.map(x => {
    const m = META[x.env] || {};
    const tier = m.tier || 'nice';
    const status = x.on ? 'done' : tier === 'blocker' ? 'attention' : 'todo';
    return { id: x.env, name: x.name, env: x.env, status, tier, why: m.why || '', min: m.min || 10, go: m.go || '#/admin-keys' };
  });
  // Open tasks first (in tier order), then done ones; within a tier, the quicker tasks first.
  tasks.sort((a, b) => {
    const da = a.status === 'done' ? 1 : 0, db = b.status === 'done' ? 1 : 0;
    if (da !== db) return da - db;
    if (ORDER[a.tier] !== ORDER[b.tier]) return ORDER[a.tier] - ORDER[b.tier];
    return a.min - b.min;
  });
  tasks.forEach((t, i) => (t.rank = i + 1));
  const done = tasks.filter(t => t.status === 'done').length;
  return { tasks, done, total: tasks.length, percent: tasks.length ? Math.round((100 * done) / tasks.length) : 100 };
}

// Setup status for the AI chat: the next open tasks, most important first.
export function nextTasks(ranked, n = 3) {
  return ranked.tasks.filter(t => t.status !== 'done').slice(0, n);
}
