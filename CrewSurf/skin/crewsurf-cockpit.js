/**
 * CrewSurf Cockpit — the new tab page, and the agent behind it.
 *
 * The page is an extension page, so it can do what a website cannot: read the
 * active tab's DOM and act on it. That is the whole reason the agent lives here
 * rather than in a hosted page.
 *
 * The loop is deliberately small and legible:
 *
 *     capture the page  ->  ask Qwen for ONE action  ->  run it  ->  repeat
 *
 * One action per turn, never a script the model wrote. The model chooses from a
 * fixed verb list and refers to elements by the index we handed it, so a
 * hallucinated selector cannot reach the page — the worst case is an index that
 * does not exist, which we report back as a failed step and let it retry.
 *
 * ## Where the work happens
 *
 * In sibling tabs, in this same window, collected under a "CrewSurf" tab group.
 * Driving the tab you are sitting in would yank you somewhere new on every step;
 * a separate window fixed that but hid the work somewhere you were not looking,
 * and made "translate this page" point at a page you had never seen. Sibling
 * tabs keep the work visible, reachable in one click, and out of your way.
 *
 * Each source gets its own tab: `open` for a new one, `switch` to read between
 * them, `navigate` only to move within a site. Reusing one tab meant every new
 * page destroyed the last, so a price comparison thrashed back and forth
 * re-fetching what it had already seen.
 *
 * Each cockpit tab is one conversation, and owns its tabs and its tab group
 * alone — see the sessions block. Two cockpits used to fight over the same page.
 *
 * The side panel streams a thumbnail of the tab being worked in. Three ways,
 * best first, because none of them works everywhere — see `captureShot`.
 */

const MAX_STEPS = 40;          // hard stop; a loop that cannot finish must end
const MAX_ELEMENTS = 120;      // keep the prompt affordable on the local model
const MIRROR_LIMIT = 1_500_000;  // markup we will ship back for one preview frame
const SETTINGS_KEY = 'crewsurf.settings';
const MEMORY_KEY = 'crewsurf.memory';
const ACTIVITY_KEY = 'crewsurf.activity';

const DEFAULTS = {
    apiKey: '',
    cloudModel: 'qwen/qwen3-vl-8b-instruct',
    localUrl: 'http://127.0.0.1:8081/v1',
    localModel: 'mlx-community/Qwen3-VL-4B-Instruct-4bit',
};

/**
 * Pages the browser will let an extension inject into. chrome://,
 * chrome-extension:// and the Web Store are refused no matter what the manifest
 * asks for — and so is about:blank, whose opaque origin `<all_urls>` does not
 * cover. No permission unlocks any of them, so reading the page is best-effort:
 * the agent works without one when it has to.
 */
const SCRIPTABLE = /^https?:\/\//i;
const isScriptable = (url) => SCRIPTABLE.test(url || '');

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------------------------------------------------------- storage -- */

/**
 * Reads a key, falling back to the name it had before the rename so an API key
 * and memory typed under the old brand are not silently lost. The old value is
 * copied forward on first read; nothing here ever writes back to the old name.
 */
async function readMigrated(key, legacyKey, fallback) {
    const stored = await chrome.storage.local.get([key, legacyKey]);
    if (stored[key] !== undefined) return stored[key];
    if (stored[legacyKey] !== undefined) {
        await chrome.storage.local.set({ [key]: stored[legacyKey] });
        return stored[legacyKey];
    }
    return fallback;
}

async function loadSettings() {
    const saved = await readMigrated(SETTINGS_KEY, 'crewser.settings', {});
    return { ...DEFAULTS, ...(saved || {}) };
}
const saveSettings = (next) => chrome.storage.local.set({ [SETTINGS_KEY]: next });

async function loadMemory() {
    return (await readMigrated(MEMORY_KEY, 'crewser.memory', '')) || '';
}
const saveMemory = (text) => chrome.storage.local.set({ [MEMORY_KEY]: text });

async function loadActivity() {
    const stored = await chrome.storage.local.get(ACTIVITY_KEY);
    return stored[ACTIVITY_KEY] || [];
}
async function pushActivity(entry) {
    const all = await loadActivity();
    all.unshift(entry);
    await chrome.storage.local.set({ [ACTIVITY_KEY]: all.slice(0, 50) });
    renderActivity();
}

/* ------------------------------------------------------------------- page -- */

/**
 * Runs inside the target tab. Returns the interactive elements with a stable
 * index, plus enough text to reason about. Kept self-contained because it is
 * injected as a function body, not bundled.
 */
function extractPageContext(limit) {
    const SELECTOR = 'a[href], button, input, textarea, select, [role="button"], [role="link"], [role="textbox"], [onclick], [contenteditable="true"]';

    const visible = (el) => {
        const rect = el.getBoundingClientRect();
        if (rect.width < 2 || rect.height < 2) return false;
        const style = getComputedStyle(el);
        if (style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0') return false;
        return rect.bottom > -600 && rect.top < window.innerHeight + 600;
    };

    const name = (el) => {
        const label =
            el.getAttribute('aria-label') ||
            el.getAttribute('placeholder') ||
            el.getAttribute('title') ||
            el.value ||
            el.innerText ||
            el.getAttribute('alt') ||
            '';
        return label.replace(/\s+/g, ' ').trim().slice(0, 120);
    };

    const elements = [];
    for (const el of document.querySelectorAll(SELECTOR)) {
        if (elements.length >= limit) break;
        if (!visible(el)) continue;
        const label = name(el);
        if (!label && el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA') continue;
        el.dataset.crewsurfIdx = String(elements.length);
        elements.push({
            i: elements.length,
            tag: el.tagName.toLowerCase(),
            type: el.getAttribute('type') || '',
            name: label,
        });
    }

    // Text from *where the page is scrolled to*, not from the top.
    //
    // This used to be `body.innerText.slice(0, 6000)` — the first 6000 characters
    // of the document, every turn, no matter where the agent had scrolled. So
    // scrolling changed nothing the model could see: it scrolled, got a
    // byte-identical observation, concluded it still had not found what it was
    // after, and scrolled again until the step ceiling. Reading the blocks near
    // the viewport is what makes `scroll` a real action.
    const BLOCKS = 'h1,h2,h3,h4,h5,p,li,td,th,dd,dt,blockquote,pre,figcaption,caption';
    const CHROME = 'nav,aside,header,footer,[role="navigation"],[role="banner"],[role="contentinfo"],[role="complementary"]';

    // Read the article, not the furniture. A sticky sidebar or a table of
    // contents sits in the viewport at *every* scroll position, so without this
    // the first thousand characters of every single turn are the same menu —
    // the identical-observation problem again, one level down.
    const root = document.querySelector('main, [role="main"], article') || document.body;

    const near = [];
    let used = 0;
    for (const el of root.querySelectorAll(BLOCKS)) {
        if (used >= 6000) break;
        const rect = el.getBoundingClientRect();
        if (rect.bottom < -800 || rect.top > window.innerHeight + 800) continue;
        if (el.querySelector(BLOCKS)) continue;          // keep the leaf, not its wrapper
        if (el.closest(CHROME)) continue;
        const line = (el.innerText || '').replace(/\s+/g, ' ').trim();
        if (!line) continue;
        near.push(line);
        used += line.length;
    }

    // A page with no recognisable blocks at all — a canvas app, an odd SPA —
    // still has to return something, so fall back to the old whole-body read.
    const text = near.length
        ? near.join('\n')
        : (document.body?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 6000);

    const height = Math.max(
        document.documentElement.scrollHeight,
        document.body?.scrollHeight || 0
    );
    const room = Math.max(0, height - window.innerHeight);

    return {
        url: location.href,
        title: document.title,
        text,
        elements,
        scroll: {
            y: Math.round(window.scrollY),
            height: Math.round(height),
            viewport: Math.round(window.innerHeight),
            percent: room ? Math.round((window.scrollY / room) * 100) : 100,
            atEnd: window.scrollY >= room - 4,
        },
    };
}

/**
 * Runs inside the target tab. Collects every visible text node, tagged with an
 * index, so translations can be written back to the exact nodes they came from.
 *
 * Working at the text-node level rather than on innerHTML is what keeps the page
 * intact: no markup is re-parsed, so links, buttons and event handlers all
 * survive translation. Script, style and editable fields are skipped — rewriting
 * those either breaks the page or overwrites what the user typed.
 */
function collectTextNodes(maxNodes) {
    const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'CODE', 'PRE']);
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
            const text = node.nodeValue.trim();
            if (text.length < 2) return NodeFilter.FILTER_REJECT;
            const parent = node.parentElement;
            if (!parent || SKIP.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
            if (parent.isContentEditable) return NodeFilter.FILTER_REJECT;
            const style = getComputedStyle(parent);
            if (style.display === 'none' || style.visibility === 'hidden') return NodeFilter.FILTER_REJECT;
            if (!/\p{L}/u.test(text)) return NodeFilter.FILTER_REJECT; // numbers/symbols only
            return NodeFilter.FILTER_ACCEPT;
        },
    });

    window.__crewsurfNodes = [];
    const out = [];
    let node;
    while ((node = walker.nextNode()) && out.length < maxNodes) {
        window.__crewsurfNodes.push(node);
        out.push({ i: out.length, t: node.nodeValue.trim().slice(0, 400) });
    }
    return out;
}

