// Yiddish for the pro polish: sign-up, empty states, the upgrade window, the plan comparison and onboarding.
export const strings = {
  'Create your account': 'עפנט אייער קאנטע', 'What you get, free': 'וואס איר באקומט, אומזיסט', 'About your account': 'וועגן אייער קאנטע',
  '$100,000 in practice money with real market prices': '$100,000 פראקטיק געלט מיט עכטע מארקעט פרייזן', 'No card needed for the free plan': 'קיין קארטל נישט נויטיג פארן אומזיסטן פלאן',
  'Two-factor login and passkeys to protect your account': 'צוויי-שריט איינלאגירן און פעסקיס צו שיצן אייער קאנטע',
  'Brightolio is software, not a broker. Orders go to the brokerage account you choose. Trading involves risk of loss.': 'ברייטאליא איז א סאפטווער, נישט קיין בראוקער. ארדערס גייען צו דער בראוקער קאנטע וואס איר קלייבט. האנדלען איז פארבונדן מיט ריזיקע פון פארלוסט.',
  'Read the risk disclosure': 'לייענט די ריזיקע אנזאג', 'How we protect your account': 'ווי מיר שיצן אייער קאנטע',
  'No orders yet.': 'נאך קיין ארדערס.', 'Place a practice trade': 'מאכט א פראקטיק טרעיד', 'Place a trade with the ticket': 'מאכט א טרעיד מיטן טיקעט', 'No positions yet.': 'נאך קיין פאזיציעס.',
  'Nothing billed yet.': 'נאך גארנישט פארעכנט.', 'Charges, refunds and credit purchases show here.': 'אפצאלן, צוריקגעצאלטס און קרעדיט קויפן ווייזן זיך דא.',
  'Compare plans': 'פארגלייכט פלענער', 'Feature': 'מעגלעכקייט', 'Recommended': 'רעקאמענדירט', 'billed yearly': 'באצאלט יערליך',
  'What stays free': 'וואס בלייבט אומזיסט', 'Not now': 'נישט יעצט', 'See all plans': 'זעט אלע פלענער', 'Monthly': 'חודשליך', 'Yearly': 'יערליך',
  "You won't be charged until the trial ends. Cancel anytime from Manage billing.": 'מען וועט אייך נישט פארעכענען ביז דער פראבע ענדיגט זיך. שטעלט אפ ווען איר ווילט פון "פירן באצאלן".',
  'Next step: try a ready-made strategy': 'קומענדיגער שריט: פרובירט א פארטיגע סטראטעגיע', 'Open the strategy library': 'עפנט די סטראטעגיע ביבליאטעק',
  'Security': 'זיכערהייט', 'Your plan': 'אייער פלאן', 'Reached your plan\'s limit': 'איר האט דערגרייכט אייער פלאן\'ס גרענעץ',
};
export const patterns = [
  [/^(.+) needs (Pro|Elite|Ultimate)$/, m => `${m[1]} דארף ${m[2]}`],
  [/^Unlock with (Pro|Elite|Ultimate)$/, m => `עפנט מיט ${m[1]}`],
  [/^Start (\d+)-day free trial of (Pro|Elite|Ultimate)$/, m => `הייבט אן ${m[1]}-טאגיגע אומזיסטע פראבע פון ${m[2]}`],
  [/^Choose (Pro|Elite|Ultimate)$/, m => `קלייבט ${m[1]}`],
  [/^\$([\d.,]+)\/month, billed \$([\d,]+) yearly$/, m => `$${m[1]} א חודש, באצאלט $${m[2]} יערליך`],
  [/^Paid plans start with a (\d+)-day free trial; cancel anytime$/, m => `באצאלטע פלענער הייבן אן מיט א ${m[1]}-טאגיגע אומזיסטע פראבע; שטעלט אפ ווען איר ווילט`],
];
