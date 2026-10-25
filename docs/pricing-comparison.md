# Pricing comparison

QuantPocket's plans are set to the average of comparable platforms. Competitor prices are the
monthly list prices supplied by the owner (approximate, October 2026). Check them again before
changing prices.

## Competitor prices (per month)

| Platform | Free | Entry tier | Middle tier | Top tier (individual) |
|---|---|---|---|---|
| TradingView | Free (1 chart, 5 indicators) | Essential $14.95 | Plus $34.95 | Ultimate $239.95 (Premium $69.95) |
| TradersPost | – | Starter $49 | Pro $99 | Unlimited $199 |
| SignalStack | Free (5 signals/month) | Basic $27 (50 signals) | Premium $97 (250 signals) | Pro $340 (1,000 signals) |
| QuantConnect | Free (unlimited backtests) | Researcher $60 | Team $120 | Firm up to $1,080 |
| Trade-Ideas | – | Standard $127 | Premium $254 | (Premium is the top) |
| MarketGear | – | Standard $74.99 | – | – |
| Investfly | Free (paper, simple strategies) | Standard $19.99 | Pro $49.99 | – |

## Averages

| Tier | Prices averaged | Average | QuantPocket plan |
|---|---|---|---|
| Free | 4 of 7 platforms have one | $0 | **Starter, $0** |
| Entry | 14.95, 49, 27, 60, 127, 74.99, 19.99 | $53.28 | **Pro, $53** |
| Middle | 34.95, 99, 97, 120, 254, 49.99 | $109.16 | **Elite, $109** |
| Top | 239.95, 199, 340, 1,080, 254, 74.99, 49.99 (each platform's highest individual price) | $319.70 | **Ultimate, $320** |

Yearly billing is 10× the monthly price (two months free, about 17% off). Trade-Ideas gives about
30% off yearly; most others give 15–20%.

## Feature limits, set from the same platforms

| Feature | Comparable limits | Starter | Pro | Elite | Ultimate |
|---|---|---|---|---|---|
| Charts per layout | TradingView 1 / 2 / 4 / 8+ | 1 | 2 | 4 + pop-out | 4 + pop-out |
| Indicators | TradingView 5 / 5 / 10 / 25+ | all | all | all | all |
| Backtests | QuantConnect free tier unlimited | unlimited | unlimited | unlimited | unlimited |
| Alert webhooks / automatic strategies | SignalStack 5 → 1,000 signals; TradersPost by strategies | 1 / 1 (paper) | 10 / 5 | 25 / 25 | 100 / 100 |
| AI assistant messages a day | – | 30 | 300 | 1,000 | 3,000 |
| Performance fee on new profits | (QuantPocket only) | 20% | 10% | 5% | 2.5% |

To charge the new prices, create matching prices in Stripe and set `STRIPE_PRICE_PRO`,
`STRIPE_PRICE_ELITE`, `STRIPE_PRICE_ULTIMATE` and the `_YEARLY` versions.
