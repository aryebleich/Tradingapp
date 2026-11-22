# Order-flow imbalance (OFI) lab: the R research project

An **academic exercise**: building order-flow factors from intraday market-book data for a futures contract (rb2305, the morning session), testing whether they predict the next mid-price moves, and backtesting a simple OFI-10 strategy. Simulated results; not investment advice. Real high-frequency trading needs exchange co-location and direct market data, which this project and the Brightolio app do not provide.

The same math runs interactively in the app (Automate → Pairs & stat arb → Order flow (OFI) lab), in `src/hfofi.js`, and is tested against this project's output to 6 decimal places (`test/hfofi.test.js`).

## Run it (offline, not on the server)

```sh
cd research/hf-ofi
Rscript R/make_sample.R      # the synthetic sample (data/sample.Rds and data/sample.csv)
./run.sh                     # renders hf.Rmd to out/hf.pdf (and out/return.png)
```

Put the real data file at `data/df_rb2305_am1.Rds` (see `data/README.md`). Without it the report uses the synthetic sample and says so on every figure. Packages: see `DESCRIPTION` (conflicted, tidyverse, lubridate, patchwork, paletteer, RcppRoll, rmarkdown; jsonlite for the export). paletteer is optional: without it a fixed Tableau palette is used. A PDF needs pandoc and a LaTeX installation.

## The factors

| Factor | Meaning |
|---|---|
| Quoted spread | ask − bid: what crossing the market costs right now |
| Mid | (bid + ask) / 2 |
| Microprice | (bid × askVol + ask × bidVol) / (bidVol + askVol): the mid tilted toward the side with less volume, a guess at where the price goes next |
| Volume imbalance | (bidVol − askVol) / (bidVol + askVol): from −1 (all on the ask) to +1 (all on the bid) |
| VOI (Shen 2015) | ΔVbid − ΔVask: new buying interest at the best bid minus new selling interest at the best ask |
| OFI (Cont, Kukanov and Stoikov 2014) | e = 1{bid ≥ prev bid}·bidVol − 1{bid ≤ prev bid}·prev bidVol − 1{ask ≤ prev ask}·askVol + 1{ask ≥ prev ask}·prev askVol |
| OFI-N | the rolling sum of e over N updates (RcppRoll::roll_sum, right-aligned) |
| Rolling differences | each factor minus its value N updates earlier |

The first update has no previous quote, so VOI and OFI start at the second update and OFI-N at update N + 1.

## The strategy and the look-ahead fix

Long when OFI-N is above its 80th percentile, back to cash below its 20th, otherwise hold. The position chosen at an update earns the mid return to the next update. The percentiles come from the **in-sample** part only (the first half by default), and the strategy is then run on the **out-of-sample** rest with those thresholds. Computing them on the whole session, as a first version naturally would, uses information from the future. Costs: exchange fee (1 bp by default), one tick of slippage per change of position, tick size 1. Statistics gross and net: trades, hit rate, average return per trade, max drawdown, and a Sharpe ratio of per-update returns × √(updates per day × 252).

## Limits

One session, snapshots instead of every book event, fills at the mid plus a fixed slippage, and no queue position or latency. The original `hf.Rmd` this project is based on is not in this repository, so this version follows the written description of it.
