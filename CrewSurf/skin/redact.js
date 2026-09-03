/**
 * Local PII sanitisation — the privacy gate.
 *
 * SIH26171 requires that sensitive data is removed *on the device*, before any
 * network request is made. So this runs entirely in the extension: nothing here
 * calls out, and the detector's output never leaves the machine.
 *
 * The design rule that makes this defensible rather than decorative:
 *
 *     detect -> replace -> RE-ASSERT -> send
 *                             │
 *                             └── still matches? throw. No request.
 *
 * Detection can miss. An unverified redaction pass that "probably worked" is
 * worth nothing, so `sanitize` re-runs every detector over its own output and
 * throws `REDACTION_GATE_FAILED` if anything survived. Fail-closed: there is no
 * retry-and-hope branch, and the caller cannot accidentally send raw text by
 * ignoring a return value.
 *
 * Values are replaced with typed, numbered placeholders (`[EMAIL_1]`) rather
 * than a solid block, because the model still has to reason about structure —
 * "the email field already has a value" is useful, the value itself is not.
 * The mapping back to real values stays in memory on this machine and is never
 * serialised into a request.
 *
 * Exposes: window.CrewSurfRedact
 */
(function () {
    'use strict';

    /**
     * Order matters. Longer, more specific patterns run first so a card number
     * is not first eaten by the phone-number rule.
     */
    const DETECTORS = [
        {
            type: 'CARD',
            // 13-19 digits, optionally spaced or dashed. Separators sit only
            // *between* digits so the match cannot swallow the following space.
            // Luhn-checked below, so order numbers and long ids are left alone.
            re: /\b\d(?:[ -]?\d){12,18}\b/g,
            verify: (raw) => luhn(raw.replace(/\D/g, '')),
        },
        {
            type: 'AADHAAR',
            // 12 digits in 4-4-4. First digit of a real Aadhaar is never 0 or 1.
            re: /\b[2-9]\d{3}[ -]?\d{4}[ -]?\d{4}\b/g,
            verify: (raw) => raw.replace(/\D/g, '').length === 12,
        },
        { type: 'EMAIL', re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
        { type: 'PAN', re: /\b[A-Z]{5}\d{4}[A-Z]\b/g },
        { type: 'IFSC', re: /\b[A-Z]{4}0[A-Z0-9]{6}\b/g },
        {
            type: 'PHONE',
            // Indian mobile with optional +91, or a generic 10-15 digit run
            // carrying separators that mark it out as a phone number.
            re: /(?:\+91[ -]?)?\b[6-9]\d{9}\b|\+\d{1,3}[ -]?\d{3,5}[ -]?\d{4,6}\b/g,
        },
        { type: 'IP', re: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g, verify: (raw) => raw.split('.').every((o) => +o <= 255) },
        { type: 'UPI', re: /\b[\w.-]{3,}@(?:okhdfcbank|oksbi|okaxis|okicici|paytm|ybl|ibl|axl|upi)\b/gi },
    ];

    /** Field names whose *value* is sensitive regardless of what it looks like. */
    const SENSITIVE_FIELD = /pass(word|wd)?|pwd|otp|cvv|cvc|pin\b|secret|token|security|card|credit|debit|account|routing|aadhaar|aadhar|ssn|passport|dob|birth|salary|income/i;

    /** Field names that hold a person's name — unmatchable by pattern alone. */
    const NAME_FIELD = /^(.*[_-])?(name|fname|lname|firstname|lastname|surname|fullname)([_-].*)?$/i;

    function luhn(digits) {
        if (digits.length < 13 || digits.length > 19) return false;
        let sum = 0;
        let alt = false;
        for (let i = digits.length - 1; i >= 0; i--) {
            let n = +digits[i];
            if (alt) { n *= 2; if (n > 9) n -= 9; }
            sum += n;
            alt = !alt;
        }
        return sum % 10 === 0;
    }

    /**
     * Finds every PII span in a string. Returns them sorted, non-overlapping,
     * longest-match-wins so a card number is not partly re-matched as a phone.
     */
    function scan(text) {
        if (typeof text !== 'string' || !text) return [];
        const hits = [];

        for (const det of DETECTORS) {
            det.re.lastIndex = 0;
            let m;
            while ((m = det.re.exec(text)) !== null) {
                const raw = m[0];
                if (det.verify && !det.verify(raw)) continue;
                hits.push({ type: det.type, value: raw, start: m.index, end: m.index + raw.length });
            }
        }

        hits.sort((a, b) => a.start - b.start || b.end - a.end);
        const kept = [];
        let cursor = -1;
        for (const hit of hits) {
            if (hit.start >= cursor) { kept.push(hit); cursor = hit.end; }
        }
        return kept;
    }

    /** Replaces every found span with a typed, numbered placeholder. */
    function redactString(text, ledger) {
        const hits = scan(text);
        if (!hits.length) return { text, hits: [] };

        let out = '';
        let last = 0;
        for (const hit of hits) {
            const key = `${hit.type}:${hit.value}`;
            if (!ledger.map.has(key)) {
                ledger.counts[hit.type] = (ledger.counts[hit.type] || 0) + 1;
                ledger.map.set(key, `[${hit.type}_${ledger.counts[hit.type]}]`);
            }
            out += text.slice(last, hit.start) + ledger.map.get(key);
            last = hit.end;
        }
        out += text.slice(last);
        return { text: out, hits };
    }

    /** True when this element's *value* must be masked whatever it contains. */
    function isSensitiveField(el) {
        if (!el) return false;
        const type = (el.type || '').toLowerCase();
        if (type === 'password') return true;
        const hay = `${el.name || ''} ${el.id || ''} ${el.autocomplete || ''} ${el.label || ''}`;
        return SENSITIVE_FIELD.test(hay) || NAME_FIELD.test((el.name || el.id || '').trim());
    }

    /**
     * Sanitises a whole page context — the element table and the page text —
     * then re-asserts. Throws REDACTION_GATE_FAILED rather than returning
     * anything a caller could mistake for safe.
     */
    function sanitizeContext(ctx) {
        const ledger = { map: new Map(), counts: {} };
        if (!ctx) return { ctx, findings: {}, total: 0 };

        const clean = {
            url: redactString(String(ctx.url || ''), ledger).text,
            title: redactString(String(ctx.title || ''), ledger).text,
            text: redactString(String(ctx.text || ''), ledger).text,
            elements: (ctx.elements || []).map((el) => {
                // Every string field is redacted, not just `name`. Spreading the
                // element and masking one known key is how PII leaks: the next
                // person to add `placeholder` or `href` to the extractor would
                // have silently opened a hole. The gate below caught exactly
                // that during development.
                const copy = {};
                for (const [key, value] of Object.entries(el)) {
                    copy[key] = typeof value === 'string'
                        ? redactString(value, ledger).text
                        : value;
                }
                // A sensitive field's value is dropped wholesale — the model is
                // told the field exists, never what is in it.
                if (isSensitiveField(el)) {
                    copy.sensitive = true;
                    for (const key of ['name', 'label', 'value', 'placeholder']) {
                        if (copy[key]) copy[key] = `[${(el.type || 'FIELD').toUpperCase()}_FIELD]`;
                    }
                }
                return copy;
            }),
        };

        assertClean(JSON.stringify(clean));
        return { ctx: clean, findings: { ...ledger.counts }, total: ledger.map.size };
    }

    /** Sanitises free text destined for a request (prompts, task strings). */
    function sanitizeText(text) {
        const ledger = { map: new Map(), counts: {} };
        const out = redactString(String(text ?? ''), ledger).text;
        assertClean(out);
        return { text: out, findings: { ...ledger.counts }, total: ledger.map.size };
    }

    /**
     * The gate itself. Re-runs every detector over already-sanitised output; a
     * survivor means the redaction pass is wrong, and the only safe response is
     * to refuse to send.
     */
    function assertClean(payload) {
        const survivors = scan(payload);
        if (survivors.length) {
            const err = new Error(
                `REDACTION_GATE_FAILED — ${survivors.length} unmasked ${survivors[0].type} remained after redaction. Request not sent.`
            );
            err.code = 'REDACTION_GATE_FAILED';
            err.types = [...new Set(survivors.map((s) => s.type))];
            throw err;
        }
        return true;
    }

    /** "2 emails, 1 phone" — for the step log, so the pass is visible. */
    function describe(findings) {
        const parts = Object.entries(findings || {})
            .filter(([, n]) => n > 0)
            .map(([type, n]) => `${n} ${type.toLowerCase()}${n === 1 ? '' : 's'}`);
        return parts.length ? parts.join(', ') : 'nothing sensitive found';
    }

    window.CrewSurfRedact = { scan, sanitizeContext, sanitizeText, assertClean, isSensitiveField, describe, SENSITIVE_FIELD };
    if (typeof module !== 'undefined') module.exports = window.CrewSurfRedact;
})();
