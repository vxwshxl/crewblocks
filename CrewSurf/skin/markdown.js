/**
 * A small, safe Markdown renderer.
 *
 * Extension pages run under `script-src 'self'`, so a CDN library is not an
 * option — and pulling a full parser in for what a chat bubble needs would be
 * overkill anyway.
 *
 * The security rule that matters: **escape first, then add markup**. Everything
 * here runs on text a language model produced, which means it is untrusted. By
 * the time any `<` reaches the output it is already `&lt;`, so the only tags in
 * the result are the ones this file emits. Link hrefs are additionally checked
 * for scheme, because `[x](javascript:…)` is the one attack the escape pass
 * does not catch on its own.
 *
 * Exposes: window.renderMarkdown(text) -> HTML string
 */
(function () {
    'use strict';

    const escapeHtml = (s) =>
        s.replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');

    /** Only http(s) and mailto survive; anything else renders as plain text. */
    const safeHref = (url) => /^(https?:\/\/|mailto:)/i.test(url.trim());

    function inline(text) {
        let out = text;

        // Code spans first: their contents must not be touched by later rules.
        const spans = [];
        out = out.replace(/`([^`\n]+)`/g, (_m, code) => {
            spans.push(`<code>${code}</code>`);
            return `\u0000${spans.length - 1}\u0000`;
        });

        out = out
            .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
            .replace(/__([^_\n]+)__/g, '<strong>$1</strong>')
            .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
            .replace(/~~([^~\n]+)~~/g, '<del>$1</del>');

        out = out.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (match, label, url) =>
            safeHref(url)
                ? `<a href="${url}" target="_blank" rel="noreferrer noopener">${label}</a>`
                : match
        );

        // Bare URLs, but not ones already inside an href we just wrote.
        out = out.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, (_m, lead, url) =>
            `${lead}<a href="${url}" target="_blank" rel="noreferrer noopener">${url}</a>`
        );

        return out.replace(/\u0000(\d+)\u0000/g, (_m, i) => spans[Number(i)]);
    }

    function renderMarkdown(src) {
        if (!src) return '';
        const lines = escapeHtml(String(src)).split('\n');
        const out = [];
        let i = 0;

        const listOpen = { ul: false, ol: false };
        const closeLists = () => {
            if (listOpen.ul) { out.push('</ul>'); listOpen.ul = false; }
            if (listOpen.ol) { out.push('</ol>'); listOpen.ol = false; }
        };

        while (i < lines.length) {
            const line = lines[i];

            // Fenced code — consumed verbatim, no inline pass.
            const fence = line.match(/^\s*```(\w*)\s*$/);
            if (fence) {
                closeLists();
                const body = [];
                i++;
                while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) body.push(lines[i++]);
                i++; // closing fence
                out.push(`<pre><code>${body.join('\n')}</code></pre>`);
                continue;
            }

            if (/^\s*$/.test(line)) { closeLists(); i++; continue; }

            const heading = line.match(/^(#{1,6})\s+(.*)$/);
            if (heading) {
                closeLists();
                const level = Math.min(heading[1].length + 2, 6);
                out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
                i++;
                continue;
            }

            if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
                closeLists();
                out.push('<hr>');
                i++;
                continue;
            }

            const quote = line.match(/^\s*&gt;\s?(.*)$/);
            if (quote) {
                closeLists();
                const body = [quote[1]];
                i++;
                while (i < lines.length && /^\s*&gt;\s?/.test(lines[i])) {
                    body.push(lines[i].replace(/^\s*&gt;\s?/, ''));
                    i++;
                }
                out.push(`<blockquote>${inline(body.join(' '))}</blockquote>`);
                continue;
            }

            // Table: a header row followed by a |---|---| separator.
            if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length &&
                /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
                closeLists();
                const cells = (row) =>
                    row.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
                const head = cells(line);
                i += 2;
                const body = [];
                while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) body.push(cells(lines[i++]));
                out.push(
                    `<table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead>` +
                    `<tbody>${body
                        .map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`)
                        .join('')}</tbody></table>`
                );
                continue;
            }

            const ordered = line.match(/^\s*\d+[.)]\s+(.*)$/);
            if (ordered) {
                if (listOpen.ul) { out.push('</ul>'); listOpen.ul = false; }
                if (!listOpen.ol) { out.push('<ol>'); listOpen.ol = true; }
                out.push(`<li>${inline(ordered[1])}</li>`);
                i++;
                continue;
            }

            const bullet = line.match(/^\s*[-*+]\s+(.*)$/);
            if (bullet) {
                if (listOpen.ol) { out.push('</ol>'); listOpen.ol = false; }
                if (!listOpen.ul) { out.push('<ul>'); listOpen.ul = true; }
                out.push(`<li>${inline(bullet[1])}</li>`);
                i++;
                continue;
            }

            // Paragraph: gather until a blank line or a block-level opener.
            closeLists();
            const para = [line];
            i++;
            while (
                i < lines.length &&
                !/^\s*$/.test(lines[i]) &&
                !/^\s*(#{1,6}\s|```|[-*+]\s|\d+[.)]\s|&gt;\s?|\|)/.test(lines[i])
            ) {
                para.push(lines[i++]);
            }
            out.push(`<p>${inline(para.join(' '))}</p>`);
        }

        closeLists();
        return out.join('');
    }

    window.renderMarkdown = renderMarkdown;
})();
