# BUG_REPORT.md: Phase 1B

Status: approved and worked. Auto bugs are fixed, each with a test written first (`test/bugfixes.test.js`) and its own commit. Review bugs are not fixed: each has a "todo" test that shows it, and waits for a decision.

How the sweep was done: code search over `src/`, `server.js` and `public/`; the browser sweep of 109 app pages at desktop and phone width (console errors, failed requests, overflow); 246 unit tests and 435 end-to-end checks (all passing at commit f17b7b9); and `npm audit --omit=dev` (0 known vulnerabilities).

Fix type: **Auto** = safe for me to fix with a failing test first. **Review** = touches order entry, margin, balances, billing, auth or compliance, so it is documented only.

| ID | Sev | Category | Where | Reproduce | Impact | Proposed fix | Type | Status |
|---|---|---|---|---|---|---|---|---|
| BUG-001 | High | Security (XSS) | `public/pages/pnlwhy.js:20`, `public/pages/riskpages.js:81`, `public/pages/analytics.js:270`, `public/pages/instruments.js:75`, `public/pages/protect.js:157` | A news item with `url: "javascript:…"` from a data feed renders as a clickable link (`esc()` escapes quotes but not the URL scheme). | A compromised or spoofed news feed could run script in a signed-in session. | Use the existing `safeUrl()` (only `http`/`https`, as in `trading.js:22`), moved into a shared helper. | Auto | Fixed (ae87bae) |
| BUG-002 | Medium | Privacy / data at rest | `public/app.js:43-44` (`qp_keep`) | Sign in, open Positions and Home, close the tab without signing out: up to 60 API answers (balances, positions, orders) stay in `localStorage` for 24 h. | Account data readable on a shared computer. Cleared on sign-out or a 401, not on session end. | Store only non-financial paths, or use `sessionStorage`, or encrypt with a per-session key. This is a product choice (it speeds start-up). | Review | Review required: not fixed, decision needed |
| BUG-003 | Medium | Race condition (margin) | `src/brokers.js:321` | Two practice buy orders at once with margin on: `marginRoom` is worked out before the transaction, so both can pass and exceed Reg T 2x. | Practice account only, but the margin logic is wrong. | Recompute the room inside `recordFill`'s check. | Review (margin logic) | Review required: not fixed, decision needed |
| BUG-004 | Medium | Billing correctness | `src/pnlwhy.js:146` | Early refresh while market data or the AI fails: credits are spent before `analyze()` runs. | The user pays 2 credits for a failed refresh. | Spend after success, or refund on error. | Review (billing) | Review required: not fixed, decision needed |
| BUG-005 | Medium | Order-entry UX safety | `public/pages/optionsdesk.js:102` | Options "Buy/Sell to open" uses `window.confirm`, not the app's secure confirm used for other real-money orders (the server step-up still applies). | Weaker confirmation for options orders. | Use `H.secureConfirm` with the order summary. | Review (order entry) | Review required: not fixed, decision needed |
| BUG-006 | Low | Privacy | `src/analytics.js:21` | Visitor hash = sha256(day + IP + user agent) with no secret; IPv4 space can be brute-forced. | The daily visitor hash could be reversed to an IP. | Add a server secret (HMAC with a random key rotated daily). | Auto | Fixed (17d3957) |
| BUG-007 | Low | Data accuracy | `src/aitools.js:123` | Theme to watchlist with market data off: AI-suggested tickers are not verified. | A watchlist may include a ticker that does not trade. | Mark them "not checked" when data is off. | Auto | Fixed (212cf3c) |
| BUG-008 | Low | Performance | `scripts/home.py:307` (hero `<img fetchpriority="high">`) | The still image downloads first, then is hidden by the live dashboard. | About 56 KB wasted on the largest-paint path. | Drop `fetchpriority` when the live hero will run; keep the image for no script. | Auto | Fixed (5673111) |
| BUG-009 | Low | Performance | `public/index.html` (`<script src="config.js">`) | Classic script without `defer`. | Small render block. | Add `defer` (`site.js` is a module and runs after it). | Auto | Fixed (b4bc2b1) |
| BUG-010 | Low | Resource | `public/pages/bell.js:29` | `setInterval(tick, 30000)` is never cleared. | Intended (the header bell lives for the session); listed for completeness. | None, or pause while the tab is hidden. | Auto | Deferred (by design) |
| BUG-011 | Low | Abuse / resource | `src/logos.js` | Requests for many made-up tickers make the server fetch up to 3,000 logos (each cached for a week). | Outbound requests from the server. | Rate-limit `/logo` per IP; cache misses for a day (already: badge for 1 day). | Auto | Fixed (3fc5b4d) |
| BUG-012 | Medium | Accessibility (WCAG 2.2.2) | `public/site.js` (live hero) | The homepage dashboard animates indefinitely; no pause control (reduced-motion users get a still view). | Distraction; fails AA "Pause, Stop, Hide". | Add a visible pause/play button. | Auto | Fixed (ebe63e5) |
| BUG-013 | Medium | Accessibility (WCAG 1.2) | `scripts/home.py` ad video | Video with on-screen text; no captions or transcript. | Fails AA for prerecorded media. | Add `<track kind="captions">` and a transcript link. | Auto | Fixed (49ef902) |
| BUG-014 | Low | SEO | `public/index.html` | No JSON-LD (Organization, FAQPage). | Weaker search results. | Add verified-facts-only JSON-LD. | Auto | Fixed (940acdd) |

Checked and found clean:
- Tokens: session cookies are httpOnly; no auth tokens in `localStorage`.
- CSRF: guard on every API (`X-Requested-With` + same-site cookie).
- Open redirects: the only `redirect` is a fixed path.
- No debug endpoints.
- No secrets in client code.
- No personal data in server logs from the code searched (`console.*` lines log messages only).
- 0 known dependency vulnerabilities.
- No console errors or failed requests across 109 pages.
- No horizontal overflow at 390 px after the batch 23 fixes.
- Gains and losses always carry a sign (+/−), not color alone.

Not covered (needs other tools or access):
- Cross-browser runs in Safari and Firefox (only Chromium here).
- A real screen reader pass.
- Financial figures compared against live broker APIs (only mocks here).
- Websocket reconnect under a real network drop.
