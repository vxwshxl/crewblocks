/**
 * Crewser Cockpit — the new tab page, and the agent behind it.
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
 */

const MAX_STEPS = 25;          // hard stop; a loop that cannot finish must end
const MAX_ELEMENTS = 120;      // keep the prompt affordable on the local model
const SETTINGS_KEY = 'crewser.settings';

const DEFAULTS = {
    apiKey: '',
    cloudModel: 'qwen/qwen3-vl-8b-instruct',
    localUrl: 'http://127.0.0.1:8081/v1',
    localModel: 'mlx-community/Qwen3-VL-4B-Instruct-4bit',
};

/* ---------------------------------------------------------------- settings -- */

async function loadSettings() {
    const stored = await chrome.storage.local.get(SETTINGS_KEY);
    return { ...DEFAULTS, ...(stored[SETTINGS_KEY] || {}) };
}

async function saveSettings(next) {
    await chrome.storage.local.set({ [SETTINGS_KEY]: next });
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
        // Ignore anything scrolled far out of reach; the agent can scroll to it.
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
        el.dataset.crewserIdx = String(elements.length);
        elements.push({
            i: elements.length,
            tag: el.tagName.toLowerCase(),
            type: el.getAttribute('type') || '',
            name: label,
        });
    }

    return {
        url: location.href,
        title: document.title,
        text: (document.body?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 6000),
        elements,
    };
}

/** Runs inside the target tab. Acts on an element previously indexed. */
function performAction(action) {
    const find = (i) => document.querySelector(`[data-crewser-idx="${i}"]`);

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

/* ------------------------------------------------------------------ model -- */

const SYSTEM_PROMPT = `You are Crewser, an agent that operates a web browser.

Each turn you get the current page and must reply with EXACTLY ONE JSON object
and nothing else. No prose, no markdown fence.

Actions:
  {"type":"click","index":N,"why":"..."}
  {"type":"type","index":N,"text":"...","submit":true,"why":"..."}
  {"type":"navigate","url":"https://...","why":"..."}
  {"type":"scroll","amount":600,"why":"..."}
  {"type":"done","answer":"the final answer for the user"}

Rules:
- "index" must be one of the indices listed in ELEMENTS. Never invent one.
- Prefer navigate over hunting for a search box when you know the URL.
- When the task is a question you can already answer from the page, use "done".
- Keep "why" under 12 words.`;

function buildUserMessage(task, ctx, history) {
    const elements = ctx.elements.map((e) => `[${e.i}] <${e.tag}${e.type ? ' ' + e.type : ''}> ${e.name}`).join('\n');
    const past = history.length
        ? `\nSTEPS SO FAR:\n${history.map((h, i) => `${i + 1}. ${h}`).join('\n')}`
        : '';
    return `TASK: ${task}

URL: ${ctx.url}
TITLE: ${ctx.title}

ELEMENTS:
${elements || '(none)'}

PAGE TEXT:
${ctx.text.slice(0, 3500)}${past}

Reply with one JSON action.`;
}

/** Both tiers speak the OpenAI chat API, so only the base URL and key differ. */
async function askModel(settings, tier, messages) {
    const cloud = tier === 'cloud';
    if (cloud && !settings.apiKey) {
        throw new Error('No OpenRouter key yet — open Settings and paste one.');
    }

    const base = cloud ? 'https://openrouter.ai/api/v1' : settings.localUrl.replace(/\/$/, '');
    const headers = { 'Content-Type': 'application/json' };
    if (cloud) headers.Authorization = `Bearer ${settings.apiKey}`;

    let res;
    try {
        res = await fetch(`${base}/chat/completions`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                model: cloud ? settings.cloudModel : settings.localModel,
                messages,
                temperature: 0,
                max_tokens: 700,
            }),
        });
    } catch {
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

const $ = (id) => document.getElementById(id);
const thread = $('thread');
let busy = false;

function addMessage(role, text) {
    $('hero')?.remove();
    const el = document.createElement('div');
    el.className = `msg ${role}`;
    el.innerHTML = `<div class="who">${role === 'user' ? 'You' : 'C'}</div><div class="body"></div>`;
    el.querySelector('.body').textContent = text;
    thread.appendChild(el);
    el.scrollIntoView({ block: 'end' });
    return el.querySelector('.body');
}

function addStep(text, kind = '') {
    const el = document.createElement('div');
    el.className = `step ${kind}`;
    el.innerHTML = `<b></b> <span></span>`;
    const [head, ...rest] = text.split(' — ');
    el.querySelector('b').textContent = head;
    el.querySelector('span').textContent = rest.join(' — ');
    thread.appendChild(el);
    el.scrollIntoView({ block: 'end' });
}

function setStatus(text) {
    $('status').textContent = text;
}

/* ------------------------------------------------------------------- loop -- */

/**
 * Pages the browser will let an extension inject into. chrome://,
 * chrome-extension:// and the Web Store are refused no matter what the manifest
 * asks for — and that includes this cockpit itself. There is no permission that
 * unlocks them, so the only correct move is to work somewhere else.
 */
const SCRIPTABLE = /^(https?:\/\/|file:\/\/|about:blank)/i;

const isScriptable = (url) => SCRIPTABLE.test(url || '');

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
        await new Promise((r) => setTimeout(r, 250));
    }
    return chrome.tabs.get(tabId).catch(() => null);
}

