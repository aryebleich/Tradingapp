// "How this page works": a short plain-language guide at the top of the more advanced pages, for
// people new to investing. Each guide says what the page is for, how to use it in a few steps, and
// what to watch out for, with a link to practice safely first. Guides start open; "Got it" folds
// one away for good (it stays one tap away), and they can be turned off for every page at once.

const G = {
  dashboard: ['Your home base', 'Home shows what your account is worth, how it changed today and since you started, and the shares you own.',
    ['Start in the practice account (paper): it has $100,000 of pretend money and nothing real is at risk.', 'Use the Trade box to buy a small amount of a broad fund such as SPY to see how an order works.', 'Come back over the next days: the chart fills in as your account changes.'],
    'Prices move every day. A drop on one day is normal; judge results over months and years, not hours.'],
  trade: ['Placing an order', 'An order is an instruction to buy or sell. A market order buys right away at the current price; a limit order only buys at your price or better.',
    ['Type a symbol (for example AAPL for Apple, or SPY for a fund of the 500 largest US companies).', 'Pick Buy, then enter how many shares or how many dollars.', 'Press Review order: you always see a summary before anything is sent.'],
    'Check which account is selected at the top. Practice (paper) uses pretend money; a live account uses real money.'],
  positions: ['What you own', 'A position is a holding: how many shares you have, what you paid on average, what they are worth now and your profit or loss.',
    ['Average price is what you paid per share, across all your buys.', 'P/L (profit or loss) is the current value minus what you paid.', 'Tap a symbol to see its chart or to trade it.'],
    'A loss on screen is not final until you sell. Selling to stop a loss is a choice, not an obligation.'],
  orders: ['Your orders', 'Every order you sent and what happened to it: filled (done), open (waiting for its price), or cancelled.',
    ['An open limit order waits until the price reaches your limit.', 'You can cancel an open order at any time before it fills.'],
    'A Day order that is not filled by the 4 PM New York close is cancelled automatically.'],
  options: ['The options chain', 'An option is a contract giving the right to buy (a call) or sell (a put) 100 shares at a set price (the strike) until a set date (the expiration). The price you pay is the premium.',
    ['Pick a stock, then an expiration date.', 'Calls are listed for each strike next to puts. Bid is what buyers offer, ask is what sellers want.', 'Delta (the "?" next to it explains) is a rough chance the option ends up worth something.'],
    'Options can lose all their value by expiration, and selling options can lose more than you received. Try them in the practice account first.'],
  optionslab: ['Options lab', 'Builds option strategies from ready templates and draws what you would make or lose at different stock prices on the expiration date.',
    ['Pick a template, such as a covered call (earn income on shares you own).', 'Look at the payoff chart: above the line is profit, below is loss.', 'Change the strike or date and watch the break-even price move.'],
    'The chart is a what-if, not a forecast. Losses on some strategies can be large; the lab shows the maximum loss where there is one.'],
  chart: ['Reading a chart', 'Each bar or candle shows a period: where the price opened, its high, its low and where it closed.',
    ['Choose the time range at the top (one day, a month, a year...).', 'Add an indicator such as a moving average: the average price over the last days, which smooths out the noise.', 'Volume under the chart shows how many shares changed hands.'],
    'Patterns on a chart describe the past. They do not guarantee where the price goes next.'],
  scanner: ['The scanner', 'Searches the market for stocks that match rules you choose, such as "up more than 3% today" or "price above its 50-day average".',
    ['Start from a ready-made scan.', 'Open a result to see its chart and details before doing anything.', 'Save a scan to get an alert when a new stock matches.'],
    'A stock appearing in a scan is not a recommendation to buy it.'],
  leaders: ['New leaders', 'Finds stocks that recently started doing better than the market, with rising prices and growing trading volume.',
    ['Look at the strength score and the trend.', 'Read the company research before deciding anything.'],
    'Fast risers can fall just as fast. Keep any one stock a small part of your money.'],
  short: ['Short selling', 'Shorting means selling shares you borrow, hoping to buy them back later for less. You profit if the price falls and lose if it rises.',
    ['Practice first: the practice account lets you short with no minimum balance.', 'Tick "Sell short" on a sell order, or use an inverse fund, which rises when the market falls, with no borrowing.', 'Set a stop (a price where you buy back automatically) to limit the loss.'],
    'A short has no limit on how much it can lose, because a price can keep rising. A real account needs margin approval and at least $2,000.'],
  margin: ['Margin', 'Margin is a loan from your brokerage that lets you buy more than your cash covers, with your holdings as security.',
    ['Initial margin is how much of a purchase you must pay yourself (usually 50%).', 'Maintenance margin is the minimum equity you must keep; below it you get a margin call.', 'This page shows how far prices could fall before a margin call.'],
    'Borrowing makes gains and losses larger, and interest is charged on the loan. The brokerage can sell your holdings to cover a margin call.'],
  execution: ['Execution & routing', 'Shows how well your orders were filled: the price you expected against the price you got (slippage), and which brokerage handled them.',
    ['Smart routing picks the connected brokerage that fills best.', 'The record of every order is kept and cannot be changed afterwards.'],
    'Small differences between expected and actual price are normal in fast markets.'],
  strategies: ['The strategy library', 'A strategy is a set of rules for when to buy and sell, for example "buy when the price crosses above its 50-day average". The library has ready-made ones.',
    ['Open a strategy to read its rules in plain words.', 'Press Backtest to see how it would have done in past years.', 'Run it in the practice account before any real money.'],
    'Past results, even good ones, do not promise future returns.'],
  backtest: ['Backtesting', 'A backtest replays a strategy over past prices to show what would have happened: the return, the worst fall (max drawdown) and how bumpy the ride was.',
    ['Pick a strategy and a symbol, then the years to test.', 'Compare it with simply buying and holding the same stock.', 'Look at the max drawdown: could you have sat through that loss?'],
    'Backtests are hypothetical. They leave out some real-world costs, and a rule that fit the past may not fit the future.'],
  bots: ['Bots', 'A bot follows a strategy for you, checking its rules once a day near the close and placing the orders it calls for.',
    ['Start a bot on the practice account and watch it for a few weeks.', 'Every action it takes is listed, with the reason.', 'You can pause or stop it at any time.'],
    'A bot does exactly what its rules say, also in unusual markets. Risk controls (Planning → Risk controls) set limits it cannot cross.'],
  schedule: ['Scheduled trades', 'Places an order automatically at a time you choose, once or on a repeat, for example $100 of an index fund every Monday (dollar-cost averaging).',
    ['Pick the symbol, the amount and when.', 'Choose market (at the price then) or limit (only at your price or better).'],
    'A scheduled order uses the account you pick. Make sure there is enough cash in it.'],
  rules: ['Rules across accounts', 'Automatic rules that watch all your accounts, such as "if any account falls 5% in a day, send me a text" or "keep at least $1,000 cash".',
    ['Pick a ready rule and adjust its numbers.', 'Choose whether it only alerts you or also acts.'],
    'Start with alert-only rules until you trust what they do.'],
  signals: ['Alerts to trades', 'Turns an alert (for example from a chart service) into an order, automatically or after you approve it.',
    ['Copy the alert address shown here into the service that sends alerts.', 'Choose "review" to approve each trade yourself at first.'],
    'Anyone with the address can send alerts, so keep it private.'],
  fleet: ['Signal fleet', 'Sends the same trade signal to several accounts at once, each sized to its own balance.',
    ['Add the accounts, then a signal channel.', 'Choose automatic or review for each account.'],
    'A wrong signal reaches every account in the fleet. Test with practice accounts first.'],
  portfolios: ['Portfolios', 'A ready set of investments with target weights (for example 60% stocks, 40% bonds). Rebalancing brings it back to the targets after prices move.',
    ['Pick a portfolio and the amount to invest.', 'Review the trades it would place before confirming.'],
    'Even a diversified portfolio can fall in value.'],
  aifunds: ['AI long/short portfolios', 'An AI builds a portfolio that owns some stocks (long) and bets against others (short), aiming to depend less on whether the whole market rises or falls.',
    ['Read the reasons it gives for each holding.', 'Nothing is traded until you approve it.', 'Try it in the practice account first.'],
    'The short side can lose without limit and AI picks can be wrong. This is software, not personal investment advice.'],
  pairs: ['Pairs trading', 'Finds two stocks that usually move together. When the gap between them gets unusually wide, it buys the cheaper one and shorts the dearer one, expecting the gap to close.',
    ['The z-score says how unusual the gap is: above 2 or below -2 is unusual.', 'Correlation shows how closely the two have moved together in the past.'],
    'Relationships between stocks can break for good, for example after big company news.'],
  statarb: ['Statistical arbitrage', 'Like pairs trading across many stocks at once: small bets on prices returning to their usual relationships.',
    ['Run it on the practice account first.', 'Watch the total exposure and the worst day.'],
    'Many small edges can still add up to a large loss in a stressed market.'],
  riskview: ['Portfolio & risk', 'Shows how risky your holdings are together: how much they swing, how much they move with the market (beta), and what a crash like 2008 would do.',
    ['Check how concentrated you are: large single holdings add risk.', 'Run a stress test to see a bad-day example in dollars.'],
    'Risk numbers come from the past and can understate a new kind of crisis.'],
  risk: ['Risk controls', 'Limits that protect you from big mistakes: the largest order, the most you can lose in a day before trading pauses, and a kill switch that stops all automated trading.',
    ['Set a daily loss limit you would be comfortable with.', 'Turn on the stop-loss guardian to protect positions automatically.'],
    'Limits apply to orders placed through Brightolio.'],
  insights: ['Insights & journal', 'Explains your results: which holdings and strategies made or lost money, and a journal of your trades with notes.',
    ['Time-weighted return measures your choices, without the effect of deposits.', 'Add a note to a trade: why you made it. It helps you learn from it later.'],
    null],
  tax: ['Taxes', 'Estimates the tax on gains you realized this year: short-term (held a year or less, taxed like income) and long-term (taxed less).',
    ['Gains only count when you sell (or cover a short).', 'A wash sale is a loss that does not count because you bought the same stock again within 30 days.', 'Download the Form 8949 list for your tax preparer.'],
    'These are estimates. Your brokerage sends the official 1099-B, and a tax professional can advise you.'],
  taxpilot: ['Tax autopilot', 'Watches for losses you could sell to lower your tax bill (tax-loss harvesting), and blocks buying them back too soon (a wash sale).',
    ['Review each suggestion before acting on it.'],
    'Selling changes your holdings. Talk to a tax professional about your situation.'],
  analyze: ['Stock & fund analyzer', 'One page on a company or fund: its price trend, its value compared with its profits (P/E ratio), its growth, dividends and plain-language scores.',
    ['Type a symbol.', 'The P/E ratio is the price divided by a year of profit per share; lower can mean cheaper, but compare within the same industry.', 'For funds, look at the expense ratio: the yearly cost, as a percentage.'],
    'Scores sum up the numbers; they are not a recommendation to buy or sell.'],
  lowcost: ['Low-cost index funds', 'Index funds own a whole market (for example the 500 largest US companies) for a very small yearly fee. Many long-term investors build on them.',
    ['Compare expense ratios: 0.03% a year costs $3 for every $10,000 invested.', 'A fund that holds thousands of companies spreads your risk.'],
    'Index funds still fall when the market falls.'],
  earnings: ['Earnings vs expectations', 'Each quarter companies report their profit. This page compares it with what analysts expected; a "beat" or a "miss" often moves the price.',
    ['EPS is earnings (profit) per share.', 'Surprise is how far the result was from the forecast, in percent.'],
    'Prices can swing sharply on earnings days, in either direction.'],
  sp500: ['The S&P 500 plan', 'A simple long-term plan: invest a set amount regularly in a fund that owns the 500 largest US companies.',
    ['Choose an amount and how often.', 'The projection shows a range of outcomes, not a promise.'],
    'The S&P 500 has had years with losses of 30% and more.'],
  invest: ['Futures, funds & savings', 'Other kinds of investments in one place: futures (contracts on a future price), funds, and savings options.',
    ['Start with the tab that matches your goal.', 'Read the "how it works" line under each product.'],
    'Futures use borrowed money (leverage) and can lose more than you put in.'],
  robo: ['Automated portfolios', 'Answer a few questions about your goal and comfort with risk, and get a matching mix of funds that is rebalanced for you.',
    ['Answer honestly: a mix you can stick with in a bad year is the right one.'],
    'Software suggestions, not personal investment advice.'],
  retirement: ['Retirement & IRAs', 'Plans saving for retirement: how much you might have, and the tax-advantaged accounts (Traditional and Roth IRA) that can help.',
    ['A Traditional IRA can lower tax now; a Roth IRA can mean no tax later.', 'Try different monthly amounts and see the effect over the years.'],
    'Projections use assumed returns. Real returns vary.'],
  agents: ['Forecasts & AI agents', 'Models that estimate where a price might go, trained on past data, which you can test and run as bots.',
    ['Look at how accurate a model was on data it did not train on.', 'Run it on practice money first.'],
    'Forecasts are often wrong. Treat them as one input, not an answer.'],
  ai: ['The AI assistant', 'Ask questions in plain words: "what is an ETF?", "how did my account do this month?", "show me Apple\'s earnings". It can also prepare a practice order for you to confirm.',
    ['Ask it to explain anything on the site you do not understand.', 'It never places a real order by itself; you confirm every order.'],
    'AI answers can contain mistakes. Check important numbers.'],
  institutions: ['Institutional portfolios', 'Large investment firms report their US stock holdings every quarter (form 13F). This page shows what they own and what they changed.',
    ['The data is up to 45 days old when it is published.'],
    'A famous investor owning a stock is not a reason by itself to buy it.'],
  tokenized: ['Tokenized securities', 'Shares and funds recorded on a blockchain, which can trade at more hours of the day.',
    ['Check who issues the token and what backs it.'],
    'Rules and protections can differ from regular shares.'],
  money: ['All my money', 'Brings your accounts together: cash, investments and debts, so you see your whole picture in one place.', ['Connect the accounts you want to include.'], null],
  accounts: ['All accounts', 'Every account you connected, side by side, with totals.', ['Use "Equalize" to spread money evenly between accounts.'], null],
  private: ['Private markets', 'Investments that do not trade on a stock exchange, such as private companies and private funds.',
    ['Check the minimum investment and how long your money is locked up.'],
    'Private investments can be hard to sell and are usually for experienced investors.'],
  realestate: ['Real estate', 'Ways to invest in property: real estate funds (REITs) that trade like shares, and property tools.', ['REITs pay out most of their income as dividends.'], 'Property values and rents can fall.'],
  'alpaca-tools': ['Bonds, rates & crypto', 'Bonds (loans to governments or companies that pay interest), current interest rates, and cryptocurrencies.',
    ['A bond\'s yield is its yearly interest as a percentage of its price.', 'Crypto trades every day of the week, around the clock.'],
    'Crypto prices can swing by 10% or more in a day.'],
  calendar: ['Calendar & events', 'Upcoming events that can move prices: earnings reports, dividends, stock splits, new listings (IPOs) and market holidays.', ['Add events for stocks you own to your alerts.'], null],
  longterm: ['The long-term view', 'Your results over years instead of days, to help you stay calm through daily ups and downs.', ['Compare your path with a simple index fund.'], null],
  values: ['Values investing', 'Invest in line with your values: screens for companies that fit your principles, and features such as no trading on Shabbos and Yom Tov.', ['Pick the values that matter to you; the screens follow them.'], null],
  research: ['Plain-language research', 'Company filings and reports summarized in everyday words: what the company does, how it makes money and its main risks.', ['Read the risks section before the highlights.'], 'Summaries can leave out details; the original filing is linked.'],
  news: ['News & sentiment', 'News about the markets and your holdings, with a score of whether the tone is positive or negative.', ['Use it to understand why a price moved.'], 'Headlines can be wrong or quickly out of date.'],
};

