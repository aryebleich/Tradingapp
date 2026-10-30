// Yiddish for values investing (maaser, Shabbos and Yom Tov), private markets, real estate,
// QuickBooks and chart colors (exact English → Yiddish).
export const strings = {
  'Values investing': 'אינוועסטירן לויט אייערע ווערטן', 'Private markets': 'פריוואטע מארקעטס', 'Real estate': 'ריעל עסטעיט',
  'My values': 'מיינע ווערטן', 'Maaser': 'מעשר', 'Shabbos & Yom Tov': 'שבת און יום טוב', 'Screen': 'סקרינירן', 'My portfolio': 'מיין פארטפאליא',
  'Jewish values': 'אידישע ווערטן', 'General ethical': 'אלגעמיין עטיש', 'Custom': 'אייגנס', 'Avoid': 'אויסמיידן', 'No flags found': 'קיין סימנים נישט געפונען',
  'Maaser calculator': 'מעשר רעכענער', 'Maaser (10%)': 'מעשר (10%)', 'Chomesh (20%)': 'חומש (20%)', 'Chomesh': 'חומש',
  'Profit counted': 'געווינס גערעכנט', 'Already given': 'שוין געגעבן', 'Still to give': 'נאך צו געבן', 'Calculate': 'רעכנט אויס',
  'No trading on Shabbos and Yom Tov': 'נישט האנדלען אום שבת און יום טוב', 'Pause all trading on Shabbos and Yom Tov': 'אפשטעלן אלע טרעידינג אום שבת און יום טוב',
  'Times for': 'זמנים פאר', 'Coming up': 'קומט', 'Trading stops': 'טרעידינג שטעלט זיך אפ', 'Trading resumes': 'טרעידינג הייבט זיך ווידער אן',
  'Shabbos': 'שבת', 'Rosh Hashana': 'ראש השנה', 'Yom Kippur': 'יום כיפור', 'Sukkos': 'סוכות', 'Shemini Atzeres': 'שמיני עצרת', 'Simchas Torah': 'שמחת תורה',
  'Pesach': 'פסח', 'Shevi\'i shel Pesach': 'שביעי של פסח', 'Acharon shel Pesach': 'אחרון של פסח', 'Shavuos': 'שבועות',
  'Net worth': 'נעט ווערט', 'Brokerage accounts': 'בראוקער קאנטעס', 'Real estate equity': 'עקוויטי אין ריעל עסטעיט', 'Total': 'סך הכל',
  'Put in': 'אריינגעלייגט', 'Paid back to you': 'צוריקבאצאלט צו אייך', 'Value now': 'ווערט יעצט', 'Gain': 'געווינס', 'Multiple': 'מאל', 'Yearly return': 'יערליכער רעזולטאט',
  'Property value': 'ווערט פון די פראפערטי', 'Mortgages': 'מארטגעדזשעס', 'Equity': 'עקוויטי', 'Cash flow a month': 'קעש פלאו א חודש', 'Cap rate': 'קעפ רעיט', 'Cash-on-cash': 'קעש-אויף-קעש',
  'Where to invest': 'וואו צו אינוועסטירן', 'Money in and out': 'געלט אריין און ארויס', 'Money in': 'געלט אריין', 'New value': 'נייע ווערט', 'Add': 'צולייגן', 'Open': 'עפנט', 'Delete': 'אויסמעקן',
  'QuickBooks': 'QuickBooks', 'Connect QuickBooks': 'פארבינדט QuickBooks', 'Send month (bookkeeping)': 'שיקט דעם חודש (בוכהאלטעריי)', 'Your QuickBooks accounts': 'אייערע QuickBooks קאנטעס', 'Save accounts': 'היט אפ די קאנטעס',
  'Chart colors': 'טשארט קאלירן', 'How your account charts are colored.': 'ווי אייערע קאנטע טשארטס ווערן געפארבט.', 'One color': 'איין קאליר', 'A color I pick': 'א קאליר וואס איך קלייב', 'Color': 'קאליר',
  'New high': 'נייער שפיץ', 'Near its high': 'נאנט צום שפיץ', 'Gain, pulling back': 'געווינס, גייט צוריק', 'Gain, well below its high': 'געווינס, ווייט אונטערן שפיץ', 'Loss, rebounding': 'פארלוסט, קומט צוריק', 'Loss, sliding': 'פארלוסט, רוטשט אראפ', 'Deep loss': 'טיפער פארלוסט',
};
export const patterns = [
  [/^(Shabbos|Rosh Hashana|Yom Kippur|Sukkos|Shemini Atzeres|Simchas Torah|Pesach|Shavuos)(.*): trading is paused until (.+)\.$/, m => `${({ Shabbos: 'שבת', 'Rosh Hashana': 'ראש השנה', 'Yom Kippur': 'יום כיפור', Sukkos: 'סוכות', 'Shemini Atzeres': 'שמיני עצרת', 'Simchas Torah': 'שמחת תורה', Pesach: 'פסח', Shavuos: 'שבועות' })[m[1]]}${m[2]}: טרעידינג איז אפגעשטעלט ביז ${m[3]}.`],
];
