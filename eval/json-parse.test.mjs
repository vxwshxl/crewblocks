// Model reply parsing — does an off-format reply still yield an action?
//
// Run from the repo root:  node eval/json-parse.test.mjs
//
// Extracts parseModelJson and jsonCandidates out of the shipped providers.ts
// rather than importing a copy, so it cannot pass against a parser the server
// does not use.

import fs from 'node:fs';

const src = fs.readFileSync('Studio/src/lib/providers.ts', 'utf8');
const from = src.indexOf('function parseModelJson(text: string)');
const to = src.indexOf('/* ------------------------------------------------------- openai-compatible -- */');
if (from === -1 || to === -1) throw new Error('could not locate the parser in providers.ts');

// Strip the handful of type annotations these two functions use.
const js = src
    .slice(from, to)
    .replace(/function parseModelJson\(text: string\): Record<string, unknown>/, 'function parseModelJson(text)')
    .replace(/function jsonCandidates\(text: string\): string\[\]/, 'function jsonCandidates(text)')
    .replace(/ as Record<string, unknown>/g, '')
    // local variable annotations, e.g. `const found: string[] = []`
    .replace(/\b(const|let)\s+(\w+):\s*[A-Za-z<>[\]|,\s]+?\s*=/g, '$1 $2 =');

const mod = await import(
    'data:text/javascript,' +
    encodeURIComponent(
        'class ModelError extends Error { constructor(m, c, raw) { super(m); this.code = c; this.raw = raw; } }\n' +
        js +
        '\nexport { parseModelJson, jsonCandidates };'
    )
);
const { parseModelJson, jsonCandidates } = mod;

const cases = [
    ['plain object', '{"action":"CLICK","elementId":2}', { action: 'CLICK', elementId: 2 }],
    ['markdown fence', '```json\n{"action":"CLICK","elementId":2}\n```', { action: 'CLICK', elementId: 2 }],
    ['prose preamble', 'Sure, here is the action:\n{"action":"CLICK","elementId":2}', { action: 'CLICK', elementId: 2 }],
    ['closed think block', '<think>click {this} or {that}</think>\n{"action":"CLICK","elementId":2}', { action: 'CLICK', elementId: 2 }],
    ['think block after answer', '{"action":"CLICK","elementId":2}\n<think>done</think>', { action: 'CLICK', elementId: 2 }],
    ['braces in prose before json', 'The set {a, b} is irrelevant. {"action":"SCROLL","direction":"DOWN"}', { action: 'SCROLL', direction: 'DOWN' }],
    ['trailing commentary', '{"action":"CLICK","elementId":2} - this opens compose.', { action: 'CLICK', elementId: 2 }],
    ['braces inside a string value', '{"action":"TYPE","elementId":7,"text":"use {braces} here"}', { action: 'TYPE', elementId: 7, text: 'use {braces} here' }],
    ['escaped quote in value', '{"action":"TYPE","elementId":7,"text":"he said \\"hi\\""}', { action: 'TYPE', elementId: 7, text: 'he said "hi"' }],
    ['two objects, first wins', '{"action":"CLICK","elementId":2}{"action":"SCROLL"}', { action: 'CLICK', elementId: 2 }],
];

let pass = 0;
for (const [name, input, want] of cases) {
    let got;
    try { got = parseModelJson(input); } catch (e) { got = `THREW: ${e.message}`; }
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (ok) pass++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
    if (!ok) console.log(`      wanted ${JSON.stringify(want)}\n      got    ${JSON.stringify(got)}`);
}

// These must still fail, so a truncated or empty reply triggers the repair retry
// instead of silently becoming the wrong action.
const mustThrow = [
    ['truncated mid-string', '{"action":"TYPE","elementId":7,"text":"a long body that stops'],
    ['unterminated think block', '<think>weighing {a} against {b}'],
    ['no json at all', 'I will click the Compose button now.'],
];
for (const [name, input] of mustThrow) {
    let threw = false;
    try { parseModelJson(input); } catch { threw = true; }
    if (threw) pass++;
    console.log(`${threw ? 'PASS' : 'FAIL'}  rejects: ${name}`);
}

if (jsonCandidates('no braces here').length !== 0) throw new Error('scanner should find nothing');
if (jsonCandidates('{a} {"b":1}').length !== 2) throw new Error('scanner should find both regions');

const total = cases.length + mustThrow.length;
console.log(`\n${pass}/${total}`);
process.exit(pass === total ? 0 : 1);
