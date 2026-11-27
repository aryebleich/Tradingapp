// Batch pull requests (AGENTS.md "Batch pull requests"): Grok or Codex collects the open task branches into
// one fresh pull request titled "BATCH-<date>: open tasks"; once it is merged, the sub-pull-requests it lists
// are closed (.github/workflows/batch-close.yml).
//   node scripts/ai-batch.mjs list                 the open ai/task-* pull requests (needs gh)
//   node scripts/ai-batch.mjs body <ID>#<n> ...    a description in the format the closer reads
//   node scripts/ai-batch.mjs included < body.md   the pull request numbers a description lists (JSON)
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const TITLE = /^BATCH-\d{4}-\d{2}-\d{2}: open tasks$/;
// "- AI-04B #67" lines only: a number mentioned anywhere else is never closed.
export function included(body = '') {
  const out = [];
  for (const m of String(body).matchAll(/^\s*-\s+([A-Z]+-\d+[A-Z]?)\s+#(\d+)\s*$/gm)) out.push({ task: m[1], pr: +m[2] });
  return out;
}
export const batchBody = items => ['Open tasks collected into one pull request (AGENTS.md, "Batch pull requests"). When it is merged, the sub-pull-requests below are closed with a link here, and their branches are deleted.', '', ...items.map(i => `- ${i.task} #${i.pr}`)].join('\n');

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === 'list') {
    const prs = JSON.parse(execFileSync('gh', ['pr', 'list', '--state', 'open', '--json', 'number,headRefName,title', '--limit', '100'], { encoding: 'utf8' }));
    console.log(JSON.stringify(prs.filter(p => /^ai\/task-/.test(p.headRefName)).map(p => ({ pr: p.number, branch: p.headRefName, task: p.headRefName.replace(/^ai\/task-/, '').toUpperCase(), title: p.title })), null, 2));
  } else if (cmd === 'body') {
    console.log(batchBody(rest.map(x => { const [task, pr] = x.split('#'); return { task, pr: +pr }; }).filter(x => x.task && x.pr)));
  } else if (cmd === 'included') {
    console.log(JSON.stringify(included(fs.readFileSync(0, 'utf8'))));
  } else { console.error('usage: ai-batch.mjs list|body|included'); process.exit(2); }
}
