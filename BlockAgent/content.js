if (!window.__1e_content_script_injected) {
    window.__1e_content_script_injected = true;

    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.type === "EXTRACT_CONTEXT") {
            const context = extractContext();
            sendResponse(context);
        } else if (request.type === "EXECUTE_COMMAND") {
            // executeCommand resolves with the result of the action — a rect for
            // READ_IMAGE, an error when the element was missing. Replying before
            // it settles threw all of that away.
            executeCommand(request.command)
                .then((result) => sendResponse(result || { status: "success" }))
                .catch((error) => sendResponse({ error: String(error && error.message || error) }));
        } else if (request.type === "WAIT_FOR_SETTLE") {
            waitForSettle(request.timeout).then(sendResponse);
        } else if (request.type === "EXTRACT_TEXT_NODES") {
            const texts = extractTextNodes();
            sendResponse({ texts: texts });
        } else if (request.type === "INJECT_TRANSLATION") {
            injectTranslation(request.translatedTexts);
            sendResponse({ status: "success" });
        } else if (request.type === "REVERT_TRANSLATION") {
            revertTranslation();
            sendResponse({ status: "success" });
        } else if (request.type === "GET_PAGE_TEXT") {
            sendResponse({ text: document.body.innerText });
        } else if (request.type === "SET_TRANSLATION_STATE") {
            currentTargetLang = request.lang;
            if (currentTargetLang) {
                startTranslationObserver();
            } else {
                stopTranslationObserver();
            }
            sendResponse({ status: "success" });
        } else if (request.type === "INJECT_NEW_TRANSLATIONS") {
            injectNewTranslations(request.translatedTexts, request.nodeIds);
            sendResponse({ status: "success" });
        } else if (request.type === "TOGGLE_LOADING_UI") {
            toggleLoadingUI(request.isAgentRunning);
            sendResponse({ status: "success" });
        }
        return true;
    });
}

function toggleLoadingUI(isRunning) {
    let overlay = document.getElementById('blockagent-loading-overlay');
    
    if (isRunning) {
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'blockagent-loading-overlay';
            
            const style = document.createElement('style');
            style.textContent = `
                #blockagent-loading-overlay {
                    position: fixed;
                    top: 0;
                    left: 0;
                    width: 100vw;
                    height: 100vh;
                    pointer-events: none;
                    z-index: 2147483647;
                    opacity: 0;
                    transition: opacity 0.5s ease;
                    box-sizing: border-box;
                }
                #blockagent-loading-overlay::before {
                    content: '';
                    position: absolute;
                    top: 0; left: 0; right: 0; bottom: 0;
                    box-shadow: inset 0 0 100px 15px rgba(140, 82, 254, 0.28);
                    pointer-events: none;
                    animation: blockagent-pulse-glow 2s infinite alternate ease-in-out;
                }
                #blockagent-loading-overlay::after {
                    content: '';
                    position: absolute;
                    top: 0; left: 0; right: 0; bottom: 0;
                    background: linear-gradient(90deg, #5a2ea6, #8C52FE, #b98cff, #8C52FE, #5a2ea6);
                    background-size: 300% 300%;
                    -webkit-mask: linear-gradient(to right, transparent, black 15px, black calc(100% - 15px), transparent), linear-gradient(to bottom, transparent, black 15px, black calc(100% - 15px), transparent);
                    -webkit-mask-composite: xor;
                    mask-composite: exclude;
                    animation: blockagent-gradient-move 3s linear infinite;
                    pointer-events: none;
                }
                @keyframes blockagent-pulse-glow {
                    0% { box-shadow: inset 0 0 80px 5px rgba(140, 82, 254, 0.18); }
                    100% { box-shadow: inset 0 0 160px 25px rgba(140, 82, 254, 0.42); }
                }
                @keyframes blockagent-gradient-move {
                    0% { background-position: 0% 50%; }
                    100% { background-position: 100% 50%; }
                }
                #blockagent-loading-overlay.active {
                    opacity: 1;
                }
            `;
            document.head.appendChild(style);
            document.body.appendChild(overlay);
            
            // Trigger reflow
            void overlay.offsetWidth;
        }
        overlay.classList.add('active');
    } else {
        if (overlay) {
            overlay.classList.remove('active');
        }
    }
}

