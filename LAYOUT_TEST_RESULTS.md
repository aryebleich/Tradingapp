# Layout v2: test results (baseline and final)

All results are from the branch `feature/layout-v2`. The raw reports are in `docs/layout-v2/`; screenshots stay in `e2e-output/` and are not committed.

## Baseline (Phase 2, old layout, before any layout change)

The baseline was taken on an untouched copy of commit `a4b8528` (main, before the redesign).

| Suite | Result |
|---|---|
| Unit tests (`npm test`) | 351 pass, 0 fail, 3 todo (the three money-logic bugs held for review) |
| Critical-flow end-to-end (`npm run e2e`) | **435 / 435 checks passed** (`docs/layout-v2/e2e-old-layout.txt`) |
| Pages × widths measured | 122 × 4 = 488 loads, 0 failed |
| Disclosure blocks recorded | 1,652 (with their visibility, fold position, size and contrast) |
| Figures recorded | 11,820 number tokens (prices, fees, balances, P&L, %) |
| Controls recorded | 11,110 |
| axe (WCAG 2.2 A/AA), at 1440 and 390px | color-contrast 657, link-name 109, label 62, target-size 57, select-name 36 |
| Sideways page scroll | Retirement at 768 and 1280px |
| Lighthouse (mobile, median of 5) | home 95/97/100/100 · risk 100/100/100/100 · terms 100/100/100/100 · login 96/100/100/63 · dashboard 93/94/100/66 · trade 94/94/100/66 (performance / accessibility / best practices / SEO) |

## Final (Phase 5, new layout)

| Gate | Check | Result |
|---|---|---|
| 1 | Unit tests, clean check, build (the server builds its bundle at start) | **357 pass, 0 fail**, 3 todo (unchanged). Clean check passes. Lint/typecheck: the project has none beyond `node --check` and the clean check. |
| 2 | Every disclosure present, visible if it was, above the fold if it was, ≥ 12px, AA contrast or no worse; at 1440/1280/768/390 | **PASS**: 0 failures, test mode and staging (`REPORT-test-mode.md`, `REPORT-staging.md`) |
| 3 | Critical-flow end-to-end on the new layout | **436 / 436 passed**. The same 435 checks with the same outcomes, plus one confirming the new layout was served (`e2e-new-layout.txt`). On staging (production mode), the full page suite passed. |
| 4 | Figures identical | **PASS**: 0 differences in 11,820 figures in test mode, and 0 on staging |
| 5 | Visual differences reviewed, each with a reason | All 488 differences are listed below with their reasons, and were reviewed on screenshots. Signed off in REVIEW.md. |
| 6 | No new axe violations; Lighthouse not lower | **axe: 0 new violations**; total violations 921 → 146 (test mode), 811 → 105 (staging). **Lighthouse: no drop beyond tolerance** (below) |
| 7 | Independent review | See REVIEW.md |

Controls: every one of the 11,110 controls of the old pages is present on the new ones, at every width (0 missing).

### axe totals (all pages, 1440 and 390px)

| Rule | Old layout | New layout |
|---|---|---|
| color-contrast | 657 | 64 |
| link-name | 109 | 0 |
| label | 62 | 32 |
| target-size | 57 | 40 |
| select-name | 36 | 10 |

The remaining items are page-specific colours and unlabeled controls outside the shared components. All of them already failed in the old layout, and none is new. They are listed per page in `REPORT-test-mode.md` and the inventory in AUDIT.md.

### Lighthouse (mobile emulation, median of 5 runs, production-mode staging)

| Page | Old: perf / a11y / best / SEO | New: perf / a11y / best / SEO |
|---|---|---|
| Home | 95 / 97 / 100 / 100 | 96 / 100 / 100 / 100 |
| Risk disclosure | 100 / 100 / 100 / 100 | 100 / 100 / 100 / 100 |
| Terms | 100 / 100 / 100 / 100 | 100 / 100 / 100 / 100 |
| Sign in | 96 / 100 / 100 / 63 | 94 / 100 / 100 / 63 |
| Dashboard | 93 / 94 / 100 / 66 | 91 / 97 / 100 / 66 |
| Trade | 94 / 94 / 100 / 66 | 92 / 97 / 100 / 66 |

Accessibility went up and nothing else went down, except performance on Sign in, Dashboard and Trade, by 2 points each. That is within the 3-point tolerance the gate allows for run-to-run noise (`test/layout/lighthouse.mjs`). The cause is understood:
- The layout adds one small stylesheet and one script request.
- Layout shift on signed-in pages is 0.063 against 0.056, because the page area is a full screen tall so the newly shown footer starts below the fold.
- LCP is equal or better.

An earlier build dropped 6 points (CLS 0.171, from the footer jumping while the page loaded). It was fixed before these final runs.

## Fixes made because a gate failed during the work

| Gate | Failure | Fix |
|---|---|---|
| 4 | Figures differed on Trade: a live latency ("8 ms") and the market-close countdown | Clocks, countdowns and latencies are excluded from figures (D-6). Admin → Data's live event counter is a named, reviewed exception. |
| 2 | Three disclosures moved below the fold at 1280px (by 54 to 70px) | Old vertical rhythm, gutters and line lengths restored; empty-state links inline; text-style link buttons keep their height |
| 2 | Homepage "Illustrative paper-trading account" caption at 3.45:1 | Lightened on its dark panel (now ≥ 4.5:1) |
| — (screenshot review) | Phone: "?" help buttons pushed stat labels apart; the guide card lost its zero padding | 44px targets only on full-size actions; card padding left to the theme |
| 6 | Lighthouse trade 94 → 88 (layout shift) | Footer shown only once sign-in state is known, below the first screen |

## Visual differences (gate 5): every page and width, with its reason

