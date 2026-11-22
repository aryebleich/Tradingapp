# Exports the R results on the synthetic sample to test/fixtures/hfofi-expected.json, so the app's
# JavaScript (src/hfofi.js) can be checked against R to 6 decimal places (test/hfofi.test.js).
# Run from research/hf-ofi/:  Rscript R/export_expected.R
source("R/ofi.R")
df <- read.csv("data/sample.csv")
ticks <- standardize_ticks(df)
n <- 10; f <- factors(ticks, n)
reg <- do.call(rbind, lapply(c("spread", "imbalance", "micro_dev", "voi", "ofi", "ofi_n", "d_imbalance", "d_micro_dev"), function(k) do.call(rbind, lapply(c(1, 5, 10, 20), function(h) regress(f, k, h)))))
split <- floor(nrow(f) * 0.5); ins <- f[seq_len(split), ]; oos <- f[(split + 1):nrow(f), ]
hi <- q7(ins$ofi_n, 0.8); lo <- q7(ins$ofi_n, 0.2)
bt_in <- backtest(ins$mid, ins$ofi_n, hi, lo); bt_out <- backtest(oos$mid, oos$ofi_n, hi, lo)
cols <- c("spread", "mid", "micro", "imbalance", "voi", "ofi", "ofi_n", "d_imbalance", "d_micro_dev")
head_rows <- lapply(cols, function(k) { v <- f[[k]][1:60]; ifelse(is.finite(v), v, NA) }); names(head_rows) <- cols
out <- list(n = nrow(f), window = n, head = head_rows,
  sums = lapply(setNames(cols, cols), function(k) sum(f[[k]], na.rm = TRUE)),
  regressions = reg, thresholds = list(hi = hi, lo = lo, split = split),
  in_sample = summarise_bt(bt_in, nrow(f)), out_of_sample = summarise_bt(bt_out, nrow(f)),
  pos_in_sum = sum(bt_in$pos), pos_out_sum = sum(bt_out$pos))
dir.create("../../test/fixtures", showWarnings = FALSE, recursive = TRUE)
jsonlite::write_json(out, "../../test/fixtures/hfofi-expected.json", digits = NA, auto_unbox = TRUE, na = "null", pretty = TRUE)
cat("Wrote test/fixtures/hfofi-expected.json\n")