let nextElementId = 1;

/**
 * The best human-readable name for an element.
 *
 * Order matters more than it looks. Accessible apps (Gmail, WhatsApp Web) put
 * the real name in aria-label and leave `name`/`value` as internal tokens, so
 * reading `value` first labelled every row checkbox "on" and made 50 elements
 * indistinguishable to the model. Accessible names come first now.
 */
/**
 * Every match for a selector, including inside open shadow roots.
 *
 * `document.querySelectorAll` stops at a shadow boundary, so a page built from
 * web components returned an empty element table and the agent reported that
 * there was nothing on the page. Any site can be built this way — this is not a
 * property of a particular site, which is why it belongs here rather than in a
 * per-site special case.
 *
 * Closed shadow roots are genuinely unreachable from a content script; nothing
 * can be done about those.
 */
function queryAllDeep(selector, root) {
    const scope = root || document;
    const found = [];
    const seen = new Set();

    const visit = (node) => {
        if (!node || seen.has(node)) return;
        seen.add(node);

        try {
            node.querySelectorAll(selector).forEach((el) => found.push(el));
        } catch (e) {
            return; // a bad selector is the caller's problem, not a crash here
        }

        // Descend into any open shadow root beneath this node.
        try {
            node.querySelectorAll('*').forEach((el) => {
                if (el.shadowRoot) visit(el.shadowRoot);
            });
        } catch (e) {
            /* nothing further to walk */
        }
    };

    visit(scope);
    return found;
}

/**
 * The text of a <label> that names this element, if one does.
 *
 * Covers both forms: `<label for="id">` pointing at it, and a `<label>` wrapping
 * it. The wrapping case has to subtract the field's own text, or a label
 * containing a checkbox returns the checkbox's value along with the words.
 */
function labelElementText(el) {
    try {
        if (el.id) {
            const root = el.getRootNode() || document;
            const explicit = root.querySelector(`label[for="${CSS.escape(el.id)}"]`);
            const text = explicit && (explicit.innerText || explicit.textContent || '').trim();
            if (text) return text.substring(0, 80);
        }

        const wrapping = el.closest && el.closest('label');
        if (wrapping) {
            const text = (wrapping.innerText || wrapping.textContent || '').trim();
            if (text) return text.substring(0, 80);
        }
    } catch (e) {
        /* a malformed id breaks the selector, not the extraction */
    }
    return '';
}

function labelFor(el) {
    const byId = el.getAttribute('aria-labelledby');
    if (byId) {
        const parts = byId.split(/\s+/)
            .map((id) => { const n = document.getElementById(id); return n && n.innerText; })
            .filter(Boolean)
            .join(' ')
            .trim();
        if (parts) return parts.substring(0, 80);
    }

    const type = (el.type || '').toLowerCase();
    // `value` is a real label on a submit button and pure noise on a checkbox.
    const useValue = type !== 'checkbox' && type !== 'radio';

    const candidates = [
        el.getAttribute('aria-label'),
        // <label for="x"> and <label><input></label>: the plainest way to name a
        // field in HTML, and the one every hand-written checkout form uses. It
        // used to be skipped entirely, so a field with a machine-generated id
        // reached the model as "f_2".
        labelElementText(el),
        el.getAttribute('placeholder'),
        el.getAttribute('title'),
        el.getAttribute('alt'),
        useValue ? el.value : null,
        el.getAttribute('name'),
        el.id,
    ];

    for (const candidate of candidates) {
        const text = (candidate || '').toString().trim();
        if (text) return text.substring(0, 80);
    }
    return '';
}

/**
 * Where an element sits in the viewport, in CSS pixels.
 *
 * Returns null for anything with no box or scrolled out of sight — the side
 * panel draws a numbered badge from this, and a badge for something off screen
 * would point the model at empty space.
 */
/**
 * Which action an element accepts.
 *
 * `<input>` is not one thing. A text box takes TYPE; a submit button, a
 * checkbox and a radio take CLICK. Filing all of them under "input" told the
 * model to type into a Send button — caught by the golden set on its first run.
 */