/** Runs inside the target tab. Writes translations back onto the same nodes. */
function writeTranslations(pairs) {
    const nodes = window.__crewsurfNodes || [];
    let written = 0;
    for (const { i, t } of pairs) {
        const node = nodes[i];
        if (!node || !t) continue;
        // Preserve the original whitespace so layout does not shift.
        const original = node.nodeValue;
        const lead = original.match(/^\s*/)[0];
        const tail = original.match(/\s*$/)[0];
        node.nodeValue = lead + t + tail;
        written++;
    }
    return { written };
}

/** Runs inside the target tab. Acts on an element previously indexed. */
function performAction(action) {
    const find = (i) => document.querySelector(`[data-crewsurf-idx="${i}"]`);

    if (action.type === 'click') {
        const el = find(action.index);
        if (!el) return { ok: false, error: `no element ${action.index}` };
        el.scrollIntoView({ block: 'center' });
        el.click();
        return { ok: true };
    }

    if (action.type === 'type') {
        const el = find(action.index);
        if (!el) return { ok: false, error: `no element ${action.index}` };
        el.focus();

        // Rich-text editors — Notion, Keep, most CMS bodies — are contenteditable,
        // not <input>, and the value setter below does nothing to them.
        // execCommand is deprecated and still the only call that inserts text
        // *and* fires the input events those editors listen for.
        if (el.isContentEditable) {
            const ok = document.execCommand('insertText', false, action.text);
            if (!ok) {
                el.textContent = (el.textContent || '') + action.text;
                el.dispatchEvent(new InputEvent('input', { bubbles: true, data: action.text }));
            }
            return { ok: true };
        }

        const setter = Object.getOwnPropertyDescriptor(
            el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
            'value'
        )?.set;
        // React and friends listen for the native setter, not .value =
        if (setter) setter.call(el, action.text);
        else el.value = action.text;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        if (action.submit) {
            el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
            el.form?.requestSubmit?.();
        }
        return { ok: true };
    }

    if (action.type === 'scroll') {
        window.scrollBy({ top: action.amount || 600, behavior: 'instant' });
        return { ok: true };
    }

    return { ok: false, error: `unknown action ${action.type}` };
}

/**
 * Runs inside the target tab. Rebuilds the page as one self-contained document
 * the cockpit can render in a sandboxed iframe.
 *
 * This is the preview that always works: it needs nothing beyond the scripting
 * permission the agent already uses to read the page, and because it is the
 * *live* DOM it shows what was typed and what was translated, which a screenshot
 * of a stale frame would not.
 *
 * Everything that could run, fetch on its own, or nest another browser is
 * stripped. What is left is markup, styling and images, loaded from the site as
 * a picture is.
 */
function mirrorPage(limit) {
    const doc = document.documentElement.cloneNode(true);

    for (const el of doc.querySelectorAll(
        'script, noscript, iframe, frame, object, embed, template, link[rel~="preload"], link[rel~="prefetch"]'
    )) {
        el.remove();
    }

    // Cloning copies attributes, not properties, so anything typed into the page
    // would vanish from the preview. Carry the live values across — the clone
    // walks in document order, so the two lists line up.
    const live = document.querySelectorAll('input, textarea, select, option');
    const copy = doc.querySelectorAll('input, textarea, select, option');
    for (let i = 0; i < live.length && i < copy.length; i++) {
        const from = live[i];
        const to = copy[i];
        if (from.tagName === 'TEXTAREA') to.textContent = from.value;
        else if (from.tagName === 'OPTION') to.toggleAttribute('selected', from.selected);
        else if (from.type === 'checkbox' || from.type === 'radio') to.toggleAttribute('checked', from.checked);
        else if (from.tagName === 'INPUT') to.setAttribute('value', from.value);
    }

    let head = doc.querySelector('head');
    if (!head) {
        head = document.createElement('head');
        doc.insertBefore(head, doc.firstChild);
    }

    // Without this, every relative stylesheet and image in the clone would be
    // resolved against the extension page and the mirror would render unstyled.
    const base = document.createElement('base');
    base.href = location.href;
    head.insertBefore(base, head.firstChild);

    // Show the page where the agent actually is, and make it inert.
    //
    // Offset by a *ratio*, not by a pixel count. The mirror lays out at 1200px
    // and the real tab does not, so the same scrollY lands somewhere else in the
    // clone — far enough down a long article to push the visible strip past the
    // end of the content and render the preview blank. A percentage translate
    // resolves against the mirror's own height, so it cannot overshoot.
    const room = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    const ratio = Math.min(1, Math.max(0, window.scrollY / room)).toFixed(4);
    const frozen = document.createElement('style');
    frozen.textContent =
        'html,body{overflow:hidden!important}' +
        `body{transform:translateY(calc(${ratio} * (750px - 100%)));pointer-events:none}`;
    head.appendChild(frozen);

    const html = `<!doctype html>${doc.outerHTML}`;
    return { html: html.length > limit ? null : html, bytes: html.length };
}

/* ------------------------------------------------------------------ model -- */

const SYSTEM_PROMPT = `You are CrewSurf, an agent that operates a web browser.

Each turn you get the current page and must reply with EXACTLY ONE JSON object
and nothing else. No prose, no markdown fence.

Actions:
  {"type":"click","index":N,"why":"..."}
  {"type":"type","index":N,"text":"...","submit":true,"why":"..."}
  {"type":"navigate","url":"https://...","why":"..."}      // reuse the current tab
  {"type":"open","url":"https://...","why":"..."}          // NEW tab, keeps the old one
  {"type":"switch","tab":N,"why":"..."}                    // read one of your open tabs
  {"type":"scroll","amount":600,"why":"..."}
  {"type":"ask","question":"...","sensitive":true}
  {"type":"done","answer":"the final answer for the user"}

Any action may also carry "note":"the fact you just read".

MEMORY — read this twice:
- You see ONE page per turn. The moment you scroll, switch or open, everything on
  the page you left is gone from your view forever.
- "note" is the only thing you keep. Whatever you put there comes back to you
  every turn afterwards, under FINDINGS.
- So: never leave a page without a note. Gathering three facts from three sources
  means three notes. If FINDINGS already answers the task, stop and use "done" —
  do not go back and re-read a page to check.

Rules:
- "index" must be one of the indices listed in ELEMENTS. Never invent one.
- Prefer navigate over hunting for a search box when you know the URL.
- Comparing sources? "open" each one in its own tab, then "switch" between them
  to read each. Never "navigate" away from a page you still need — that throws
  the page away and you will have to fetch it again.
- TABS lists the tabs you already have. Read one before opening another copy.
- PAGE TEXT is what is on screen *now*, not the whole page. POSITION tells you
  where you are in it. Scroll only when POSITION says there is page left below
  and what you need is not on screen. Never scroll twice in a row without taking
  a note in between — if two scrolls taught you nothing, the answer is not on
  this page, so switch or answer.
- When the task is a question you can already answer from the page or FINDINGS,
  use "done".
- When no page is loaded, either answer with "done" or "navigate" somewhere useful.
- Greetings and small talk are answered with "done", not by browsing.
- Never guess a password, OTP, card number or personal detail. Use "ask".
- An element marked [sensitive] must not be typed into without asking first.
- Keep "why" under 12 words.
- The "answer" field is shown to the user as Markdown. Use headings, lists and
  tables where they help, and keep it tight.`;

