# System architecture

How the parts of Brightolio fit together. The feature-level map is docs/FEATURE_REGISTRY.md; performance details are in PERFORMANCE.md; hosting history is in MIGRATION_ORACLE.md. Nothing private is in this file (no addresses, accounts or keys).

## In one picture

```
 Browser / Android app / installable web app
   public/app.html + app.js (the shell: sign-in, menu, router, shared helpers)
   public/pages/*.js (one module per area, loaded lazily)   public/sw.js (cache of static files)
        │  HTTPS: JSON under /api, live updates over Server-Sent Events
        ▼
 Optional Cloudflare edge (edge/worker.js): caching, a backup copy for reads, rate limits
        ▼
 Caddy (TLS) → server.js on the Oracle VM
   cluster.js: one Node.js process per CPU core (src/bus.js roles: web workers + one leader)
   src/cpu.js: a worker-thread pool for backtests, optimizers and other heavy math
        │
        ├── src/db.js: libSQL (a SQLite file on the VM's disk); src/backup.js copies it off the server
        ├── Brokers: src/brokers.js (Alpaca and the built-in paper simulator), src/ext/brokers.js
        │   (Schwab, tastytrade, Tradier, TradeStation), src/alpaca/* (Trading, Broker and Data APIs)
        ├── Market data: src/datasources.js (quotes and history from several providers, in the
        │   owner's order), src/streams.js (WebSocket feeds), src/fundamentals.js (SEC XBRL)
        ├── AI: src/llm.js (one place for every model; free providers first), src/ai/router.js,
        │   src/ai-loop.js caps ($0 by default for per-use billing)
        ├── Payments: src/stripe-client.js, src/stripe-events.js (test mode until the owner)
        └── Messaging: src/notify.js, src/notify-user.js, src/sms-voice/* (texts, calls, email)
```

## The modules, by product

| Product (master plan) | Main modules | Pages |
| --- | --- | --- |
| Terminal | src/brokers.js, src/desk.js, src/paperorders.js, src/orderqueue.js, src/execution.js, src/optionsdesk.js, src/options.js | trading.js, orderdesk.js, public/chart.js, optionsdesk.js, optionslab.js |
| AI | src/llm.js, src/chat.js, src/aitrading.js, src/aitools.js, src/chartcopilot.js, src/research.js, src/aiplans.js, src/aiaccess.js | studio.js, aitools.js, aitrade.js |
| Scanner | src/scanner.js, src/engine.js (rule language), src/plainresearch.js, src/stock.js, src/aisignals.js | signals.js, growth.js |
| AutoTrade | src/engine.js, src/playbooks.js, src/rotation/*, src/aibots.js, src/signals.js, src/scheduler.js, src/jobs.js, src/risk.js | strategies.js, playbooks.js, build.js |
| Portfolio | src/consolidate.js, src/insights.js, src/portfoliorisk.js, src/tax.js, src/taxpilot.js, src/money.js, src/income.js, src/retirement.js | riskpages.js, money.js, retirement.js, wealth.js |
| Intelligence | src/intel.js, src/institutions.js, src/events.js, src/sentiment.js, src/rates.js, src/fundamentals.js | stock.js, invest.js |
| Social and Marketplace | src/profiles.js, src/fleet.js, src/market.js | social.js, profile.js |
| Academy | src/lessons.js, the guides | guides.js, guides-more.js, glossary.js, start.js |
| Developer Cloud | src/apiv1.js, src/mcp.js, src/agentic.js, src/code.js, src/quantconnect.js | — |
| Enterprise | src/business/*, src/books.js, src/statement.js (pieces only) | business.js |
| Security | src/auth.js, src/security.js, src/mfa-policy.js, src/crypto.js, src/keystore.js, src/reliability.js, src/trust.js | protect.js, owner.js |

## Data flow

1. **A quote:**
   - the browser asks /api/desk or a page route;
   - the server takes the first working source in the owner's order (src/datasources.js), caches it briefly, and labels it with its source and age;
   - live prices come over src/streams.js and the live channel (SSE).
2. **An order:**
   - the order ticket checks the session, the holding and the costs (src/desk.js);
   - the server checks the risk limits, the kill switch, the pattern-day-trader rule and maintenance mode (src/risk.js, src/pdt.js);
   - real-money orders need step-up confirmation (stepUpGuard in server.js);
   - automated orders go through the durable queue (src/orderqueue.js) with an idempotency key, then to the member's own broker.
   - Paper is the default; paper and live never mix (src/routingcheck.js checks it after every deploy).
3. **An automation:**
   - a strategy, bot or Playbook is saved with its rules;
   - the scheduler (src/scheduler.js, src/jobs.js) claims each time slot once across processes;
   - it evaluates the rules on fresh data and places orders as in step 2, or asks for approval;
   - every run is logged with its reason.
4. **An AI answer:**
   - the page calls the AI route, which checks the plan's daily allowance and credits (src/credits.js) and what the AI may see (src/aiaccess.js);
   - src/llm.js calls the first available provider;
   - the answer comes back with its sources. AI never places a real order on its own: it prepares one, and the member confirms.

## Hosting

- **Server:** one Oracle Cloud VM (MIGRATION_ORACLE.md) runs Caddy and the app under systemd, with the database file on the VM's disk.
- **Deploys:**
  - every push to main runs release-gates.yml (audit, secrets scan, syntax, clean check, unit, end-to-end, the page gate, browser suites);
  - then deploy.yml, then the post-deploy checks, which roll back if the live site fails.
- **Address:** app.brightolio.com points to the VM. The optional Cloudflare edge (edge/) can sit in front.
- **Background work:**
  - one leader process per server runs the scheduler and the streams;
  - web workers serve requests;
  - heavy math runs in the CPU pool (PERFORMANCE.md).
- **Backups:** src/backup.js copies the database off the server; oracle-migrate.yml can restore.

## Brokers

Members connect their own accounts:
- **Alpaca:** API keys, OAuth, or accounts opened through the Broker API.
- **Schwab, tastytrade, Tradier and TradeStation:** OAuth (src/ext/brokers.js).

Keys are encrypted at rest (AES-256-GCM, src/crypto.js). Brightolio never holds client money: orders go to the member's own broker. The paper simulator (src/brokers.js) is the default account.

## AI

- **One place:** src/llm.js is the only place that calls a model.
- **Order of providers:** free providers come first (Groq, Gemini), then the paid ones the owner set up (OpenAI, Anthropic, xAI), each behind a monthly cap that is $0 by default for per-use billing (src/ai-loop.js, Admin → AI team).
- **Without a model:** every AI feature has a plain fallback that says so.
- **Rules for every answer:**
  - it explains its reasoning;
  - it shows the data and sources it used and how sure it is (registry A-19);
  - it never promises profits.

## Jobs

| Job | Where | When |
| --- | --- | --- |
| Scheduled orders, bots, price alerts, equity snapshots | src/scheduler.js | every minute in the leader |
| Playbooks, AI picks, AI signals, scans | src/jobs.js, src/scanner.js, src/newspicks.js, src/aisignals.js | their own schedules, claimed once |
| Status checks | src/trust.js | every 5 minutes |
| Backups | src/backup.js | daily |
| The AI loop | .github/workflows/ai-loop.yml | hourly |

## Where things are decided

- DECISIONS.md: architectural and product decisions.
- ASSUMPTIONS.md: assumptions.
- AGENTS.md: the development rules.
