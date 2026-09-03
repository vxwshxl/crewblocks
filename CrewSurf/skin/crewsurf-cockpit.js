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
 * ## Why the work happens in a separate window
 *
 * Driving the tab you are sitting in means the browser yanks you somewhere new
 * every time the agent moves, which makes it impossible to do anything else. So
 * the agent gets its own unfocused window and the cockpit stays put, streaming
 * a thumbnail of that window back into the side panel. You watch, or you ignore
 * it and carry on — which is the entire point of an agent doing the work.
 */

const MAX_STEPS = 25;          // hard stop; a loop that cannot finish must end
const MAX_ELEMENTS = 120;      // keep the prompt affordable on the local model
const SHOT_MS = 1400;          // live preview cadence
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

    return {
        url: location.href,
        title: document.title,
        text: (document.body?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 6000),
        elements,
    };
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

const SYSTEM_PROMPT = `You are CrewSurf, an agent that operates a web browser.

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
- When no page is loaded, either answer with "done" or "navigate" somewhere useful.
- Greetings and small talk are answered with "done", not by browsing.
- Keep "why" under 12 words.
- The "answer" field is shown to the user as Markdown. Use headings, lists and
  tables where they help, and keep it tight.`;

function buildUserMessage(task, ctx, history, memory) {
    const past = history.length
        ? `\nSTEPS SO FAR:\n${history.map((h, i) => `${i + 1}. ${h}`).join('\n')}`
        : '';
    const notes = memory ? `\nWHAT YOU KNOW ABOUT THE USER:\n${memory}\n` : '';

    if (!ctx) {
        return `TASK: ${task}
${notes}
No page is loaded, so there is nothing to read or click yet.
If the task is conversational, answer it with "done".
If it needs the web, "navigate" to a page you can work from.${past}

Reply with one JSON action.`;
    }

    const elements = ctx.elements
        .map((e) => `[${e.i}] <${e.tag}${e.type ? ' ' + e.type : ''}> ${e.name}`)
        .join('\n');

    return `TASK: ${task}
${notes}
URL: ${ctx.url}
TITLE: ${ctx.title}

ELEMENTS:
${elements || '(none)'}

PAGE TEXT:
${ctx.text.slice(0, 3500)}${past}

Reply with one JSON action.`;
}

