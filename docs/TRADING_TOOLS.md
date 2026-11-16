# Trading tools: gap analysis, how each new tool works, release package

Branch `feature/trading-tools`. Nothing is deployed and every flag is off. Decisions: [DECISIONS.md](../DECISIONS.md).
Legal and compliance review: [COMPLIANCE_REVIEW.md](../COMPLIANCE_REVIEW.md).

## 1. Gap analysis

The inventory comes from the app's menu (`public/app.js`, `NAV`) and the server modules. The comparison is
with the standard tool set named in the brief. **No competitor is named and no competitor feature is claimed**:
public documentation could not be fetched from the build environment (DECISIONS.md D-3).

| Tool | Exists? | Gap severity | Effort | Risk level | Recommendation |
|---|---|---|---|---|---|
| Charting (indicators, drawings, replay) | Yes: Chart, chart co-pilot | None | – | – | Keep |
| Watchlists | Yes: Watchlists, theme to watchlist | None | – | – | Keep |
| Screeners | Yes: Scanner, New leaders, stat-arb scan | Low | – | Low | Keep; show each scan's rules on its page (not checked here) |
| Alerts | Yes: price alerts, alerts to trades, signal fleet | None | – | – | Keep |
| Order preview | Yes: order desk (costs, slippage, sell check) | None | – | High (order entry) | Not touched (hard rule 1) |
| P&L and position analytics | Yes: Positions, Insights & journal, Home P&L explanation | Low | – | – | Keep |
| **Position-size calculator** | Partial: only inside Short selling | **High** | S | Low | **Built** (flag `tools_sizing`) |
| **Risk / reward planner with ATR stop** | No | **High** | S | Low | **Built** (flag `tools_rr`) |
| Economic calendar (macro releases) | No: Calendar has earnings and IPOs only | Medium | M | Low | **Not built**: needs a release-dates data source [PLACEHOLDER: provider and licence]; dates must not be invented |
| **Sector heatmap** | No | Medium | S | Low | **Built** (flag `tools_heatmap`, needs live data) |
| News | Yes: News & sentiment, AI news tools | None | – | Medium | Keep; see compliance flag on "News to trades" |
| Options analysis | Yes: Options desk, Options lab, payoff, expected move | None | – | – | Keep |
| Portfolio analytics | Yes: Portfolio & risk | Low | – | – | Keep |
| **Concentration explained in plain language** | No | Medium | S | Medium (AI) | **Built** as a guarded AI tool (flag `ai_portfolio_explainer`) |
| **Indicator explained, educational** | Partial: Learning center, glossary | Low | S | Medium (AI) | **Built** as a guarded AI tool (flag `ai_indicator_explainer`) |
| Trade journal | Yes: Insights & journal | None | – | – | Keep |
| Scenario / what-if | Yes: AI tools, What-if scenarios | None | – | Medium | Keep; add the AI guard (next row) |
| **Guardrails on the existing AI tools** (advice blocking, kill switch, compliance log) | No | **High** | M | High | **Not changed** (outside "new tools"); recommend routing the existing AI tools through `src/tradetools/aiguard.js`: **Review required** |

## 2. Tools built (all behind flags, all default off)

| Tool | Route | Flag | Data | Status |
|---|---|---|---|---|
| Position size | `POST /api/tools/size`, `#/tradetools?tab=sizing` | `tools_sizing` | what the user types | Built, tested; ready for staging |
| Risk / reward + ATR stop | `POST /api/tools/rr` | `tools_rr` | what the user types; daily bars (read-only) for ATR | Built, tested |
| Sector heatmap | `GET /api/tools/heatmap` | `tools_heatmap` | Alpaca snapshots (read-only), data label | Built, tested against the mock; needs live data on staging |
| Portfolio concentration explainer (AI) | `POST /api/tools/ai/portfolio` | `ai_portfolio_explainer` | holdings the user enters or fills from positions (read-only) | Built, guarded, eval passed; legal review before release |
| Indicator explainer (AI, educational) | `POST /api/tools/ai/indicator` | `ai_indicator_explainer` | daily bars (read-only) | Built, guarded, eval passed; legal review before release |

None of them places, changes or cancels an order or moves money. No order-placing module was built.

## 3. How each tool works (plain language; the same rules the code uses, `src/tradetools/math.js`)

**Position size.** You give your account size, the share of it you are prepared to lose on this trade, your entry
and your stop. The amount you risk is account size times that share. The risk per share is the gap between entry
and stop. Shares = amount at risk ÷ risk per share, rounded **down** to whole lots, and never more than the largest
position you allow (that share of the account ÷ entry price). The page shows every step. Example: $10,000, 1%,
entry 50, stop 48: $100 at risk, $2 per share, 50 shares, $2,500 position. A stop can fill worse than its price in a gap.