const TYPEABLE_INPUT_TYPES = new Set([
    'text', 'search', 'email', 'url', 'tel', 'number', 'password',
    'date', 'datetime-local', 'month', 'week', 'time', ''
]);

function kindOf(el) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'textarea') return 'input';
    if (el.isContentEditable) return 'input';
    if (tag === 'input') {
        return TYPEABLE_INPUT_TYPES.has((el.type || '').toLowerCase()) ? 'input' : 'clickable';
    }
    const role = (el.getAttribute('role') || '').toLowerCase();
    if (role === 'textbox' || role === 'searchbox') return 'input';
    return 'clickable';
}

/** Roles that mean "a person operates this". */
const ACTIONABLE_ROLES = new Set([
    'button', 'link', 'tab', 'checkbox', 'radio', 'menuitem', 'menuitemcheckbox',
    'menuitemradio', 'option', 'switch', 'treeitem', 'combobox', 'textbox', 'searchbox', 'slider'
]);

/** Tags that are interactive without needing a role or a handler. */
const ACTIONABLE_TAGS = new Set(['button', 'a', 'input', 'textarea', 'select', 'summary']);

/** The same net extractContext casts, used to spot wrapper elements. */
const CANDIDATE_SELECTOR =
    'button, a, input:not([type="hidden"]), textarea, select, summary, ' +
    '[role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="checkbox"], ' +
    '[role="switch"], [role="option"], [contenteditable="true"], [role="textbox"], [onclick]';

/**
 * Whether this node is really a control, or just something the net caught.
 *
 * The button selector casts wide on purpose — `li`, `[tabindex]` and `[onclick]`
 * catch the hand-rolled controls that real sites are full of. The cost is that
 * it also catches layout: every list row, every card wrapper. Those crowd the
 * budget and give the model plausible-looking things to click that do nothing.
 */
function isActionable(el) {
    const tag = el.tagName.toLowerCase();
    const role = (el.getAttribute('role') || '').toLowerCase();

    if (el.disabled || el.getAttribute('aria-disabled') === 'true') return false;
    if (el.getAttribute('aria-hidden') === 'true') return false;

    let style;
    try {
        style = window.getComputedStyle(el);
    } catch (e) {
        return false;
    }
    if (!style) return false;
    if (style.pointerEvents === 'none') return false;
    if (style.visibility === 'hidden' || style.display === 'none') return false;
    if (parseFloat(style.opacity) === 0) return false;

    // A wrapper around a real control is not the control. Keep the innermost
    // thing, which is what a person would actually click.
    if (!ACTIONABLE_TAGS.has(tag) && !ACTIONABLE_ROLES.has(role)) {
        try {
            if (el.querySelector(CANDIDATE_SELECTOR)) return false;
        } catch (e) {
            /* selector unsupported here; fall through */
        }
    }

    if (ACTIONABLE_TAGS.has(tag)) return true;
    if (ACTIONABLE_ROLES.has(role)) return true;
    if (el.hasAttribute('onclick')) return true;
    if (el.isContentEditable) return true;
    // The strongest hint a hand-rolled control gives about itself.
    if (style.cursor === 'pointer') return true;

    return false;
}

/**
 * Whether something else is painted on top of this element.
 *
 * An element under a modal backdrop, a cookie banner or a sticky header is in
 * the DOM, is "visible" by every style check, and cannot be clicked. Listing it
 * invites the agent to click it, see nothing happen, and loop.
 *
 * Only checked inside the viewport: `boxOf` already returns null for anything
 * scrolled off screen, and those elements are legitimately reachable later.
 */
/**
 * Whether an element is actually on the page.
 *
 * `offsetParent !== null` was the test, and it is wrong in one important way:
 * the spec returns null for any `position: fixed` element as well as for hidden
 * ones. Sticky action bars, floating buttons, cookie bars and modal dialogs are
 * all fixed — so the controls most likely to be the thing the user meant were
 * the ones being filtered out.
 */
function isVisible(el) {
    if (el.offsetParent !== null) return true;

    let style;
    try {
        style = getComputedStyle(el);
    } catch (e) {
        return false;
    }
    if (!style || style.display === 'none' || style.visibility === 'hidden') return false;

    // No offsetParent and not fixed means genuinely not rendered.
    if (style.position !== 'fixed') return false;

    const box = el.getBoundingClientRect();
    return box.width > 0 && box.height > 0;
}

