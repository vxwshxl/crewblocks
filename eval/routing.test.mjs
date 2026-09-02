// Capability routing — does a named capability land on the right site?
//
// Run from the repo root:  node eval/routing.test.mjs
//
// Like eval/index.html, this extracts the resolver out of the shipped
// sidebar.js rather than importing a copy, so it cannot pass against code the
// extension does not actually run.

import fs from 'node:fs';

const s = fs.readFileSync('BlockAgent/sidebar.js', 'utf8');
const from = s.indexOf('/**\n * What each capability looks like in the wild.');
const to = s.indexOf('/**\n * Opens the site a task starts on in a NEW tab');
if (from === -1 || to === -1) throw new Error('could not locate the resolver');
const code = s.slice(from, to);

let TABS = [];
globalThis.chrome = { tabs: { query: async () => TABS } };
const mod = await import('data:text/javascript,' + encodeURIComponent(
  code + '\nexport { resolveCapability, CAPABILITY_SITES };'
));
const { resolveCapability } = mod;

const tab = (url, t = 1) => ({ url, lastAccessed: t });
const cases = [
  ['no mail tab open',        [],                                        'email',  null,       null,          'https://mail.google.com/mail/u/0/#inbox?compose=new'],
  ['Outlook is open',         [tab('https://outlook.live.com/mail/0/')], 'email',  null,       null,          'https://outlook.live.com/mail/0/'],
  ['Gmail + Outlook, Gmail newer', [tab('https://outlook.live.com/mail/0/',1), tab('https://mail.google.com/mail/u/0/',9)], 'email', null, null, 'https://mail.google.com/mail/u/0/#inbox?compose=new'],
  ['no shop tab',             [],                                        'shop',   null,       null,          'https://www.amazon.in/'],
  ['Flipkart is open',        [tab('https://www.flipkart.com/cart')],    'shop',   null,       null,          'https://www.flipkart.com/'],
  ['user named flipkart',     [],                                        'shop',   'flipkart', null,          'https://www.flipkart.com/'],
  ['user named an unknown site', [],                                     'shop',   'zomato',   null,          'https://www.zomato.com/'],
  ['search with a query',     [],                                        'search', null,       'who won x&y', 'https://www.google.com/search?q=who%20won%20x%26y'],
  ['video with a query',      [],                                        'video',  null,       'lofi beats',  'https://www.youtube.com/results?search_query=lofi%20beats'],
  ['code, site rejected upstream', [],                                   'code',   null,       null,          'https://github.com/'],
  ['unknown capability',      [],                                        'nonsense', null,     null,          null],
];

let pass = 0;
for (const [name, tabs, needs, site, query, want] of cases) {
  TABS = tabs;
  const got = await resolveCapability(needs, site, query);
  const ok = got === want;
  if (ok) pass++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(32)} -> ${got}`);
  if (!ok) console.log(`      wanted ${want}`);
}
console.log(`\n${pass}/${cases.length}`);
process.exit(pass === cases.length ? 0 : 1);