/** Both tiers speak the OpenAI chat API, so only the base URL and key differ. */
async function askModel(settings, tier, messages, signal) {
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
            signal,
            body: JSON.stringify({
                model: cloud ? settings.cloudModel : settings.localModel,
                messages,
                temperature: 0,
                max_tokens: 900,
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
let shotTimer = null;
let workWindowId = null;
let workTabId = null;

function addMessage(role, text, asMarkdown = false) {
    $('hero')?.remove();
    const el = document.createElement('div');
    el.className = `msg ${role}`;

    const avatar = document.createElement('div');
    avatar.className = 'avatar';
    avatar.textContent = role === 'user' ? 'You' : 'C';

    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    if (asMarkdown) {
        bubble.classList.add('md');
        // Safe: renderMarkdown escapes before it adds any markup.
        bubble.innerHTML = window.renderMarkdown(text);
    } else {
        bubble.textContent = text;
    }

    el.append(avatar, bubble);
    thread.appendChild(el);
    bubble.scrollIntoView({ block: 'end' });
    return bubble;
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
    $('steps').appendChild(el);
    el.scrollIntoView({ block: 'nearest' });
}

const setStatus = (t) => { $('status').textContent = t; };

function setLive(running, label) {
    $('liveDot').classList.toggle('run', running);
    $('liveLabel').textContent = label;
}

function setWhere(title, url) {
    $('whereTitle').textContent = title || '—';
    $('whereUrl').textContent = url || '';
}

/* ------------------------------------------------------------ live view -- */

/**
 * Streams a thumbnail of the work window. captureVisibleTab only ever captures
 * the *active tab of the window you name*, which is why the agent gets a window
 * of its own — it stays capturable while you work somewhere else. It can still
 * fail (minimised window, a chrome:// page), and a failed frame is not worth
 * reporting, so the last good one simply stays put.
 */
async function tickShot() {
    if (workWindowId === null) return;
    try {
        const dataUrl = await chrome.tabs.captureVisibleTab(workWindowId, {
            format: 'jpeg',
            quality: 55,
        });
        const shot = $('shot');
        let img = shot.querySelector('img');
        if (!img) {
            shot.textContent = '';
            img = document.createElement('img');
            img.alt = 'Live view of the work window';
            shot.appendChild(img);
        }
        img.src = dataUrl;
    } catch {
        /* keep the previous frame */
    }
}

function startShots() {
    stopShots();
    tickShot();
    shotTimer = setInterval(tickShot, SHOT_MS);
}
function stopShots() {
    if (shotTimer) clearInterval(shotTimer);
    shotTimer = null;
}

/**
 * The window the agent works in. Created unfocused and off to the side, so the
 * cockpit keeps the foreground and you can keep using the browser.
 */
async function ensureWorkWindow() {
    if (workWindowId !== null) {
        const win = await chrome.windows.get(workWindowId, { populate: true }).catch(() => null);
        if (win) {
            const tab = win.tabs?.find((t) => t.id === workTabId) || win.tabs?.[0];
            if (tab) {
                workTabId = tab.id;
                return tab;
            }
        }
        workWindowId = null;
        workTabId = null;
    }

    // Reuse a real page the user already has open in this window, if there is
    // one — moving it is friendlier than opening yet another blank tab.
    const created = await chrome.windows.create({
        url: 'about:blank',
        focused: false,
        width: 1100,
        height: 800,
        top: 60,
        left: 80,
    });
    workWindowId = created.id;
    workTabId = created.tabs?.[0]?.id ?? null;
    if (workTabId === null) return null;
    return (await waitForComplete(workTabId)) ?? created.tabs[0];
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
    const started = Date.now();

    $('steps').textContent = '';
    setLive(true, 'Working');

    const tab = await ensureWorkWindow();
    if (!tab) {
        addStep('Error', 'Could not open a window to work in.', 'err');
        setLive(false, 'Idle');
        return;
    }
    startShots();

    for (let step = 1; step <= MAX_STEPS; step++) {
        if (abort?.signal.aborted) {
            addStep('Stopped', 'by you');
            return;
        }
        setStatus(`Step ${step}/${MAX_STEPS}`);

        const live = await chrome.tabs.get(workTabId).catch(() => null);
        if (!live) {
            addStep('Error', 'The work window was closed.', 'err');
            return;
        }
        setWhere(live.title, live.url);

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

        let reply;
        try {
            reply = await askModel(
                settings,
                tier,
                [
                    { role: 'system', content: SYSTEM_PROMPT },
                    { role: 'user', content: buildUserMessage(task, ctx, history, memory) },
                ],
                abort?.signal
            );
        } catch (err) {
            if (err.name === 'AbortError') { addStep('Stopped', 'by you'); return; }
            addStep('Model error', err.message, 'err');
            addMessage('agent', `**Model error** — ${err.message}`, true);
            return;
        }

        const action = parseAction(reply);
        if (!action || !action.type) {
            addStep('Unreadable reply', reply.slice(0, 80), 'err');
            addMessage('agent', "I couldn't read the model's reply as an action.", true);
            return;
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

        if (action.type === 'navigate') {
            addStep('Navigate', action.url);
            await chrome.tabs.update(workTabId, { url: action.url });
            await waitForComplete(workTabId);
            history.push(`navigated to ${action.url}`);
            continue;
        }

        const [outcome] = await chrome.scripting
            .executeScript({ target: { tabId: workTabId }, func: performAction, args: [action] })
            .catch(() => [{ result: { ok: false, error: 'could not reach the page' } }]);

        if (outcome?.result?.ok) {
            const label = ctx?.elements?.[action.index]?.name || '';
            addStep(action.type[0].toUpperCase() + action.type.slice(1), label || why);
            history.push(`${action.type} ${label}`.trim());
            // A click or submit often starts a navigation. Let it begin, then
            // wait properly rather than guessing at a delay.
            await sleep(400);
            await waitForComplete(workTabId, 10000);
        } else {
            addStep(action.type, `failed — ${outcome?.result?.error}`, 'err');
            history.push(`${action.type} failed: ${outcome?.result?.error}`);
        }
    }

    addStep('Stopped', `hit the ${MAX_STEPS}-step limit`, 'err');
    addMessage('agent', `I stopped after ${MAX_STEPS} steps without finishing.`, true);
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
        stopShots();
        tickShot();
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

// Tabs. Declared before the handlers that close over it so the binding is
// initialised no matter when they fire.
let previewOn = true;

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
    });
}

$('previewBtn').addEventListener('click', () => {
    previewOn = !previewOn;
    $('previewBtn').setAttribute('aria-pressed', String(previewOn));
    $('preview').classList.toggle('on', previewOn);
});

$('stopBtn').addEventListener('click', () => {
    if (abort) abort.abort();
});

$('openTab').addEventListener('click', async () => {
    if (workWindowId !== null) {
        await chrome.windows.update(workWindowId, { focused: true, drawAttention: true });
    }
});

// Translate acts as a shortcut that writes a task, so it goes through the same
// loop as everything else rather than being a second code path.
$('translate').addEventListener('change', (e) => {
    const lang = e.target.value;
    e.target.value = '';
    if (lang) submit(`Translate the page I have open into ${lang} and give me the translation.`);
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

(async () => {
    const [settings, memory] = await Promise.all([loadSettings(), loadMemory()]);
    if (!settings.apiKey) setStatus('Add a key in Settings');
    $('memory').value = memory;
    setLive(false, 'Idle');
    $('input').focus();
})();