/**
 * The tab the agent works in — never the cockpit. Prefers whatever the user is
 * already looking at, falls back to any other real page, and only opens a blank
 * one when the cockpit is genuinely the only thing on screen.
 */
async function ensureWorkingTab() {
    const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (active && isScriptable(active.url)) return active;

    const tabs = await chrome.tabs.query({ currentWindow: true });
    const existing = tabs.find((t) => isScriptable(t.url));
    if (existing) {
        await chrome.tabs.update(existing.id, { active: true });
        return existing;
    }

    const created = await chrome.tabs.create({ url: 'about:blank', active: true });
    return (await waitForComplete(created.id)) ?? created;
}

async function runTask(task) {
    const settings = await loadSettings();
    const tier = $('model').value;
    const history = [];

    const tab = await ensureWorkingTab();
    if (!tab || !isScriptable(tab.url)) {
        addStep('No page to work in — open a website in another tab, then try again.', 'err');
        return;
    }

    for (let step = 1; step <= MAX_STEPS; step++) {
        setStatus(`Step ${step} of ${MAX_STEPS}`);

        // Re-read every turn: the page may have navigated itself, or been closed,
        // since the last action.
        const live = await chrome.tabs.get(tab.id).catch(() => null);
        if (!live) {
            addStep('The working tab was closed.', 'err');
            return;
        }
        if (!isScriptable(live.url)) {
            addStep(`Cannot read ${live.url || 'that page'} — browser pages are off limits.`, 'err');
            return;
        }

        let ctx;
        try {
            const [result] = await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: extractPageContext,
                args: [MAX_ELEMENTS],
            });
            ctx = result.result;
        } catch (err) {
            addStep(`Could not read the page — ${err.message}`, 'err');
            return;
        }

        let reply;
        try {
            reply = await askModel(settings, tier, [
                { role: 'system', content: SYSTEM_PROMPT },
                { role: 'user', content: buildUserMessage(task, ctx, history) },
            ]);
        } catch (err) {
            addStep(`Model error — ${err.message}`, 'err');
            return;
        }

        const action = parseAction(reply);
        if (!action || !action.type) {
            addStep(`Could not read the model's reply — ${reply.slice(0, 90)}`, 'err');
            return;
        }

        if (action.type === 'done') {
            addMessage('agent', action.answer || 'Done.');
            return;
        }

        const why = action.why ? ` — ${action.why}` : '';

        if (action.type === 'navigate') {
            addStep(`Navigate ${action.url}${why}`, 'ok');
            // active:true so you watch it happen rather than wondering.
            await chrome.tabs.update(tab.id, { url: action.url, active: true });
            await waitForComplete(tab.id);
            history.push(`navigated to ${action.url}`);
            continue;
        }

        const [outcome] = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: performAction,
            args: [action],
        });

        if (outcome.result?.ok) {
            const label = ctx.elements[action.index]?.name || '';
            addStep(`${action.type[0].toUpperCase()}${action.type.slice(1)} ${label}${why}`, 'ok');
            history.push(`${action.type} ${label}`.trim());
            // A click or a submit often starts a navigation. Give it a moment to
            // begin, then wait for it properly rather than guessing at a delay.
            await new Promise((r) => setTimeout(r, 400));
            await waitForComplete(tab.id, 10000);
        } else {
            addStep(`${action.type} failed — ${outcome.result?.error}`, 'err');
            history.push(`${action.type} failed: ${outcome.result?.error}`);
        }
    }

    addStep(`Stopped after ${MAX_STEPS} steps without finishing.`, 'err');
}

async function submit() {
    const input = $('input');
    const task = input.value.trim();
    if (!task || busy) return;

    busy = true;
    $('send').disabled = true;
    input.value = '';
    addMessage('user', task);

    try {
        await runTask(task);
    } catch (err) {
        addStep(`Unexpected error — ${err.message}`, 'err');
    } finally {
        busy = false;
        $('send').disabled = false;
        setStatus('');
        input.focus();
    }
}

/* ------------------------------------------------------------------- wire -- */

$('send').addEventListener('click', submit);
$('input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        submit();
    }
});
$('input').addEventListener('input', (e) => {
    e.target.style.height = 'auto';
    e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
});
document.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (chip) {
        $('input').value = chip.dataset.task;
        submit();
    }
});

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
        localUrl: $('localUrl').value.trim() || DEFAULTS.localUrl,
        localModel: $('localModel').value.trim() || DEFAULTS.localModel,
    });
    $('settings').close();
});

chrome.storage.local.get(SETTINGS_KEY).then((stored) => {
    if (!stored[SETTINGS_KEY]?.apiKey) setStatus('Add a key in Settings');
});
$('input').focus();
