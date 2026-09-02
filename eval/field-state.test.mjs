// Field state — can the model and the loop guards see what has been typed?
//
// Run from the repo root:  node eval/field-state.test.mjs
//
// Extracts valueOf and fieldsSignature out of the shipped content.js rather
// than importing a copy, so it cannot pass against code the extension does not
// run.

import fs from 'node:fs';

const src = fs.readFileSync('BlockAgent/content.js', 'utf8');
const grab = (startMarker, endMarker) => {
    const from = src.indexOf(startMarker);
    const to = src.indexOf(endMarker, from);
    if (from === -1 || to === -1) throw new Error(`could not locate ${startMarker}`);
    return src.slice(from, to);
};

const code =
    grab('function valueOf(el) {', '\nconst inputs = [];') +
    '\n' +
    grab('function fieldsSignature(inputs) {', '\n/**\n * Resolves once the page has stopped changing');

const { valueOf, fieldsSignature } = await import(
    'data:text/javascript,' + encodeURIComponent(code + '\nexport { valueOf, fieldsSignature };')
);

/** A minimal stand-in for the bits of an element valueOf touches. */
const el = ({ type = 'text', value = '', innerText = '', contentEditable = false, attrs = {} }) => ({
    type,
    value,
    innerText,
    isContentEditable: contentEditable,
    getAttribute: (name) => attrs[name] ?? null,
});

const cases = [
    ['empty field reads as absent', el({ value: '' }), undefined],
    ['whitespace only reads as absent', el({ value: '   ' }), undefined],
    ['filled text field', el({ value: 'jeumachahary07@gmail.com' }), 'jeumachahary07@gmail.com'],
    ['value is trimmed', el({ value: '  hello  ' }), 'hello'],
    ['contenteditable body', el({ contentEditable: true, innerText: 'Prototype is ready.' }), 'Prototype is ready.'],
    ['long value is capped', el({ value: 'x'.repeat(200) }), 'x'.repeat(120) + '…'],
];

// The security half: a secret must never appear in the payload, however it is labelled.
const secrets = [
    ['password field', el({ type: 'password', value: 'hunter2' })],
    ['card number by autocomplete', el({ value: '4111111111111111', attrs: { autocomplete: 'cc-number' } })],
    ['card number by name', el({ value: '4111111111111111', attrs: { name: 'cardNumber' } })],
    ['card number, mixed case name', el({ value: '4111111111111111', attrs: { name: 'billing_CARDNUMBER' } })],
];

let pass = 0;
for (const [name, element, want] of cases) {
    const got = valueOf(element);
    const ok = got === want;
    if (ok) pass++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
    if (!ok) console.log(`      wanted ${JSON.stringify(want)}\n      got    ${JSON.stringify(got)}`);
}
for (const [name, element] of secrets) {
    const got = valueOf(element);
    const ok = got === undefined;
    if (ok) pass++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  never emitted: ${name}`);
    if (!ok) console.log(`      leaked ${JSON.stringify(got)}`);
}

// The guard half: typing has to move the signature, or a successful TYPE still
// counts as "the page did not change" and the repeat guard kills the run.
const empty = [{ id: 2, value: undefined }, { id: 3, value: undefined }];
const recipientTyped = [{ id: 2, value: 'jeumachahary07@gmail.com' }, { id: 3, value: undefined }];
const subjectToo = [{ id: 2, value: 'jeumachahary07@gmail.com' }, { id: 3, value: 'Prototype ready' }];

const sigChecks = [
    ['empty form is stable', fieldsSignature(empty) === fieldsSignature(empty)],
    ['typing a recipient moves it', fieldsSignature(empty) !== fieldsSignature(recipientTyped)],
    ['typing a subject moves it again', fieldsSignature(recipientTyped) !== fieldsSignature(subjectToo)],
    ['same values hash the same', fieldsSignature(subjectToo) === fieldsSignature([...subjectToo])],
];
for (const [name, ok] of sigChecks) {
    if (ok) pass++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  signature: ${name}`);
}

const total = cases.length + secrets.length + sigChecks.length;
console.log(`\n${pass}/${total}`);
process.exit(pass === total ? 0 : 1);
