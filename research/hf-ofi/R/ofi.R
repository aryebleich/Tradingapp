# Order-flow factors and the OFI-N backtest, as plain functions used by hf.Rmd and by the export for
# the app's JavaScript version (src/hfofi.js must match these to 6 decimal places).
#
# Ticks: one row per top-of-book update with columns
#   datetime, last, bid, ask, bid_vol, ask_vol, volume, turnover

suppressPackageStartupMessages({
  library(dplyr)
  library(RcppRoll)
})

# Common CTP / exchange export names are renamed to the ones above.
standardize_ticks <- function(df) {
  map <- c(UpdateTime = "datetime", time = "datetime", LastPrice = "last", BidPrice1 = "bid", AskPrice1 = "ask",
           BidVolume1 = "bid_vol", AskVolume1 = "ask_vol", Volume = "volume", Turnover = "turnover")
  for (k in names(map)) if (k %in% names(df) && !(map[[k]] %in% names(df))) names(df)[names(df) == k] <- map[[k]]
  need <- c("datetime", "last", "bid", "ask", "bid_vol", "ask_vol", "volume", "turnover")
  miss <- setdiff(need, names(df))
  if (length(miss)) stop("The tick data is missing columns: ", paste(miss, collapse = ", "))
  tibble::as_tibble(df[, need])
}

# VOI (Shen 2015): order-volume imbalance at the best quotes.
voi_of <- function(bid, ask, bv, av) {
  pb <- dplyr::lag(bid); pa <- dplyr::lag(ask); pbv <- dplyr::lag(bv); pav <- dplyr::lag(av)
  dvb <- ifelse(bid > pb, bv, ifelse(bid == pb, bv - pbv, 0))
  dva <- ifelse(ask < pa, av, ifelse(ask == pa, av - pav, 0))
  dvb - dva
}
# OFI (Cont, Kukanov and Stoikov 2014): the order-flow contribution e of each update.
ofi_of <- function(bid, ask, bv, av) {
  pb <- dplyr::lag(bid); pa <- dplyr::lag(ask); pbv <- dplyr::lag(bv); pav <- dplyr::lag(av)
  (bid >= pb) * bv - (bid <= pb) * pbv - (ask <= pa) * av + (ask >= pa) * pav
}

# All factors. OFI-N is the right-aligned rolling sum of e over N updates (NA until N values exist).
factors <- function(ticks, n = 10) {
  ticks %>% mutate(
    spread = ask - bid,
    mid = (bid + ask) / 2,
    micro = (bid * ask_vol + ask * bid_vol) / (bid_vol + ask_vol),
    micro_dev = micro - mid,
    imbalance = (bid_vol - ask_vol) / (bid_vol + ask_vol),
    voi = voi_of(bid, ask, bid_vol, ask_vol),
    ofi = ofi_of(bid, ask, bid_vol, ask_vol),
    ofi_n = RcppRoll::roll_sum(ofi, n, align = "right", fill = NA),
    # Rolling differences: the change of each factor over the same N updates.
    d_imbalance = imbalance - dplyr::lag(imbalance, n),
    d_micro_dev = micro_dev - dplyr::lag(micro_dev, n)
  )
}

# Future mid-price change over h updates, regressed on one factor (OLS with an intercept).
regress <- function(f, factor, h) {
  y <- dplyr::lead(f$mid, h) - f$mid
  x <- f[[factor]]
  ok <- is.finite(x) & is.finite(y)
  fit <- lm(y[ok] ~ x[ok])
  s <- summary(fit)
  tibble::tibble(factor = factor, horizon = h, n = sum(ok), beta = unname(coef(fit)[2]), t = unname(s$coefficients[2, 3]), r2 = s$r.squared)
}

# Percentiles the same way as R's default quantile (type 7).
q7 <- function(x, p) unname(stats::quantile(x[is.finite(x)], p, type = 7))

# The OFI-N strategy on one segment: long (1) when OFI-N > hi, back to cash (0) when OFI-N < lo,
# otherwise hold. The position decided at update t earns the mid return from t to t+1, so nothing
# uses a future price. Each change of position costs fee (fraction of price) + slip ticks x tick.
backtest <- function(mid, sig, hi, lo, fee = 0.0001, tick = 1, slip = 1) {
  n <- length(mid); pos <- numeric(n); p <- 0
  for (i in seq_len(n)) { s <- sig[i]; if (is.finite(s)) { if (s > hi) p <- 1 else if (s < lo) p <- 0 }; pos[i] <- p }
  ret <- c(mid[-1] / mid[-n] - 1, 0)             # return from t to t+1 (0 after the last update)
  gross <- pos * ret
  change <- abs(diff(c(0, pos)))                  # entering or leaving
  cost <- change * (fee + slip * tick / mid)
  net <- gross - cost
  list(pos = pos, gross = gross, net = net, cost = cost)
}

# Round trips: from each entry to the next exit (or the end of the segment).
trades_of <- function(pos, r) {
  out <- c(); acc <- NA
  for (i in seq_along(pos)) {
    entering <- pos[i] == 1 && (i == 1 || pos[i - 1] == 0)
    if (entering) acc <- 0
    if (!is.na(acc)) acc <- (1 + acc) * (1 + r[i]) - 1
    leaving <- !is.na(acc) && (i == length(pos) || pos[i + 1] == 0)
    if (leaving) { out <- c(out, acc); acc <- NA }
  }
  out
}
max_dd <- function(r) { eq <- cumprod(1 + r); min(eq / cummax(eq) - 1) }
# Sharpe of per-update returns, scaled to a year: sqrt(updates per day x 252).
sharpe <- function(r, per_day) if (sd(r) > 0) mean(r) / sd(r) * sqrt(per_day * 252) else NA_real_

summarise_bt <- function(bt, per_day) {
  one <- function(r) { tr <- trades_of(bt$pos, r)
    tibble::tibble(trades = length(tr), hit_rate = if (length(tr)) mean(tr > 0) else NA_real_, avg_trade = if (length(tr)) mean(tr) else NA_real_,
                   total = prod(1 + r) - 1, max_dd = max_dd(r), sharpe = sharpe(r, per_day)) }
  dplyr::bind_rows(gross = one(bt$gross), net = one(bt$net), .id = "basis")
}
