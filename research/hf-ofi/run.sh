#!/usr/bin/env bash
# Renders the report into out/ (run from research/hf-ofi/; makes the synthetic sample first if needed).
set -euo pipefail
cd "$(dirname "$0")"
[ -f data/sample.Rds ] || Rscript R/make_sample.R
mkdir -p out
Rscript -e 'rmarkdown::render("hf.Rmd", output_dir = "out")'