function buildUserMessage(task, ctx, history, memory, openTabs = [], findings = []) {
    const past = history.length
        ? `\nSTEPS SO FAR:\n${history.map((h, i) => `${i + 1}. ${h}`).join('\n')}`
        : '';
    const notes = memory ? `\nWHAT YOU KNOW ABOUT THE USER:\n${memory}\n` : '';

    // The agent's own notes, carried across tabs and scrolls. Without this it
    // has no way to hold three sources in mind at once, and a comparison task
    // degenerates into re-reading pages it has already read.
    const learned = findings.length
        ? `\nFINDINGS — what you have already established:\n${findings.map((f, i) => `${i + 1}. ${f}`).join('\n')}\n`
        : '';

    const tabs = openTabs.length
        ? `\nYOUR OPEN TABS:\n${openTabs.map((t, i) => `[${i}]${t.id === workTabId ? ' (reading)' : ''} ${t.title} — ${t.url}`).join('\n')}\n`
        : '';

    if (!ctx) {
        return `TASK: ${task}
${notes}${learned}${tabs}
No page is loaded, so there is nothing to read or click yet.
If the task is conversational, answer it with "done".
If it needs the web, "navigate" to a page you can work from.${past}

Reply with one JSON action.`;
    }

    const elements = ctx.elements
        .map((e) => `[${e.i}] <${e.tag}${e.type ? ' ' + e.type : ''}> ${e.name}`)
        .join('\n');

    const s = ctx.scroll;
    const position = s
        ? `POSITION: ${s.percent}% down the page (${s.y}px of ${s.height}). ` +
          (s.atEnd
              ? 'You are at the BOTTOM — scrolling again shows nothing new.'
              : `About ${Math.max(0, Math.round((s.height - s.viewport - s.y) / s.viewport))} more screens below.`)
        : '';

    return `TASK: ${task}
${notes}${learned}${tabs}
URL: ${ctx.url}
TITLE: ${ctx.title}
${position}

ELEMENTS:
${elements || '(none)'}

PAGE TEXT (what is on screen now):
${ctx.text.slice(0, 3500)}${past}

Reply with one JSON action.`;
}

/** Both tiers speak the OpenAI chat API, so only the base URL and key differ. */
async function askModel(settings, tier, messages, signal, maxTokens = 900) {
    const cloud = tier === 'cloud';
    if (cloud && !settings.apiKey) {
        throw new Error('No OpenRouter key yet — open Settings and paste one.');
    }

    const base = cloud ? 'https://openrouter.ai/api/v1' : settings.localUrl.replace(/\/$/, '');
    const headers = { 'Content-Type': 'application/json' };
    if (cloud) headers.Authorization = `Bearer ${settings.apiKey}`;

    // THE GATE. Nothing reaches the network on the cloud tier without passing
    // through local redaction first, and a failed assertion throws before the
    // fetch rather than after it. On the local tier the model is on this
    // machine, so there is nothing to redact from.
    if (cloud) {
        messages = messages.map((m) => {
            const { text, findings, total } = window.CrewSurfRedact.sanitizeText(m.content);
            if (total) lastRedaction = window.CrewSurfRedact.describe(findings);
            return { ...m, content: text };
        });
    }

    let res;
    try {
        res = await fetch(`${base}/chat/completions`, {
            method: 'POST',
            headers,
            signal,
            body: JSON.stringify({
                model: cloud ? settings.cloudModel : settings.localModel,
                messages,
                temperature: 0,
                max_tokens: maxTokens,
            }),
        });
    } catch (err) {
        if (err.name === 'AbortError') throw err;
        throw new Error(
            cloud
                ? 'Could not reach OpenRouter.'
                : `Could not reach the local model at ${base} — is it running?`
        );
    }

    if (!res.ok) {
        const detail = (await res.text()).slice(0, 200);
        throw new Error(`Model returned ${res.status}. ${detail}`);
    }

    const data = await res.json();
    return data.choices?.[0]?.message?.content ?? '';
}

/**
 * Models wrap JSON in fences and commentary more often than not, so take the
 * first balanced object rather than trusting the whole reply to parse.
 */
function parseAction(reply) {
    let text = reply.trim().replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    text = text.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    try {
        return JSON.parse(text);
    } catch {
        const start = text.indexOf('{');
        if (start === -1) return null;
        let depth = 0;
        for (let i = start; i < text.length; i++) {
            if (text[i] === '{') depth++;
            else if (text[i] === '}' && --depth === 0) {
                try {
                    return JSON.parse(text.slice(start, i + 1));
                } catch {
                    return null;
                }
            }
        }
        return null;
    }
}

/* --------------------------------------------------------------------- ui -- */

const thread = $('thread');
let busy = false;
let abort = null;
let workWindowId = null;
let workTabId = null;
let workGroupId = null;
let lastRedaction = null;   // reported into the step log so the pass is visible
let previewOn = true;       // live thumbnail on/off, header toggle
let agentTabIds = [];       // every tab this run has opened, in order

/* --------------------------------------------------------------- sessions -- */

/**
 * One cockpit tab is one conversation, and each owns its own tabs and its own
 * tab group.
 *
 * There used to be no such notion. `workTabId` was picked as "the first real
 * page in this window", so opening a second cockpit and typing a task into it
 * adopted the *first* conversation's tab: it navigated the page away mid-run and
 * dragged it out of the other conversation's group. Ownership is therefore
 * recorded where every cockpit can see it — a claims table in extension storage,
 * keyed by session, pruned of sessions whose cockpit tab has since closed.
 *
 * Claims are advisory between cockpits, never a lock on the user: any tab is
 * still one click away, and closing a cockpit releases everything it held.
 */
const SESSIONS_KEY = 'crewsurf.sessions';
// Session storage, not local: tab ids are only unique within one run of the
// browser, so a claims table that outlived a restart would hand this run's tabs
// to conversations that ended yesterday. Older builds without it lose only the
// restart guarantee.
const sessionStore = chrome.storage.session ?? chrome.storage.local;
const sessionId = crypto.randomUUID?.() ?? `s${Date.now()}${Math.random()}`;
let sessionLabel = 'CrewSurf';
let cockpitTabId = null;

/** The claims table with dead conversations dropped. */
async function readSessions() {
    const stored = await sessionStore.get(SESSIONS_KEY);
    const all = stored[SESSIONS_KEY] || {};
    const live = {};
    for (const [id, entry] of Object.entries(all)) {
        if (id === sessionId) { live[id] = entry; continue; }
        // A conversation whose cockpit tab is gone cannot own anything any more.
        // This is also what makes an unclean close safe: nothing has to be
        // released on the way out for the claim to lapse.
        const tab = await chrome.tabs.get(entry.cockpitTabId).catch(() => null);
        if (tab) live[id] = entry;
    }
    return live;
}

