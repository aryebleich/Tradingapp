// Yiddish for Equalize positions: choosing which holdings to include.
export const strings = {
  'Pick at least two holdings.': 'קלייבט כאטש צוויי האלדינגס.', 'Pick at least two holdings': 'קלייבט כאטש צוויי האלדינגס',
  'Pick at least two holdings to equalize': 'קלייבט כאטש צוויי האלדינגס צו גלייכן', 'Reset to all': 'צוריק צו אלע', 'Select all / none': 'אלע / קיינע',
  'Not changed': 'נישט געטוישט', 'Updating…': 'מען רעכנט איבער…', 'No trades needed': 'קיין טרעידס נישט נויטיג', 'Each included holding gets about': 'יעדע אריינגערעכנטע האלדינג באקומט בערך',
  'No trades needed: the included holdings already have about the same amount.': 'קיין טרעידס נישט נויטיג: די אריינגערעכנטע האלדינגס האבן שוין בערך די זעלבע סומע.',
  'To buy': 'צו קויפן', 'To sell': 'צו פארקויפן', 'Holding': 'האלדינג', 'Change': 'ענדערונג', 'Not held in this account': 'נישט געהאלטן אין דעם קאנטע',
};
export const patterns = [
  [/^(\d+) of (\d+) included$/, m => `${m[1]} פון ${m[2]} אריינגערעכנט`],
  [/^Place (\d+) trades?$/, m => `שטעלט אריין ${m[1]} טרעידס`],
  [/^(\d+) trades?$/, m => `${m[1]} טרעידס`],
  [/^Include (.+)$/, m => `רעכנט אריין ${m[1]}`],
  [/^Equalize holdings in (.+)\?$/, m => `גלייכן די האלדינגס אין ${m[1]}?`],
  [/^\(([\d.]+)% of the account\)\. Holdings you leave out are not bought or sold\.$/, m => `(${m[1]}% פון דער קאנטע). האלדינגס וואס איר לאזט אויס ווערן נישט געקויפט אדער פארקויפט.`],
  [/^Not held in this account: (.+)$/, m => `נישט געהאלטן אין דעם קאנטע: ${m[1]}`],
];
