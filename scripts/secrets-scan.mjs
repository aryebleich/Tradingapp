// Secret scan of the tracked files: private keys, live payment keys, cloud and GitHub tokens, and long
// literal values assigned to key/secret/token/password names. Placeholders and obvious test values are
// allowed. Exit code 1 on a finding (the finding is printed without the value).
//   node scripts/secrets-scan.mjs
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const files = execFileSync('git', ['ls-files', '-z']).toString().split('\0').filter(Boolean)
  .filter(f => !/^(node_modules|android\/.*\.(png|jpg|webp|apk)|public\/(fonts|media)|test\/golden|package-lock\.json)/.test(f) && !/\.(png|jpg|jpeg|webp|woff2?|mp4|webm|ico|apk|pdf)$/i.test(f));
const RULES = [
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/],
  ['Stripe live key', /\b(?:sk|rk)_live_[A-Za-z0-9]{16,}/],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['GitHub token', /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}/],
  ['Slack token', /\bxox[abprs]-[A-Za-z0-9-]{20,}/],
  ['Anthropic or OpenAI key', /\bsk-(?:ant-)?[A-Za-z0-9_-]{32,}/],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/],
];
// name = "long literal" (not an env lookup, placeholder or test value)
const ASSIGN = /\b(?:api[_-]?key|secret|token|passw(?:or)?d|private[_-]?key)\w*\s*[:=]\s*['"]([A-Za-z0-9+/_=-]{24,})['"]/i;
const OK = /(example|placeholder|changeme|xxxx|test|dummy|fake|sample|your[_-]|<|\$\{|process\.env|\.{3}|a{8,}|0{8,}|1234)/i;
const found = [];
for (const f of files) {
  let text; try { text = fs.readFileSync(f, 'utf8'); } catch { continue; }
  if (text.length > 2e6) continue;
  text.split('\n').forEach((line, i) => {
    for (const [name, re] of RULES) if (re.test(line) && !OK.test(line)) found.push(`${f}:${i + 1}: ${name}`);
    const m = ASSIGN.exec(line);
    if (m && !OK.test(line) && !/^(test|docs)\//.test(f)) found.push(`${f}:${i + 1}: long literal assigned to a secret-like name`);
  });
}
if (found.length) { console.log(found.join('\n')); console.log(`\n${found.length} possible secret(s). Move them to environment variables or Admin → Keys.`); process.exit(1); }
console.log(`No secrets found in ${files.length} tracked files.`);