/** Records what this conversation owns, and prunes conversations that ended. */
async function claimTabs() {
    const live = await readSessions();
    live[sessionId] = {
        cockpitTabId,
        label: sessionLabel,
        groupId: workGroupId,
        tabIds: agentTabIds.slice(),
        at: Date.now(),
    };
    await sessionStore.set({ [SESSIONS_KEY]: live });
    return live;
}

/** Tab ids another live conversation is working in. We never take one of these. */
async function foreignTabIds() {
    const live = await readSessions();
    const ids = new Set();
    for (const [id, entry] of Object.entries(live)) {
        if (id === sessionId) continue;
        if (entry.cockpitTabId != null) ids.add(entry.cockpitTabId);
        for (const tabId of entry.tabIds || []) ids.add(tabId);
    }
    return ids;
}

/** Names this conversation after the ones already open: CrewSurf, CrewSurf 2, … */
async function openSession() {
    const me = await chrome.tabs.getCurrent();
    cockpitTabId = me?.id ?? null;

    const live = await readSessions();
    const taken = new Set(
        Object.entries(live).filter(([id]) => id !== sessionId).map(([, e]) => e.label)
    );
    let n = 1;
    while (taken.has(n === 1 ? 'CrewSurf' : `CrewSurf ${n}`)) n++;
    sessionLabel = n === 1 ? 'CrewSurf' : `CrewSurf ${n}`;
    $('sessionLabel').textContent = n === 1 ? '' : sessionLabel;

    await claimTabs();
}

async function closeSession() {
    const stored = await sessionStore.get(SESSIONS_KEY);
    const all = stored[SESSIONS_KEY] || {};
    delete all[sessionId];
    await sessionStore.set({ [SESSIONS_KEY]: all });
}

/** The agent's own tabs, dead ones dropped, for the prompt and the sidebar. */
async function listAgentTabs() {
    const live = [];
    for (const id of agentTabIds) {
        const tab = await chrome.tabs.get(id).catch(() => null);
        if (tab) {
            live.push({
                id: tab.id,
                title: tab.title || '',
                url: tab.url || '',
                favIconUrl: tab.favIconUrl || '',
            });
        }
    }
    agentTabIds = live.map((t) => t.id);
    return live;
}

/** Opens a new tab beside the others and makes it the one being read. */
async function openAgentTab(url) {
    const me = await chrome.tabs.getCurrent();
    const created = await chrome.tabs.create({
        windowId: me.windowId,
        url,
        active: false,             // never steal the foreground
        index: me.index + 1 + agentTabIds.length,
    });
    agentTabIds.push(created.id);
    workTabId = created.id;
    await groupWorkTab(created.id, me.windowId);
    await claimTabs();
    await waitForComplete(created.id);
    return created;
}

function addMessage(role, text, asMarkdown = false) {
    $('hero')?.remove();
    const row = document.createElement('div');
    row.className = `row ${role}`;

    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    if (asMarkdown) {
        bubble.classList.add('md');
        // Safe: renderMarkdown escapes before it adds any markup.
        bubble.innerHTML = window.renderMarkdown(text);
    } else {
        bubble.textContent = text;
    }

    row.appendChild(bubble);
    thread.appendChild(row);
    row.scrollIntoView({ block: 'end' });
    return bubble;
}

/**
 * Suspends the run and asks the human, the way a permission prompt does.
 *
 * Resolves with the typed value, or null if they decline. The value is returned
 * to the caller and nowhere else: it is not appended to the transcript, not put
 * in `history`, and never included in a prompt.
 */
function askUser(question, note, secret) {
    return new Promise((resolve) => {
        $('hero')?.remove();
        const box = document.createElement('div');
        box.className = 'prompt';

        const q = document.createElement('p');
        q.className = 'q';
        q.textContent = question;

        const sub = document.createElement('p');
        sub.className = 'sub';
        sub.textContent = note || '';

        const field = document.createElement('div');
        field.className = 'field';

        const input = document.createElement('input');
        input.type = secret ? 'password' : 'text';
        input.autocomplete = secret ? 'off' : 'on';
        input.setAttribute('aria-label', question);

        const send = document.createElement('button');
        send.className = 'btn primary';
        send.textContent = 'Use this';

        const skip = document.createElement('button');
        skip.className = 'btn';
        skip.textContent = 'Skip';

        let settled = false;
        const finish = (value) => {
            if (settled) return;
            settled = true;
            box.classList.add('done');
            sub.textContent = value === null
                ? 'Skipped.'
                : secret ? 'Entered directly into the page. Not sent to the model.' : `Used: ${value}`;
            resolve(value);
        };

        send.addEventListener('click', () => finish(input.value));
        skip.addEventListener('click', () => finish(null));
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); finish(input.value); }
            if (e.key === 'Escape') finish(null);
        });

        field.append(input, send, skip);
        box.append(q, sub, field);
        thread.appendChild(box);
        box.scrollIntoView({ block: 'end' });
        input.focus();
    });
}

function addStep(kind, detail, tone = '') {
    const el = document.createElement('div');
    el.className = `step ${tone}`;
    const k = document.createElement('span');
    k.className = 'k';
    k.textContent = kind;
    const d = document.createElement('span');
    d.textContent = detail || '';
    el.append(k, d);
    const log = $('steps');
    // Follow the tail only if the user is already at the bottom, so scrolling
    // back to read an earlier step is not yanked away by the next one.
    const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
    log.appendChild(el);
    if (atBottom) log.scrollTop = log.scrollHeight;
}

const setStatus = (t) => { $('status').textContent = t; };

/* ------------------------------------------------------------ live preview -- */

/**
 * A thumbnail of the tab the agent is working in.
 *
 * There is no single API that can do this, so there are three, best first:
 *
 *  1. `chrome.tabs.captureVisibleTab`, when the work tab happens to be the one
 *     in front. Exact, instant, free — but by definition it can only ever
 *     return the *visible* tab, and the tab in front is normally the cockpit.
 *  2. `Page.captureScreenshot` over the debugger protocol, which is the only
 *     thing that can read a background tab directly. It needs the `debugger`
 *     permission, and a permission added to an extension that is already
 *     installed is not granted until the extension is installed afresh — so on
 *     an existing profile `chrome.debugger` is simply not there. That is what
 *     used to leave the panel reading "Preview appears while working" for the
 *     whole run: the attach threw, the catch swallowed it, and nothing said so.
 *  3. Mirroring the DOM into a sandboxed iframe. Needs nothing beyond the
 *     scripting permission the agent already uses to read the page, works on any
 *     background tab, and shows the live state — what was typed, what was
 *     translated. Not pixel-exact, and that is the trade.
 *
 * Whatever happens, the panel says what it is showing. A silent placeholder is
 * the one outcome that is not allowed.
 */
const MIRROR_WIDTH = 1200;   // lay the mirror out as a desktop, then scale it down
const MIRROR_HEIGHT = 750;   // 16:10, matching the .shot box

let dbgTabId = null;
let shotTimer = null;
let shotBusy = false;         // a mirror in flight; never queue a second
let shotMode = '';            // what the panel currently holds: text | img | frame
let shotNote = null;
let lastMirror = '';
const dbgRefused = new Set(); // tabs the debugger would not attach to, so we stop asking

const canDebug = () => typeof chrome.debugger?.attach === 'function';

async function attachDebugger(tabId) {
    if (dbgTabId === tabId) return true;
    await detachDebugger();
    try {
        await chrome.debugger.attach({ tabId }, '1.3');
        dbgTabId = tabId;
        return true;
    } catch {
        return false; // devtools already open on that tab, or permission refused
    }
}

async function detachDebugger() {
    if (dbgTabId === null) return;
    const id = dbgTabId;
    dbgTabId = null;
    try { await chrome.debugger.detach({ tabId: id }); } catch { /* already gone */ }
}

/* ---- what the panel shows ---- */

function setShotNote(text) {
    if (shotNote === text) return;
    shotNote = text;
    const note = $('shotNote');
    note.textContent = text || '';
    note.hidden = !text;
}

