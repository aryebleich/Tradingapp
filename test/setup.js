// Each test process gets its own throwaway database and no outbound market-data calls.
import os from 'node:os';
import path from 'node:path';
process.env.DB_FILE = path.join(os.tmpdir(), `qp-test-${process.pid}-${Date.now()}.db`);
process.env.FREE_DATA = 'off';
// Tests never reach a real AI service.
for (const k of ['GROQ_API_KEY', 'GEMINI_API_KEY', 'OPENROUTER_API_KEY', 'AI_BASE_URL', 'AI_API_KEY', 'AI_PROVIDER', 'AI_MODEL']) delete process.env[k];
// Parallel test files load the machine; load shedding is tested on its own (reliability.test.js).
process.env.SHED_AT = '1.01';
// Stand-in owner addresses and phone (the real ones exist only as fingerprints in src/site.js).
process.env.OWNER_HASHES = '05d59c3e64f67e5d1910ee1d1a42bece6495c57f9d12f6e07f2db4a2862a789f,331519fe73c2af5fd954005af89f91ede27cc65809784d7aae617006d71925e3,f4d519b67c0dc312416bf44a3b6abc53e46296363951fa28db195b3585c81b5b';
