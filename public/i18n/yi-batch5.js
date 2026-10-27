// Yiddish for statistical arbitrage, monthly bookkeeping and the phone-line pages
// (exact English phrase → Yiddish).
export const strings = {
  // statistical arbitrage
  'Statistical arbitrage': 'סטאטיסטישע ארביטראזש',
  'Pairs trading for a whole basket. Every stock is measured against the basket\'s common move: buy the ones that fell unusually far behind, sell short the ones that ran unusually far ahead, and close when they come back.': 'פעירס טרעידינג פאר א גאנצן קאָשיק. יעדע סטאק ווערט געמאסטן קעגן דער געמיינזאמער באוועגונג פונעם קאָשיק: קויפט די וואס זענען אומגעווענליך ווייט צוריקגעבליבן, פארקויפט שארט די וואס זענען אומגעווענליך ווייט פאראויסגעלאפן, און פארמאכט ווען זיי קומען צוריק.',
  'Two-stock pairs': 'פּערס פון צוויי סטאקס', 'Whole basket: statistical arbitrage': 'א גאנצער קאָשיק: סטאטיסטישע ארביטראזש',
  'Basket': 'קאָשיק', 'Your own list': 'אייער אייגענע ליסטע', 'Window (days)': 'פענצטער (טעג)', 'Enter at |s| ≥': 'גייט אריין ביי |s| ≥', 'Exit at |s| ≤': 'גייט ארויס ביי |s| ≤',
  'Analyze basket': 'אנאליזירט דעם קאָשיק', 'Live: refresh (Pro)': 'לייוו: דערנייערן (Pro)', 'Pair matrix': 'פּערס מאטריץ',
  'Correlation of daily returns': 'קארעלאציע פון טעגליכע פראפיטן', 'Cointegration t-stat': 'קאאינטעגראציע t-סטאט', 'Gap z-score today': 'z-סקאר פונעם אפשטאנד היינט',
  'Signals today': 'סיגנאלן היינט', 's-score': 's-סקאר', 'Beta to basket': 'בעטא צום קאָשיק', 'Buy (cheap)': 'קויפט (ביליג)', 'Sell short (rich)': 'פארקויפט שארט (טייער)',
  'Not mean-reverting': 'קומט נישט צוריק צום דורכשניט', 'No position': 'קיין פאזיציע', 'Hold': 'האלט',
  's-score: how many standard deviations a stock sits from its own normal level against the basket. Stocks whose residual does not pull back within half the window are skipped.': 's-סקאר: וויפל סטאנדארט אפווייכונגען א סטאק איז אוועק פון זיין אייגענעם נארמאלן שטאפל קעגן דעם קאָשיק. סטאקס וועמענס רעשט ציט זיך נישט צוריק אין א האלב פענצטער ווערן איבערגעשפרונגען.',
  'Run it in Python (code lab)': 'לאזט עס לויפן אין Python (קאוד לאבאראטאריע)',
  'Statistical arbitrage (numpy, several symbols)': 'סטאטיסטישע ארביטראזש (numpy, עטלעכע סימבאלן)',
  // sign-in page
  'Backtest, paper trade and automate stock strategies. Connect your brokerage, trade by text or phone.': 'באקטעסט, פּעיפּער טרעידינג און אויטאמאטישע סטאק סטראטעגיעס. פארבינדט אייער בראוקער, טרעידט דורך טעקסט אדער טעלעפאן.',
  // monthly bookkeeping
  'Monthly bookkeeping': 'חודש\'דיגע בוכהאלטעריע', 'Download books CSV': 'דאונלאודט די ביכער CSV',
  'Every month\'s trades, gains, dividends, interest and deposits, with how much to set aside for taxes so far this year.': 'יעדן חודש\'ס טרעידס, געווינסן, דיווידענדן, פראצענט און איינלייגן, מיט וויפל אוועקצולייגן פאר שטייערן ביז יעצט דאס יאר.',
  'Month': 'חודש', 'Short-term': 'קורץ-טערמיניג', 'Long-term': 'לאנג-טערמיניג', 'Dividends': 'דיווידענדן', 'Interest': 'פראצענט', 'Deposits': 'איינלייגן',
  'Realized this year': 'רעאליזירט דאס יאר', 'Set aside so far': 'אוועקגעלייגט ביז יעצט', 'Nothing recorded this year yet': 'נאך גארנישט פארשריבן דאס יאר',
  'Estimated tax payments (Form 1040-ES)': 'אומגעפערע שטייער צאלונגען (Form 1040-ES)',
  'Email me last month\'s books on the 1st of every month': 'שיקט מיר די פריערדיגע חודש\'ס ביכער אויף אימעיל דעם 1טן פון יעדן חודש',
  'Set-aside amounts use your rates above and count dividends and interest as ordinary income. You may owe no estimated tax if your withholding covers it; check with a tax professional.': 'די אוועקגעלייגטע סומעס ניצן אייערע ראטעס אויבן און רעכענען דיווידענדן און פראצענט ווי געווענליכע הכנסה. אפשר דארפט איר נישט צאלן קיין אומגעפערע שטייער אויב אייער אפהאלטונג (withholding) דעקט עס; פרעגט א שטייער עקספערט.',
};
export const patterns = [
  [/^Stocks \(3 to (\d+)\)$/, 'סטאקס (3 ביז $1)'],
  [/^Live: refresh every (\d+) seconds$/, 'לייוו: דערנייערן יעדע $1 סעקונדעס'],
  [/^Your plan: up to (\d+) stocks, (refresh by hand|live every (\d+) s)\. (.+)\.$/, (m, n, how, s, rest) => `אייער פלאן: ביז ${n} סטאקס, ${s ? `לייוו יעדע ${s} סעק.` : 'דערנייערן מיט דער האנט'}. ${rest.replace(/(\w+): (\d+) stocks, every (\d+) s/g, '$1: $2 סטאקס, יעדע $3 סעק.')}.`],
  [/^(Correlation of daily returns|Cointegration t-stat \(below -3\.34 = cointegrated\)|Gap z-score today)\. Click a square to open that pair\.$/, (m, w) => `${{ 'Correlation of daily returns': 'קארעלאציע פון טעגליכע פראפיטן', 'Gap z-score today': 'z-סקאר פונעם אפשטאנד היינט' }[w] || 'קאאינטעגראציע t-סטאט (אונטער -3.34 = קאאינטעגרירט)'}. דריקט אויף א קעסטל צו עפענען דעם פּער.`],
  [/^as of (.+)$/, 'ביז $1'],
  [/^([\d.]+) days$/, '$1 טעג'],
  [/^Backtest (\S+) to (\S+)$/, 'באקטעסט $1 ביז $2'],
  [/^Long and short positions, equal money each, re-fitted every day on past data only, 0\.05% cost per trade\. Short selling needs a margin account\. Data: (.+)\.$/, 'לאנג און שארט פאזיציעס, גלייכע געלט פאר יעדן, יעדן טאג אויסגערעכנט נאר אויף פריערדיגע דאטן, 0.05% קאסט פער טרעיד. שארט סעלינג דארף א מארדזשין קאנטע. דאטן: $1.'],
  [/^Q(\d) · due (.+)$/, 'Q$1 · פעליג $2'],
];