function showPlaceholder(text, note = '') {
    const shot = $('shot');
    shot.classList.remove('has');
    shot.textContent = text;
    shotMode = 'text';
    lastMirror = '';
    setShotNote(note);
}

function showImage(src, note = '') {
    const shot = $('shot');
    if (shotMode !== 'img') {
        shot.textContent = '';
        const img = document.createElement('img');
        img.alt = 'Live view of the tab CrewSurf is working in';
        shot.appendChild(img);
        shotMode = 'img';
        lastMirror = '';
    }
    shot.classList.add('has');
    shot.querySelector('img').src = src;
    setShotNote(note);
}

function scaleMirror() {
    const shot = $('shot');
    const frame = shot.querySelector('iframe');
    // Zero while the panel is hidden, and scaling to nothing would leave the
    // mirror invisible when it comes back.
    if (frame && shot.clientWidth) {
        frame.style.transform = `scale(${shot.clientWidth / MIRROR_WIDTH})`;
    }
}

function showMirror(html, note = '') {
    const shot = $('shot');
    if (shotMode !== 'frame') {
        shot.textContent = '';
        const frame = document.createElement('iframe');
        // No scripts, no forms, no navigation, opaque origin — it is a picture.
        frame.setAttribute('sandbox', '');
        frame.setAttribute('referrerpolicy', 'no-referrer');
        frame.setAttribute('tabindex', '-1');
        frame.setAttribute('aria-hidden', 'true');
        frame.width = MIRROR_WIDTH;
        frame.height = MIRROR_HEIGHT;
        shot.appendChild(frame);
        shotMode = 'frame';
    }
    shot.classList.add('has');
    scaleMirror();
    // Reassigning srcdoc reloads the frame, so an unchanged page must not.
    if (html !== lastMirror) {
        lastMirror = html;
        shot.querySelector('iframe').srcdoc = html;
    }
    setShotNote(note);
}

/* ---- the three ways to get a frame ---- */

async function shotFromVisible(tab) {
    try {
        const url = await chrome.tabs.captureVisibleTab(tab.windowId, {
            format: 'jpeg',
            quality: 60,
        });
        if (!url) return false;
        showImage(url);
        return true;
    } catch {
        return false;
    }
}

async function shotFromDebugger(tabId) {
    if (!(await attachDebugger(tabId))) {
        dbgRefused.add(tabId);
        return false;
    }
    try {
        const res = await chrome.debugger.sendCommand(
            { tabId },
            'Page.captureScreenshot',
            { format: 'jpeg', quality: 45 }
        );
        if (!res?.data) return false;
        showImage(`data:image/jpeg;base64,${res.data}`);
        return true;
    } catch {
        return false; // a navigation mid-capture just costs one frame
    }
}

async function shotFromDom(tabId) {
    let mirror;
    try {
        const [res] = await chrome.scripting.executeScript({
            target: { tabId },
            func: mirrorPage,
            args: [MIRROR_LIMIT],
        });
        mirror = res?.result ?? null;
    } catch {
        return false;
    }
    if (!mirror) return false;

    if (!mirror.html) {
        showPlaceholder(
            'Page too big to preview',
            `${Math.round(mirror.bytes / 1024)} KB of markup. The run is unaffected.`
        );
        return true;
    }
    showMirror(mirror.html, 'Rebuilt from the live page, not a screenshot.');
    return true;
}

async function captureShot(useDebugger = true) {
    // Mirroring a page is not free, and a cockpit in a background tab is not
    // being read. The run carries on regardless; only the picture pauses.
    if (!previewOn || document.hidden || workTabId === null || shotBusy) return;

    const tabId = workTabId;
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab) return;
    if (!isScriptable(tab.url)) {
        showPlaceholder(
            'Nothing to show yet',
            tab.url && tab.url !== 'about:blank' ? 'This kind of page cannot be previewed.' : ''
        );
        return;
    }

    shotBusy = true;
    try {
        if (tab.active && (await shotFromVisible(tab))) return;
        if (useDebugger && canDebug() && !dbgRefused.has(tabId) && (await shotFromDebugger(tabId))) return;
        if (await shotFromDom(tabId)) return;
        showPlaceholder('Preview unavailable', 'The page would not let CrewSurf read it.');
    } finally {
        shotBusy = false;
    }
}

/**
 * `live` is a run in progress: poll faster, and allow the debugger — its
 * "CrewSurf is debugging this browser" bar is a fair price while the agent is
 * working, and not one to pay while it is idle.
 */
function startPreview(live = true) {
    stopPreview();
    if (!previewOn) return;
    captureShot(live);
    shotTimer = setInterval(() => captureShot(live), live ? 1500 : 5000);
}

function stopPreview() {
    if (shotTimer) clearInterval(shotTimer);
    shotTimer = null;
    detachDebugger();
}

function setLive(running, label) {
    $('liveDot').classList.toggle('run', running);
    $('liveLabel').textContent = label;
}

function setWhere(title, url, favIconUrl) {
    $('whereTitle').textContent = title || 'Nothing open yet';
    $('whereUrl').textContent = url || '';
    const fav = $('nowFav');
    if (favIconUrl) { fav.src = favIconUrl; fav.style.visibility = 'visible'; }
    else fav.style.visibility = 'hidden';
}

/* ------------------------------------------------------------ live view -- */

/**
 * The tab the agent works in — a sibling of the cockpit in the *same* window,
 * grouped under a green "CrewSurf" group so it is obvious in the tab strip and
 * one click away. A separate window was the earlier design and it was wrong: it
 * split the work off from the browser the user is actually looking at, so
 * "translate this page" pointed at a blank page they had never seen.
 */
async function groupWorkTab(tabId, windowId) {
    try {
        if (workGroupId !== null) {
            const existing = await chrome.tabGroups.get(workGroupId).catch(() => null);
            if (existing) {
                await chrome.tabs.group({ tabIds: [tabId], groupId: workGroupId });
                return;
            }
            workGroupId = null;
        }
        workGroupId = await chrome.tabs.group({ tabIds: [tabId], createProperties: { windowId } });
        await chrome.tabGroups.update(workGroupId, { title: sessionLabel, color: 'green' });
    } catch {
        workGroupId = null; // grouping is a nicety, never a blocker
    }
}

async function ensureWorkTab() {
    const me = await chrome.tabs.getCurrent();
    if (!me) return null;
    workWindowId = me.windowId;

    if (workTabId !== null) {
        const live = await chrome.tabs.get(workTabId).catch(() => null);
        // A tab we were only previewing is not owned yet, and may have been
        // claimed by another conversation since we picked it.
        const owned = agentTabIds.includes(workTabId);
        if (live && (owned || !(await foreignTabIds()).has(live.id))) {
            if (!owned) {
                agentTabIds.push(live.id);
                await groupWorkTab(live.id, me.windowId);
                await claimTabs();
            }
            return live;
        }
        workTabId = null;
    }

    // Prefer a real page the user already has open — acting on what they are
    // looking at is almost always what they meant. But never one another
    // conversation is working in: adopting it would navigate that page away and
    // pull it out of the other conversation's group, mid-run.
    const taken = await foreignTabIds();
    const tabs = await chrome.tabs.query({ windowId: me.windowId });
    const free = tabs.filter((t) => t.id !== me.id && isScriptable(t.url) && !taken.has(t.id));
    const existing = free.find((t) => t.active) ?? free[0];
    if (existing) {
        workTabId = existing.id;
        if (!agentTabIds.includes(existing.id)) agentTabIds.push(existing.id);
        await groupWorkTab(existing.id, me.windowId);
        await claimTabs();
        return existing;
    }

    const created = await chrome.tabs.create({
        windowId: me.windowId,
        url: 'about:blank',
        active: false,          // the cockpit keeps the foreground
        index: me.index + 1,
    });
    workTabId = created.id;
    if (!agentTabIds.includes(created.id)) agentTabIds.push(created.id);
    await groupWorkTab(created.id, me.windowId);
    await claimTabs();
    return (await waitForComplete(created.id)) ?? created;
}

