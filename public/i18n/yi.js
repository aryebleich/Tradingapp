// Yiddish for the Brightfolio app (exact English phrase → Yiddish). Written in everyday
// American-Hasidic usage: common trading terms stay in their English form, in Yiddish letters.
import labs from './yi-labs.js';
import * as features from './yi-features.js';
import * as protect from './yi-protect.js';
import * as wealth from './yi-wealth.js';
import * as batch5 from './yi-batch5.js';
import * as batch6 from './yi-batch6.js';
import * as batch8 from './yi-batch8.js';
import * as batch9 from './yi-batch9.js';
import * as batch11 from './yi-batch11.js';
import * as batch12 from './yi-batch12.js';

export const credit = '';

export const strings = {
  // navigation + shell
  'Trading': 'טרעידינג', 'Markets': 'מארקעטס', 'Strategies': 'סטראטעגיעס', 'Account': 'קאנטע', 'Owner': 'אייגנטימער',
  'Portfolio': 'פארטפאליא', 'Trade': 'טרעידן', 'Orders': 'ארדערס', 'Positions': 'פאזיציעס', 'Watchlists': 'וואטש-ליסטעס',
  'S&P 500 plan': 'S&P 500 פלאן', 'Markets & news': 'מארקעטס און נייעס', 'Options chain': 'אפשאנס טאבעלע', 'Calendar & events': 'קאלענדאר און געשעענישן',
  'Strategy library': 'סטראטעגיע ביבליאטעק', 'Alerts to trades': 'אלערטס צו טרעידס', 'Pairs trading': 'פעירס טרעידינג', 'Backtest': 'באקטעסט', 'Bots': 'באטס',
  'Scheduled trades': 'געפלאנטע טרעידס', 'QuantConnect': 'QuantConnect', 'Brokerages': 'בראוקערס', 'Alpaca account': 'Alpaca קאנטע', 'Plans & billing': 'פלענער און באצאלונג',
  'Invite & earn': 'לאדנט איין און פארדינט', 'Taxes': 'שטייערן', 'Text & hotline': 'טעקסט און האטליין', 'Settings': 'סעטינגס', 'Admin': 'אדמין',
  'Sign out': 'ארויסלאגירן', 'Sign in': 'אריינלאגירן', 'Menu': 'מעניו', 'Switch theme': 'טויש קאליר', 'Language': 'שפראך',
  'Try Pro free for 14 days': 'פרובירט Pro אומזיסט פאר 14 טעג', 'Upgrade to Pro': 'גייט ארויף צו Pro',
  'Paper': 'פּעיפּער', 'Simulated': 'סימולירט', 'LIVE MONEY': 'עכטע געלט', 'Alpaca paper': 'Alpaca פּעיפּער', 'No brokerage connected': 'קיין בראוקער נישט פארבינדן',

  // auth
  'Create account': 'עפנט א קאנטע', 'Create an account': 'עפנט א קאנטע', 'Email': 'אימעיל', 'Password': 'פאסווארט',
  'Password (10+ chars, upper, lower, digit)': 'פאסווארט (10+ אותיות, גרויס, קליין, א נומער)', 'Forgot password?': 'פארגעסן דעם פאסווארט?',
  'New here?': 'נייע דא?', 'Sign in instead': 'לאגירט זיך אריין אנשטאט', 'Continue with Google': 'גייט ווייטער מיט Google', 'Sign up with Google': 'עפנט א קאנטע מיט Google',
  'or': 'אדער', 'I agree to the': 'איך שטים איין צו די', 'and': 'און', 'and have read the': 'און האב געליינט די',
  'Terms': 'תנאים', 'Privacy Policy': 'פריוואטקייט פאליסי', 'Privacy': 'פריוואטקייט', 'Risk Disclosure': 'ריזיקע ערקלערונג', 'Support': 'סופּאָרט',
  'By continuing with Google you agree to the': 'מיטן ווייטער גיין מיט Google שטימט איר איין צו די',
  'You start with a $100,000 paper account.': 'איר הייבט אן מיט א $100,000 פּעיפּער קאנטע.',
  'Reset your password': 'שטעלט צוריק אייער פאסווארט', 'Enter your email and we will send you a reset link.': 'שרייבט אייער אימעיל און מיר וועלן אייך שיקן א לינק.',
  'Send reset link': 'שיקט דעם לינק', 'Back to sign in': 'צוריק צום אריינלאגירן', 'Choose a new password': 'קלויבט א נייעם פאסווארט',
  'New password (10+ chars, upper, lower, digit)': 'נייער פאסווארט (10+ אותיות, גרויס, קליין, א נומער)', 'Save password': 'היט אפ דעם פאסווארט',
  'Two-factor code': 'צוויי-שריט קאוד', 'Open your authenticator app.': 'עפנט אייער authenticator עפּ.', '6-digit code': '6 ציפערן קאוד', 'Verify': 'באשטעטיגן',
  'Email confirmed': 'דער אימעיל איז באשטעטיגט', 'Continue': 'גייט ווייטער',
  'Backtest, paper trade and automate stock strategies. Connect Alpaca and QuantConnect, trade by text or phone.': 'באקטעסט, פּעיפּער טרעידינג און אויטאמאטישע סטאק סטראטעגיעס. פארבינדט Alpaca און QuantConnect, טרעידט דורך טעקסט אדער טעלעפאן.',

  // common
  'Save': 'אפהיטן', 'Save changes': 'אפהיטן די ענדערונגען', 'Cancel': 'אפשטעלן', 'Delete': 'אויסמעקן', 'Edit': 'רעדאגירן', 'Remove': 'אראפנעמען', 'Rename': 'טוישן נאמען',
  'Add': 'צולייגן', 'Send': 'שיקן', 'Go': 'גיי', 'Open': 'עפענען', 'Close': 'פארמאכן', 'Back': 'צוריק', 'Done': 'פארטיג', 'Copy': 'קאפירן',
  'Loading…': 'לאדנט…', 'Working…': 'ארבעט…', 'None': 'קיינע', 'None yet': 'נאך קיינע', 'Nothing yet': 'נאך גארנישט', 'Off': 'אויס', 'On': 'אן', 'Yes': 'יא', 'No': 'ניין',
  'Name': 'נאמען', 'Date': 'דאטום', 'Time': 'צייט', 'When': 'ווען', 'Type': 'סארט', 'Status': 'סטאטוס', 'Amount': 'סכום', 'Amount ($)': 'סכום ($)', 'Amount (USD)': 'סכום (דאלאר)',
  'Price': 'פרייז', 'Prices': 'פרייזן', 'Value': 'ווערט', 'Symbol': 'סימבאל', 'Ticker': 'טיקער', 'Qty': 'צאל', 'Side': 'זייט', 'Buy': 'קויפן', 'Sell': 'פארקויפן',
  'buy': 'קויפן', 'sell': 'פארקויפן', 'exit': 'ארויסגיין', 'Cash': 'קעש', 'Equity': 'ווערט', 'Buying power': 'קויף-קראפט', 'Today': 'היינט', 'Total P/L': 'סך הכל געווינס/פארלוסט',
  'Profit / loss': 'געווינס / פארלוסט', 'Unrealized P/L': 'נאכנישט ריאליזירטע געווינס/פארלוסט', 'Market value': 'מארקעט ווערט', 'Avg entry': 'דורכשניטליכע אריינקויף', 'Avg': 'דורכשניט',
  'Order type': 'ארדער סארט', 'Market': 'מארקעט', 'Limit': 'לימיט', 'Stop': 'סטאפ', 'Time in force': 'גילטיג פאר', 'Day': 'טאג', 'Shares': 'שערס', 'Dollars': 'דאלארן',
  'Review order': 'קוקט איבער דעם ארדער', 'Place market order': 'שטעלט א מארקעט ארדער', 'Recent orders': 'לעצטע ארדערס', 'All orders →': 'אלע ארדערס ←', 'All positions →': 'אלע פאזיציעס ←',
  'No orders.': 'קיין ארדערס.', 'No positions.': 'קיין פאזיציעס.', 'No positions': 'קיין פאזיציעס', 'No open positions.': 'קיין אפענע פאזיציעס.',
  'Account settings': 'קאנטע סעטינגס', 'Details': 'פרטים', 'Result': 'רעזולטאט', 'Results': 'רעזולטאטן', 'Signal': 'סיגנאל', 'Message': 'מעסעדזש', 'Note': 'באמערקונג',
  'Monthly': 'חודש\'ליך', 'Yearly': 'יערליך', 'Weekly': 'וועכנטליך', 'Once': 'איינמאל', 'Every trading day': 'יעדן טרעידינג טאג', 'Year': 'יאר', 'Years': 'יארן',
  'Most popular': 'מערסטע פאפולער', '2 months free': '2 חדשים אומזיסט', 'Pro': 'Pro', 'Current': 'יעצטיגע', 'Your plan': 'אייער פלאן',
  'Automatic': 'אויטאמאטיש', 'By hand': 'מיט די האנט', 'Strategy': 'סטראטעגיע', 'Rule': 'כלל', 'Decision': 'באשלוס', 'Run now': 'לויפט יעצט', 'History': 'היסטאריע',
  'Not connected': 'נישט פארבינדן', 'Disconnect': 'אפשניידן', 'Connected': 'פארבינדן', 'Enabled': 'איינגעשאלטן', 'New': 'נייע',

  // dashboard
  'Place a trade': 'מאכט א טרעיד', 'Reset paper account': 'שטעלט צוריק די פּעיפּער קאנטע', 'The line turns green above your starting value and red below it.': 'די ליניע ווערט גרין איבער אייער אנהייב ווערט און רויט אונטער דעם.',
  'Projected next-year return': 'ערווארטעטע קומענדיגע-יאר רעטורן', 'Bad year (5th pct)': 'שלעכט יאר (5טע פראצענטיל)', 'Typical (median)': 'געווענליך (מעדיאן)', 'Good year (95th)': 'גוט יאר (95טע)', 'Chance of a loss': 'שאנס פון א פארלוסט',

  // trading pages
  'Symbol or company': 'סימבאל אדער פירמע', 'AAPL, BTC/USD, Apple…': 'AAPL, BTC/USD, Apple…', 'Bid': 'ביד', 'Ask': 'אסק', 'Bid / Ask': 'ביד / אסק', 'Volume': 'וואלום',
  'News': 'נייעס', 'No recent news.': 'קיין לעצטע נייעס.', 'News unavailable.': 'נייעס נישט גרייט.', 'Top movers': 'גרעסטע באוועגונגען', 'Most active': 'מערסטע אקטיוו',
  'Market is': 'דער מארקעט איז', 'Next open': 'קומענדיגע עפענונג', 'Next close': 'קומענדיגע פארמאכונג', 'Early close': 'פריע פארמאכונג',
  'Advanced: bracket, OCO, OTO, extended hours': 'פארגעשריטן: bracket, OCO, OTO, עקסטערע שעהן', 'Limit price': 'לימיט פרייז', 'Stop price': 'סטאפ פרייז',
  'Take-profit limit': 'געווינס-נעמען לימיט', 'Stop-loss stop': 'סטאפ-לאס', 'Stop-loss limit (optional)': 'סטאפ-לאס לימיט (אפציאנאל)', 'Trail %': 'טרעיל %',
  'Allow pre-market & after-hours (Day orders)': 'ערלויבט פאר און נאך מארקעט שעהן (טאג ארדערס)', 'Estimated cost': 'אומגעפערע קאסט',
  'Cancel all open': 'אנולירט אלע אפענע', 'Close all positions': 'פארמאכט אלע פאזיציעס', 'Modify': 'טוישן', 'Submitted': 'געשיקט', 'Filter': 'פילטער',
  'Every open order on this account will be cancelled.': 'יעדער אפענער ארדער אויף די קאנטע וועט ווערן אנולירט.',
  'Market orders will be sent to close every position, and open orders will be cancelled.': 'מארקעט ארדערס וועלן פארמאכן יעדע פאזיציע, און אפענע ארדערס וועלן ווערן אנולירט.',
  'This is a LIVE order with real money.': 'דאס איז אן עכטער ארדער מיט עכטע געלט.', 'This sends a real order with real money.': 'דאס שיקט אן עכטן ארדער מיט עכטע געלט.',
  'Empty. Add a symbol above.': 'ליידיג. לייגט צו א סימבאל אויבן.', 'New watchlist name': 'נאמען פאר א נייע ליסטע', 'No watchlists yet. Create one above.': 'נאך קיין ליסטעס. שאפט איינס אויבן.',
  'Add symbol (AAPL, BTC/USD)': 'לייגט צו א סימבאל (AAPL, BTC/USD)', 'Calls': 'קאָלס', 'Puts': 'פּוּטס', 'Strike': 'סטרייק', 'Expiration': 'אויסלויף',
  'Underlying': 'אונטערליגנדע', 'Order builder': 'ארדער בויער', 'Click a bid or ask in the chain to add a leg.': 'קליקט אויף א ביד אדער אסק אין דער טאבעלע צו צולייגן א טייל.',
  'Options can expire worthless. Max loss on long options is the premium paid.': 'אפשאנס קענען אויסלויפן אן ווערט. דער מאקסימום פארלוסט אויף לאנג אפשאנס איז די באצאלטע פרעמיע.',
  'Corporate actions': 'פירמע אקציעס', 'Trading days (next 30 days)': 'טרעידינג טעג (קומענדיגע 30 טעג)', 'No announcements in this window.': 'קיין מעלדונגען אין די צייט.',
  'Days not listed are market holidays or weekends. Times are New York time.': 'טעג וואס זענען נישט אויסגערעכנט זענען יום טוב אדער סוף וואך. די צייטן זענען ניו יארק צייט.',

  // brokerage account (Alpaca)
  'Open a brokerage account': 'עפנט א בראוקער קאנטע', 'Connect an existing Alpaca account': 'פארבינדט אן עקזיסטירנדע Alpaca קאנטע', 'Connect with Alpaca': 'פארבינדט מיט Alpaca',
  'Use API keys': 'ניצט API שליסלען', 'Save keys': 'היט אפ די שליסלען', 'API key ID': 'API שליסל ID', 'Secret key': 'געהיימער שליסל', 'These are live (real money) keys': 'דאס זענען עכטע (עכטע געלט) שליסלען',
  'Your Alpaca account is connected.': 'אייער Alpaca קאנטע איז פארבינדן.', 'Your account is active. You can fund it and start trading.': 'אייער קאנטע איז אקטיוו. איר קענט אריינלייגן געלט און אנהייבן טרעידן.',
  'Link a bank account': 'פארבינדט א באנק קאנטע', 'Link bank': 'פארבינדט באנק', 'No bank linked yet.': 'נאך קיין באנק נישט פארבינדן.', 'Deposit to brokerage': 'לייגט אריין אין בראוקער',
  'Withdraw to bank': 'נעמט ארויס צום באנק', 'Transfers': 'טראנספערס', 'No transfers yet': 'נאך קיין טראנספערס', 'Submit transfer': 'שיקט די טראנספער',
  'Routing number': 'ראוטינג נומער', 'Account number': 'קאנטע נומער', 'Account holder name': 'נאמען פונעם קאנטע אייגנטימער', 'Nickname': 'צונאמען',
  'First name': 'ערשטער נאמען', 'Middle name': 'מיטלסטער נאמען', 'Last name': 'פאמיליע נאמען', 'Date of birth': 'געבורטס טאג', 'Social Security number': 'סאשעל סעקיוריטי נומער',
  'Street address': 'גאס אדרעס', 'Apt / unit': 'דירה', 'City': 'שטאט', 'State': 'סטעיט', 'ZIP code': 'זיפ קאוד', 'Mobile phone': 'מאביל טעלעפאן', 'Employer': 'ארבעטגעבער',
  'Takes about 3 minutes. Accounts are held by Alpaca Securities LLC, member FINRA/SIPC.': 'נעמט בערך 3 מינוט. די קאנטעס ווערן געהאלטן ביי Alpaca Securities LLC, מיטגליד FINRA/SIPC.',
  'Required by law to verify your identity (KYC). Your SSN is sent securely to Alpaca and is not stored by Brightfolio.': 'דאס געזעץ פארלאנגט צו באשטעטיגן ווער איר זענט (KYC). אייער SSN ווערט זיכער געשיקט צו Alpaca און Brightfolio היט עס נישט אפ.',
  'Sign in at Alpaca and approve access. We never see your Alpaca password.': 'לאגירט זיך איין ביי Alpaca און גיט רשות. מיר זעען קיינמאל נישט אייער Alpaca פאסווארט.',

  // strategy library
  'My strategies': 'מיינע סטראטעגיעס', 'Library': 'ביבליאטעק', 'Use this strategy': 'ניצט די סטראטעגיע', 'Portfolio split': 'פארטפאליא צעטיילונג',
  'Use these allocations': 'ניצט די צעטיילונג', 'Runs': 'לויפט', 'Money': 'געלט', 'Last result': 'לעצטער רעזולטאט', 'Reality Check': 'ריעליטי טשעק',
  'Backtest, 5 years': 'באקטעסט, 5 יאר', 'Worst drop': 'ערגסטער אראפפאל', 'Live, last 3 months': 'לייוו, לעצטע 3 חדשים',
  'Live results so far are far below the backtest': 'די לייוו רעזולטאטן ביז יעצט זענען ווייט אונטער דעם באקטעסט',
  
  'Backtests are hypothetical and leveraged ETFs can lose most of their value quickly. Results shown are not a promise of future returns.': 'באקטעסטס זענען היפאטעטיש, און לעווערעדזש ETFs קענען שנעל פארלירן רוב פון זייער ווערט. די רעזולטאטן זענען נישט קיין הבטחה פאר די צוקונפט.',
  "Today's walkdown": 'היינטיגער וואקדאון', 'Orders go to:': 'ארדערס גייען צו:', '2nd value': '2טע ווערט', 'Needs a rule': 'דארף א כלל',
  'check': 'טשעק', 'Clear typed values': 'מעקט אויס די אריינגעשריבענע נומערן',
  'No position today: stay in cash.': 'היינט קיין פאזיציע: בלייבט אין קעש.', 'Target $': 'ציל $', 'Target shares': 'ציל שערס', 'Held': 'געהאלטן', 'Order': 'ארדער',
  
  'Run backtest': 'לויפט באקטעסט', 'Return per year': 'רעטורן א יאר', 'S&P 500 per year': 'S&P 500 א יאר', 'Sharpe': 'שארפ', 'Total return': 'סך הכל רעטורן', 'Switches': 'טוישן',
  'Running… (loading several years of prices for every ticker the rules use)': 'לויפט… (לאדנט עטליכע יאר פרייזן פאר יעדן טיקער)',
  'Edit rules': 'רעדאגירט די כללים', "Change any number, indicator or ticker, then preview today's result or backtest before saving.": 'טוישט סיי וועלכע נומער, אינדיקאטאר אדער טיקער, און זעט דעם היינטיגן רעזולטאט אדער באקטעסט פארן אפהיטן.',
  'Preview today': 'זעט היינט', 'Backtest these rules': 'באקטעסט די כללים', 'Save rules': 'היט אפ די כללים', 'Back to original': 'צוריק צום ארגינעל',
  'Advanced: edit as JSON': 'פארגעשריטן: רעדאגירט ווי JSON', 'Apply JSON': 'ניצט JSON', 'Turn into a comparison': 'מאכט עס א פארגלייך',
  'Money for this strategy (% of account)': 'געלט פאר די סטראטעגיע (% פון קאנטע)', 'Cash kept aside (%)': 'קעש אוועקגעלייגט (%)', 'Trailing stop (%)': 'טרעילינג סטאפ (%)',
  'Trade at (New York time)': 'טרעידט ביי (ניו יארק צייט)', 'Whole shares only': 'נאר גאנצע שערס', 'Save settings': 'היט אפ די סעטינגס',
  'Auto-throttle: trade 50% while on Watch, 0% while Drifting': 'אויטא-ברעמז: טרעידט 50% ביי "וואטש", 0% ביי "דריפטינג"',
  'Live days': 'לייוו טעג', 'Live return': 'לייוו רעטורן', 'Backtest expected': 'באקטעסט האט ערווארט', 'Win rate': 'געווינס ראטע', 'Delete strategy': 'מעקט אויס די סטראטעגיע', 'No runs yet.': 'נאך נישט געלאפן.',
  'Healthy': 'געזונט', 'Watch': 'היט אויף', 'Drifting': 'דריפט אוועק', 'Learning': 'לערנט זיך',
  'Rebalance day:': 'באלאנס טאג:', 'New buys:': 'נייע קויפן:', 'Exits:': 'ארויסגיין:', 'Keep:': 'האלטן:', 'Predictions:': 'פאראויסזאגן:',
  'Stocks to rank (comma separated)': 'סטאקס צו ראנגירן (מיט קאמעס)', 'Stocks to scan': 'סטאקס צו סקענען', 'Predictions': 'פאראויסזאגן', 'I type them each month': 'איך שרייב זיי יעדן חודש',
  'Automatic (recent return)': 'אויטאמאטיש (לעצטע רעטורן)', 'Bitcoin ticker': 'ביטקוין טיקער', 'Rebalance day': 'באלאנס טאג', 'Predicted 21-day return %': 'פאראויסגעזאגטע 21-טאג רעטורן %',
  'Asset': 'אסעט', 'Weight': 'וואג', 'Rank': 'ראנג', 'Pullback': 'צוריקפאל', 'Z-score': 'Z-סקאר', 'win-rate weighted, 10%–70% each': 'לויט געווינס ראטע, 10%–70% יעדע',
  

  // alerts to trades
  'Send an alert from TradingView, TrendSpider, Zapier, a script or an AI agent. It becomes an order in the accounts you choose, inside your risk rules.': 'שיקט אן אלערט פון TradingView, TrendSpider, Zapier, א סקריפט אדער אן AI אגענט. עס ווערט אן ארדער אין די קאנטעס וואס איר קלייבט, לויט אייערע ריזיקע כללים.',
  'Create': 'שאפט', 'a webhook with sizing and risk rules': 'א וועבהוק מיט גרייס און ריזיקע כללים', 'Paste': 'לייגט אריין', 'its URL into your alert': 'זיין URL אין אייער אלערט',
  ': every alert is executed and logged': ': יעדער אלערט ווערט אויסגעפירט און פארשריבן', 'New webhook': 'נייער וועבהוק', 'Edit webhook': 'רעדאגירט וועבהוק', 'Create webhook': 'שאפט א וועבהוק',
  'Allowed tickers': 'ערלויבטע טיקערס', '(optional)': '(אפציאנאל)', 'Send orders to': 'שיקט ארדערס צו', 'Order size': 'ארדער גרייס', 'Fixed dollar amount': 'פעסטער דאלאר סכום',
  'Fixed number of shares': 'פעסטע צאל שערס', 'Use the size in the alert': 'ניצט די גרייס פונעם אלערט', 'Risk rules': 'ריזיקע כללים', '(leave empty for no limit)': '(לאזט ליידיג פאר קיין גרענעץ)',
  'Max position per ticker ($)': 'מאקסימום פאזיציע פער טיקער ($)', 'Max trades per day': 'מאקסימום טרעידס א טאג', 'No limit': 'קיין גרענעץ',
  'Long only: sells never go below zero shares, and "exit" sells the whole position.': 'נאר לאנג: פארקויפן גייט קיינמאל נישט אונטער נול שערס, און "exit" פארקויפט די גאנצע פאזיציע.',
  'Copy URL': 'קאפירט URL', 'Send test signal': 'שיקט א טעסט סיגנאל', 'New URL': 'נייע URL', 'Alert message': 'אלערט מעסעדזש', 'Copy message': 'קאפירט מעסעדזש',
  'Send from a script, Zapier or an AI agent': 'שיקן פון א סקריפט, Zapier אדער אן AI אגענט', 'Signal log': 'סיגנאל ליסטע', 'Webhook': 'וועבהוק', 'test': 'טעסט',
  'Filled': 'אויסגעפירט', 'Partly done': 'טיילווייז', 'Rejected': 'אפגעווארפן', 'See Pro': 'זעט Pro',
  'No signals yet. Send a test signal from a webhook above.': 'נאך קיין סיגנאלן. שיקט א טעסט סיגנאל פון א וועבהוק אויבן.',

  // pairs
  'Stock A': 'סטאק A', 'Stock B': 'סטאק B', 'Fit window (days)': 'פאס פענסטער (טעג)', 'z window (days)': 'z פענסטער (טעג)', 'Enter at |z| ≥': 'גייט אריין ביי |z| ≥',
  'Exit at |z| ≤': 'גייט ארויס ביי |z| ≤', 'Stop at |z| ≥': 'סטאפ ביי |z| ≥', 'Max days in a trade': 'מאקסימום טעג אין א טרעיד', 'Analyze pair': 'אנאליזירט דעם פעיר',
  'Scan 20 popular pairs': 'סקענט 20 פאפולערע פעירס', "Today's z-score": 'היינטיגער z-סקאר', 'Hedge ratio (β)': 'העדזש ראטיא (β)', 'Half-life': 'האלב-לעבן',
  'Correlation': 'קארעלאציע', 'Cointegration t-stat': 'קאאינטעגראציע t-סטאט', 'Pair bots': 'פעיר באטס', 'Pair': 'פעיר', 'Mode': 'מאוד', 'Position': 'פאזיציע', 'Last run': 'לעצטע מאל',
  'Run this pair automatically': 'לויפט דעם פעיר אויטאמאטיש', 'Money for this pair ($)': 'געלט פאר דעם פעיר ($)', 'Long only (no shorting)': 'נאר לאנג (קיין שארטן)',
  'Market-neutral (needs margin)': 'מארקעט-נייטראל (דארף מארדזשין)', 'Popular pairs, strongest first': 'פאפולערע פעירס, די שטארקסטע ערשט', 'Cointegrated': 'קאאינטעגרירט',
  'Colored: market-neutral. Grey: long only.': 'קאלירט: מארקעט-נייטראל. גרוי: נאר לאנג.', 'z today': 'z היינט',
  'A pair bot checks its pair every trading day at 3:45 pm New York time and trades when the gap crosses your levels.': 'א פעיר באט טשעקט זיין פעיר יעדן טרעידינג טאג 3:45 נאכמיטאג ניו יארק צייט, און טרעידט ווען דער אונטערשייד גייט איבער אייערע שטאפלען.',
  'No pair bots yet. Analyze a pair, then start a bot from the result.': 'נאך קיין פעיר באטס. אנאליזירט א פעיר, און הייבט אן א באט פונעם רעזולטאט.',

  // S&P 500
  'SPY today': 'SPY היינט', 'This year': 'דאס יאר', 'Last 12 months': 'לעצטע 12 חדשים', '5 years, per year': '5 יאר, א יאר', '10 years, per year': '10 יאר, א יאר',
  'The 500 largest US companies in one fund. The simplest long-term plan: buy a little every month, whatever the market does.': 'די 500 גרעסטע אמעריקאנער פירמעס אין איין פאנד. דער איינפאכסטער לאנג-טערמיניגער פלאן: קויפט א ביסל יעדן חודש, אפגעזען וואס דער מארקעט טוט.',
  'Your investment plan': 'אייער אינוועסטמענט פלאן', 'Start with ($)': 'הייבט אן מיט ($)', 'Add every month ($)': 'לייגט צו יעדן חודש ($)', 'For how many years': 'פאר וויפיל יאר',
  'Goal (optional, $)': 'ציל (אפציאנאל, $)', 'Fund': 'פאנד', 'Show my range': 'ווייזט מיין ראנדזש', 'You put in': 'איר לייגט אריין', 'Typical result': 'געווענליכער רעזולטאט',
  'Bad case (1 in 10)': 'שלעכטער פאל (1 פון 10)', 'Good case (1 in 10)': 'גוטער פאל (1 פון 10)', 'Invest automatically': 'אינוועסטירט אויטאמאטיש',
  'Buys your fund on the same day every month, in dollars (fractional shares), so every dollar is invested.': 'קויפט אייער פאנד דעם זעלבן טאג יעדן חודש, אין דאלארן (שטיקלעך שערס), אזוי אז יעדער דאלאר ווערט אינוועסטירט.',
  'Day of the month': 'טאג אין חודש', 'How often': 'וויאזוי אפט', 'Start investing': 'הייבט אן אינוועסטירן', 'Active plans': 'אקטיווע פלענער', 'Repeats': 'איבערחזר\'ט', 'Next buy': 'קומענדיגע קויף',
  'No automatic plan yet.': 'נאך קיין אויטאמאטישער פלאן.',

  // brokerages
  'Connect every account you trade. Each one then shows up in the account pickers: alerts, strategies, pairs and the S&P 500 plan can send orders to any of them, or to several at once.': 'פארבינדט יעדע קאנטע וואס איר טרעידט. יעדע ווייזט זיך דאן ארויס ביים קלייבן א קאנטע: אלערטס, סטראטעגיעס, פעירס און דער S&P 500 פלאן קענען שיקן ארדערס צו יעדע, אדער צו עטליכע אויף איינמאל.',
  'Loading balance…': 'לאדנט באלאנס…', 'Use the TradeStation simulator': 'ניצט דעם TradeStation סימולאטאר',

  // billing
  'Manage billing': 'פירט די באצאלונג', 'Every paid plan starts with a': 'יעדער באצאלטער פלאן הייבט אן מיט א', 'You are on': 'איר זענט אויף',
  'Thank you! Your plan is being activated. It can take a few seconds to show here.': 'א דאנק! אייער פלאן ווערט אקטיוויזירט. עס קען נעמען עטליכע סעקונדעס.',
  'Add paper money': 'לייגט צו פּעיפּער געלט', 'Add to paper account': 'לייגט צו אין פּעיפּער קאנטע', 'Deposit to your brokerage': 'לייגט אריין אין אייער בראוקער', 'Continue to payment': 'גייט ווייטער צום באצאלן',
  'Performance fee': 'פערפארמענס אפצאל', 'Your rate:': 'אייער ראטע:', 'of new profit. You only pay when an account is above its previous peak, after deposits and withdrawals.': 'פון נייע געווינס. איר באצאלט נאר ווען די קאנטע איז העכער פון איר פריערדיגן שפיץ, נאך אריינלייגן און ארויסנעמען.',
  'Billing history': 'באצאלונג היסטאריע', 'Secure checkout by Stripe. Cancel anytime from "Manage billing". Prices in USD.': 'זיכערע באצאלונג דורך Stripe. אנולירט ווען איר ווילט ביי "פירט די באצאלונג". פרייזן אין דאלאר.',
  'Real money goes to your brokerage account by bank transfer on the': 'עכטע געלט גייט צו אייער בראוקער קאנטע דורך א באנק טראנספער אויף די',
  'Your invite link': 'אייער איינלאדונג לינק', 'Share': 'טיילט', 'Friends who joined': 'פריינט וואס האבן זיך איינגעשריבן', 'Friends who subscribed': 'פריינט וואס באצאלן', 'Credit earned': 'קרעדיט פארדינט',

  // settings
  'Two-factor authentication': 'צוויי-שריט באשטעטיגונג', 'Set up 2FA': 'שטעלט איין 2FA', 'Turn on 2FA': 'שאלט איין 2FA', 'Disable 2FA': 'שאלט אויס 2FA',
  'Protect your account with an authenticator app (Google Authenticator, 1Password, Authy).': 'באשיצט אייער קאנטע מיט אן authenticator עפּ (Google Authenticator, 1Password, Authy).',
  'Phone for SMS & hotline': 'טעלעפאן פאר טעקסט און האטליין', 'Mobile number': 'מאביל נומער', 'Send code': 'שיקט קאוד', 'Trading PIN': 'טרעידינג PIN', 'Account password': 'קאנטע פאסווארט',
  'New PIN (4-8 digits)': 'נייער PIN (4-8 ציפערן)', 'Save PIN': 'היט אפ PIN', 'Tax rates': 'שטייער ראטעס', 'Federal bracket': 'פעדעראלע שטאפל', 'State rate %': 'סטעיט ראטע %',
  'Add a password': 'לייגט צו א פאסווארט', 'Your data': 'אייערע דאטא', 'Download my data': 'דאונלאוד מיינע דאטא', 'Delete my account': 'מעקט אויס מיין קאנטע',
  'Download everything we store about you, or permanently delete your account.': 'דאונלאוד אלעס וואס מיר האלטן וועגן אייך, אדער מעקט אויס אייער קאנטע אויף אייביג.',
  'Active sessions': 'אקטיווע סעסיעס', 'Security log': 'זיכערהייט ליסטע', 'IP address': 'IP אדרעס', 'Device': 'מכשיר', 'Signed in': 'אריינלאגירט', 'Event': 'געשעעניש', 'this device': 'דער מכשיר',
  'Manage brokerage connection': 'פירט די בראוקער פארבינדונג', 'Alpaca brokerage': 'Alpaca בראוקער', 'User id': 'באניצער ID', 'API token': 'API טאקען',

  // text & hotline
  'Text & Hotline': 'טעקסט און האטליין', 'Manage your account by SMS or phone': 'פירט אייער קאנטע דורך טעקסט אדער טעלעפאן', "Brightfolio's number": 'Brightfolio\'ס נומער',
  'Text us': 'שיקט אונז א טעקסט', 'Call': 'רופט', 'Try it here': 'פרובירט עס דא', 'How is my account doing?': 'וויאזוי שטייט מיין קאנטע?',
  'The SMS/voice number is not configured on this server yet (Twilio).': 'דער טעקסט/טעלעפאן נומער איז נאך נישט איינגעשטעלט (Twilio).',

  // tax
  'Tax information': 'שטייער אינפארמאציע', 'Download Form 8949 CSV': 'דאונלאוד Form 8949 CSV', 'Short-term gains': 'קורץ-טערמיניגע געווינסן', 'Long-term gains': 'לאנג-טערמיניגע געווינסן',
  'Estimated tax': 'אומגעפערער שטייער', 'Tax-loss harvesting ideas': 'שטייער-פארלוסט אידייען', 'Realized sales': 'ריאליזירטע פארקויפן', 'No sales this year': 'קיין פארקויפן דאס יאר',
  "Estimates for planning only (US federal + flat state rate, FIFO lots). Your broker's 1099-B is the official record; check with a tax professional.": 'נאר אומגעפערע חשבונות פאר פלאנירן. אייער בראוקער\'ס 1099-B איז דער אפיציעלער רעקארד; רעדט מיט א שטייער פראפעסיאנאל.',

  // backtest + bots + schedule
  'Run on paper': 'לויפט אויף פּעיפּער', 'Run on Alpaca': 'לויפט אויף Alpaca', 'Save strategy': 'היט אפ סטראטעגיע', 'Build rules': 'בויט כללים', 'Idea': 'אידיי',
  'Entry rules (all must be true)': 'אריינגיין כללים (אלע מוזן זיין אמת)', 'Exit rules (any)': 'ארויסגיין כללים (סיי וועלכע)', 'Stop loss %': 'סטאפ לאס %', 'Take profit %': 'געווינס נעמען %',
  'Trailing stop %': 'טרעילינג סטאפ %', 'Position size %': 'פאזיציע גרייס %', 'Cost per side %': 'קאסט פער זייט %', 'Preset': 'פארגעשטעלט', 'Start': 'אנהייב', 'Capital': 'קאפיטאל',
  'Max drawdown': 'מאקסימום אראפפאל', 'Buy & hold': 'קויפן און האלטן', 'Walk-forward check': 'פאראויס-טעסט', 'Trades': 'טרעידס', 'New scheduled order': 'נייער געפלאנטער ארדער',
  'Nothing scheduled': 'גארנישט געפלאנט', 'Next run': 'קומענדיגע מאל', 'Repeat': 'איבערחזרן', 'Price alerts (sent by SMS)': 'פרייז אלערטס (דורך טעקסט)', 'Add alert': 'לייגט צו אן אלערט',
  'Strategies & Bots': 'סטראטעגיעס און באטס', 'Save a strategy from the Backtest page first.': 'היט אפ א סטראטעגיע פון דעם באקטעסט בלאט ערשט.', 'Running on': 'לויפט אויף', 'Last action': 'לעצטע אקציע',

  'Brokerage account': 'בראוקער קאנטע', 'Trading connection': 'טרעידינג פארבינדונג', 'Identity': 'אידענטיטעט', 'Contact': 'קאנטאקט', 'Employment & disclosures': 'ארבעט און אנמעלדונגען', 'Agreements': 'הסכמים',
  'Citizenship': 'בירגערשאפט', 'Country of birth': 'געבורט לאנד', 'Other ways to connect': 'אנדערע וועגן צו פארבינדן', '(existing Alpaca account or API keys)': '(עקזיסטירנדע Alpaca קאנטע אדער API שליסלען)',
  'Fractional shares': 'שטיקלעך שערס', 'Disable short selling': 'שאלט אויס שארט סעלינג', 'Suspend all trading (kill switch)': 'שטעלט אפ אלע טרעידינג (נויט קנעפל)', 'Orders go to': 'ארדערס גייען צו',
  'Day-trade buying power check': 'דעי-טרעיד קויף-קראפט טשעק', 'Pattern day trader check': 'פעטערן דעי טרעידער טשעק', 'Max margin': 'מאקסימום מארדזשין', 'Trade confirmations': 'טרעיד באשטעטיגונגען',
  // footer, status lines, common server messages
  'Trading involves risk of loss. Backtests and projections are hypothetical and do not guarantee future results. Brightfolio is software, not a broker or investment adviser; orders route to your own Alpaca account.': 'טרעידינג טראגט מיט זיך א ריזיקע פון פארלוסט. באקטעסטס און פראיעקציעס זענען היפאטעטיש און זענען נישט קיין גאראנטיע פאר די צוקונפט. Brightfolio איז א סאפטוועיר, נישט קיין בראוקער אדער אינוועסטמענט אדווייזער; ארדערס גייען צו אייער אייגענע בראוקער קאנטע.',
  'Text or call from your verified phone.': 'שיקט א טעקסט אדער רופט פון אייער באשטעטיגטן טעלעפאן.',
  'The AI assistant understands plain language: "how am I doing this month?", "put $200 into the S&P every week", "what does RSI mean?". Trades always need your PIN.': 'דער AI אסיסטענט פארשטייט פשוט\'ע שפראך: "וויאזוי שטיי איך דעם חודש?", "לייג אריין $200 אין S&P יעדע וואך", "וואס מיינט RSI?". טרעידס דארפן אלעמאל אייער PIN.',
  'Phone:': 'טעלעפאן:', 'PIN:': 'PIN:', 'not set': 'נישט איינגעשטעלט', 'set': 'איינגעשטעלט', 'verified': 'באשטעטיגט', 'change in Settings': 'טוישט אין סעטינגס',
  'Email already registered': 'דער אימעיל איז שוין רעגיסטרירט', 'Wrong email or password': 'אומריכטיגער אימעיל אדער פאסווארט', 'Please accept the Terms to continue': 'ביטע שטימט איין צו די תנאים כדי ווייטער צו גיין',
  'Enter a valid email': 'שרייבט א גילטיגן אימעיל', 'Password needs 10+ characters with upper, lower and a digit': 'דער פאסווארט דארף 10+ אותיות מיט גרויסע, קליינע און א נומער',
  'Not signed in': 'נישט אריינלאגירט', 'The server is busy, please try again.': 'דער סערווער איז פארנומען, פרובירט נאכאמאל.', 'Saved': 'אפגעהיט', 'Connected': 'פארבינדן',
  'Paper account': 'פּעיפּער קאנטע', 'Paper money added.': 'פּעיפּער געלט צוגעלייגט.',

  // admin
  'Monthly recurring revenue': 'חודש\'ליכע איינקונפט', 'Annual run rate': 'יערליכע ראטע', 'Revenue, last 30 days': 'איינקונפט, לעצטע 30 טעג', 'Signup → paying': 'איינשרייבן ← באצאלן',
  'Funnel': 'פאנעל', 'Payment processors': 'פעימענט פראסעסארס', 'Users': 'באניצער', 'Support inbox': 'סופּאָרט אינבאקס', 'Fees due': 'אפצאלן שולדיג',
  'Card deposits awaiting brokerage transfer': 'קארטל אריינלייגן וואס ווארטן אויף בראוקער טראנספער', 'Assess performance fees now': 'רעכנט אויס פערפארמענס אפצאלן יעצט',
  // brokerage application (5 steps) and status dashboard
  'Disclosures': 'אנמעלדונגען', 'Documents': 'דאקומענטן', 'Mobile phone': 'מאביל טעלעפאן', 'Street address': 'גאס אדרעס', 'Apt / unit': 'דירה / יוניט', 'City': 'שטאט', 'State': 'סטעיט', 'ZIP code': 'זיפ קאוד',
  'First name': 'ערשטער נאמען', 'Middle name': 'מיטלסטער נאמען', 'Last name': 'פאמיליע נאמען', 'Date of birth': 'געבורטס טאג', 'Social Security number': 'סאשעל סעקיוריטי נומער',
  'Country of citizenship': 'בירגערשאפט לאנד', 'Country of birth': 'געבורטס לאנד', 'Tax residence': 'שטייער וואוינארט', 'Main source of funds': 'הויפט מקור פון געלט',
  'Employment income': 'פארדינסט פון ארבעט', 'Investments': 'אינוועסטמענטס', 'Inheritance': 'ירושה', 'Business income': 'ביזנעס איינקונפט', 'Savings': 'סעיווינגס', 'Family': 'פאמיליע',
  'Required by law to verify your identity (KYC). Your SSN goes to Alpaca over an encrypted connection and is not stored by Brightfolio.': 'דאס געזעץ פארלאנגט צו באשטעטיגן אייער אידענטיטעט (KYC). אייער SSN גייט צו Alpaca איבער א פארשלאסענע פארבינדונג און ווערט נישט אפגעהיט ביי Brightfolio.',
  'Are you a 10% shareholder, director or officer of a public company? (control person)': 'זענט איר א 10% שעיר-האלטער, דירעקטאר אדער אפיציר פון א פובליק פירמע? (קאנטראל פערזאן)',
  'Are you affiliated with a stock exchange or FINRA?': 'זענט איר פארבינדן מיט א סטאק בערזע אדער FINRA?',
  'Are you a senior political figure (politically exposed person)?': 'זענט איר א הויכע פאליטישע פיגור (פאליטיש אויסגעשטעלטע פערזאן)?',
  'Is an immediate family member a senior political figure?': 'איז א נאענטער פאמיליע מיטגליד א הויכע פאליטישע פיגור?',
  'No': 'ניין', 'Yes': 'יא', 'Employment (optional)': 'ארבעט (נישט מוז)', 'Employment': 'ארבעט', 'Employer': 'ארבעטס-געבער', 'Position': 'פאזיציע',
  'Employed': 'ארבעט', 'Unemployed': 'ארבעטסלאז', 'Student': 'סטודענט', 'Retired': 'פענסיאנירט', 'Account features': 'קאנטע מעגליכקייטן',
  'Apply for a margin account (Margin Agreement)': 'בעט א מארדזשין קאנטע (מארדזשין הסכם)', 'Enable options trading (Options Agreement)': 'עפנט אפשאנס טרעידינג (אפשאנס הסכם)', 'Enable crypto trading (Crypto Agreement)': 'עפנט קריפטא טרעידינג (קריפטא הסכם)',
  'Your agreement is recorded with the time you submit and your IP address, as Alpaca requires.': 'אייער הסכמה ווערט פארשריבן מיט דער צייט ווען איר שיקט אריין און אייער IP אדרעס, אזוי ווי Alpaca פארלאנגט.',
  'Optional: adding a photo of your ID now can speed up approval. You can also upload later if Alpaca asks for it.': 'נישט מוז: א בילד פון אייער ID יעצט קען פארשנעלערן די באשטעטיגונג. איר קענט עס אויך ארויפלייגן שפעטער אויב Alpaca בעט.',
  'Document': 'דאקומענט', 'File (JPG, PNG or PDF, up to 5 MB)': 'פייל (JPG, PNG אדער PDF, ביז 5 MB)', 'File': 'פייל', 'Passport': 'פאספארט', "Driver's license": 'דרייווער לייסענס', 'National ID card': 'נאציאנאלע ID קארטל', 'State ID': 'סטעיט ID',
  'Review': 'איבערקוקן', 'Name': 'נאמען', 'Address': 'אדרעס', 'Email / phone': 'אימעיל / טעלעפאן', 'None apply': 'קיינס פאסט נישט', 'Remove': 'אראפנעמען',
  'Takes about 3 minutes. Accounts are held by Alpaca Securities LLC, member FINRA/SIPC.': 'נעמט בערך 3 מינוט. קאנטעס ווערן געהאלטן ביי Alpaca Securities LLC, מיטגליד FINRA/SIPC.',
  'Continue': 'ווייטער', 'Back': 'צוריק', 'Submit application': 'שיקט אריין די אפליקאציע', 'Submit application?': 'אריינשיקן די אפליקאציע?', 'Submit': 'שיקט אריין',
  'Your information will be sent to Alpaca for identity verification.': 'אייער אינפארמאציע וועט געשיקט ווערן צו Alpaca צו באשטעטיגן אייער אידענטיטעט.',
  'Application under review': 'די אפליקאציע ווערט איבערגעקוקט', 'Account approved! Ready to trade': 'קאנטע באשטעטיגט! גרייט צו טרעידן', 'Action required: upload documents': 'מען דארף אייך: לייגט ארויף דאקומענטן',
  'Pending manual review': 'ווארט אויף א מענטשליכע איבערקוק', 'Application rejected': 'די אפליקאציע איז אפגעווארפן געווארן', 'Submission failed': 'אריינשיקן איז דורכגעפאלן', 'Account disabled': 'קאנטע אפגעשטעלט', 'Account closed': 'קאנטע פארמאכט',
  'Alpaca is verifying your identity. Most applications are decided within minutes.': 'Alpaca באשטעטיגט אייער אידענטיטעט. רוב אפליקאציעס ווערן באשלאסן אין עטליכע מינוט.',
  'Alpaca is switching the account on. This usually takes a few minutes.': 'Alpaca צינדט אן די קאנטע. דאס נעמט געווענליך עטליכע מינוט.',
  'Fund your account by linking a bank below, then place your first trade.': 'לייגט אריין געלט דורך פארבינדן א באנק אונטן, און דערנאך מאכט אייער ערשטן טרעיד.',
  "Alpaca needs more documents to verify your identity. Upload a passport or driver's license below.": 'Alpaca דארף מער דאקומענטן צו באשטעטיגן אייער אידענטיטעט. לייגט ארויף א פאספארט אדער דרייווער לייסענס אונטן.',
  'A compliance officer at Alpaca is reviewing your application. This can take up to 1 business day.': 'א קאמפלייענס אפיציר ביי Alpaca קוקט איבער אייער אפליקאציע. דאס קען נעמען ביז 1 ביזנעס טאג.',
  'Alpaca could not approve this application. Contact support if you think this is a mistake.': 'Alpaca האט נישט געקענט באשטעטיגן די אפליקאציע. קאנטאקטירט סופּאָרט אויב איר מיינט אז עס איז א טעות.',
  'Contact support': 'קאנטאקטירט סופּאָרט', 'Submitted': 'אריינגעשיקט', 'Under review': 'ווערט איבערגעקוקט', 'Approved': 'באשטעטיגט', 'Active': 'אקטיוו',
  'Live: this page updates the moment Alpaca decides.': 'לייוו: דער בלאט דערהייַנטיקט זיך דעם מאמענט וואס Alpaca באשליסט.', 'This page checks for updates automatically.': 'דער בלאט קוקט אליין פאר נייעס.',
  'Upload documents': 'לייגט ארויף דאקומענטן', 'Upload': 'ארויפלייגן', 'A clear photo or scan of a government ID. JPG, PNG or PDF, up to 5 MB each.': 'א קלארער בילד אדער סקען פון א רעגירונג ID. JPG, PNG אדער PDF, ביז 5 MB יעדעס.',
  'Account details': 'קאנטע פרטים', 'Account number': 'קאנטע נומער', 'Crypto': 'קריפטא', 'Enabled assets': 'ערלויבטע אסעטס', 'Opened': 'געעפנט', 'Application history': 'אפליקאציע היסטאריע',
  'No updates yet': 'נאך קיין נייעס', 'Alpaca event': 'Alpaca געשעעניש', 'Application sent': 'אפליקאציע געשיקט', 'Status check': 'סטאטוס טשעק', 'Update contact details': 'דערהייַנטיקט קאנטאקט פרטים', 'Save changes': 'היט אפ די ענדערונגען',
  '1. Create your Brightfolio login': '1. שאפט אייער Brightfolio לאגין', 'Continue to application': 'גייט ווייטער צו די אפליקאציע', 'Already have a login?': 'האט איר שוין א לאגין?',
  'Commission-free US stocks and ETFs, plus options and crypto, at Alpaca Securities LLC (member FINRA/SIPC). Apply in about 3 minutes, all from Brightfolio.': 'אמעריקאנער סטאקס און ETFs אן קאמישאן, פלוס אפשאנס און קריפטא, ביי Alpaca Securities LLC (מיטגליד FINRA/SIPC). אפליקירט אין בערך 3 מינוט, אלעס פון Brightfolio.',
  'Choose a file to upload': 'קלייבט א פייל ארויפצולייגן', ', then open Account → Alpaca account.': ', און דערנאך עפנט קאנטע ← Alpaca קאנטע.',
  // round 3: everything the Yiddish page scan still found in English
  'Get started': 'הייבט אן', 'Hide': 'באהאלטן', 'Try a ready-made strategy': 'פרובירט א פארטיגע סטראטעגיע', 'Turn on two-factor login': 'צינדט אן צוויי-שריט לאגין',
  'Place your first paper trade': 'מאכט אייער ערשטן פּעיפּער טרעיד', 'Add your phone and PIN for SMS': 'לייגט צו אייער טעלעפאן און PIN פאר SMS', 'Backtest a strategy': 'באקטעסט א סטראטעגיע',
  'or Dollars': 'אדער דאלארן', 'Quote': 'פרייז', 'Source': 'מקור', '· New here?': '· נייע דא?', 'Stocks': 'סטאקס',
  'Your equity curve starts filling in after the first trading day.': 'אייער ווערט-ליניע הייבט זיך אן אנצופילן נאכן ערשטן טרעידינג טאג.',
  'Connect a brokerage account to start': 'פארבינדט א בראוקער קאנטע כדי אנצוהייבן',
  'Open a new Alpaca brokerage account, connect your existing Alpaca account, or use API keys. Everything starts in the paper / sandbox environment.': 'עפנט א נייע Alpaca בראוקער קאנטע, פארבינדט אייער עקזיסטירנדע Alpaca קאנטע, אדער ניצט API שליסלען. אלעס הייבט זיך אן אין דער פּעיפּער / סענדבאקס סביבה.',
  'Set up brokerage': 'שטעלט איין א בראוקער', 'Could not reach Alpaca. Please try again.': 'מען קען נישט דערגרייכן Alpaca. פרובירט נאכאמאל.', 'Filter: AAPL, TSLA, BTCUSD': 'פילטער: AAPL, TSLA, BTCUSD',
  'Nothing connected yet. Choose one of the options below.': 'נאך גארנישט פארבינדן. קלייבט איינס פון די אפציעס אונטן.', 'OAuth is not configured on this server yet.': 'OAuth איז נאך נישט איינגעשטעלט אויף דעם סערווער.',
  'From the Alpaca dashboard → API keys. Stored encrypted.': 'פון דעם Alpaca דעשבאָרד ← API keys. ווערט אפגעהיט פארשלאסן.',
  'Open a new brokerage account inside Brightfolio, sign in with Alpaca, or use API keys. Stocks, ETFs, options and crypto, with fractional shares.': 'עפנט א נייע בראוקער קאנטע אינעווייניג אין Brightfolio, לאגירט זיך איין מיט Alpaca, אדער ניצט API שליסלען. סטאקס, ETFs, אפשאנס און קריפטא, מיט שטיקלעך שערס.',
  'Stocks, ETFs and options. Create a token at dash.tradier.com → API Access (use a sandbox token to test).': 'סטאקס, ETFs און אפשאנס. מאכט א טאקען ביי dash.tradier.com ← API Access (ניצט א סענדבאקס טאקען צו פרובירן).',
  'API access token': 'API צוטריט טאקען', 'Sandbox (paper) account': 'סענדבאקס (פּעיפּער) קאנטע', 'Sandbox (cert) environment': 'סענדבאקס (cert) סביבה',
  'Stocks, ETFs and options. At my.tastytrade.com → Manage → My Profile → API, create an OAuth application and a personal grant, then paste its client secret and refresh token.': 'סטאקס, ETFs און אפשאנס. ביי my.tastytrade.com ← Manage ← My Profile ← API, מאכט אן OAuth אפליקאציע און א פערזענליכע ערלויבעניש, און דערנאך קלעבט אריין איר client secret און refresh token.',
  'OAuth client secret': 'OAuth client secret', 'Refresh token (personal grant)': 'Refresh token (פערזענליכע ערלויבעניש)',
  'Your Schwab brokerage account (stocks and ETFs). You sign in at Schwab; Schwab asks you to sign in again every 7 days.': 'אייער Schwab בראוקער קאנטע (סטאקס און ETFs). איר לאגירט זיך איין ביי Schwab; Schwab בעט זיך איינלאגירן נאכאמאל יעדע 7 טעג.',
  'Not available yet on this server: the owner needs to register a Charles Schwab developer app first.': 'נאך נישט צו באקומען אויף דעם סערווער: דער אייגנטימער דארף קודם רעגיסטרירן א Charles Schwab דעוועלאפער עפּ.',
  'Stocks and ETFs at TradeStation, live or in its simulator. You sign in at TradeStation.': 'סטאקס און ETFs ביי TradeStation, לייוו אדער אין זיין סימולאטאר. איר לאגירט זיך איין ביי TradeStation.',
  'Not available yet on this server: the owner needs to register a TradeStation developer app first.': 'נאך נישט צו באקומען אויף דעם סערווער: דער אייגנטימער דארף קודם רעגיסטרירן א TradeStation דעוועלאפער עפּ.',
  'Keys and tokens are encrypted before they are stored, and you can disconnect at any time (also revoke access at the broker). Orders on these brokerages are whole shares only. Live accounts trade real money.': 'שליסלען און טאקענס ווערן פארשלאסן איידער מען היט זיי אפ, און איר קענט זיך אפפארבינדן ווען איר ווילט (אויך צוריקנעמען דעם צוטריט ביים בראוקער). ארדערס ביי די בראוקערס זענען נאר גאנצע שערס. לייוו קאנטעס טרעידן מיט עכטע געלט.',
  // strategy library
  
  'very high risk': 'זייער הויכע ריזיקע', 'high risk': 'הויכע ריזיקע', 'medium risk': 'מיטלמעסיגע ריזיקע', 'low risk': 'נידעריגע ריזיקע',
  'Hierarchical decision-tree regime rotation · Every trading day': 'שטאפלדיגע באשלוס-בוים ראטאציע · יעדן טרעידינג טאג',
  'Gold-miner RSI exhaustion gate, then Nasdaq momentum decides between a fast risk-on path (TQQQ / SPXL / UVXY / BTAL) and a slow path through bonds, financials and inverse ETFs. Holds one ETF at 100%.': 'א גאלד-מיינער RSI אויסגעמאטערטקייט טויער, דערנאך באשליסט Nasdaq מאמענטום צווישן א שנעלן ריזיקע וועג (TQQQ / SPXL / UVXY / BTAL) און א פאמעלעכן וועג דורך באנדס, פינאנץ און פארקערטע ETFs. האלט איין ETF אויף 100%.',
  
  ', a common sign of over-fitting.': ', א געווענליכער סימן פון איבער-צופאסן.', 'Live results so far are far below the backtest': 'די לייוו רעזולטאטן ביז יעצט זענען ווייט אונטער דעם באקטעסט',
  '4 independent sleeves × 25% · Every trading day': '4 באזונדערע טיילן × 25% · יעדן טרעידינג טאג',
  'Four separate models each run a quarter of the money: Nasdaq trend (TQQQ/SQQQ), semiconductors (SOXL), a 202-day trend vote across SPY/QQQ/IWM (TECL or T-bills), and S&P trend (SPXL or anti-beta).': 'פיר באזונדערע מאדעלן, יעדער פירט א פערטל פון די געלט: Nasdaq טרענד (TQQQ/SQQQ), סעמיקאנדאקטארס (SOXL), א 202-טאג טרענד שטימונג איבער SPY/QQQ/IWM (TECL אדער T-bills), און S&P טרענד (SPXL אדער אנטי-בעטא).',
  'Holds one leveraged ETF at 100% · Every trading day': 'האלט איין לעווערידזשד ETF אויף 100% · יעדן טרעידינג טאג',
  'Bull market (SPY above its 200-day average): TQQQ unless Nasdaq or the S&P is overbought, then volatility (UVXY). Bear market: buys oversold dips in TECL / SPXL, otherwise rotates between TQQQ, SQQQ, TECS and short-term bonds.': 'בול מארקעט (SPY איבער זיין 200-טאג דורכשניט): TQQQ, סיידן Nasdaq אדער דער S&P איז איבערגעקויפט, דאן וואלאטיליטעט (UVXY). בער מארקעט: קויפט איבערפארקויפטע אראפגאנגען אין TECL / SPXL, אנדערש דרייט עס צווישן TQQQ, SQQQ, TECS און קורצע באנדס.',
  
  'Gold-miner fade and Nasdaq momentum tree · Every trading day': 'גאלד-מיינער אפשוואכונג און Nasdaq מאמענטום בוים · יעדן טרעידינג טאג',
  'Starts with the GDXU RSI exhaustion gate and the Nasdaq 90-day vs 70-day momentum split, then a long tree of RSI, trend and return checks across leveraged ETFs and single stocks.': 'הייבט אן מיטן GDXU RSI אויסגעמאטערטקייט טויער און דער Nasdaq 90-טאג קעגן 70-טאג מאמענטום צעטיילונג, דערנאך א לאנגער בוים פון RSI, טרענד און רעזולטאט טשעקס איבער לעווערידזשד ETFs און איינצלנע סטאקס.',
  
  'One stock: the strongest 12-month momentum · Weekly': 'איין סטאק: דער שטארקסטער 12-חודש מאמענטום · וועכנטליך',
  'Every Wednesday ranks 50 large US companies by their 252-day return and holds the single strongest one at 100%. The original code uses a 10% stop.': 'יעדן מיטוואך ראנגירט עס 50 גרויסע אמעריקאנער פירמעס לויט זייער 252-טאג רעזולטאט און האלט דעם איינציגן שטארקסטן אויף 100%. דער ארגינעלער קאוד ניצט א 10% סטאפ.',
  
  'Buy the dip in an uptrend, sell the bounce · Every trading day': 'קויפט דעם אראפגאנג אין אן ארויפטרענד, פארקויפט דעם אויפשפרונג · יעדן טרעידינג טאג',
  'Buys top Nasdaq-100 stocks in a long-term uptrend that dipped below the lower Bollinger band with weak RSI and a real pullback. Sells on the bounce back to the 15-day average, a break of the 200-day average, or after 15 days. Equal weight, up to 10 stocks.': 'קויפט שפיץ Nasdaq-100 סטאקס אין א לאנג-טערמיניגן ארויפטרענד וואס זענען אראפ אונטער דעם אונטערשטן Bollinger באנד, מיט א שוואכן RSI און אן עכטן צוריקגאנג. פארקויפט ביים צוריקשפרינגען צום 15-טאג דורכשניט, ביים צעברעכן דעם 200-טאג דורכשניט, אדער נאך 15 טעג. גלייכע וואג, ביז 10 סטאקס.',
  'Stocks, gold, bonds and bitcoin by predicted return · Monthly': 'סטאקס, גאלד, באנדס און ביטקוין לויט דעם פאראויסגעזאגטן רעזולטאט · חודש\'ליך',
  'Once a month, weights SPY, GLD, BND and bitcoin (IBIT) by their predicted 21-day return. Only positive predictions get money, bitcoin is capped, and the total never exceeds 100% (no margin).': 'איינמאל א חודש טיילט עס צו SPY, GLD, BND און ביטקוין (IBIT) לויט זייער פאראויסגעזאגטן 21-טאג רעזולטאט. נאר פאזיטיווע פאראויסזאגונגען באקומען געלט, ביטקוין האט א גרענעץ, און די סומע גייט קיינמאל נישט איבער 100% (קיין מארדזשין).',
  
  // alerts to trades
  'Dollars per order': 'דאלארן פער ארדער', 'In TradingView: create an alert, turn on': 'אין TradingView: מאכט אן אלערט, צינדט אן', 'Webhook URL': 'Webhook URL',
  'and paste your URL, then use one of these as the message. Accepted actions are': 'און קלעבט אריין אייער URL, דערנאך ניצט איינס פון די אלס די מעסעדזש. ערלויבטע אקציעס זענען', '; size with': '; גרייס מיט',
  'TradingView strategy': 'TradingView סטראטעגיע', 'TradingView alert (buy)': 'TradingView אלערט (קויפן)', 'Exit a position': 'ארויסגיין פון א פאזיציע', 'Plain text': 'פשוט\'ער טעקסט', 'SPY trend strategy': 'SPY טרענד סטראטעגיע',
  // pairs, S&P 500, backtest, bots, schedule
  'Two stocks that usually move together. When the gap between them stretches far from normal, sell the expensive one and buy the cheap one, then close when the gap returns.': 'צוויי סטאקס וואס באוועגן זיך געווענליך צוזאמען. ווען דער אונטערשייד צווישן זיי ציט זיך ווייט פונעם נארמאלן, פארקויפט דעם טייערן און קויפט דעם ביליגן, און פארמאכט ווען דער אונטערשייד קומט צוריק.',
  'Pairs that moved together in the past can stop doing so (a merger, a lawsuit, a new product). The stop level and the time limit exist for that. Short selling needs a margin account and has borrowing costs; the paper account trades the long-only version. Backtests are hypothetical.': 'פעירס וואס האבן זיך פריער באוועגט צוזאמען קענען אויפהערן (א צוזאמענשמעלצונג, א פראצעס, א נייער פראדוקט). דערפאר זענען דא דער סטאפ שטאפל און די צייט גרענעץ. שארט סעלינג פארלאנגט א מארדזשין קאנטע און קאסט צו בארגן; די פּעיפּער קאנטע טרעידט די ווערסיע מיט נאר קויפן. באקטעסטס זענען היפאטעטיש.',
  'Projections resample real 12-month stretches of S&P 500 history (crashes included) 2,000 times. They are not a forecast or a promise; the market can fall for years.': 'די פראיעקציעס נעמען 2,000 מאל עכטע 12-חודש שטיקער פון דער S&P 500 היסטאריע (מיט די קראכן). זיי זענען נישט קיין פאראויסזאג און נישט קיין הבטחה; דער מארקעט קען פאלן פאר יארן.',
  'Describe a strategy in plain English': 'באשרייבט א סטראטעגיע מיט פשוט\'ע ווערטער',
  'Indicators: Close, SMA(n), EMA(n), RSI(n), BBU(n,k), BBL(n,k), HIGH(n), LOW(n), ROC(n), MACD(f,s), MACDSIG(f,s,sig). Ops: > < >= <= crosses_above crosses_below. Optimizer: put choices in braces, e.g.': 'אינדיקאטארן: Close, SMA(n), EMA(n), RSI(n), BBU(n,k), BBL(n,k), HIGH(n), LOW(n), ROC(n), MACD(f,s), MACDSIG(f,s,sig). אפעראציעס: > < >= <= crosses_above crosses_below. אפטימייזער: לייגט די ברירות אין געגרייזלטע קלאמערן, למשל',
  'Buy AAPL when RSI drops below 30 in an uptrend, 8% stop loss': 'קויפט AAPL ווען RSI פאלט אונטער 30 אין אן ארויפטרענד, 8% סטאפ לאס',
  'A deployed bot checks its rules once per trading day shortly before the 4 pm New York close and buys or sells on the chosen account. Text BOTS to see them, PAUSE <PIN> to stop all.': 'א לויפנדיגער באט טשעקט זיינע כללים איינמאל א טרעידינג טאג, א ביסל פאר דעם 4 אזייגער ניו יארקער שליסן, און קויפט אדער פארקויפט אויף דער אויסגעקליבענער קאנטע. שיקט א טעקסט BOTS זיי צו זען, PAUSE <PIN> אלע אפצושטעלן.',
  'Entry': 'אריינגאנג', 'Exit': 'ארויסגאנג', 'First run': 'ערשטע לויף', 'Schedule': 'פלאן', 'When price is': 'ווען דער פרייז איז',
  // plans
  '14-day free trial': '14 טעג אומזיסט', '. You won\'t be charged until it ends, and you can cancel anytime.': '. איר ווערט נישט באשולדיגט ביז עס ענדיגט זיך, און איר קענט אנולירן ווען איר ווילט.',
  'Learn and practice': 'לערנט און פראקטיצירט', 'forever': 'אויף אייביג', '+ 20% of new profits above your high-water mark': '+ 20% פון נייע געווינסן איבער אייער העכסטן פונקט', '+ 10% of new profits above your high-water mark': '+ 10% פון נייע געווינסן איבער אייער העכסטן פונקט', '+ 5% of new profits above your high-water mark': '+ 5% פון נייע געווינסן איבער אייער העכסטן פונקט',
  '$100,000 paper account': '$100,000 פּעיפּער קאנטע', 'Strategy library by hand + 1 automatic strategy on paper': 'סטראטעגיע ביבליאטעק מיט די האנט + 1 אויטאמאטישע סטראטעגיע אויף פּעיפּער', 'S&P 500 auto-invest on paper': 'S&P 500 אויטא-אינוועסטירן אויף פּעיפּער',
  'Pairs analysis & backtests': 'פעירס אנאליז און באקטעסטס', '1 alert webhook (paper)': '1 אלערט וועבהוק (פּעיפּער)', 'AI text assistant for questions & balances': 'AI טעקסט אסיסטענט פאר שאלות און באלאנסן', 'English & Yiddish': 'ענגליש און אידיש',
  'Automate your real accounts': 'מאכט אויטאמאטיש אייערע עכטע קאנטעס', '/month': '/חודש', '/year': '/יאר', 'Everything in Starter': 'אלעס פון Starter', 'Everything in Pro': 'אלעס פון Pro',
  'Live trading on Alpaca, Schwab, tastytrade, Tradier & TradeStation': 'לייוו טרעידינג אויף Alpaca, Schwab, tastytrade, Tradier און TradeStation', '5 automatic strategies with Reality Check auto-throttle': '5 אויטאמאטישע סטראטעגיעס מיט ריעליטי טשעק אויטא-ברעמז',
  '10 alert webhooks (TradingView, Zapier)': '10 אלערט וועבהוקס (TradingView, Zapier)', 'Pair bots, scheduled trades & live S&P 500 auto-invest': 'פעיר באטס, געפלאנטע טרעידס און לייוו S&P 500 אויטא-אינוועסטירן', 'Trade by text & phone with the AI assistant': 'טרעידט דורך טעקסט און טעלעפאן מיטן AI אסיסטענט',
  'Optimizer, walk-forward testing & QuantConnect': 'אפטימייזער, פאראויס טעסטינג און QuantConnect', 'For serious capital': 'פאר ערנסטע קאפיטאל', 'Lowest performance fee (5%)': 'די נידעריגסטע פערפארמענס אפצאל (5%)', '50 automatic strategies & 50 webhooks': '50 אויטאמאטישע סטראטעגיעס און 50 וועבהוקס',
  'Market-neutral pairs (long + short)': 'מארקעט-נייטראלע פעירס (לאנג + שארט)', 'Tax-loss harvesting report': 'באריכט פון שטייער-פארלוסט איינזאמלען', 'Priority AI & priority support': 'פריאריטעט AI און פריאריטעט סופּאָרט',
  'Card and bank deposits are not set up on this server yet. You can fund your brokerage account by bank transfer on the': 'קארטל און באנק אריינלייגן זענען נאך נישט איינגעשטעלט אויף דעם סערווער. איר קענט אריינלייגן געלט אין אייער בראוקער קאנטע דורך א באנק טראנספער אויפן', 'page.': 'בלאט.',
  // referrals, taxes, text, settings
  'Wash-sale disallowed': 'וואש-סעיל נישט ערלויבט', 'Loss carryforward': 'פארלוסט איבערגעטראגן', 'Acquired': 'געקויפט', 'Sold': 'פארקויפט', 'Proceeds': 'איינקונפט', 'Cost': 'קאסטן', 'Gain': 'געווינס', 'Term': 'טערמין',
  'On the hotline: enter your PIN, then press 1 balance, 2 positions, 3 scheduled trades, 9 pause bots, or say a command like "buy five shares of Apple".': 'אויף דער האטליין: שרייבט אריין אייער PIN, דערנאך דריקט 1 באלאנס, 2 פאזיציעס, 3 געפלאנטע טרעידס, 9 אפשטעלן באטס, אדער זאגט א באפעל ווי "קויף פינף שערס פון Apple".',
  'Open a brokerage account, connect your Alpaca account with one click, or use API keys.': 'עפנט א בראוקער קאנטע, פארבינדט אייער Alpaca קאנטע מיט איין קליק, אדער ניצט API שליסלען.',
  'quantconnect.com → Account → API Access': 'quantconnect.com ← Account ← API Access', 'Not set': 'נישט איינגעשטעלט', 'Code': 'קאוד', 'Change password': 'טוישט פאסווארט', 'Changing it signs out every other device.': 'טוישן עס לאגירט אויס יעדן אנדערן מכשיר.', 'Password to delete your account': 'פאסווארט צו אויסמעקן אייער קאנטע',
  'Language': 'שפראך', 'Main': 'הויפט', 'Theme: auto (click to change)': 'קאליר: אויטאמאטיש (קליקט צו טוישן)', 'Theme: light (click to change)': 'קאליר: ליכטיג (קליקט צו טוישן)', 'Theme: dark (click to change)': 'קאליר: טונקל (קליקט צו טוישן)',
  'No price data for this range.': 'קיין פרייז דאטן פאר די צייט.',
  'The language of the app on this device.': 'די שפראך פון דער עפּ אויף דעם מכשיר.',
  // security log
  'Account created': 'קאנטע געעפנט', 'Signed in': 'אריינלאגירט', 'Failed sign-in': 'דורכגעפאלענער לאגין', 'Wrong two-factor code': 'אומריכטיגער צוויי-שריט קאוד', 'Password changed': 'פאסווארט געטוישט',
  'Password reset': 'פאסווארט איבערגעשטעלט', 'Password reset requested': 'געבעטן איבערשטעלן פאסווארט', 'Email verified': 'אימעיל באשטעטיגט', 'Phone verified': 'טעלעפאן באשטעטיגט',
  'Two-factor login turned on': 'צוויי-שריט לאגין אנגעצונדן', 'Two-factor login turned off': 'צוויי-שריט לאגין אויסגעלאשן', 'Google sign-in linked': 'Google לאגין פארבינדן', 'Account deleted': 'קאנטע אויסגעמעקט',
  'Alpaca keys connected': 'Alpaca שליסלען פארבינדן', 'Alpaca connected': 'Alpaca פארבינדן', 'Brokerage connected': 'בראוקער פארבינדן', 'Brokerage disconnected': 'בראוקער אפגעפארבינדן',
  'Brokerage application sent': 'בראוקער אפליקאציע געשיקט', 'Brokerage contact details changed': 'בראוקער קאנטאקט פרטים געטוישט', 'Identity documents uploaded': 'אידענטיטעט דאקומענטן ארויפגעלייגט',
  'Bank account linked': 'באנק קאנטע פארבינדן', 'Bank transfer': 'באנק טראנספער', 'Order': 'ארדער', 'Order changed': 'ארדער געטוישט', 'All orders cancelled': 'אלע ארדערס אנולירט',
  'Position closed': 'פאזיציע פארמאכט', 'All positions closed': 'אלע פאזיציעס פארמאכט', 'Account settings changed': 'קאנטע סעטינגס געטוישט', 'Checkout started': 'באצאלונג אנגעהויבן',
  'Text command': 'טעקסט באפעל', 'Phone command': 'טעלעפאן באפעל', 'Phone AI request': 'טעלעפאן AI בקשה', 'Wrong phone PIN': 'אומריכטיגער טעלעפאן PIN', 'Balance update': 'באלאנס דערהייַנטיקונג',
  // admin pages
  'Overview': 'איבערבליק', 'Money & fees': 'געלט און אפצאלן', 'Open support messages': 'אפענע סופּאָרט מעסעדזשעס', 'Deposits awaiting transfer': 'אריינלייגן וואס ווארטן אויף טראנספער',
  'Search email': 'זוכט אימעיל', 'Role': 'ראלע', 'Joined': 'איינגעשריבן', 'Make admin': 'מאכט אדמין', 'Remove admin': 'נעמט אראפ אדמין',
  'Changing a plan here gives it without payment (for friends, testers or support cases). Paying customers change plans themselves under Plans & billing.': 'טוישן א פלאן דא גיט עס אן באצאלן (פאר פריינט, טעסטערס אדער סופּאָרט פעלער). באצאלנדע קליענטן טוישן פלענער אליין אונטער פלענער און באצאלונג.',
  'Setup': 'איינשטעלונגען', 'What is switched on, from the environment variables in Render (values are never shown). Admins:': 'וואס איז אנגעצונדן, לויט די environment variables אין Render (די ווערטן ווערן קיינמאל נישט געוויזן). אדמינס:',
  'On': 'אן', 'Not set': 'נישט איינגעשטעלט', 'To change one: Render → your service → Environment → add or edit the variable → Save. The server restarts by itself.': 'צו טוישן: Render ← אייער סערוויס ← Environment ← לייגט צו אדער טוישט דעם variable ← Save. דער סערווער שטעלט זיך אליין איבער.',
  'Admin email': 'אדמין אימעיל', 'Database (Turso)': 'דאטאבאזע (Turso)', 'Encryption key': 'פארשליסונג שליסל', 'Alpaca Broker API (account opening)': 'Alpaca Broker API (קאנטע עפענען)', 'Alpaca market data': 'Alpaca מארקעט דאטן',
  'Connect existing Alpaca accounts (OAuth)': 'פארבינדן עקזיסטירנדע Alpaca קאנטעס (OAuth)', 'Sign in with Google': 'אריינלאגירן מיט Google', 'Plans and card payments (Stripe)': 'פלענער און קארטל באצאלונגען (Stripe)', 'Stripe webhook': 'Stripe וועבהוק',
  'Text messages and hotline (Twilio)': 'טעקסט מעסעדזשעס און האטליין (Twilio)', 'Emails (Resend)': 'אימעילס (Resend)', 'AI assistant (Claude)': 'AI אסיסטענט (Claude)', 'Yiddish Labs credit line': 'Yiddish Labs קרעדיט שורה',
  'Deposits: Bank account (ACH) (Stripe)': 'אריינלייגן: באנק קאנטע (ACH) (Stripe)', 'Deposits: Debit card (Helcim)': 'אריינלייגן: דעביט קארטל (Helcim)', 'Deposits: Debit card (Stripe)': 'אריינלייגן: דעביט קארטל (Stripe)',
  'You cannot remove your own admin access': 'איר קענט נישט אראפנעמען אייער אייגענעם אדמין צוטריט', 'This address is in ADMIN_EMAIL; remove it there first': 'די אדרעס איז אין ADMIN_EMAIL; נעמט עס קודם ארויס פון דארט',
  'Admin user update': 'אדמין האט געטוישט א באניצער',
};