const key = r => 'qp_guide_' + r;
const get = k => { try { return localStorage.getItem(k); } catch { return null; } };
const put = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} };
const shown = {};
export const GUIDE_PAGES = Object.keys(G);
export const hasGuide = route => !!G[route];
export const guidesOff = () => get('qp_guides') === 'off';

// Adds the guide under the page's title. `practice` says whether the practice account is in use.
export function pageGuide(view, route, { practice = true } = {}) {
  const g = G[route]; if (!g || !view || view.querySelector('.pguide')) return;
  const [title, what, steps, caution] = g;
  // A page that redraws itself (every 20 seconds on live pages) keeps the guide as the user left it.
  const open = shown[route] ?? (!guidesOff() && get(key(route)) !== 'seen');
  const box = document.createElement('details');
  box.className = 'pguide card'; box.open = open;
  box.innerHTML = `<summary><span class="pg-ic" aria-hidden="true">i</span><span class="pg-h">${open && get(key(route)) !== 'seen' ? 'New to this? ' : ''}How this page works</span><span class="pg-sub">${title}</span></summary>
    <div class="pg-body"><p>${what}</p>
      ${steps?.length ? `<ol>${steps.map(s => `<li>${s}</li>`).join('')}</ol>` : ''}
      ${caution ? `<p class="pg-warn"><b>Good to know:</b> ${caution}</p>` : ''}
      <div class="pg-act"><button type="button" class="small" data-pg="seen">Got it</button>
        ${practice ? '' : '<span class="pg-tip">Tip: switch the Trading mode in the menu to Practice to try this with pretend money.</span>'}
        <a class="pg-link" href="#/learn">Learning center</a><a class="pg-link" href="#/ai">Ask the AI assistant</a>
        <button type="button" class="link small" data-pg="off">${guidesOff() ? 'Show guides on every page' : 'Hide guides on every page'}</button></div></div>`;
  box.addEventListener('toggle', () => { shown[route] = box.open; });
  box.addEventListener('click', e => {
    const b = e.target.closest('[data-pg]'); if (!b) return;
    if (b.dataset.pg === 'seen') { put(key(route), 'seen'); box.open = false; box.querySelector('.pg-h').textContent = 'How this page works'; }
    else { const off = !guidesOff(); put('qp_guides', off ? 'off' : null); b.textContent = off ? 'Show guides on every page' : 'Hide guides on every page'; if (off) box.open = false; }
  });
  // Right under the page title (and the Home clock); before the first card when the title sits
  // inside one, and at the top when the page has no title. Always a direct part of the page.
  const h1 = view.querySelector('h1'), top = h1 && [...view.children].find(c => c === h1 || c.contains(h1));
  if (!top) return view.prepend(box);
  if (top !== h1 && !top.classList.contains('row')) return top.before(box);
  const clock = top.nextElementSibling?.id === 'homeClock' ? top.nextElementSibling : null;
  (clock || top).after(box);
}