Reason codes: **F** Signed-in disclosure footer now shown under the page (rule 1: more visible); **C** Gain/loss/warning/accent text and pills one step darker for AA contrast (D-9); **T** Phone: full-size buttons 44px and fields 16px/44px tall (thumb reach, no zoom on focus); **W** Tables placed in a named scroll box (D-10); **L** Loading lines shown as skeletons; empty lists get a next-step link on the same line; **S** Public site: caption, kicker and badge contrast; logo link named; **G** Content width capped at 1280px and centred on wide screens; **H** Sign-in screens: 44px buttons and fields on phones, focus outline.

| Page | Width | Pixels changed | Height old → new (px) | Reasons |
|---|---|---|---|---|
| app/account | 1440 | 9.35% | 1233 → 1296 | F, C, G |
| app/account | 1280 | 9.52% | 1233 → 1296 | F |
| app/account | 768 | 11.04% | 1282 → 1386 | F |
| app/account | 390 | 15.92% | 1897 → 2131 | F, T |
| app/accounts | 1440 | 0.09% | 2456 → 2534 | F, C, W, G |
| app/accounts | 1280 | 0.1% | 2480 → 2558 | F, W |
| app/accounts | 768 | 15.82% | 2667 → 2746 | F, W |
| app/accounts | 390 | 17.55% | 3935 → 4204 | F, C, T, W |
| app/admin | 1440 | 0.06% | 900 → 1035 | F, C, G |
| app/admin | 1280 | 0.08% | 805 → 935 | F |
| app/admin | 768 | 12.84% | 1024 → 1238 | F |
| app/admin | 390 | 15.6% | 1084 → 1274 | F, T |
| app/admin-admins | 1440 | 0.73% | 900 → 1035 | F, C, G |
| app/admin-admins | 1280 | 0.71% | 800 → 935 | F |
| app/admin-admins | 768 | 2.79% | 1024 → 1238 | F |
| app/admin-admins | 390 | 13.08% | 844 → 1135 | F, T |
| app/admin-agents | 1440 | 5.07% | 2429 → 2496 | F, C, W, G |
| app/admin-agents | 1280 | 5.09% | 2429 → 2496 | F, W |
| app/admin-agents | 768 | 11.81% | 2541 → 2626 | F, W |
| app/admin-agents | 390 | 19.67% | 4171 → 4354 | F, T, W |
| app/admin-ai | 1440 | 5.86% | 3394 → 3450 | F, C, W, G |
| app/admin-ai | 1280 | 6.19% | 3417 → 3472 | F, W |
| app/admin-ai | 768 | 12.47% | 3553 → 3627 | F, W |
| app/admin-ai | 390 | 20.47% | 5231 → 5422 | F, T, W |
| app/admin-analytics | 1440 | 0.06% | 900 → 1035 | F, C, G |
| app/admin-analytics | 1280 | 0.07% | 854 → 935 | F |
| app/admin-analytics | 768 | 5% | 1112 → 1238 | F |
| app/admin-analytics | 390 | 13.38% | 1557 → 1673 | F, T |
| app/admin-comms | 1440 | 0.03% | 1657 → 1735 | F, C, G |
| app/admin-comms | 1280 | 0.04% | 1678 → 1756 | F |
| app/admin-comms | 768 | 10.87% | 1858 → 1972 | F |
| app/admin-comms | 390 | 17.26% | 2356 → 2537 | F, T |
| app/admin-data | 1440 | 0.11% | 2003 → 2081 | F, C, W, G |
| app/admin-data | 1280 | 0.12% | 2046 → 2124 | F, W |
| app/admin-data | 768 | 7.7% | 2122 → 2219 | F, W |
| app/admin-data | 390 | 14.33% | 6017 → 6471 | F, C, T, W |
| app/admin-hosting | 1440 | 7.28% | 1489 → 1565 | F, C, W, G |
| app/admin-hosting | 1280 | 7.41% | 1533 → 1609 | F, W |
| app/admin-hosting | 768 | 16.4% | 1691 → 1782 | F, W |
| app/admin-hosting | 390 | 20.85% | 2492 → 2688 | F, C, T, W |
| app/admin-keys | 1440 | 8.41% | 8142 → 8204 | F, C, W, G |
| app/admin-keys | 1280 | 8.66% | 8142 → 8204 | F, W |
| app/admin-keys | 768 | 13.72% | 8197 → 8277 | F, W |
| app/admin-keys | 390 | 17.31% | 14045 → 14818 | F, T, W |
| app/admin-money | 1440 | 14.29% | 4353 → 4396 | F, C, W, G |
| app/admin-money | 1280 | 14.27% | 4532 → 4575 | F, W |
| app/admin-money | 768 | 18.09% | 5019 → 5140 | F, W |
| app/admin-money | 390 | 20.93% | 8734 → 9020 | F, C, T, W |
| app/admin-phone | 1440 | 0.52% | 5834 → 5912 | F, C, W, G |
| app/admin-phone | 1280 | 0.46% | 5855 → 5934 | F, W |
| app/admin-phone | 768 | 21.61% | 6103 → 6274 | F, W |
| app/admin-phone | 390 | 20.83% | 14214 → 14347 | F, C, T, W |
| app/admin-phoneaccts | 1440 | 0.06% | 900 → 1035 | F, C, W, G |
| app/admin-phoneaccts | 1280 | 0.08% | 800 → 935 | F, W |
| app/admin-phoneaccts | 768 | 9.03% | 1024 → 1238 | F, W |
| app/admin-phoneaccts | 390 | 14.75% | 880 → 1135 | F, T, W |
| app/admin-readme | 1440 | 0.05% | 11127 → 11190 | F, C, W, G |
| app/admin-readme | 1280 | 0.02% | 11987 → 12050 | F, W |
| app/admin-readme | 768 | 18.28% | 14431 → 14705 | F, W |
| app/admin-readme | 390 | 24.71% | 26142 → 27058 | F, C, T, W |
| app/admin-seo | 1440 | 0.06% | 8760 → 8838 | F, C, G |
| app/admin-seo | 1280 | 0.01% | 8864 → 8943 | F |
| app/admin-seo | 768 | 8.66% | 9509 → 9606 | F |
| app/admin-seo | 390 | 21.6% | 13522 → 13962 | F, C, T |
| app/admin-setup | 1440 | 0.91% | 1544 → 1610 | F, C, G |
| app/admin-setup | 1280 | 0.92% | 1544 → 1610 | F |
| app/admin-setup | 768 | 13.08% | 1706 → 1811 | F |
| app/admin-setup | 390 | 28.79% | 2611 → 2820 | F, C, T |
| app/admin-sponsored | 1440 | 0.04% | 1271 → 1349 | F, C, W, G |
| app/admin-sponsored | 1280 | 0.05% | 1271 → 1349 | F, W |
| app/admin-sponsored | 768 | 6.66% | 1340 → 1437 | F, W |
| app/admin-sponsored | 390 | 14.81% | 2120 → 2318 | F, T, W |
| app/admin-strategies | 1440 | 9.1% | 6159 → 6223 | F, C, W, G |
| app/admin-strategies | 1280 | 9.45% | 6181 → 6244 | F, W |
| app/admin-strategies | 768 | 14.89% | 6465 → 6547 | F, W |
| app/admin-strategies | 390 | 24.45% | 7654 → 7899 | F, T, W |
| app/admin-support | 1440 | 0.06% | 900 → 1035 | F, C, W, G |
| app/admin-support | 1280 | 0.08% | 800 → 935 | F, W |
| app/admin-support | 768 | 1.12% | 1024 → 1238 | F, W |
| app/admin-support | 390 | 3.15% | 844 → 1135 | F, T, W |
| app/admin-trust | 1440 | 0.29% | 1454 → 1532 | F, C, G |
| app/admin-trust | 1280 | 0.04% | 1472 → 1550 | F |
| app/admin-trust | 768 | 5.44% | 1561 → 1657 | F |
| app/admin-trust | 390 | 13.71% | 2644 → 2965 | F, T |
| app/admin-upgrades | 1440 | 0.04% | 1218 → 1296 | F, C, G |
| app/admin-upgrades | 1280 | 0.05% | 1264 → 1342 | F |
| app/admin-upgrades | 768 | 11.74% | 1377 → 1494 | F |
| app/admin-upgrades | 390 | 22.59% | 1931 → 2196 | F, T |
| app/admin-users | 1440 | 1.22% | 900 → 1035 | F, C, W, G |
| app/admin-users | 1280 | 1.53% | 800 → 935 | F, W |
| app/admin-users | 768 | 5.59% | 1024 → 1238 | F, W |
| app/admin-users | 390 | 16% | 967 → 1135 | F, T, W |
| app/agenthub | 1440 | 2.54% | 1463 → 1526 | F, C, W, G |
| app/agenthub | 1280 | 2.67% | 1463 → 1526 | F, W |
| app/agenthub | 768 | 10.07% | 1740 → 1821 | F, W |
| app/agenthub | 390 | 17.51% | 2626 → 2800 | F, T, W |
| app/agents | 1440 | 0.06% | 974 → 1052 | F, C, W, G |
| app/agents | 1280 | 0.06% | 974 → 1052 | F, W |
| app/agents | 768 | 7.77% | 1068 → 1238 | F, W |
| app/agents | 390 | 15.99% | 1491 → 1660 | F, T, W |
| app/ai | 1440 | 0.04% | 1196 → 1275 | F, C, G |
| app/ai | 1280 | 0.05% | 1231 → 1310 | F |
| app/ai | 768 | 8.64% | 1316 → 1412 | F |
| app/ai | 390 | 16.33% | 1575 → 1737 | F, T |
| app/aibots | 1440 | 0.06% | 976 → 1054 | F, C, G |
| app/aibots | 1280 | 0.06% | 1011 → 1089 | F |
| app/aibots | 768 | 18.75% | 1133 → 1253 | F |
| app/aibots | 390 | 23.16% | 1409 → 1590 | F, T |
| app/aifunds | 1440 | 0.05% | 1181 → 1259 | F, C, G |
| app/aifunds | 1280 | 0.05% | 1224 → 1302 | F |
| app/aifunds | 768 | 10.99% | 1292 → 1389 | F |
| app/aifunds | 390 | 19.55% | 2107 → 2365 | F, T |
| app/aimarket | 1440 | 0.06% | 900 → 1035 | F, C, W, G |
| app/aimarket | 1280 | 0.08% | 800 → 935 | F, W |
| app/aimarket | 768 | 3.49% | 1024 → 1238 | F, W |
| app/aimarket | 390 | 14.15% | 844 → 1135 | F, T, W |
| app/aisignals | 1440 | 2.15% | 1482 → 1544 | F, C, W, G |
| app/aisignals | 1280 | 2.18% | 1527 → 1589 | F, W |
| app/aisignals | 768 | 9.19% | 1887 → 1967 | F, W |
| app/aisignals | 390 | 21.09% | 2393 → 2593 | F, C, T, W |
| app/aitools | 1440 | 0.25% | 900 → 1035 | F, C, G |
| app/aitools | 1280 | 0.32% | 800 → 935 | F |
| app/aitools | 768 | 4.7% | 1024 → 1238 | F |
| app/aitools | 390 | 14.34% | 844 → 1135 | F, T |
| app/alpaca-tools | 1440 | 8.27% | 2612 → 2616 | F, C, G |
| app/alpaca-tools | 1280 | 8.42% | 2673 → 2677 | F |
| app/alpaca-tools | 768 | 13.85% | 2970 → 2977 | F |
| app/alpaca-tools | 390 | 20.83% | 3985 → 4051 | F, T |
| app/analyze | 1440 | 1.22% | 900 → 1035 | F, C, G |
| app/analyze | 1280 | 1.34% | 800 → 935 | F |
| app/analyze | 768 | 17.38% | 1024 → 1238 | F |
| app/analyze | 390 | 18.23% | 1036 → 1188 | F, T |
| app/android | 1440 | 0.06% | 900 → 1035 | F, C, G |
| app/android | 1280 | 0.08% | 800 → 935 | F |
| app/android | 768 | 8.42% | 1024 → 1238 | F |
| app/android | 390 | 17.4% | 990 → 1207 | F, T |
| app/backtest | 1440 | 0.05% | 1114 → 1192 | F, C, G |
| app/backtest | 1280 | 0.05% | 1137 → 1215 | F |
| app/backtest | 768 | 7.71% | 1208 → 1305 | F |
| app/backtest | 390 | 15.45% | 2145 → 2308 | F, T |
| app/bank | 1440 | 4.52% | 1096 → 1158 | F, C, W, G |
| app/bank | 1280 | 4.47% | 1096 → 1158 | F, W |
| app/bank | 768 | 15.53% | 1272 → 1461 | F, W |
| app/bank | 390 | 17.29% | 1908 → 2069 | F, C, T, W |
| app/bizreports | 1440 | 5.01% | 1080 → 1143 | F, C, W, G |
| app/bizreports | 1280 | 5.01% | 1080 → 1143 | F, W |
| app/bizreports | 768 | 16.16% | 1112 → 1238 | F, W |
| app/bizreports | 390 | 17.82% | 1832 → 1959 | F, C, T, W |
| app/books | 1440 | 0.04% | 1901 → 1979 | F, C, W, G |
| app/books | 1280 | 0.04% | 1901 → 1979 | F, W |
| app/books | 768 | 14.87% | 1955 → 2086 | F, W |
| app/books | 390 | 13.98% | 5886 → 6041 | F, C, T, W |
| app/bots | 1440 | 0.06% | 900 → 1035 | F, C, W, G |
| app/bots | 1280 | 0.08% | 800 → 935 | F, W |
| app/bots | 768 | 7.22% | 1024 → 1238 | F, W |
| app/bots | 390 | 24.59% | 996 → 1186 | F, T, W |
| app/brief | 1440 | 4.04% | 900 → 1035 | F, C, G |
| app/brief | 1280 | 4.57% | 800 → 935 | F |
| app/brief | 768 | 7.03% | 1024 → 1238 | F |
| app/brief | 390 | 12.77% | 844 → 1135 | F, T |
| app/brokers | 1440 | 1.54% | 922 → 1035 | F, C, G |
| app/brokers | 1280 | 1.22% | 1181 → 1246 | F |
| app/brokers | 768 | 8.18% | 1275 → 1359 | F |
| app/brokers | 390 | 21.92% | 1789 → 1994 | F, C, T |
| app/business | 1440 | 2.31% | 1064 → 1126 | F, C, G |
| app/business | 1280 | 2.38% | 1064 → 1126 | F |
| app/business | 768 | 15.62% | 1230 → 1346 | F |
| app/business | 390 | 15.05% | 1819 → 1955 | F, T |
| app/calendar | 1440 | 0.8% | 1618 → 1669 | F, C, W, G |
| app/calendar | 1280 | 0.8% | 1618 → 1669 | F, W |
| app/calendar | 768 | 8.97% | 1710 → 1791 | F, W |
| app/calendar | 390 | 20.83% | 2229 → 2357 | F, C, T, W |
| app/chart | 1440 | 11.87% | 1638 → 1677 | F, C, G |
| app/chart | 1280 | 1.84% | 1638 → 1716 | F |
| app/chart | 768 | 9.25% | 1768 → 1864 | F |
| app/chart | 390 | 21% | 2308 → 2451 | F, C, T |
| app/code | 1440 | 1.06% | 1121 → 1184 | F, C, G |
| app/code | 1280 | 0.99% | 1183 → 1246 | F |
| app/code | 768 | 8.51% | 1327 → 1409 | F |
| app/code | 390 | 16.11% | 1625 → 1794 | F, T |
| app/currencies | 1440 | 0.06% | 900 → 1035 | F, C, G |
| app/currencies | 1280 | 0.08% | 800 → 935 | F |
| app/currencies | 768 | 2.18% | 1024 → 1238 | F |
| app/currencies | 390 | 6.44% | 844 → 1135 | F, T |
| app/dashboard | 1440 | 0.41% | 1903 → 1965 | F, C, W, G |
| app/dashboard | 1280 | 0.42% | 1935 → 1997 | F, W |
| app/dashboard | 768 | 8.09% | 2093 → 2174 | F, W |
| app/dashboard | 390 | 19.62% | 2642 → 2767 | F, C, T, W |
| app/earnings | 1440 | 1.22% | 900 → 1035 | F, C, G |
| app/earnings | 1280 | 1.34% | 800 → 935 | F |
| app/earnings | 768 | 7.5% | 1024 → 1238 | F |
| app/earnings | 390 | 17.43% | 1049 → 1201 | F, T |
| app/execution | 1440 | 0.07% | 1439 → 1518 | F, C, W, G |
| app/execution | 1280 | 0.07% | 1492 → 1570 | F, W |
| app/execution | 768 | 8.84% | 1602 → 1699 | F, W |
| app/execution | 390 | 18.2% | 2250 → 2470 | F, C, T, W |
| app/fleet | 1440 | 2.69% | 1017 → 1079 | F, C, W, G |
| app/fleet | 1280 | 2.74% | 1017 → 1079 | F, W |
| app/fleet | 768 | 9.11% | 1066 → 1238 | F, W |
| app/fleet | 390 | 22.77% | 1585 → 1812 | F, T, W |
| app/funding | 1440 | 2.2% | 2068 → 2117 | F, C, W, G |
| app/funding | 1280 | 2.1% | 2169 → 2218 | F, W |
| app/funding | 768 | 15.06% | 2899 → 3008 | F, W |
| app/funding | 390 | 14.06% | 4087 → 4216 | F, C, T, W |
| app/hotline | 1440 | 1.31% | 900 → 1035 | F, C, G |
| app/hotline | 1280 | 1.45% | 800 → 935 | F |
| app/hotline | 768 | 4.87% | 1024 → 1238 | F |
| app/hotline | 390 | 10.52% | 844 → 1135 | F, C, T |
| app/insights | 1440 | 3.85% | 1712 → 1775 | F, C, W, G |
| app/insights | 1280 | 3.58% | 1808 → 1870 | F, W |
| app/insights | 768 | 9.55% | 1907 → 1988 | F, W |
| app/insights | 390 | 15.85% | 2690 → 2834 | F, C, T, W |
| app/institutions | 1440 | 0.06% | 900 → 1035 | F, C, G |
| app/institutions | 1280 | 0.07% | 877 → 956 | F |
| app/institutions | 768 | 9.81% | 1024 → 1238 | F |
| app/institutions | 390 | 20.02% | 1797 → 1966 | F, T |
| app/intel | 1440 | 4.98% | 1653 → 1715 | F, C, W, G |
| app/intel | 1280 | 5.05% | 1698 → 1760 | F, W |
| app/intel | 768 | 11.53% | 1812 → 1892 | F, W |
| app/intel | 390 | 19.84% | 2857 → 3044 | F, T, W |
| app/inventory | 1440 | 0.06% | 900 → 1035 | F, C, W, G |
| app/inventory | 1280 | 0.07% | 826 → 935 | F, W |
| app/inventory | 768 | 11.96% | 1024 → 1238 | F, W |
| app/inventory | 390 | 13.72% | 1415 → 1584 | F, T, W |
| app/invest | 1440 | 15.21% | 2616 → 2679 | F, C, W, G |
| app/invest | 1280 | 15.56% | 2633 → 2696 | F, W |
| app/invest | 768 | 20.36% | 2710 → 2792 | F, W |
| app/invest | 390 | 18.36% | 8205 → 8311 | F, T, W |
| app/invoices | 1440 | 0.05% | 1131 → 1209 | F, C, W, G |
| app/invoices | 1280 | 0.05% | 1131 → 1209 | F, W |
| app/invoices | 768 | 13.55% | 1163 → 1295 | F, W |
| app/invoices | 390 | 12.06% | 1993 → 2176 | F, T, W |
| app/leaders | 1440 | 0.33% | 1481 → 1559 | F, C, W, G |
| app/leaders | 1280 | 0.37% | 1481 → 1559 | F, W |
| app/leaders | 768 | 9.37% | 1536 → 1633 | F, W |
| app/leaders | 390 | 16.25% | 4559 → 4659 | F, C, T, W |
| app/learn | 1440 | 0.04% | 1423 → 1501 | F, C, G |
| app/learn | 1280 | 0.04% | 1622 → 1700 | F |
| app/learn | 768 | 6.24% | 1562 → 1659 | F |
| app/learn | 390 | 20% | 2552 → 3288 | F, T |
| app/longterm | 1440 | 5.31% | 1841 → 1889 | F, C, W, G |
| app/longterm | 1280 | 5.24% | 1863 → 1911 | F, W |
| app/longterm | 768 | 10.7% | 1939 → 2005 | F, W |
| app/longterm | 390 | 15.26% | 3013 → 3159 | F, C, T, W |
| app/lowcost | 1440 | 0.16% | 2438 → 2516 | F, C, W, G |
| app/lowcost | 1280 | 0.23% | 2461 → 2539 | F, W |
| app/lowcost | 768 | 10.17% | 2511 → 2607 | F, W |
| app/lowcost | 390 | 15.08% | 9866 → 9964 | F, T, W |
| app/margin | 1440 | 9.53% | 2270 → 2304 | F, C, W, G |
| app/margin | 1280 | 9.87% | 2354 → 2388 | F, W |
| app/margin | 768 | 16.6% | 2805 → 2972 | F, W |
| app/margin | 390 | 22.66% | 4132 → 4396 | F, T, W |
| app/marketplace | 1440 | 0.87% | 900 → 1035 | F, C, G |
| app/marketplace | 1280 | 2% | 800 → 935 | F |
| app/marketplace | 768 | 8.68% | 1024 → 1238 | F |
| app/marketplace | 390 | 21.95% | 1763 → 1907 | F, T |
| app/markets | 1440 | 4.87% | 1591 → 1637 | F, C, W, G |
| app/markets | 1280 | 4.96% | 1591 → 1637 | F, W |
| app/markets | 768 | 10.34% | 1842 → 1927 | F, W |
| app/markets | 390 | 13.28% | 2887 → 2971 | F, C, T, W |
| app/money | 1440 | 2.03% | 1017 → 1080 | F, C, W, G |
| app/money | 1280 | 2.03% | 1052 → 1114 | F, W |
| app/money | 768 | 8.77% | 1167 → 1248 | F, W |
| app/money | 390 | 16.41% | 1830 → 1967 | F, C, T, W |
| app/news | 1440 | 0.06% | 1412 → 1490 | F, C, G |
| app/news | 1280 | 0.07% | 1412 → 1490 | F |
| app/news | 768 | 6% | 1467 → 1564 | F |
| app/news | 390 | 15.24% | 2164 → 2331 | F, C, T |
| app/options | 1440 | 0.1% | 1213 → 1291 | F, C, W, G |
| app/options | 1280 | 0.11% | 1234 → 1312 | F, W |
| app/options | 768 | 19.46% | 1305 → 1425 | F, W |
| app/options | 390 | 18.63% | 1733 → 1899 | F, C, T, W |
| app/optionslab | 1440 | 0.08% | 1899 → 1961 | F, C, W, G |
| app/optionslab | 1280 | 0.09% | 2032 → 2094 | F, W |
| app/optionslab | 768 | 10.94% | 2646 → 2727 | F, W |
| app/optionslab | 390 | 15.86% | 4713 → 4949 | F, T, W |
| app/orders | 1440 | 1.48% | 900 → 1035 | F, C, G |
| app/orders | 1280 | 1.66% | 800 → 935 | F |
| app/orders | 768 | 5.95% | 1024 → 1238 | F |
| app/orders | 390 | 19.95% | 886 → 1135 | F, C, T |
| app/pairs | 1440 | 0.05% | 1058 → 1136 | F, C, W, G |
| app/pairs | 1280 | 0.06% | 1058 → 1136 | F, W |
| app/pairs | 768 | 21.05% | 1309 → 1452 | F, W |
| app/pairs | 390 | 17.27% | 1627 → 1856 | F, T, W |
| app/payroll | 1440 | 9.18% | 1174 → 1237 | F, C, W, G |
| app/payroll | 1280 | 9.08% | 1192 → 1256 | F, W |
| app/payroll | 768 | 18.79% | 1243 → 1360 | F, W |
| app/payroll | 390 | 18.38% | 1807 → 1961 | F, T, W |
| app/portfolios | 1440 | 0.05% | 1181 → 1260 | F, C, G |
| app/portfolios | 1280 | 0.05% | 1205 → 1283 | F |
| app/portfolios | 768 | 7.22% | 1337 → 1434 | F |
| app/portfolios | 390 | 15.72% | 2006 → 2229 | F, T |
| app/positions | 1440 | 0.45% | 900 → 1035 | F, C, W, G |
| app/positions | 1280 | 0.57% | 800 → 935 | F, W |
| app/positions | 768 | 7.04% | 1024 → 1238 | F, W |
| app/positions | 390 | 19.96% | 1312 → 1476 | F, C, T, W |
| app/private | 1440 | 0.03% | 1727 → 1805 | F, C, W, G |
| app/private | 1280 | 0.03% | 1749 → 1827 | F, W |
| app/private | 768 | 7.34% | 1967 → 2063 | F, W |
| app/private | 390 | 18.94% | 3118 → 3330 | F, T, W |
| app/protection | 1440 | 7.89% | 1150 → 1165 | F, C, G |
| app/protection | 1280 | 8.31% | 1172 → 1186 | F |
| app/protection | 768 | 15.36% | 1465 → 1520 | F |
| app/protection | 390 | 26.04% | 2207 → 2277 | F, T |
| app/quantconnect | 1440 | 1.22% | 900 → 1035 | F, C, G |
| app/quantconnect | 1280 | 1.34% | 800 → 935 | F |
| app/quantconnect | 768 | 3.37% | 1024 → 1238 | F |
| app/quantconnect | 390 | 6.89% | 844 → 1135 | F, T |
| app/referrals | 1440 | 0.27% | 900 → 1035 | F, C, G |
| app/referrals | 1280 | 0.17% | 850 → 935 | F |
| app/referrals | 768 | 5.03% | 1024 → 1238 | F |
| app/referrals | 390 | 21.46% | 1038 → 1241 | F, C, T |
| app/research | 1440 | 0.06% | 900 → 1035 | F, C, G |
| app/research | 1280 | 0.07% | 884 → 962 | F |
| app/research | 768 | 6.97% | 1024 → 1238 | F |
| app/research | 390 | 17.03% | 1137 → 1305 | F, T |
| app/retirement | 1440 | 7.8% | 2146 → 2209 | F, C, W, G |
| app/retirement | 1280 | 7.8% | 2182 → 2244 | F, W |
| app/retirement | 768 | 10.09% | 2377 → 2479 | F, W |
| app/retirement | 390 | 19.65% | 4764 → 4995 | F, T, W |
| app/risk | 1440 | 0.26% | 1672 → 1751 | F, C, W, G |
| app/risk | 1280 | 0.29% | 1672 → 1751 | F, W |
| app/risk | 768 | 8.01% | 1809 → 1906 | F, W |
| app/risk | 390 | 16.88% | 2730 → 2945 | F, C, T, W |
| app/riskview | 1440 | 1.22% | 900 → 1035 | F, C, G |
| app/riskview | 1280 | 1.31% | 818 → 935 | F |
| app/riskview | 768 | 8.36% | 1024 → 1238 | F |
| app/riskview | 390 | 18.5% | 1202 → 1354 | F, T |
| app/robo | 1440 | 0.05% | 1175 → 1253 | F, C, G |
| app/robo | 1280 | 0.05% | 1175 → 1253 | F |
| app/robo | 768 | 7.09% | 1230 → 1327 | F |
| app/robo | 390 | 15.28% | 1393 → 2014 | F, T |
| app/rules | 1440 | 0.04% | 1235 → 1313 | F, C, G |
| app/rules | 1280 | 0.05% | 1235 → 1313 | F |
| app/rules | 768 | 7.26% | 1342 → 1439 | F |
| app/rules | 390 | 14.77% | 1653 → 2119 | F, T |
| app/scanner | 1440 | 0.03% | 1839 → 1917 | F, C, W, G |
| app/scanner | 1280 | 0.03% | 1839 → 1917 | F, W |
| app/scanner | 768 | 8.19% | 1961 → 2058 | F, W |
| app/scanner | 390 | 17.4% | 2422 → 2603 | F, T, W |
| app/schedule | 1440 | 0.04% | 1235 → 1313 | F, C, W, G |
| app/schedule | 1280 | 0.05% | 1258 → 1336 | F, W |
| app/schedule | 768 | 7.58% | 1290 → 1387 | F, W |
| app/schedule | 390 | 16.09% | 2310 → 2544 | F, T, W |
| app/security | 1440 | 0.4% | 1015 → 1093 | F, C, W, G |
| app/security | 1280 | 0.43% | 1081 → 1159 | F, W |
| app/security | 768 | 6.04% | 1174 → 1271 | F, W |
| app/security | 390 | 14.2% | 1339 → 1543 | F, C, T, W |
| app/settings | 1440 | 6.42% | 3375 → 3438 | F, C, W, G |
| app/settings | 1280 | 6.08% | 3442 → 3511 | F, W |
| app/settings | 768 | 13.61% | 4322 → 4382 | F, W |
| app/settings | 390 | 19.22% | 6037 → 6187 | F, C, T, W |
| app/sharedportfolios | 1440 | 0.06% | 900 → 1035 | F, C, G |
| app/sharedportfolios | 1280 | 0.08% | 800 → 935 | F |
| app/sharedportfolios | 768 | 1.67% | 1024 → 1238 | F |
| app/sharedportfolios | 390 | 7.92% | 844 → 1135 | F, T |
| app/sharedstrategies | 1440 | 0.06% | 900 → 1035 | F, C, G |
| app/sharedstrategies | 1280 | 0.08% | 800 → 935 | F |
| app/sharedstrategies | 768 | 1.75% | 1024 → 1238 | F |
| app/sharedstrategies | 390 | 7.22% | 844 → 1135 | F, T |
| app/short | 1440 | 0.05% | 1008 → 1086 | F, C, G |
| app/short | 1280 | 0.06% | 1029 → 1107 | F |
| app/short | 768 | 9.37% | 1225 → 1322 | F |
| app/short | 390 | 18.32% | 1849 → 2033 | F, T |
| app/signalchannels | 1440 | 0.06% | 900 → 1035 | F, C, G |
| app/signalchannels | 1280 | 0.08% | 800 → 935 | F |
| app/signalchannels | 768 | 1.76% | 1024 → 1238 | F |
| app/signalchannels | 390 | 8.45% | 844 → 1135 | F, T |
| app/signals | 1440 | 0.03% | 1681 → 1759 | F, C, W, G |
| app/signals | 1280 | 0.04% | 1689 → 1767 | F, W |
| app/signals | 768 | 7.48% | 1744 → 1841 | F, W |
| app/signals | 390 | 18.64% | 2377 → 2591 | F, C, T, W |
| app/sp500 | 1440 | 0.45% | 1911 → 1989 | F, C, W, G |
| app/sp500 | 1280 | 0.45% | 1933 → 2011 | F, W |
| app/sp500 | 768 | 14.19% | 2730 → 2806 | F, W |
| app/sp500 | 390 | 14.8% | 3365 → 3546 | F, C, T, W |
| app/spend | 1440 | 2% | 1157 → 1219 | F, C, W, G |
| app/spend | 1280 | 2.01% | 1157 → 1219 | F, W |
| app/spend | 768 | 7.81% | 1206 → 1287 | F, W |
| app/spend | 390 | 14.2% | 2015 → 2186 | F, C, T, W |
| app/start | 1440 | 0.06% | 900 → 1035 | F, C, G |
| app/start | 1280 | 0.08% | 800 → 935 | F |
| app/start | 768 | 4.01% | 1024 → 1238 | F |
| app/start | 390 | 9.41% | 951 → 1135 | F, T |
| app/statarb | 1440 | 4.52% | 2449 → 2516 | F, C, W, G |
| app/statarb | 1280 | 4.62% | 2467 → 2533 | F, W |
| app/statarb | 768 | 11.74% | 2809 → 2894 | F, W |
| app/statarb | 390 | 21.41% | 4262 → 4483 | F, C, T, W |
| app/strategies | 1440 | 0.06% | 2281 → 2359 | F, C, W, G |
| app/strategies | 1280 | 0.06% | 2559 → 2638 | F, W |
| app/strategies | 768 | 13.68% | 2887 → 3003 | F, W |
| app/strategies | 390 | 23.38% | 4778 → 4998 | F, C, T, W |
| app/tax | 1440 | 9.46% | 2076 → 2141 | F, C, W, G |
| app/tax | 1280 | 9.55% | 2094 → 2159 | F, W |
| app/tax | 768 | 16.2% | 2392 → 2454 | F, W |
| app/tax | 390 | 18.98% | 3403 → 3635 | F, T, W |
| app/taxpilot | 1440 | 0.04% | 1308 → 1386 | F, C, W, G |
| app/taxpilot | 1280 | 0.05% | 1308 → 1386 | F, W |
| app/taxpilot | 768 | 10.6% | 1402 → 1521 | F, W |
| app/taxpilot | 390 | 15.54% | 2154 → 2332 | F, T, W |
| app/text | 1440 | 3.45% | 900 → 1035 | F, C, G |
| app/text | 1280 | 2.5% | 800 → 935 | F |
| app/text | 768 | 11.6% | 1024 → 1238 | F |
| app/text | 390 | 21.81% | 1515 → 1659 | F, C, T |
| app/tokenized | 1440 | 0.81% | 2111 → 2187 | F, C, G |
| app/tokenized | 1280 | 0.86% | 2172 → 2248 | F |
| app/tokenized | 768 | 13.96% | 2798 → 2917 | F |
| app/tokenized | 390 | 23.73% | 4382 → 4683 | F, C, T |
| app/trade | 1440 | 1.01% | 2067 → 2145 | F, C, G |
| app/trade | 1280 | 0.92% | 2108 → 2186 | F |
| app/trade | 768 | 8.97% | 2942 → 2985 | F |
| app/trade | 390 | 21.83% | 3283 → 3464 | F, C, T |
| app/traders | 1440 | 0.06% | 900 → 1035 | F, C, W, G |
| app/traders | 1280 | 0.08% | 800 → 935 | F, W |
| app/traders | 768 | 5.55% | 1024 → 1238 | F, W |
| app/traders | 390 | 16.33% | 1094 → 1302 | F, T, W |
| app/values | 1440 | 0.06% | 900 → 1035 | F, C, G |
| app/values | 1280 | 0.08% | 800 → 935 | F |
| app/values | 768 | 6.47% | 1024 → 1238 | F |
| app/values | 390 | 17.31% | 1071 → 1237 | F, T |
| app/watchlists | 1440 | 0.06% | 900 → 1035 | F, C, G |
| app/watchlists | 1280 | 0.08% | 800 → 935 | F |
| app/watchlists | 768 | 0.79% | 1024 → 1238 | F |
| app/watchlists | 390 | 2.04% | 844 → 1135 | F, T |
| app/wealth | 1440 | 1.01% | 1237 → 1306 | F, C, W, G |
| app/wealth | 1280 | 1.07% | 1237 → 1306 | F, W |
| app/wealth | 768 | 10.15% | 1330 → 1418 | F, W |
| app/wealth | 390 | 22.33% | 3120 → 3223 | F, T, W |
| app/workspace | 1440 | 0.15% | 900 → 1035 | F, C, W, G |
| app/workspace | 1280 | 0.16% | 915 → 993 | F, W |
| app/workspace | 768 | 6.75% | 1055 → 1238 | F, W |
| app/workspace | 390 | 13.95% | 1642 → 1815 | F, C, T, W |
| out/forgot | 1440 | 1.83% | 900 → 900 | H |
| out/forgot | 1280 | 2.31% | 800 → 800 | H |
| out/forgot | 768 | 2.82% | 1067 → 1082 | H |
| out/forgot | 390 | 10.11% | 964 → 998 | H |
| out/login | 1440 | 1.68% | 902 → 900 | H |
| out/login | 1280 | 1.93% | 888 → 882 | H |
| out/login | 768 | 2.82% | 1067 → 1082 | H |
| out/login | 390 | 8.48% | 1018 → 1038 | H |
| out/login-phone | 1440 | 1.83% | 900 → 900 | H |
| out/login-phone | 1280 | 2.31% | 800 → 800 | H |
| out/login-phone | 768 | 2.82% | 1067 → 1082 | H |
| out/login-phone | 390 | 9.38% | 964 → 998 | H |
| out/register | 1440 | 1.83% | 900 → 900 | H |
| out/register | 1280 | 2.31% | 800 → 800 | H |
| out/register | 768 | 2.82% | 1067 → 1082 | H |
| out/register | 390 | 12.78% | 964 → 998 | H |
| site/contact | 1440 | 2.16% | 1381 → 1377 | S |
| site/contact | 1280 | 2.43% | 1381 → 1377 | S |
| site/contact | 768 | 3.79% | 1549 → 1519 | S |
| site/contact | 390 | 10.77% | 1920 → 1782 | S, T |
| site/home | 1440 | 18.59% | 13761 → 14052 | S |
| site/home | 1280 | 20.63% | 13761 → 14052 | S |
| site/home | 768 | 17.15% | 18202 → 18206 | S |
| site/home | 390 | 15.77% | 24527 → 24243 | S, T |
| site/insurance | 1440 | 1.96% | 1544 → 1541 | S |
| site/insurance | 1280 | 2.2% | 1544 → 1541 | S |
| site/insurance | 768 | 3.47% | 1712 → 1682 | S |
| site/insurance | 390 | 4.61% | 2412 → 2338 | S, T |
| site/no-such-page | 1440 | 0% | 932 → 932 | S |
| site/no-such-page | 1280 | 0% | 832 → 832 | S |
| site/no-such-page | 768 | 0% | 1056 → 1056 | S |
| site/no-such-page | 390 | 0% | 876 → 876 | S, T |
| site/privacy | 1440 | 1.05% | 2889 → 2886 | S |
| site/privacy | 1280 | 1.18% | 2889 → 2886 | S |
| site/privacy | 768 | 1.92% | 3083 → 3053 | S |
| site/privacy | 390 | 2.39% | 4660 → 4586 | S, T |
| site/risk | 1440 | 1.12% | 3032 → 3029 | S |
| site/risk | 1280 | 1.27% | 3032 → 3029 | S |
| site/risk | 768 | 2.07% | 3200 → 3171 | S |
| site/risk | 390 | 2.65% | 4667 → 4593 | S, T |
| site/security | 1440 | 1.64% | 1834 → 1831 | S |
| site/security | 1280 | 1.85% | 1834 → 1831 | S |
| site/security | 768 | 2.95% | 2002 → 1973 | S |
| site/security | 390 | 3.78% | 2923 → 2849 | S, T |
| site/status | 1440 | 1.94% | 1628 → 1625 | S |
| site/status | 1280 | 2.18% | 1628 → 1625 | S |
| site/status | 768 | 3.44% | 1796 → 1766 | S |
| site/status | 390 | 5.24% | 2205 → 2131 | S, T |
| site/terms | 1440 | 1.09% | 2798 → 2795 | S |
| site/terms | 1280 | 1.22% | 2798 → 2795 | S |
| site/terms | 768 | 1.98% | 2967 → 2937 | S |
| site/terms | 390 | 2.6% | 4246 → 4172 | S, T |
| site/yi | 1440 | 3.68% | 14420 → 14656 | S |
| site/yi | 1280 | 4.14% | 14420 → 14656 | S |
| site/yi | 768 | 16.38% | 19167 → 19005 | S |
| site/yi | 390 | 15.64% | 25966 → 25771 | S, T |