function isOccluded(el, box) {
    if (!box) return false;
    const x = box.x + box.w / 2;
    const y = box.y + box.h / 2;
    if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) return false;

    let hit;
    try {
        hit = document.elementFromPoint(x, y);
    } catch (e) {
        return false;
    }
    if (!hit) return false;
    return !sharesLineage(hit, el);
}

/**
 * Whether the node under the cursor is really this element.
 *
 * `elementFromPoint` stops at a shadow boundary and returns the host, and
 * `Node.contains` does not cross one either — so without walking the host chain
 * every element inside a shadow root looks covered by its own host and gets
 * dropped as occluded.
 */
function sharesLineage(hit, el) {
    if (hit === el || el.contains(hit) || hit.contains(el)) return true;

    let node = el;
    for (let depth = 0; depth < 10; depth++) {
        const root = node.getRootNode && node.getRootNode();
        const host = root && root.host;
        if (!host) return false;
        if (host === hit || hit.contains(host)) return true;
        node = host;
    }
    return false;
}

function boxOf(el) {
    const rect = el.getBoundingClientRect();
    if (rect.width < 4 || rect.height < 4) return null;

    const withinX = rect.left < window.innerWidth && rect.right > 0;
    const withinY = rect.top < window.innerHeight && rect.bottom > 0;
    if (!withinX || !withinY) return null;

    return {
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        w: Math.round(rect.width),
        h: Math.round(rect.height)
    };
}