/**
 * This conversation's tabs — not every tab in the window.
 *
 * Listing the window meant a second cockpit, and the tabs another conversation
 * had opened, all showed up here as if this run owned them. The count in the
 * heading is the point of the panel: one task can be reading four sources at
 * once, and you should be able to see that at a glance.
 */
async function refreshTabList() {
    const list = $('tabList');
    list.textContent = '';

    const mine = await listAgentTabs();
    for (const tab of mine) {
        const row = document.createElement('button');
        row.className = 'tabrow' + (tab.id === workTabId ? ' active' : '');
        row.title = tab.url || '';

        const favicon = document.createElement('img');
        favicon.className = 'fav';
        favicon.alt = '';
        if (tab.favIconUrl) favicon.src = tab.favIconUrl;

        const label = document.createElement('span');
        label.textContent = tab.title || tab.url || 'Untitled';

        row.append(favicon, label);
        row.addEventListener('click', () => chrome.tabs.update(tab.id, { active: true }));
        list.appendChild(row);
    }
    $('tabCount').textContent = mine.length ? `· ${mine.length}` : '';

    // Say when another conversation is running, so a tab that was deliberately
    // left alone does not read as CrewSurf having missed it.
    const live = await claimTabs();
    const others = Object.entries(live).filter(([id]) => id !== sessionId);
    const note = $('tabNote');
    if (others.length) {
        const held = others.reduce((sum, [, e]) => sum + (e.tabIds?.length || 0), 0);
        note.textContent =
            `${others.length} other conversation${others.length === 1 ? '' : 's'} open` +
            (held ? `, working in ${held} tab${held === 1 ? '' : 's'} of ${others.length === 1 ? 'its' : 'their'} own.` : '.');
        note.hidden = false;
    } else {
        note.hidden = true;
    }
}

/**
 * The page a task would land on, shown before there is a task.
 *
 * Display only: it is not claimed and not grouped, so another conversation is
 * still free to take it. `ensureWorkTab` does the owning, once there is a run.
 */
async function pickPreviewTab() {
    const me = await chrome.tabs.getCurrent();
    if (!me || workTabId !== null) return;

    const taken = await foreignTabIds();
    const tabs = await chrome.tabs.query({ windowId: me.windowId }).catch(() => []);
    const free = tabs.filter((t) => t.id !== me.id && isScriptable(t.url) && !taken.has(t.id));
    const candidate = free.find((t) => t.active) ?? free[0];
    if (!candidate) return;

    workTabId = candidate.id;
    setWhere(candidate.title, candidate.url, candidate.favIconUrl);
}

/** Resolves once the tab has finished loading, so there is a DOM to read. */
async function waitForComplete(tabId, timeoutMs = 20000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        let tab;
        try {
            tab = await chrome.tabs.get(tabId);
        } catch {
            return null; // closed under us
        }
        if (tab.status === 'complete') return tab;
        await sleep(250);
    }
    return chrome.tabs.get(tabId).catch(() => null);
}

/* ------------------------------------------------------------------- loop -- */

async function runTask(task) {
    const settings = await loadSettings();
    const memory = await loadMemory();
    const tier = $('model').value;
    const history = [];
    const findings = [];        // the agent's own notes, the only thing it keeps
    const started = Date.now();
    let seenText = '';          // last page text, to tell a useful scroll from a stuck one
    let deadScrolls = 0;

    $('steps').textContent = '';
    setLive(true, 'Working');

    const tab = await ensureWorkTab();
    if (!tab) {
        addStep('Error', 'Could not open a tab to work in.', 'err');
        setLive(false, 'Idle');
        return;
    }
    await refreshTabList();
    startPreview();

    for (let step = 1; step <= MAX_STEPS; step++) {
        if (abort?.signal.aborted) {
            addStep('Stopped', 'by you');
            return;
        }
        setStatus(`Step ${step}/${MAX_STEPS}`);

        const live = await chrome.tabs.get(workTabId).catch(() => null);
        if (!live) {
            addStep('Error', 'The working tab was closed.', 'err');
            return;
        }
        setWhere(live.title, live.url, live.favIconUrl);

        // Best-effort. A blank or internal page just means there is nothing to
        // describe yet — the model can still answer, or navigate somewhere it
        // *can* read. Failing here would turn "hi" into an error.
        let ctx = null;
        if (isScriptable(live.url)) {
            try {
                const [result] = await chrome.scripting.executeScript({
                    target: { tabId: workTabId },
                    func: extractPageContext,
                    args: [MAX_ELEMENTS],
                });
                ctx = result.result ?? null;
            } catch {
                ctx = null;
            }
        }

        // Redact before the context is ever put in a prompt. On the cloud tier
        // this is what the problem statement requires; on the local tier it
        // costs a millisecond and keeps one code path.
        if (ctx) {
            try {
                const sanitised = window.CrewSurfRedact.sanitizeContext(ctx);
                if (sanitised.total) {
                    addStep('Redacted', window.CrewSurfRedact.describe(sanitised.findings), 'ok');
                }
                ctx = sanitised.ctx;
            } catch (err) {
                addStep('Blocked', err.message, 'err');
                addMessage('agent', `**Redaction gate failed.** ${err.message}`, true);
                return;
            }
        }

        let reply;
        try {
            reply = await askModel(
                settings,
                tier,
                [
                    { role: 'system', content: SYSTEM_PROMPT },
                    {
                        role: 'user',
                        content: buildUserMessage(task, ctx, history, memory, await listAgentTabs(), findings),
                    },
                ],
                abort?.signal
            );
        } catch (err) {
            if (err.name === 'AbortError') { addStep('Stopped', 'by you'); return; }
            addStep('Model error', err.message, 'err');
            addMessage('agent', `**Model error** — ${err.message}`, true);
            return;
        }

        let action = parseAction(reply);
        if (!action || !action.type) {
            addStep('Unreadable reply', reply.slice(0, 80), 'err');
            addMessage('agent', "I couldn't read the model's reply as an action.", true);
            return;
        }

        // Whatever the model says it learned survives the page it learned it on.
        if (action.note) {
            const note = String(action.note).slice(0, 240).trim();
            if (note && !findings.includes(note)) {
                findings.push(`${(live.title || '').slice(0, 40)} — ${note}`);
                addStep('Noted', note, 'ok');
            }
        }

        // Two scrolls that turn up the same text mean the page has nothing more
        // to give, whatever the model believes. Telling it so in the prompt is
        // advice; refusing the action is what actually ends the loop.
        if (action.type === 'scroll') {
            const same = ctx?.text === seenText;
            deadScrolls = same ? deadScrolls + 1 : 0;
            if (deadScrolls >= 2 || ctx?.scroll?.atEnd) {
                addStep('Scroll', 'refused — nothing new below', 'warn');
                history.push(
                    'scrolling is not working: the page shows the same text. ' +
                    'Note what you have, then switch tab or answer.'
                );
                deadScrolls = 0;
                continue;
            }
        } else {
            deadScrolls = 0;
        }
        seenText = ctx?.text ?? '';

        if (action.type === 'ask') {
            const answer = await askUser(
                action.question || 'What should I use here?',
                'Only what you type is used. Nothing is filled in on a guess.',
                Boolean(action.sensitive)
            );
            if (answer === null) {
                addStep('Stopped', 'you declined to answer');
                return;
            }
            // A sensitive answer is deliberately not echoed into history.
            history.push(action.sensitive ? 'user supplied a private value' : `user answered: ${answer}`);
            continue;
        }

        if (action.type === 'done') {
            addMessage('agent', action.answer || 'Done.', true);
            addStep('Done', `${step} step${step === 1 ? '' : 's'}`, 'ok');
            await pushActivity({
                task,
                steps: step,
                at: Date.now(),
                seconds: Math.round((Date.now() - started) / 1000),
                answer: (action.answer || '').slice(0, 240),
            });
            return;
        }

        const why = action.why || '';

        if (action.type === 'open') {
            addStep('Open', action.url);
            const tab = await openAgentTab(action.url);
            history.push(`opened ${action.url} in a new tab`);
            setWhere(tab.title, action.url, tab.favIconUrl);
            await refreshTabList();
            continue;
        }

        if (action.type === 'switch') {
            const open = await listAgentTabs();
            const target = open[action.tab];
            if (!target) {
                addStep('Switch failed', `no tab ${action.tab}`, 'err');
                history.push(`switch to tab ${action.tab} failed`);
                continue;
            }
            workTabId = target.id;
            addStep('Switch', target.title || target.url);
            history.push(`switched to ${target.url}`);
            await refreshTabList();
            continue;
        }

        if (action.type === 'navigate') {
            addStep('Navigate', action.url);
            await chrome.tabs.update(workTabId, { url: action.url });
            await waitForComplete(workTabId);
            await refreshTabList();
            history.push(`navigated to ${action.url}`);
            continue;
        }

        // A field the redactor classed as sensitive is never filled from the
        // model's guess. The run suspends, the human types the value, and it
        // goes straight into the page — it is never added to the transcript and
        // never reaches a prompt.
        if (action.type === 'type') {
            const target = ctx?.elements?.[action.index];
            if (target?.sensitive) {
                addStep('Paused', 'sensitive field — asking you', 'warn');
                const supplied = await askUser(
                    `This field looks sensitive. What should I enter?`,
                    `${target.tag}${target.type ? ` · ${target.type}` : ''} — your answer goes straight into the page and is never sent to the model.`,
                    true
                );
                if (supplied === null) {
                    addStep('Skipped', 'you declined');
                    history.push('user declined to fill a sensitive field');
                    continue;
                }
                action = { ...action, text: supplied };
            }
        }

        const [outcome] = await chrome.scripting
            .executeScript({ target: { tabId: workTabId }, func: performAction, args: [action] })
            .catch(() => [{ result: { ok: false, error: 'could not reach the page' } }]);

        if (outcome?.result?.ok) {
            const label = ctx?.elements?.[action.index]?.name || '';
            addStep(action.type[0].toUpperCase() + action.type.slice(1), label || why);
            history.push(`${action.type} ${label || why}`.trim());
            // A click or submit often starts a navigation. Let it begin, then
            // wait properly rather than guessing at a delay.
            await sleep(400);
            await waitForComplete(workTabId, 10000);
            captureShot();
        } else {
            addStep(action.type, `failed — ${outcome?.result?.error}`, 'err');
            history.push(`${action.type} failed: ${outcome?.result?.error}`);
        }
    }

    addStep('Stopped', `hit the ${MAX_STEPS}-step limit`, 'err');
    addMessage(
        'agent',
        findings.length
            ? `I ran out of steps before finishing, but here is what I did establish:\n\n` +
              findings.map((f) => `- ${f}`).join('\n')
            : `I stopped after ${MAX_STEPS} steps without finishing.`,
        true
    );
}

