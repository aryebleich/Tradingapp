# Data

The project ships with **synthetic** ticks, `sample.Rds` and `sample.csv`, made by `R/make_sample.R` (seeded, so they are the same every time). The report and the app use them by default, so **no market data and no data licence are needed**.

To study tick data of your own (data you are allowed to use), put it here in an R data frame with one row per top-of-book update and these columns, and render with `params = list(data = "data/your_file.Rds")`:

| Column | Meaning |
|---|---|
| `datetime` | time of the update (POSIXct) |
| `last` | last traded price |
| `bid`, `ask` | best bid and best ask price |
| `bid_vol`, `ask_vol` | volume at the best bid and at the best ask |
| `volume` | cumulative traded volume |
| `turnover` | cumulative traded value |

Common CTP names are renamed automatically: `UpdateTime`, `LastPrice`, `BidPrice1`, `AskPrice1`, `BidVolume1`, `AskVolume1`, `Volume`, `Turnover`. Files of your own are ignored by git, so they are never published with the repository.

For the app, export the same columns as CSV: `write.csv(readRDS("your_file.Rds"), "ticks.csv", row.names = FALSE)`.
