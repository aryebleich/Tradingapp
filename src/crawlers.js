// AI crawlers and the robots.txt built from the owner's choices. No dependencies, so the GitHub
// Pages build can write the same robots.txt (with the defaults: every AI crawler blocked).
export const CRAWLERS = {
  google: { name: 'Google Gemini', agents: ['Google-Extended', 'GoogleOther'], note: 'Gemini and Google\'s AI training. Google Search is set separately below.' },
  openai: { name: 'OpenAI ChatGPT', agents: ['GPTBot', 'OAI-SearchBot', 'ChatGPT-User'] },
  anthropic: { name: 'Anthropic Claude', agents: ['ClaudeBot', 'Claude-User', 'Claude-SearchBot', 'anthropic-ai'] },
  perplexity: { name: 'Perplexity', agents: ['PerplexityBot', 'Perplexity-User'] },
  commoncrawl: { name: 'Common Crawl', agents: ['CCBot'], note: 'A public web archive many AI models are trained on.' },
  apple: { name: 'Apple Intelligence', agents: ['Applebot-Extended'] },
  meta: { name: 'Meta AI', agents: ['Meta-ExternalAgent', 'meta-externalfetcher', 'FacebookBot'] },
  bytedance: { name: 'ByteDance', agents: ['Bytespider'] },
  amazon: { name: 'Amazon', agents: ['Amazonbot'] },
  others: { name: 'Other AI crawlers', agents: ['cohere-ai', 'Diffbot', 'YouBot', 'DuckAssistBot', 'MistralAI-User', 'Timpibot', 'ImagesiftBot'] },
};
// Never open to any crawler.
export const PRIVATE_PATHS = ['/app', '/api/', '/admin', '/auth/', '/oauth/', '/twilio/', '/webhooks/', '/mcp'];
export const DEFAULTS = {
  allow: Object.fromEntries(Object.keys(CRAWLERS).map(k => [k, false])),
  search: true, // Google Search, Bing and others may list the public pages
  llms: 'QuantPocket is software for testing, paper trading and automating stock strategies on your own brokerage account. It is not a broker or an investment adviser. Website: the homepage, Terms, Privacy and Risk Disclosure pages.',
  llmsOn: false,
  accountData: 'private', // 'private': only to providers that do not train on it · 'always' · 'never'
};
export function robotsTxt(s = DEFAULTS) {
  const lines = ['# Set in QuantPocket Admin → AI & privacy.', ''];
  const blockedAgents = Object.entries(CRAWLERS).filter(([k]) => !s.allow[k]).flatMap(([, c]) => c.agents);
  const allowedAgents = Object.entries(CRAWLERS).filter(([k]) => s.allow[k]).flatMap(([, c]) => c.agents);
  if (blockedAgents.length) lines.push('# AI crawlers: not allowed to read or train on this site.', ...blockedAgents.map(a => `User-agent: ${a}`), 'Disallow: /', '');
  if (allowedAgents.length) lines.push('# AI crawlers allowed on the public pages.', ...allowedAgents.map(a => `User-agent: ${a}`), ...PRIVATE_PATHS.map(p => `Disallow: ${p}`), 'Allow: /', '');
  lines.push('# Everyone else (search engines).', 'User-agent: *', ...(s.search ? PRIVATE_PATHS.map(p => `Disallow: ${p}`) : ['Disallow: /']), '');
  return lines.join('\n');
}
