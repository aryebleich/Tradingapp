// Each test process gets its own throwaway database and no outbound market-data calls.
import os from 'node:os';
import path from 'node:path';
process.env.DB_FILE = path.join(os.tmpdir(), `qp-test-${process.pid}-${Date.now()}.db`);
process.env.FREE_DATA = 'off';
// Tests never reach a real AI service.
for (const k of ['GROQ_API_KEY', 'GEMINI_API_KEY', 'OPENROUTER_API_KEY', 'AI_BASE_URL', 'AI_API_KEY', 'AI_PROVIDER', 'AI_MODEL']) delete process.env[k];
// Parallel test files load the machine; load shedding is tested on its own (reliability.test.js).
process.env.SHED_AT = '1.01';
