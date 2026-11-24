// One scheduled backup in its own process at the lowest CPU priority (src/backup.js startBackups),
// so the online backup, its integrity check and the off-site upload never slow a request.
import os from 'node:os';
try { os.setPriority(19); } catch { /* not allowed here: it still runs outside the request processes */ }
process.env.QP_ROLE = 'helper'; // never tidies or runs background work
const B = await import('../src/backup.js');
try { const r = await B.backupNow({ kind: process.argv[2] || 'hourly' }); console.log(`backup ${r.file}: ${r.bytes} bytes in ${r.ms} ms`); process.exit(0); }
catch (e) { console.error('backup failed:', e.message); process.exit(1); }
