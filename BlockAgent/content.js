if (!window.__1e_content_script_injected) {
    window.__1e_content_script_injected = true;

    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.type === "EXTRACT_CONTEXT") {
            const context = extractContext();
            sendResponse(context);
        } else if (request.type === "EXECUTE_COMMAND") {
            executeCommand(request.command);
            sendResponse({ status: "success" });
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
                    box-shadow: inset 0 0 100px 15px rgba(30, 136, 229, 0.25);
                    pointer-events: none;
                    animation: blockagent-pulse-glow 2s infinite alternate ease-in-out;
                }
                #blockagent-loading-overlay::after {
                    content: '';
                    position: absolute;
                    top: 0; left: 0; right: 0; bottom: 0;
                    background: linear-gradient(90deg, #1e88e5, #00acc1, #1e88e5, #8e24aa, #1e88e5);
                    background-size: 300% 300%;
                    -webkit-mask: linear-gradient(to right, transparent, black 15px, black calc(100% - 15px), transparent), linear-gradient(to bottom, transparent, black 15px, black calc(100% - 15px), transparent);
                    -webkit-mask-composite: xor;
                    mask-composite: exclude;
                    animation: blockagent-gradient-move 3s linear infinite;
                    pointer-events: none;
                }
                @keyframes blockagent-pulse-glow {
                    0% { box-shadow: inset 0 0 80px 5px rgba(30, 136, 229, 0.15); }
                    100% { box-shadow: inset 0 0 160px 25px rgba(30, 136, 229, 0.4); }
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

function extractContext() {
    // Clean up old IDs
    document.querySelectorAll('[data-1e-id]').forEach(el => el.removeAttribute('data-1e-id'));
    nextElementId = 1;

    // Limit text to avoid payload size issues but keep enough for e-commerce sites
    const text = document.body ? document.body.innerText.substring(0, 8000) : "";

    const inputs = [];
    try {
        document.querySelectorAll('input:not([type="hidden"]), textarea, select, [contenteditable="true"], [role="textbox"], [role="combobox"]').forEach(i => {
            if (i.offsetParent !== null) {
                const label = (i.placeholder || i.name || i.id || i.value || i.innerText || i.getAttribute('aria-label') || i.getAttribute('title') || "input").substring(0, 50);
                if (!i.hasAttribute('data-1e-id')) {
                    i.setAttribute('data-1e-id', nextElementId);
                    inputs.push({ id: nextElementId, name: label, type: i.type || i.tagName.toLowerCase(), role: i.getAttribute('role') });
                    nextElementId++;
                }
            }
        });
    } catch (e) {
        console.warn("Failed to extract input elements", e);
    }

    const buttons = [];
    try {
        document.querySelectorAll('button, a, [role="button"], [role="link"], [role="tab"], [tabindex], [onclick], li, .card, .track01').forEach(b => {
            if (b.offsetParent !== null) { // only visible
                const label = (b.innerText || b.value || b.getAttribute('aria-label') || "").trim().substring(0, 100);
                if (label && !b.hasAttribute('data-1e-id')) {
                    b.setAttribute('data-1e-id', nextElementId);
                    buttons.push({ id: nextElementId, text: label, tag: b.tagName.toLowerCase() });
                    nextElementId++;
                }
            }
        });
    } catch (e) {
        console.warn("Failed to extract button elements", e);
    }

    const images = [];
    try {
        document.querySelectorAll('img').forEach(img => {
            if (img.offsetParent !== null) { // only visible
                const label = (img.alt || img.id || img.src || "image").substring(0, 100);
                if (!img.hasAttribute('data-1e-id')) {
                    img.setAttribute('data-1e-id', nextElementId);
                    images.push({ id: nextElementId, name: label, type: 'image' });
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

    return {
        page_content: text,
        elements: {
            interactable: [...inputs, ...buttons, ...images].slice(0, 400), // Keep payload broad enough for complex pages
            headings: [...new Set(headings)]
        }
    };
}

function executeCommand(command) {
    if (!command || !command.action) return Promise.resolve();

    return new Promise((resolve) => {
        try {
            const action = command.action.toUpperCase();

            if (action === "CLICK" && command.elementId) {
                const el = document.querySelector(`[data-1e-id="${command.elementId}"]`);

                if (el) {
                    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                    setTimeout(() => {
                        el.click();
                        resolve();
                    }, 500);
                } else {
                    console.warn("Element not found for click (ID):", command.elementId);
                    resolve();
                }
            } else if (action === "SCROLL") {
                const dir = (command.direction || "DOWN").toUpperCase();
                if (dir === "DOWN") {
                    window.scrollBy({ top: window.innerHeight * 0.8, behavior: 'smooth' });
                } else {
                    window.scrollBy({ top: -window.innerHeight * 0.8, behavior: 'smooth' });
                }
                setTimeout(resolve, 500);
            } else if (action === "TYPE" && command.elementId && command.text) {
                const el = document.querySelector(`[data-1e-id="${command.elementId}"]`);

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

                        setTimeout(resolve, 300);
                    }, 300);
                } else {
                    console.warn("Element not found for type (ID):", command.elementId);
                    resolve();
                }
            } else if (action === "NAVIGATE" && command.url) {
                window.location.href = command.url;
                // Don't resolve immediately; let the page unload
            } else if (action === "READ_IMAGE" && command.elementId) {
                const el = document.querySelector(`[data-1e-id="${command.elementId}"]`);

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
