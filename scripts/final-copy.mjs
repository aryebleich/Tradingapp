#!/usr/bin/env node
// The last copy of the old database, kept before anything of it is deleted:
//   node scripts/final-copy.mjs <pull.db>
// Encrypted like the backups (gzip + AES-256-GCM, key from BACKUP_KEY or ENCRYPTION_KEY), written to
// <data>/final/old-db-final-<date>.db.gz.enc, checked by decrypting it again (the same bytes), and
// sent to Oracle Object Storage when OCI_BACKUP_PAR_URL is set. Kept 90 days (src/backup.js prune).
// Prints one JSON line: { ok, file, bytes, sha256, offsite }.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { encryptBackup, decryptBackup, FINAL_DAYS } from '../src/backup.js';

export async function finalCopy(src, { now = new Date(), upload = true } = {}) {
  if (!process.env.BACKUP_KEY && !process.env.ENCRYPTION_KEY) throw new Error('No BACKUP_KEY or ENCRYPTION_KEY to encrypt the copy with');
  const raw = fs.readFileSync(src), sha = crypto.createHash('sha256').update(raw).digest('hex');
  const dir = path.join(path.dirname(src), 'final'); fs.mkdirSync(dir, { recursive: true });
  const name = `old-db-final-${now.toISOString().slice(0, 10)}.db.gz.enc`, out = path.join(dir, name);
  const enc = encryptBackup(raw); fs.writeFileSync(out, enc);
  const back = crypto.createHash('sha256').update(decryptBackup(fs.readFileSync(out))).digest('hex');
  if (back !== sha) throw new Error('the encrypted copy does not decrypt to the same file');
  let offsite = null;
  const par = process.env.OCI_BACKUP_PAR_URL;
  if (upload && par) {
    const r = await fetch(par.replace(/\/?$/, '/') + 'final/' + encodeURIComponent(name), { method: 'PUT', body: enc, headers: { 'content-type': 'application/octet-stream' }, signal: AbortSignal.timeout(300e3) });
    if (!r.ok) throw new Error(`Object Storage answered ${r.status}`);
    offsite = 'Oracle Object Storage: final/' + name;
  }
  return { ok: true, file: out, bytes: enc.length, sha256: sha, offsite, keepDays: FINAL_DAYS, until: new Date(now.getTime() + FINAL_DAYS * 864e5).toISOString().slice(0, 10) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const r = await finalCopy(path.resolve(process.argv[2] || 'data/pull.db')).catch(e => ({ ok: false, error: e.message }));
  console.log(JSON.stringify(r));
  process.exit(r.ok ? 0 : 1);
}