/* -------------------------------------------------------------- translate -- */

// Sized against the reply budget, not against how many strings exist. Sixty
// segments needs well over 2000 tokens to come back, and a truncated array is
// not salvageable JSON — which is exactly how every batch failed before.
const TRANSLATE_BATCH = 14;
const TRANSLATE_TOKENS = 3000;

/**
 * Translates the page in place, rather than pasting a translation into chat.
 *
 * This does not go through the action loop on purpose. Translation is not a
 * decision the model has to reason its way to — it is one deterministic pass
 * over the page's text, so routing it through "pick an action" would make it
 * slower, dearer and less reliable for no gain.
 *
 * Text is sent in batches as a JSON array and written back by index, so a batch
 * that comes back malformed costs that batch and nothing else.
 */
async function runTranslate(language) {
    const settings = await loadSettings();
    const tier = $('model').value;

    $('steps').textContent = '';
    setLive(true, `Translating → ${language}`);

    const tab = await ensureWorkTab();
    if (!tab) {
        addStep('Error', 'Could not open a tab to work in.', 'err');
        setLive(false, 'Idle');
        return;
    }
    await refreshTabList();
    startPreview();

    const live = await chrome.tabs.get(workTabId).catch(() => null);
    if (!live || !isScriptable(live.url)) {
        addStep('Nothing to translate', 'open a web page in a tab first', 'err');
        addMessage(
            'agent',
            'There is no web page open to translate. Open a page in another tab, then pick a language again.',
            true
        );
        return;
    }
    setWhere(live.title, live.url, live.favIconUrl);

    let nodes;
    try {
        const [res] = await chrome.scripting.executeScript({
            target: { tabId: workTabId },
            func: collectTextNodes,
            args: [1200],
        });
        nodes = res.result || [];
    } catch (err) {
        addStep('Error', `could not read the page — ${err.message}`, 'err');
        return;
    }

    if (!nodes.length) {
        addStep('Nothing to translate', 'no visible text found', 'err');
        return;
    }
    addStep('Found', `${nodes.length} text segments`);

    let done = 0;
    for (let start = 0; start < nodes.length; start += TRANSLATE_BATCH) {
        if (abort?.signal.aborted) { addStep('Stopped', 'by you'); break; }

        const batch = nodes.slice(start, start + TRANSLATE_BATCH);
        setStatus(`Translating ${start + 1}–${Math.min(start + TRANSLATE_BATCH, nodes.length)} of ${nodes.length}`);


        let pairs = null;
        let attempt = 0;
        // One retry at half size: a batch that overran the reply budget usually
        // fits when split, so this recovers instead of dropping the segments.
        for (const slice of [batch, batch.slice(0, Math.ceil(batch.length / 2))]) {
            attempt++;
            let reply;
            try {
                reply = await askModel(
                    settings,
                    tier,
                    [
                        { role: 'system', content: 'You are a precise translation engine. You reply with a JSON array and nothing else.' },
                        { role: 'user', content: promptFor(slice, language) },
                    ],
                    abort?.signal,
                    TRANSLATE_TOKENS
                );
            } catch (err) {
                if (err.name === 'AbortError') { addStep('Stopped', 'by you'); return; }
                addStep('Model error', err.message, 'err');
                return;
            }
            pairs = parseJsonArray(reply);
            if (pairs?.length) break;
            if (attempt === 1) addStep('Retrying', 'reply was cut short — halving the batch');
        }

        if (!pairs?.length) {
            addStep('Batch skipped', 'model would not return usable JSON', 'err');
            continue;
        }

        try {
            const [res] = await chrome.scripting.executeScript({
                target: { tabId: workTabId },
                func: writeTranslations,
                args: [pairs],
            });
            done += res.result?.written || 0;
            addStep('Applied', `${done} of ${nodes.length}`, 'ok');
            captureShot();   // the page visibly changes language as batches land
        } catch (err) {
            addStep('Write failed', err.message, 'err');
            break;
        }
    }

    addMessage(
        'agent',
        done
            ? `Translated **${done}** of ${nodes.length} text segments on _${live.title}_ into **${language}**, in place on the page.\n\nReload the tab to get the original back.`
            : `I could not translate that page.`,
        true
    );
    await pushActivity({
        task: `Translate page → ${language}`,
        steps: Math.ceil(nodes.length / TRANSLATE_BATCH),
        at: Date.now(),
        seconds: 0,
        answer: `${done}/${nodes.length} segments · ${live.title}`,
    });
}

function promptFor(items, language) {
    return `Translate the "t" value of each object into ${language}.

Reply with ONLY a JSON array: [{"i":<same i>,"t":"<translation>"}]
- Exactly ${items.length} objects, same "i" values, same order.
- Do not translate URLs, code, numbers or brand names — copy them through.
- No commentary, no markdown fence, no trailing text.

${JSON.stringify(items)}`;
}