function extractContext() {
    // Clean up old IDs
    queryAllDeep('[data-1e-id]').forEach(el => el.removeAttribute('data-1e-id'));
    nextElementId = 1;

    // Limit text to avoid payload size issues but keep enough for e-commerce sites
    const text = document.body ? document.body.innerText.substring(0, 8000) : "";

    /**
 * What a field currently contains, as the model needs to see it.
 *
 * Without this the element table is identical before and after a successful
 * TYPE, because a field's contents live in `.value`, which appears in neither
 * the DOM structure nor `innerText`. The model then cannot tell its own typing
 * worked, retypes, and the repeat guard kills the run — which is exactly how
 * every form-filling flow was dying.
 *
 * Secrets are never read. A password or card number would otherwise be shipped
 * to the model on every single turn just for being on the page.
 */
function valueOf(el) {
    const type = (el.type || '').toLowerCase();
    if (type === 'password') return undefined;

    const autocomplete = (el.getAttribute('autocomplete') || '').toLowerCase();
    const name = (el.getAttribute('name') || '').toLowerCase();
    if (autocomplete.includes('cc-number') || name.includes('cardnumber')) return undefined;

    const raw = el.isContentEditable
        ? (el.innerText || '')
        : (typeof el.value === 'string' ? el.value : '');

    const trimmed = raw.trim();
    if (!trimmed) return undefined;
    // Enough to recognise what is there; a composed email body is not the point.
    return trimmed.length > 120 ? trimmed.slice(0, 120) + '\u2026' : trimmed;
}

const inputs = [];
    try {
        queryAllDeep('input:not([type="hidden"]), textarea, select, [contenteditable="true"], [role="textbox"], [role="combobox"]').forEach(i => {
            // A field that cannot be typed into is not a target. Checkout forms
            // disable steps until an earlier one is done, and offering those
            // spends the error budget on actions that could never succeed.
            const inert = i.disabled
                || i.readOnly
                || i.getAttribute('aria-disabled') === 'true'
                || i.getAttribute('aria-hidden') === 'true';

            if (isVisible(i) && !inert) {
                const label = labelFor(i) || (i.innerText || '').trim().substring(0, 50) || (i.type || 'input');
                const inputBox = boxOf(i);
                if (!i.hasAttribute('data-1e-id') && !isOccluded(i, inputBox)) {
                    i.setAttribute('data-1e-id', nextElementId);
                    // A password field is never a target, and its presence puts
                    // the whole page into sensitive context.
                    const isSecret = i.type === 'password';
                    inputs.push({
                        id: nextElementId,
                        // The model has to know a text box takes TYPE, not
                        // CLICK. Without this the list is undifferentiated and
                        // clicking a search field looks as reasonable as typing.
                        kind: kindOf(i),
                        name: isSecret ? '(password field)' : label,
                        type: i.type || i.tagName.toLowerCase(),
                        role: i.getAttribute('role'),
                        // What is in the field right now, so a filled field is
                        // visibly different from an empty one.
                        value: isSecret ? undefined : valueOf(i),
                        secret: isSecret || undefined,
                        box: inputBox
                    });
                    nextElementId++;
                }
            }
        });
    } catch (e) {
        console.warn("Failed to extract input elements", e);
    }

    const buttons = [];
    try {
        queryAllDeep('button, a, [role="button"], [role="link"], [role="tab"], [tabindex], [onclick], li, .card, .track01').forEach(b => {
            if (isVisible(b) && isActionable(b)) { // visible and really a control
                const label = ((b.innerText || '').trim() || labelFor(b)).substring(0, 100);
                const buttonBox = boxOf(b);
                if (label && !b.hasAttribute('data-1e-id') && !isOccluded(b, buttonBox)) {
                    b.setAttribute('data-1e-id', nextElementId);
                    buttons.push({
                        id: nextElementId,
                        kind: 'clickable',
                        text: label,
                        tag: b.tagName.toLowerCase(),
                        box: buttonBox
                    });
                    nextElementId++;
                }
            }
        });
    } catch (e) {
        console.warn("Failed to extract button elements", e);
    }

    const images = [];
    try {
        queryAllDeep('img').forEach(img => {
            if (isVisible(img)) { // only visible
                const label = (labelFor(img) || 'image').substring(0, 100);
                if (!img.hasAttribute('data-1e-id')) {
                    img.setAttribute('data-1e-id', nextElementId);
                    images.push({ id: nextElementId, kind: 'image', name: label, type: 'image', box: boxOf(img) });
                    nextElementId++;
                }
            }
        });
    } catch (e) {
        console.warn("Failed to extract image elements", e);
    }

    let headings = [];
    try {
        headings = Array.from(document.querySelectorAll('h1, h2, h3'))
            .slice(0, 20)
            .map(h => h.innerText.trim())
            .filter(Boolean);
    } catch (e) {
        console.warn("Failed to extract headings", e);
    }

    const interactable = [...inputs, ...buttons, ...images].slice(0, 400); // Keep payload broad enough for complex pages

    // A password field anywhere on the page, or a card-number field, puts the
    // run into sensitive context. The side panel refuses to act there.
    let sensitive = false;
    try {
        sensitive = !!document.querySelector(
            'input[type="password"], input[autocomplete*="cc-number"], input[name*="cardnumber" i]'
        );
    } catch (e) {
        console.warn("Failed to check for sensitive fields", e);
    }

    return {
        page_content: text,
        elements: {
            interactable,
            headings: [...new Set(headings)]
        },
        viewport: {
            width: window.innerWidth,
            height: window.innerHeight,
            scrollY: Math.round(window.scrollY),
            scrollHeight: Math.round(document.documentElement.scrollHeight),
            devicePixelRatio: window.devicePixelRatio || 1
        },
        sensitive,
        // Cheap fingerprint of "what the page currently is". The loop compares
        // these across turns to notice it is getting nowhere.
        //
        // `text` is `body.innerText`, which does not contain what is typed into
        // a field — so before this, filling a form left the signature byte for
        // byte identical and a successful TYPE counted as "the page did not
        // change". Folding the field contents in makes typing progress.
        stateSignature: [
            location.href,
            Math.round(window.scrollY / 100),
            interactable.length,
            text.length,
            fieldsSignature(inputs)
        ].join('|')
    };
}

/**
 * A short hash of everything currently typed on the page.
 *
 * Values are hashed rather than concatenated so the signature stays small and so
 * page contents are not held in the run's `seen` map turn after turn.
 */
