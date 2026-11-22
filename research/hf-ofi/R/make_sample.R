# Writes data/sample.Rds (and data/sample.csv for the app): synthetic morning-session ticks shaped
# like a Chinese rebar future (rb2305): a 1-yuan tick, prices near 4,100, a half-second update rate,
# order-book volumes that lean the way the price is about to move. SYNTHETIC: not market data.
# Run from research/hf-ofi/:  Rscript R/make_sample.R
set.seed(2305)
n <- 6000
t0 <- as.POSIXct("2023-03-01 09:00:00", tz = "Asia/Shanghai")
datetime <- t0 + (seq_len(n) - 1) * 0.5
tick <- 1
mid <- numeric(n); bid <- numeric(n); ask <- numeric(n); bv <- numeric(n); av <- numeric(n)
pressure <- 0; m <- 4100.5
for (i in seq_len(n)) {
  pressure <- 0.92 * pressure + rnorm(1, 0, 0.35)                 # slowly changing order-flow pressure
  lean <- tanh(pressure)
  bv[i] <- max(1, round(rlnorm(1, log(60), 0.6) * (1 + lean)))
  av[i] <- max(1, round(rlnorm(1, log(60), 0.6) * (1 - lean)))
  up <- 0.08 * (1 + lean); down <- 0.08 * (1 - lean)               # the mid moves with the pressure
  u <- runif(1); if (u < up) m <- m + tick else if (u < up + down) m <- m - tick
  wide <- runif(1) < 0.15                                          # mostly a one-tick spread
  bid[i] <- m - 0.5
  ask[i] <- m + 0.5 + if (wide) tick else 0                        # sometimes two ticks wide
}
volume <- cumsum(rpois(n, 8)); last <- ifelse(runif(n) < 0.5, bid, ask)
turnover <- cumsum(c(volume[1], diff(volume)) * last * 10)          # 10 tons per lot
df <- data.frame(datetime = datetime, last = last, bid = bid, ask = ask, bid_vol = bv, ask_vol = av, volume = volume, turnover = turnover)
attr(df, "synthetic") <- TRUE
dir.create("data", showWarnings = FALSE)
saveRDS(df, "data/sample.Rds")
out <- df; out$datetime <- format(out$datetime, "%Y-%m-%dT%H:%M:%OS3%z")
write.csv(out, "data/sample.csv", row.names = FALSE)
cat("Wrote data/sample.Rds and data/sample.csv:", n, "synthetic ticks\n")