Object.assign(strings, features.strings, protect.strings, wealth.strings, batch5.strings, batch6.strings, { ...batch12.strings, ...batch11.strings, ...batch9.strings, ...batch8.strings, ...strings }, labs);

// Sentences that contain numbers or names.
export const patterns = [
  [/^Place (\d+) orders? now$/, 'שטעלט $1 ארדער(ס) יעצט'],
  [/^Collecting live results: (\d+) of (\d+) trading days\.$/, 'זאמלט לייוו רעזולטאטן: $1 פון $2 טרעידינג טעג.'],
  [/^(\d+) of (\d+) votes → (.*)$/, '$1 פון $2 שטימען ← $3'],
  [/^DONE → BUY (.+)$/, 'פארטיג ← קויפט $1'],
  [/^(\d+) of (\d+) saved · (\d+) of (\d+) automatic$/, '$1 פון $2 אפגעהיט · $3 פון $4 אויטאמאטיש'],
  [/^Start (\d+)-day free trial$/, 'הייבט אן $1 טעג אומזיסט'],
  [/^Start 14-day free trial$/, 'הייבט אן 14 טעג אומזיסט'],
  [/^Step (\d) of (\d):$/, 'שריט $1 פון $2:'],
  [/^Brokerage account: (.+)$/, 'בראוקער קאנטע: $1'],
  [/^Brokerage account (\d+)$/, 'בראוקער קאנטע $1'],
  [/^(\d+) of (\d+) done$/, '$1 פון $2 פארטיג'],
  [/^Worst drop since (\d{4})$/, 'ערגסטער אראפגאנג זינט $1'],
  [/^Dividends included \(adjusted prices\)\. Best year (\d{4}): (\S+) · worst year (\d{4}): (\S+)\. Data: (\w+)\.$/, 'דיווידענדן אריינגערעכנט (אדזשאסטירטע פרייזן). בעסטער יאר $1: $2 · ערגסטער יאר $3: $4. דאטן: $5.'],
  [/^Shaded: 8 out of 10 outcomes\. Line: the middle outcome\. Dashed: money you put in\. Chance of ending below what you put in: (\S+)\. Fund costs \((\S+)\) included; taxes not\.$/, 'שאטירט: 8 פון 10 רעזולטאטן. ליניע: דער מיטלסטער רעזולטאט. געשטריכלט: די געלט וואס איר לייגט אריין. די שאנס צו ענדיגן אונטער וואס איר האט אריינגעלייגט: $1. פאנד קאסטן ($2) אריינגערעכנט; שטייערן נישט.'],
  [/^Rates used: ordinary (\S+), long-term (\S+), state (\S+)\. Change them in Settings\.$/, 'ראטעס געניצט: געווענליך $1, לאנג-טערמין $2, סטעיט $3. טוישט זיי אין סעטינגס.'],
  [/^(paper|alpaca): high-water mark (\S+)$/, '$1: העכסטער פונקט $2'],
  [/^Give your friends a head start\. Get (\S+) for each one who subscribes\.$/, 'גיט אייערע פריינט א פארשפרונג. באקומט $1 פאר יעדן וואס שרייבט זיך איין.'],
  [/^Share your link\. When someone signs up with it and starts a paid plan, (\S+) is credited to your account and taken off your next bill\.$/, 'טיילט אייער לינק. ווען איינער שרייבט זיך איין דערמיט און הייבט אן א באצאלטן פלאן, ווערט $1 צוגעלייגט צו אייער קאנטע און אראפגענומען פון אייער נעקסטן חשבון.'],
  [/^(very high|high|medium|low) risk$/, m => ({ 'very high': 'זייער הויכע ריזיקע', high: 'הויכע ריזיקע', medium: 'מיטלמעסיגע ריזיקע', low: 'נידעריגע ריזיקע' }[m.replace(/ risk$/, '')])],
  [/^Connect (.+)$/, 'פארבינדט $1'],
  [/^Sign in with (.+)$/, 'לאגירט זיך איין מיט $1'],
  [/^Choose (.+)$/, 'קלייבט $1'],
  ...protect.patterns,
  ...wealth.patterns,
  ...features.patterns,
  ...batch5.patterns,
  ...batch6.patterns,
  ...batch8.patterns,
  ...batch9.patterns,
  ...batch11.patterns,
  ...batch12.patterns,
];