function fieldsSignature(inputs) {
    let joined = '';
    for (const input of inputs) {
        if (input.value) joined += input.id + ':' + input.value + '|';
    }
    if (!joined) return '0';

    // djb2: cheap, stable, and good enough to tell two form states apart.
    let hash = 5381;
    for (let i = 0; i < joined.length; i++) {
        hash = ((hash << 5) + hash + joined.charCodeAt(i)) | 0;
    }
    return (hash >>> 0).toString(36);
}

/**
 * Resolves once the page has stopped changing, or the ceiling is hit.
 *
 * A fixed delay after an action either wastes time or screenshots a spinner —
 * and a model shown a spinner reasons very carefully about a loading state.
 * Waiting for mutations to go quiet costs nothing on a fast page and actually
 * waits on a slow one.
 */
function waitForSettle(timeout) {
    const ceiling = typeof timeout === 'number' ? timeout : 10000;
    const quietFor = 400;

    return new Promise((resolve) => {
        let quietTimer = null;
        let observer = null;
        let done = false;

        const finish = (reason) => {
            if (done) return;
            done = true;
            if (quietTimer) clearTimeout(quietTimer);
            if (observer) observer.disconnect();
            clearTimeout(hardStop);
            resolve({ settled: reason === 'quiet', reason });
        };

        const restartQuietTimer = () => {
            if (quietTimer) clearTimeout(quietTimer);
            quietTimer = setTimeout(() => {
                if (document.readyState === 'complete') finish('quiet');
                else restartQuietTimer();
            }, quietFor);
        };

        const hardStop = setTimeout(() => finish('timeout'), ceiling);

        try {
            observer = new MutationObserver(restartQuietTimer);
            observer.observe(document.documentElement, {
                childList: true,
                subtree: true,
                attributes: true,
                characterData: true
            });
        } catch (e) {
            console.warn("Could not observe the page for settling", e);
        }

        restartQuietTimer();
    });
}

