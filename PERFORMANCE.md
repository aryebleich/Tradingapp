# Performance

How Brightolio stays fast for many people at once on the Oracle server (2 cores, 12 GB, Always Free),
the targets, and the measurements.

## Targets

Checked by `scripts/perf-targets.mjs` at the end of every load test:

- p95 under **300 ms** for cached routes (static files, the app shell, and API answers served from a shared cache);
- p95 under **800 ms** for every other route;
- **no shed** answers and **no 5xx**;
- Lighthouse mobile performance **90+** on the sign-in page, the dashboard, the scanner and a stock page.

## How it is built

| Part | Where | What it does |
|---|---|---|
| One process per core | `cluster.js`, `src/bus.js`, `deploy/vm/compose.yml` | The leader (port 3000) holds everything stateful: jobs, streams, webhooks, sign-in, orders and Admin. The helpers (3001+) serve pages, static files and the rest of the API. Caddy spreads requests across them. |
| CPU pool | `src/cpu.js`, `src/cpu-worker.js`, `src/cpu-tasks.js`, `src/baskets-math.js` | Backtests, the optimizer, Monte Carlo, walk-forward, basket backtests, the landing-page demo and the pairs and dividend math run in worker threads (pure modules only), so a long calculation never delays anybody's page. `CPU_THREADS` sets the size. |
| Shared caches | `src/memo.js` (`dbCached`) | Database-backed cache with a memory front. Data that lives 5 minutes or more is served stale while one refresh runs. |
| Shared cache for market-wide data | `src/shared-cache.js` | Movers, most actives and the latest news are kept 60 s; the last answer is served for 10 more minutes while one refresh runs. A desk quote is shared per symbol for 1 s. |
| Time limit on every outside call | `src/fetch-timeout.js` | `FETCH_TIMEOUT_MS`, default 30 s. |
| Load shedding | `src/reliability.js` | Optional routes are refused first when the server is overloaded. Response times per route appear in `/internal/load` and Admin → Hosting. |
| Indexes | `src/db.js` | 131 indexes. READS_AUDIT.md lists the reads they serve. |

## The load test

`.github/workflows/load-test.yml` (manual) runs `scripts/loadtest-live.mjs` against the Oracle server's own address:

1. A real browser opens 9 common pages with the paper-only load-test account and records every GET.
2. 200 simulated people replay those calls for 60 s.

It never places an order. Lighthouse runs too, through `scripts/lighthouse-live.mjs`.

## Measurements

### 2026-11-25, commit de9ee64 (before the shared market-data cache)

- **Throughput:** 34,949 requests in 61 s, 568 per second, by 200 people.
- **Response times:** p50 71 ms, p95 1,207 ms, p99 1,485 ms (API p95 1,280 ms, static p95 226 ms, pages p95 137 ms).
- **Errors:** 0 errors, 0 shed, no 5xx. There were 1,285 answers of 429: the per-user market-data limit on the one test account.
- **Server:** 2 cores, load 0.04 before and 0.05 after. The heap grew from 36 MB to 158 MB, and event-loop lag stayed around 10 ms. The CPU was idle: the slow routes were waiting on outside data providers.
- **Targets missed:**
  - `/api/desk/quote/:x`: p95 about 1.7 s (a provider call on every request);
  - `/api/alpaca/data/{movers,most-actives,news}` and `/api/news/sentiment`: p95 about 1.3–1.4 s (no cache: every call went to Alpaca);
  - `/api/stock/AAPL/card`: p95 4.7 s (a cold cache on the first calls);
  - `/api/market/overview`: p95 392 ms;
  - the font file: p95 364 ms.
- **Lighthouse:** did not run, because the script passed `npx --yes lighthouse@12` as a single program name. Fixed.
- **Changes that followed:** the shared market-data cache (above), the shared 1-second desk quote, and the Lighthouse fix.

### After the shared cache

See the newest section of CHANGELOG_AI.md. Each load test also keeps its JSON as a workflow artifact for 30 days.

## Still to do

- Precompute the stock card for the most-viewed symbols, so its first call is never cold.
- Serve the font from the cache headers Caddy already sets, or preload it.
- Run the load test through app.brightolio.com once the DNS points straight at the server.
