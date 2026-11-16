// Yiddish for scheduling from the order ticket, the clock and date pickers, and Close later.
export const strings = {
  'When': 'ווען', 'Now': 'יעצט', 'At a date and time': 'אויף א דאטום און צייט', 'Before the close': 'פארן שליסן', 'At the next open': 'ביים קומענדיגן עפענען',
  'After a delay': 'נאך א וויילע', 'Market open': 'מארקעט עפענט', '30 min before close': '30 מינוט פארן שליסן', 'At close': 'ביים שליסן', 'Next open': 'קומענדיגע עפענונג',
  'Repeat': 'איבערחזרן', 'Once': 'איינמאל', 'Every trading day': 'יעדן טרעידינג טאג', 'On chosen weekdays': 'אויף אויסגעקליבענע טעג', 'Monthly on this date': 'יעדן חודש אויף דעם דאטום',
  'Run': 'לויפן', 'At the close': 'ביים שליסן', '5 minutes before the close': '5 מינוט פארן שליסן', '15 minutes before the close': '15 מינוט פארן שליסן',
  '30 minutes before the close': '30 מינוט פארן שליסן', '1 hour before the close': 'א שעה פארן שליסן', 'Other…': 'אנדערש…', 'Minutes before the close': 'מינוט פארן שליסן',
  'In 5 minutes': 'אין 5 מינוט', 'In 1 hour': 'אין א שעה', 'Working out the time…': 'מען רעכנט אויס די צייט…', 'New York': 'ניו יארק',
  'Timing:': 'צייט:', 'Dial': 'זייגער', 'Digital': 'דיגיטאל', '24-hour clock': '24-שעה זייגער', 'Hour': 'שעה', 'Minute': 'מינוט',
  'Pick the hour, then the minute.': 'קלייבט די שעה, דערנאך די מינוט.', 'Pick the minute. Drag for single minutes.': 'קלייבט די מינוט. שלעפט פאר איינצלנע מינוטן.',
  'Previous month': 'פריערדיגער חודש', 'Next month': 'קומענדיגער חודש', 'Market closed': 'מארקעט פארמאכט', 'Closes at 1:00 PM': 'שליסט 1:00 נאכמיטאג',
  'Weekend': 'סוף וואך', 'Review scheduled order': 'קוקט איבער די באשטימטע ארדער', 'Schedule order': 'באשטימט ארדער', 'Close later': 'שליסן שפעטער',
  'How much': 'וויפיל', 'Entire position': 'די גאנצע פאזיציע', 'A quantity': 'א קוואנטיטעט', 'A percentage': 'א פראצענט', 'Percent of the position': 'פראצענט פון די פאזיציע',
  'Quantity': 'קוואנטיטעט', 'Review': 'איבערקוקן', 'Cancel': 'אפשטעלן', 'Pick when it should run': 'קלייבט ווען עס זאל לויפן',
  'Only market and limit orders can be scheduled from here.': 'נאר מארקעט און לימיט ארדערס קען מען דא באשטימען.',
  'Only simple market and limit orders can be scheduled for now.': 'פאר יעצט קען מען נאר באשטימען פשוטע מארקעט און לימיט ארדערס.',
  'Closing auction order (market on close).': 'שליס-אקציע ארדער (מארקעט ביים שליסן).', 'Opening auction order (market on open).': 'עפענונג-אקציע ארדער (מארקעט ביים עפענען).',
  'Sent as a closing auction order.': 'געשיקט אלס שליס-אקציע ארדער.', 'Sent as an opening auction order.': 'געשיקט אלס עפענונג-אקציע ארדער.',
  'The price when the order runs may differ from the price now.': 'דער פרייז ווען די ארדער לויפט קען זיין אנדערש ווי דער פרייז יעצט.',
  'This schedules a LIVE order with real money.': 'דאס באשטימט א לייוו ארדער מיט אמת\'ע געלט.', 'Pick a trading day': 'קלייבט א טרעידינג טאג',
  'Times are New York (exchange) time. Weekends and market holidays are skipped; on early-close days the market closes at 1:00 PM. An order that cannot be sent within its window is cancelled, never sent late.':
    'די צייטן זענען ניו יארק (בערזע) צייט. סוף וואכן און מארקעט יום טובים ווערן איבערגעהיפּט; אויף טעג וואס שליסן פריער פארמאכט דער מארקעט 1:00 נאכמיטאג. א ארדער וואס מען קען נישט שיקן אין איר צייט ווערט אפגעשטעלט, קיינמאל נישט געשיקט שפעט.',
};
export const patterns = [
  [/^runs in (\d+)d (\d+)h$/, m => `לויפט אין ${m[1]} טעג ${m[2]} שעה`],
  [/^runs in (\d+)h (\d+)m$/, m => `לויפט אין ${m[1]} שעה ${m[2]} מינוט`],
  [/^runs in (\d+)m$/, m => `לויפט אין ${m[1]} מינוט`],
  [/^Close (\S+) later$/, m => `שליסן ${m[1]} שפעטער`],
];
