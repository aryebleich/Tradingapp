# COMPLIANCE_REVIEW.md: trading tools (branch `feature/trading-tools`)

All tools are off by default and none places, changes or cancels an order or moves money. Jurisdiction assumed: US
retail; UK and EU listed where the same tool would need review there. Firm regulatory status is open
(LEGAL_REVIEW.md L6) and affects every row.

| Tool | What it does | Data used | Disclosures shown | Jurisdictions to review | Legal flag |
|---|---|---|---|---|---|
| Position size | Shares that keep the loss at the stop within a chosen % of the account | user inputs only | "For planning and education only. Not investment advice and not an order: nothing is sent to your broker. Investing involves risk…"; "A stop is not guaranteed to fill at its price" | US (FINRA 2210 if presented as a communication), UK FCA, EU | Low. A calculator on the user's own inputs. |
| Risk / reward + ATR stop | R multiples, break-even win rate, expectancy, an ATR-based stop | user inputs; daily bars (read-only) | same, plus the data-source label and "ratios do not estimate how likely a target is" | as above | Low. The ATR stop is a calculated level, not a suggestion; confirm the wording "puts the stop at". |
| Sector heatmap | Today's change for 11 sector funds | Alpaca snapshots (read-only), data label and price age | same, plus "Past moves do not predict future moves" | market-data licence terms (exchange display rules for IEX / SIP) | Low; **check the market-data display licence** for showing prices to users. |
| Portfolio concentration explainer (AI) | Explains concentration figures (largest holdings, HHI) in plain language | holdings the user enters or fills from their positions; not stored | AI label or "written from fixed rules, not by AI"; "not investment advice, may be wrong, capital at risk"; sources | US: SEC / state adviser rules (personalised content about a person's own portfolio), FINRA 2210 / 2214; UK: FCA "advice vs guidance" boundary (PERG 8); EU: MiFID II investment advice | **Review required.** It discusses the user's own holdings. The guard blocks recommendations, but explaining a person's concentration could be read as personalised guidance. |
| Indicator explainer (AI, educational) | Computes RSI, MACD, averages or bands for a symbol and explains the reading | daily bars (read-only) | AI or rules label; "Educational… not investment advice… may be wrong… capital at risk"; "describes the past, does not predict"; sources | US FINRA 2210 (communications), SEC Reg BI if offered by a broker-dealer; UK FCA financial promotions; EU MiFID II | **Review required.** Naming a security and calling it "overbought" could be read as a view on that security. |

Existing tools, **not changed in this work**, that may be considered recommendations and should be reviewed:
"News to trades", "AI signals", "AI bots", "Forecasts & AI agents", "Top traders" and copy-trading, "AI strategy
marketplace". They are outside this branch; the AI guard built here could be applied to the AI ones (Review required).

**Copy check.** No superlatives, promises or performance claims in the new copy; placeholders are marked
[PLACEHOLDER]. Every AI output carries the disclaimer and its sources.

**Records.** `ai_compliance_log` (redacted, keyed user hash, 3-year default retention [PLACEHOLDER: legal retention]).

**Sign-off** (fill in before each rollout step in docs/TRADING_TOOLS.md):

| Tool | Reviewer | Date | Decision |
|---|---|---|---|
| Position size | | | |
| Risk / reward | | | |
| Sector heatmap | | | |
| Portfolio explainer (AI) | | | |
| Indicator explainer (AI) | | | |
