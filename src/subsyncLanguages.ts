// Language identifiers from neck0l/subsync's data/languages.py at the pinned
// revision. The first code in each row is upstream's model/dictionary key;
// remaining codes include ISO 639-1 and ISO 639-2/T aliases.
const languages = [
  'alb sq sqi',
  'ara ar',
  'bel be',
  'bul bg',
  'cat ca',
  'chi zh zho cht chs cmn',
  'cze cs ces',
  'dan da',
  'dut nl nld',
  'eng en',
  'est et',
  'fao fo',
  'fin fi',
  'fre fr fra',
  'ger de deu',
  'gla gd',
  'glg gl',
  'gre el ell',
  'heb he',
  'hrv hr',
  'hun hu',
  'ice is isl',
  'ind id',
  'ita it',
  'jpn ja',
  'kor ko',
  'lat la',
  'lav lv',
  'lit lt',
  'may ms msa',
  'mlg mg',
  'mlt mt',
  'nor no',
  'per fa fas',
  'pol pl',
  'por pt pob',
  'rum ro ron',
  'rus ru',
  'slo sk slk',
  'slv sl',
  'spa es',
  'srp sr',
  'swe sv',
  'tur tr',
  'ukr uk',
];

const aliases = new Map<string, string>();
for (const row of languages) {
  const codes = row.split(' ');
  for (const code of codes) aliases.set(code, codes[0]);
}

export function getSubsyncLanguage(code: string): string | undefined {
  return aliases.get(code.trim().toLowerCase());
}
