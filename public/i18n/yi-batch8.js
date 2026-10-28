// Yiddish for scheduled trades at a set time, the monthly calendar with earnings and IPOs, credits,
// and the stock lookups by text (exact English → Yiddish).
export const strings = {
  // scheduled trades
  'New scheduled order': 'נייער געפלאנטער ארדער', 'Date': 'דאטום', 'Time (New York)': 'צייט (ניו יארק)', 'Quick pick': 'שנעלע אויסוואל', 'Choose…': 'קלייבט…',
  'At the open (9:30)': 'ביים עפענען (9:30)', 'Just after the open (9:35)': 'גלייך נאכן עפענען (9:35)', 'Midday (12:00)': 'מיטאג (12:00)', 'Before the close (15:50)': 'פארן שליסן (15:50)',
  'Pre-market (8:00, limit + extended)': 'פרי-מארקעט (8:00, לימיט + עקסטענדעד)', 'After hours (17:00, limit + extended)': 'נאך די שעות (17:00, לימיט + עקסטענדעד)',
  'Repeat': 'איבערחזרן', 'Once': 'איינמאל', 'Every weekday': 'יעדן וואכנטאג', 'On chosen weekdays': 'אויף אויסגעקליבענע וואכנטעג', 'Monthly on this date': 'יעדן חודש אויף דעם דאטום',
  'Weekly': 'יעדע וואך', 'Monthly': 'יעדן חודש', 'Weekdays:': 'וואכנטעג:',
  'Sun': 'זונ', 'Mon': 'מאנ', 'Tue': 'דינ', 'Wed': 'מיט', 'Thu': 'דאנ', 'Fri': 'פרייט', 'Sat': 'שבת',
  'Order type': 'ארדער טיפ', 'Market': 'מארקעט', 'Limit': 'לימיט', 'Limit price': 'לימיט פרייז',
  'Extended hours (4:00–9:30 and 16:00–20:00, Alpaca)': 'עקסטענדעד שעות (4:00–9:30 און 16:00–20:00, Alpaca)',
  'Times are New York (exchange) time. Market orders run during the regular session (9:30–16:00); a time outside it runs at the next open. Limit orders with extended hours can run pre-market and after hours on an Alpaca account.': 'די צייטן זענען ניו יארקער (בערזע) צייט. מארקעט ארדערס לויפן בעת די רעגולערע שעות (9:30–16:00); א צייט אויסער דעם לויפט ביים נעקסטן עפענען. לימיט ארדערס מיט עקסטענדעד שעות קענען לויפן פרי-מארקעט און נאך די שעות אויף אן Alpaca קאנטע.',
  'Schedule': 'פלאנירט', 'When': 'ווען', 'Next run': 'נעקסטער לויף', 'Last result': 'לעצטער רעזולטאט', 'No scheduled trades yet': 'נאך קיין געפלאנטע טרעידס',
  'done': 'פארטיג',

  // calendar
  '📅 Calendar & events': '📅 קאלענדאר און געשעענישן', 'Earnings, IPOs, dividends, splits and market holidays for the month.': 'ערנינגס, IPOs, דיווידענדן, ספליטס און מארקעט יום-טובים פארן חודש.',
  'Earnings (you own it)': 'ערנינגס (איר פארמאגט עס)', 'Earnings': 'ערנינגס', 'IPO': 'IPO', 'Dividend': 'דיווידענד', 'Split or other action': 'ספליט אדער אן אנדער אקציע',
  'Earnings dates and IPOs appear once the owner adds a market-events key (Admin → Keys → FINNHUB_API_KEY).': 'ערנינגס דאטומס און IPOs ווייזן זיך ווען דער אייגנטימער לייגט צו א מארקעט-געשעענישן שליסל (Admin → Keys → FINNHUB_API_KEY).',
  'Nothing scheduled.': 'גארנישט נישט געפלאנט.', 'Closed': 'פארמאכט', 'Early close': 'פרי פארמאכט', 'Today': 'היינט', 'Previous month': 'פריערדיגער חודש', 'Next month': 'נעקסטער חודש',
  'Connect an Alpaca account to add market holidays, early closes, dividends and splits.': 'פארבינדט אן Alpaca קאנטע צו צולייגן מארקעט יום-טובים, פרי פארמאכן, דיווידענדן און ספליטס.',

  // credits
  'Credits': 'קרעדיטס', 'credits': 'קרעדיטס', 'What credits pay for': 'פאר וואס קרעדיטס צאלן', 'Buy credits': 'קויפט קרעדיטס', 'Monthly credits left': 'חודשליכע קרעדיטס געבליבן',
  'AI message beyond the daily allowance': 'AI מעסעדזש איבערן טאגליכן לימיט', 'Text message sent to you': 'טעקסט מעסעדזש געשיקט צו אייך', 'Call to the phone line': 'א רוף צו דער טעלעפאן ליניע',
  'AI summary of a 10-K or 10-Q': 'AI סיכום פון א 10-K אדער 10-Q', 'Training an AI agent': 'טרענירן אן AI אגענט', 'Strategy optimizer run': 'סטראטעגיע אפטימייזער לויף',
  'Bought credits never expire and are used after your monthly ones.': 'געקויפטע קרעדיטס גייען קיינמאל נישט אויס און ווערן גענוצט נאך די חודשליכע.',
  'Thank you! Your credits are being added. It can take a few seconds to show here.': 'א דאנק! אייערע קרעדיטס ווערן צוגעלייגט. עס קען נעמען עטליכע סעקונדעס ביז עס ווייזט זיך דא.',
  '100 credits every month': '100 קרעדיטס יעדן חודש', '1,000 credits every month': '1,000 קרעדיטס יעדן חודש', '3,000 credits every month': '3,000 קרעדיטס יעדן חודש', '10,000 credits every month': '10,000 קרעדיטס יעדן חודש',

  // text & hotline
  'Look up any stock': 'קוקט נאך סיי וועלכע אקציע', 'Text a ticker and a word. Try any stock!': 'שיקט א טיקער מיט א ווארט. פרובירט סיי וועלכע אקציע!',
  '1 week, 1 month and 1 year performance': 'פערפארמענס פון 1 וואך, 1 חודש און 1 יאר', 'Next earnings date, estimates and the last results': 'נעקסטער ערנינגס דאטום, שאצונגען און די לעצטע רעזולטאטן',
  'The latest headlines': 'די לעצטע כעדליינס', 'Price and this week\'s move': 'פרייז און די וואך\'ס באוועגונג',
  'On the phone line: press 1 for paper or 2 for live, then 1 account info, 2 positions, 3 market clock, 4 place a trade, 5 cancel orders, 6 close all, 9 switch account. Every change needs your PIN.': 'אויף דער טעלעפאן ליניע: דריקט 1 פאר פּעיפּער אדער 2 פאר לייוו, דערנאך 1 קאנטע אינפא, 2 פאזיציעס, 3 מארקעט זייגער, 4 שטעלן א טרעיד, 5 אפשטעלן ארדערס, 6 פארמאכן אלעס, 9 טוישן קאנטע. יעדע ענדערונג דארף אייער PIN.',
};
export const patterns = [
  [/^([\d,]+) of ([\d,]+) monthly credits left \(they refill on the 1st\)\.$/, '$1 פון $2 חודשליכע קרעדיטס געבליבן (זיי ווערן אנגעפילט דעם 1טן).'],
  [/^([\d,]+) of ([\d,]+) monthly credits left \(they refill on the 1st\) · ([\d,]+) bought credits \(never expire\)\.$/, '$1 פון $2 חודשליכע קרעדיטס געבליבן (זיי ווערן אנגעפילט דעם 1טן) · $3 געקויפטע קרעדיטס (גייען נישט אויס).'],
  [/^Monthly on the (\d+)( at .+)?$/, 'יעדן חודש דעם $1$2'],
  [/^Scheduled\. First run (.+) New York time\.$/, 'געפלאנט. ערשטער לויף $1 ניו יארקער צייט.'],
];