/** Same salvage logic as parseAction, for a top-level array. */
function parseJsonArray(reply) {
    let text = reply.trim().replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    text = text.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    try {
        const parsed = JSON.parse(text);
        return Array.isArray(parsed) ? parsed : null;
    } catch {
        const start = text.indexOf('[');
        const end = text.lastIndexOf(']');
        if (start === -1 || end <= start) return null;
        try {
            const parsed = JSON.parse(text.slice(start, end + 1));
            return Array.isArray(parsed) ? parsed : null;
        } catch {
            return null;
        }
    }
}

async function submit(preset) {
    const input = $('input');
    const task = (preset ?? input.value).trim();
    if (!task || busy) return;

    busy = true;
    abort = new AbortController();
    $('send').disabled = true;
    if (!preset) input.value = '';
    input.style.height = 'auto';
    addMessage('user', task);

    try {
        await runTask(task);
    } catch (err) {
        addStep('Error', err.message, 'err');
    } finally {
        busy = false;
        abort = null;
        $('send').disabled = false;
        dbgRefused.clear();
        startPreview(false);   // detaches, and keeps showing where we ended up
        await refreshTabList();
        setLive(false, 'Idle');
        setStatus('');
        input.focus();
    }
}

/* --------------------------------------------------------------- activity -- */

async function renderActivity() {
    const list = $('activityList');
    const all = await loadActivity();
    list.textContent = '';

    if (!all.length) {
        const p = document.createElement('p');
        p.className = 'empty';
        p.textContent = 'Nothing yet. Runs you finish will be listed here.';
        list.appendChild(p);
        return;
    }

    for (const entry of all) {
        const row = document.createElement('div');
        row.style.cssText =
            'border:1px solid var(--border);border-radius:12px;padding:14px 16px;margin-bottom:10px;background:var(--surface)';

        const title = document.createElement('div');
        title.style.cssText = 'font-weight:600;margin-bottom:4px';
        title.textContent = entry.task;

        const meta = document.createElement('div');
        meta.style.cssText = 'font-size:12px;color:var(--muted)';
        meta.textContent =
            `${new Date(entry.at).toLocaleString()} · ${entry.steps} steps · ${entry.seconds}s`;

        row.append(title, meta);

        if (entry.answer) {
            const ans = document.createElement('div');
            ans.style.cssText = 'margin-top:8px;color:var(--muted);font-size:13px';
            ans.textContent = entry.answer;
            row.appendChild(ans);
        }
        list.appendChild(row);
    }
}

/* ------------------------------------------------------------------- wire -- */

$('send').addEventListener('click', () => submit());
$('input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        submit();
    }
});
$('input').addEventListener('input', (e) => {
    e.target.style.height = 'auto';
    e.target.style.height = `${Math.min(e.target.scrollHeight, 180)}px`;
});

document.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (chip) submit(chip.dataset.task);
});

for (const tab of document.querySelectorAll('.tab')) {
    tab.addEventListener('click', () => {
        for (const t of document.querySelectorAll('.tab')) {
            const on = t === tab;
            t.setAttribute('aria-selected', String(on));
            $(t.getAttribute('aria-controls')).hidden = !on;
        }
        if (tab.id === 'tab-activity') renderActivity();
        // The live view only makes sense beside the chat.
        $('preview').classList.toggle('on', tab.id === 'tab-chat' && previewOn);
        scaleMirror();   // it had no width to measure while it was hidden
    });
}

$('previewBtn').addEventListener('click', () => {
    previewOn = !previewOn;
    $('previewBtn').setAttribute('aria-pressed', String(previewOn));
    $('preview').classList.toggle('on', previewOn);
    if (previewOn) startPreview(busy);
    else stopPreview();   // detaches, so the debugging bar goes away
});

$('stopBtn').addEventListener('click', () => {
    if (abort) abort.abort();
});

// The work tab lives beside the cockpit now, so "go there" means activating it.
$('openTab').addEventListener('click', async () => {
    if (workTabId === null) return;
    const tab = await chrome.tabs.get(workTabId).catch(() => null);
    if (tab) await chrome.tabs.update(workTabId, { active: true });
});

// Translate acts as a shortcut that writes a task, so it goes through the same
// loop as everything else rather than being a second code path.
$('translate').addEventListener('change', async (e) => {
    const language = e.target.value;
    e.target.value = '';
    if (!language || busy) return;

    busy = true;
    abort = new AbortController();
    $('send').disabled = true;
    addMessage('user', `Translate this page into ${language}`);
    try {
        await runTranslate(language);
    } catch (err) {
        addStep('Error', err.message, 'err');
    } finally {
        busy = false;
        abort = null;
        $('send').disabled = false;
        dbgRefused.clear();
        startPreview(false);
        await refreshTabList();
        setLive(false, 'Idle');
        setStatus('');
    }
});

// Settings
$('settingsBtn').addEventListener('click', async () => {
    const s = await loadSettings();
    $('apiKey').value = s.apiKey;
    $('cloudModel').value = s.cloudModel;
    $('localUrl').value = s.localUrl;
    $('localModel').value = s.localModel;
    $('settings').showModal();
});
$('cancelSettings').addEventListener('click', () => $('settings').close());
$('saveSettings').addEventListener('click', async () => {
    await saveSettings({
        apiKey: $('apiKey').value.trim(),
        cloudModel: $('cloudModel').value.trim() || DEFAULTS.cloudModel,
        localModel: $('localModel').value.trim() || DEFAULTS.localModel,
        localUrl: $('localUrl').value.trim() || DEFAULTS.localUrl,
    });
    $('settings').close();
    setStatus('');
});

// Memory
$('saveMemory').addEventListener('click', async () => {
    await saveMemory($('memory').value);
    $('memSaved').textContent = 'Saved';
    setTimeout(() => { $('memSaved').textContent = ''; }, 1800);
});

/* ------------------------------------------------------------------- mic -- */

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recogniser = null;

if (!Recognition) {
    $('micBtn').disabled = true;
    $('micBtn').title = 'Dictation is not available in this build';
} else {
    $('micBtn').addEventListener('click', () => {
        if (recogniser) {
            recogniser.stop();
            return;
        }
        recogniser = new Recognition();
        recogniser.lang = $('lang').value;
        recogniser.interimResults = true;
        recogniser.continuous = false;

        const before = $('input').value;
        $('micBtn').setAttribute('aria-pressed', 'true');
        $('hint').textContent = 'Listening…';

        recogniser.onresult = (event) => {
            let text = '';
            for (const result of event.results) text += result[0].transcript;
            $('input').value = (before ? `${before} ` : '') + text;
        };
        recogniser.onerror = (event) => {
            $('hint').textContent =
                event.error === 'not-allowed'
                    ? 'Microphone blocked — allow it for this page.'
                    : `Dictation stopped (${event.error})`;
        };
        recogniser.onend = () => {
            recogniser = null;
            $('micBtn').setAttribute('aria-pressed', 'false');
            setTimeout(() => {
                $('hint').textContent = 'Enter to run · Shift+Enter for a new line';
            }, 1600);
            $('input').focus();
        };
        recogniser.start();
    });
}

/* ------------------------------------------------------------------- boot -- */

window.addEventListener('resize', () => { if (shotMode === 'frame') scaleMirror(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) captureShot(busy); });

window.addEventListener('beforeunload', () => {
    stopPreview();
    closeSession();   // best effort; a stale claim is pruned on the next read
});

(async () => {
    const [settings, memory] = await Promise.all([loadSettings(), loadMemory()]);
    if (!settings.apiKey) setStatus('Add a key in Settings');
    $('memory').value = memory;
    setLive(false, 'Idle');
    await openSession();
    await refreshTabList();
    await pickPreviewTab();
    startPreview(false);
    $('input').focus();
})();