function executeCommand(command) {
    if (!command || !command.action) return Promise.resolve();

    return new Promise((resolve) => {
        try {
            const action = command.action.toUpperCase();

            if (action === "CLICK" && (command.elementId || command.x !== undefined)) {
                // Id first. Coordinates are the fallback for canvas and
                // cross-origin iframes, where there is no DOM node to address.
                const el = command.elementId
                    ? queryAllDeep(`[data-1e-id="${command.elementId}"]`)[0]
                    : document.elementFromPoint(command.x, command.y);

                if (el) {
                    if (el.type === 'password') {
                        resolve({ error: "Refused: that is a password field." });
                        return;
                    }
                    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                    setTimeout(() => {
                        el.click();
                        resolve({ status: "success" });
                    }, 500);
                } else {
                    console.warn("Element not found for click (ID):", command.elementId);
                    resolve({ error: `No element ${command.elementId} on this page. Re-read the ELEMENTS table.` });
                }
            } else if (action === "SCROLL") {
                const dir = (command.direction || "DOWN").toUpperCase();
                const before = window.scrollY;
                window.scrollBy({
                    top: (dir === "DOWN" ? 1 : -1) * window.innerHeight * 0.8,
                    behavior: 'smooth'
                });
                setTimeout(() => {
                    resolve(window.scrollY === before
                        ? { error: `Already at the ${dir === "DOWN" ? "bottom" : "top"}. Scrolling further will not help.` }
                        : { status: "success" });
                }, 500);
            } else if (action === "TYPE" && command.elementId && command.text) {
                const el = queryAllDeep(`[data-1e-id="${command.elementId}"]`)[0];

                if (el && el.type === 'password') {
                    resolve({ error: "Refused: that is a password field." });
                    return;
                }

                if (el) {
                    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                    setTimeout(() => {
                        el.focus();

                        // Select existing text to overwrite it
                        const range = document.createRange();
                        range.selectNodeContents(el);
                        const selection = window.getSelection();
                        if (selection) {
                            selection.removeAllRanges();
                            selection.addRange(range);
                        }

                        if (el.isContentEditable) {
                            // Using insertText is much more reliable for triggering React/Angular/Vue listeners
                            document.execCommand('insertText', false, command.text);
                        } else {
                            const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
                            const nativeTextAreaValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
                            if (nativeInputValueSetter && el.tagName.toLowerCase() === 'input') {
                                nativeInputValueSetter.call(el, command.text);
                            } else if (nativeTextAreaValueSetter && el.tagName.toLowerCase() === 'textarea') {
                                nativeTextAreaValueSetter.call(el, command.text);
                            } else {
                                el.value = command.text;
                            }
                            el.dispatchEvent(new Event('input', { bubbles: true }));
                            el.dispatchEvent(new Event('change', { bubbles: true }));
                        }

                        // Filling a search box and stopping is the classic dead
                        // end: the value is there, the page never moves, and the
                        // next turn sees an unchanged page. Enter is what a
                        // person would press, so make it available.
                        if (command.submit) {
                            setTimeout(() => {
                                for (const type of ['keydown', 'keypress', 'keyup']) {
                                    el.dispatchEvent(new KeyboardEvent(type, {
                                        key: 'Enter',
                                        code: 'Enter',
                                        keyCode: 13,
                                        which: 13,
                                        bubbles: true,
                                        cancelable: true
                                    }));
                                }
                                // Some forms listen for submit rather than Enter.
                                const form = el.closest && el.closest('form');
                                if (form && typeof form.requestSubmit === 'function') {
                                    try {
                                        form.requestSubmit();
                                    } catch (e) {
                                        console.warn('Form submit failed:', e.message);
                                    }
                                }
                                resolve({ status: "success" });
                            }, 300);
                            return;
                        }

                        setTimeout(() => resolve({ status: "success" }), 300);
                    }, 300);
                } else {
                    console.warn("Element not found for type (ID):", command.elementId);
                    resolve({ error: `No element ${command.elementId} on this page. Re-read the ELEMENTS table.` });
                }
            } else if (action === "NAVIGATE" && command.url) {
                window.location.href = command.url;
                // Don't resolve immediately; let the page unload
            } else if (action === "READ_IMAGE" && command.elementId) {
                const el = queryAllDeep(`[data-1e-id="${command.elementId}"]`)[0];

                if (el && el.tagName.toLowerCase() === 'img') {
                    // Scroll to ensure it's fully visible and not blocked by sticky headers if possible
                    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

                    // Give it a moment to land and render
                    setTimeout(() => {
                        const rect = el.getBoundingClientRect();
                        // Also need the device pixel ratio for correct cropping later
                        resolve({
                            rect: {
                                x: rect.left,
                                y: rect.top,
                                width: rect.width,
                                height: rect.height
                            },
                            devicePixelRatio: window.devicePixelRatio || 1
                        });
                    }, 500);
                } else {
                    console.warn("Element not found or not an image (ID):", command.elementId);
                    resolve({ error: "Element not found or is not an image." });
                }
            } else {
                resolve({});
            }
        } catch (error) {
            console.error("Error executing command:", error);
            resolve({ error: error.message });
        }
    });
}

let originalTextNodes = [];

function extractTextNodes() {
    originalTextNodes = [];
    const texts = [];

    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
        acceptNode: function (node) {
            const tag = node.parentElement ? node.parentElement.tagName.toLowerCase() : '';
            if (tag === 'script' || tag === 'style' || tag === 'noscript') return NodeFilter.FILTER_REJECT;
            if (!node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
            return NodeFilter.FILTER_ACCEPT;
        }
    }, false);

    let node;
    while (node = walk.nextNode()) {
        const text = node.nodeValue.trim();
        if (text.length > 1) {
            originalTextNodes.push({ node: node, originalText: node.nodeValue });
            texts.push(text);
        }
    }

    // Limit to avoid payload crashes
    const MAX_NODES = 500;
    if (texts.length > MAX_NODES) {
        originalTextNodes = originalTextNodes.slice(0, MAX_NODES);
        return texts.slice(0, MAX_NODES);
    }
    return texts;
}

function injectTranslation(translatedTexts) {
    if (!translatedTexts || !Array.isArray(translatedTexts)) return;

    for (let i = 0; i < Math.min(originalTextNodes.length, translatedTexts.length); i++) {
        const { node, originalText } = originalTextNodes[i];
        const translation = translatedTexts[i];

        const leadingSpace = originalText.match(/^\s*/)[0];
        const trailingSpace = originalText.match(/\s*$/)[0];

        node.nodeValue = leadingSpace + translation + trailingSpace;
        if (node.parentElement) {
            node.parentElement.setAttribute('data-1e-translated', 'true');
        }
    }
}

