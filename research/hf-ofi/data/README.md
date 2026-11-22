# Data

Put the real tick file here as **`data/df_rb2305_am1.Rds`**. It is not in the repository (it may be licensed) and is ignored by git.

The file is an R data frame (or tibble) with one row per top-of-book update and these columns:

| Column | Meaning |
|---|---|
| `datetime` | time of the update (POSIXct) |
| `last` | last traded price |
| `bid`, `ask` | best bid and best ask price |
| `bid_vol`, `ask_vol` | volume at the best bid and at the best ask |
| `volume` | cumulative traded volume |
| `turnover` | cumulative traded value |

Common CTP names are renamed automatically: `UpdateTime`, `LastPrice`, `BidPrice1`, `AskPrice1`, `BidVolume1`, `AskVolume1`, `Volume`, `Turnover`.

`sample.Rds` / `sample.csv` are **synthetic** ticks made by `R/make_sample.R` (seeded, so they are the same every time), so the report and the app work without the real file.

For the app, export the same columns as CSV: `write.csv(readRDS("df_rb2305_am1.Rds"), "ticks.csv", row.names = FALSE)`.