**Risk / reward.** Risk per share = |entry − stop| plus any costs. For each target, reward = distance to the target
minus costs, and R = reward ÷ risk. The win rate needed to break even at R is 1 ÷ (1 + R). With your own win rate p,
expectancy per trade = p × R − (1 − p), in units of risk. Example: entry 100, stop 95, target 110: R = 2, break-even win
rate 33.3%. These ratios say nothing about how likely a target is.

**ATR stop.** True range for a day = the largest of high − low, |high − previous close| and |low − previous close|.
The 14-day ATR starts as the average of the first 14 true ranges, then each day ATR = (previous ATR × 13 + today's
range) ÷ 14 (Wilder's method). The stop is a chosen number of ATRs (default 2) below the entry for a long, above it
for a short. If there are fewer than 15 daily bars, no ATR is shown.

**Sector heatmap.** Each S&P 500 sector is represented by its Select Sector SPDR fund (XLK, XLF, …). Change = latest
price ÷ previous close − 1. Tiles are ordered by change, each with ▲ / ▼ and the number (not colour alone), its price
and how old that price is. The label says where prices come from: "IEX feed" (one exchange, can differ from other
exchanges), "consolidated (SIP)", or "delayed / end-of-day" when live data is not set up (the heatmap is then off).

**Concentration explainer.** Each holding's weight = its value ÷ the total. Shown: the share in the largest 1, 3 and 5
holdings, the Herfindahl-Hirschman index (the sum of squared weights, from near 0 for spread out to 1 for a single
holding) and 1 ÷ index, "about this many equally sized holdings". AI (when set up and allowed to see account figures,
Admin → AI & privacy) explains these numbers; otherwise a fixed text does. It does not say what to buy or sell.

**Indicator explainer.** RSI(14), MACD(12, 26, 9), 50 / 200-day averages and Bollinger bands (20, 2) are computed from
daily closes with the formulas in `src/ta.js`, then explained. Every explanation says the indicator describes past
prices and does not predict.

## 4. The AI guard (`src/tradetools/aiguard.js`)

1. **Kill switch**: `AI_TOOLS_KILL=all` or `=portfolio,indicator` in the environment, or `PUT /api/admin/tools/kill
   {tool, killed}` (admin). Checked on every request; the tool answers 503 at once.
2. **Prompt check**: 15 patterns refuse requests for a trade, a pick, a verdict, a prediction, a price target, a promise,
   an allocation or a rule bypass, before any AI call.
3. **AI with facts only**: the system prompt forbids recommendations, predictions and promises; the AI sees only figures
   the server computed. No AI provider, or account figures not allowed → rule-based text.
4. **Output check**: 11 patterns block answers that tell the user what to do, recommend, name a security with a trade
   verb, rate, time the market, predict, give a price target or promise. Key points are checked too, and so is the
   rule-based text.
5. **Labels**: every answer says whether AI or fixed rules wrote it, carries the disclaimer ("not investment advice, may
   be wrong, capital at risk") and lists its data sources.
6. **Compliance log** `ai_compliance_log`: tool, keyed hash of the user, redacted question and answer (e-mails, phones,
   money amounts and long numbers removed), outcome, reason, model, time. Holdings and balances are not stored. Kept
   `AI_LOG_RETENTION_DAYS` (default 1,095). Read with `GET /api/admin/tools/log`.

**Release gate (adversarial evaluation, `test/tradetools.test.js`)**: 38 adversarial prompts must all be refused
without calling the AI; 21 advice-giving outputs must all be blocked; 11 educational questions and 10 explanations must
pass (false-positive check). Current result: **all pass**. Pattern checks can miss new phrasings; that is why the
log, the kill switch and staged rollout exist. Add every missed phrasing found in the log to the test set before widening.

## 5. Test results

| Suite | Command | Result |
|---|---|---|
| Unit and route tests (whole app) | `npm test` | 285 passed, 0 failed, 3 todo (pre-existing review items) |
| Trading tools: maths vs worked examples, routes behind flags, guard, kill switch, log redaction, adversarial eval | `node --test test/tradetools.test.js` (part of `npm test`) | 18 passed |
| Browser: components, keyboard, disclaimers, data labels, refusal, WCAG checks, phone width, flag on / off | `npm run tools:ui` | all 11 checks passed |
| Clean check | `npm run clean` | passed |

Not tested: a real AI provider's answers (tests use a fake AI and the rule-based path), live market data (the Alpaca
mock is used), screen readers by a person, colour contrast with a measuring tool.

## 6. Release package

### Staging deployment

1. Create a staging service (a second Render service, or any host) from branch `feature/trading-tools` with its **own
   database**, `NODE_ENV=production`, `ENCRYPTION_KEY`, Alpaca **paper** keys and market-data keys, and optionally an AI
   provider key. No live brokerage keys.
2. Sign in as the owner on staging: Admin → SEO → Feature flags: switch on the five flags at 100% (staging has only
   internal users).
3. Run the smoke test below. Read `GET /api/admin/tools/log` after the AI checks.

### Smoke-test checklist (staging)

- [ ] Flags off: no "Planning tools" in the menu; `/api/tools/size` answers 404.
- [ ] Position size: $10,000 / 1% / 50 / 48 gives 50 shares; a stop above the entry for a long is refused in words.
- [ ] Risk / reward: 100 / 95 / 110 gives R 2 and 33.3%; with a liquid symbol the ATR stop and its data label appear.
- [ ] Heatmap: 11 sectors, a data label (IEX, SIP or delayed), price ages; refresh works.
- [ ] Portfolio explainer: "Fill from my positions" (paper account) works; the answer is labelled AI or rules, has
      sources and the disclaimer; "Should I sell X?" is refused.
- [ ] Indicator explainer: RSI for a liquid symbol explains the reading as educational; "will it go up?" is refused.
- [ ] Kill switch: `PUT /api/admin/tools/kill {"tool":"all","killed":true}` makes both AI tools answer 503 at once; switch back.
- [ ] The compliance log has one row per AI call, with no amounts, e-mails or phone numbers.
- [ ] Keyboard only and a screen reader on each tab; phone width; light and dark theme.
- [ ] `npm test` and `npm run tools:ui` green on the branch.

### Flag rollout (each step gated on COMPLIANCE_REVIEW.md sign-off for that tool)

| Step | Who | How | Gate to move on |
|---|---|---|---|
| 1. Internal | the owner and admins, on **staging** | flags on at 100% on staging | smoke test passed; legal sign-off on the tool's row |
| 2. Small share | real users | production flag on at **5%** (percentage by user id, Admin → SEO → Feature flags) | 7 days with no blocked-output spikes, error rate < 1%, no complaints; log reviewed |
| 3. Wider | real users | 25%, then 50% | same, 7 days each |
| 4. Full | everyone | 100% | sign-off recorded in COMPLIANCE_REVIEW.md |

The calculators (sizing, risk / reward, heatmap) can go first; the AI tools only after the legal items marked on them.
The flag system targets a percentage of users, not named people: "internal first" is done on staging (DECISIONS.md D-6).

### Rollback, per tool

| Tool | Rollback |
|---|---|
| Any calculator | Switch its flag off: the tab and the menu entry disappear on the next page load and its route answers 404. Nothing is stored, so nothing to undo. |
| AI explainers | Instant: kill switch (`PUT /api/admin/tools/kill` or `AI_TOOLS_KILL=all` and restart); then switch the flag off. The compliance log stays for review. |
| All of it | Revert the merge commit of `feature/trading-tools`. The `ai_compliance_log` table is left (harmless); drop it only after the retention period. |

### Monitoring and alerts

What is recorded (existing analytics table `traffic`, `count(kind, key)`): `tool` = `sizing:used`, `rr:used`,
`heatmap:used`; `ai_tool` = `<tool>:ai | rules | blocked_prompt | blocked_output | killed`; `ai_latency` =
`<tool>:<1s | 1-3s | 3-10s | >10s`. Page views of `tradetools` come from the existing route tracking.

| Alert | Rule | Where |
|---|---|---|
| AI answers blocked | `blocked_output` > 2% of AI answers in a day → review the log, consider the kill switch | `SELECT key, SUM(n) FROM traffic WHERE kind = 'ai_tool' AND day = date('now') GROUP BY key` |
| Advice requests | a sudden rise in `blocked_prompt` → check the page wording | same query |
| Errors | 5xx on `/api/tools/*` > 1% of requests in 15 minutes | host logs / uptime monitor |
| Latency | `>10s` bucket > 5% of AI calls | `kind = 'ai_latency'` |
| Data freshness | heatmap prices older than 30 minutes in market hours | the tile ages on the page; add a synthetic check on staging |

Alert delivery (e-mail, pager) is not built; the queries above are ready for whichever monitor you use [PLACEHOLDER: alerting tool].