function revertTranslation() {
    for (const item of originalTextNodes) {
        if (item.node && item.originalText !== undefined) {
            item.node.nodeValue = item.originalText;
            if (item.node.parentElement) {
                item.node.parentElement.removeAttribute('data-1e-translated');
            }
        }
    }
}

let translationObserver = null;
let currentTargetLang = null;
let dynamicNodesMap = new Map();
let dynamicNodeIdCounter = 1;

function startTranslationObserver() {
    if (translationObserver) return;
    translationObserver = new MutationObserver((mutations) => {
        let addedTexts = [];
        let addedIds = [];

        mutations.forEach(mutation => {
            mutation.addedNodes.forEach(node => {
                if (node.nodeType === Node.ELEMENT_NODE) {
                    const walk = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, {
                        acceptNode: function (n) {
                            const tag = n.parentElement ? n.parentElement.tagName.toLowerCase() : '';
                            if (tag === 'script' || tag === 'style' || tag === 'noscript') return NodeFilter.FILTER_REJECT;
                            if (!n.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
                            if (n.parentElement && n.parentElement.hasAttribute('data-1e-translated')) return NodeFilter.FILTER_REJECT;
                            return NodeFilter.FILTER_ACCEPT;
                        }
                    }, false);
                    let textNode;
                    while (textNode = walk.nextNode()) {
                        const text = textNode.nodeValue.trim();
                        if (text.length > 1) {
                            const id = dynamicNodeIdCounter++;
                            dynamicNodesMap.set(id, { node: textNode, originalText: textNode.nodeValue });
                            addedTexts.push(text);
                            addedIds.push(id);
                        }
                    }
                } else if (node.nodeType === Node.TEXT_NODE && node.nodeValue.trim().length > 1) {
                    const tag = node.parentElement ? node.parentElement.tagName.toLowerCase() : '';
                    if (tag !== 'script' && tag !== 'style' && tag !== 'noscript' && (!node.parentElement || !node.parentElement.hasAttribute('data-1e-translated'))) {
                        const id = dynamicNodeIdCounter++;
                        dynamicNodesMap.set(id, { node: node, originalText: node.nodeValue });
                        addedTexts.push(node.nodeValue.trim());
                        addedIds.push(id);
                    }
                }
            });
        });

        if (addedTexts.length > 0) {
            chrome.runtime.sendMessage({
                type: "TRANSLATE_NEW_NODES",
                texts: addedTexts,
                nodeIds: addedIds,
                targetLang: currentTargetLang
            });
        }
    });

    translationObserver.observe(document.body, { childList: true, subtree: true });
}

function stopTranslationObserver() {
    if (translationObserver) {
        translationObserver.disconnect();
        translationObserver = null;
    }
}

function injectNewTranslations(translatedTexts, nodeIds) {
    if (!translatedTexts || !nodeIds) return;
    for (let i = 0; i < nodeIds.length; i++) {
        const id = nodeIds[i];
        const translation = translatedTexts[i];
        if (dynamicNodesMap.has(id)) {
            const item = dynamicNodesMap.get(id);
            const originalText = item.originalText;
            const leadingSpace = originalText.match(/^\s*/)[0] || "";
            const trailingSpace = originalText.match(/\s*$/)[0] || "";
            item.node.nodeValue = leadingSpace + translation + trailingSpace;
            if (item.node.parentElement) {
                item.node.parentElement.setAttribute('data-1e-translated', 'true');
            }
        }
    }
}

// Listen for messages from the web page (e.g., Chatflows Dashboard)
window.addEventListener("message", (event) => {
    // Only accept messages from the same window
    if (event.source !== window) return;

    if (event.data && event.data.type === 'TOGGLE_BLOCKAGENT') {
        chrome.runtime.sendMessage({ type: "TOGGLE_BLOCKAGENT" });
    }
    if (event.data && event.data.type === 'SYNC_BLOCKAGENT') {
        chrome.runtime.sendMessage({ type: "SYNC_BLOCKAGENT" });
    }
}, false);
