const chatContainer = document.getElementById('chat-container');
const chatInput = document.getElementById('chat-input');
const sendBtn = document.getElementById('send-btn');
const clearBtn = document.getElementById('clear-btn');
const translateLang = document.getElementById('translate-lang');
const micBtn = document.getElementById('mic-btn');
const speechLang = document.getElementById('speech-lang');
const equalizer = document.getElementById('mic-equalizer');
const eqBars = equalizer ? equalizer.querySelectorAll('.bar') : [];

// Default backend URL — change this to your deployed URL
let BACKEND_URL = 'https://crewblocks.vercel.app/api/extension';
const LOCAL_MODEL_URL = 'http://127.0.0.1:8081/v1';

let modelsData = [];
let attachedImagesData = [];

async function fetchModels() {
    try {
        const select = document.getElementById('model-select');
        const currentSelection = select?.value;

        // Auto-detect environment based on current tab URL
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab?.url?.includes('localhost:3000')) {
            BACKEND_URL = 'http://localhost:3000/api/extension';
        } else {
            BACKEND_URL = 'https://crewblocks.vercel.app/api/extension';
        }

        // 1. Get models from Server (filtered by logged in user via session)
        let serverModels = [];
        try {
            const res = await fetch(`${BACKEND_URL}/models`, { credentials: 'include' });
            if (res.ok) {
                const data = await res.json();
                serverModels = data.models || [];
                // Update local storage to stay in sync
                await chrome.storage.local.set({ synced_models: serverModels });
            }
        } catch (e) { /* silent */ }

        // 2. Get models from Local Sync
        let syncedModels = [];
        try {
            const result = await chrome.storage.local.get(['synced_models']);
            syncedModels = result.synced_models || [];
        } catch (e) { /* silent */ }

        // 3. Merge models
        const modelMap = new Map();
        [...serverModels, ...syncedModels].forEach(m => {
            // FILTER: Never show the 'default-agent' fallback
            if (m.id && m.name && m.id !== 'default-agent') {
                modelMap.set(m.id, m);
            }
        });

        const allModels = Array.from(modelMap.values());
        modelsData = allModels;

        if (select) {
            select.innerHTML = '<option value="">Select agent...</option>';
            if (allModels.length > 0) {
                allModels.forEach(model => {
                    const opt = document.createElement('option');
                    opt.value = model.id;
                    opt.textContent = model.name;
                    select.appendChild(opt);
                });

                // Auto-select logic
                if (currentSelection && allModels.some(m => m.id === currentSelection)) {
                    select.value = currentSelection;
                } else {
                    select.value = allModels[0].id;
                }
                updateUploadButtonVisibility(select.value);
            }
        }
    } catch (e) {
        console.error("fetchModels overall failure", e);
    }
}

async function syncWithDashboard(isAuto = false) {
    const syncBtn = document.getElementById('sync-btn');
    if (syncBtn && !isAuto) syncBtn.style.opacity = '0.5';

    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab) return;

        // Script to run in the dashboard tab
        const results = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => {
                try {
                    const storeData = localStorage.getItem('crewblocks-storage-v1');
                    if (!storeData) return null;
                    const parsed = JSON.parse(storeData);
                    return parsed.state?.agents?.map(f => ({ id: f.id, name: f.name })) || [];
                } catch (e) { return null; }
            }
        });

        let agents = results?.[0]?.result;
        if (agents && agents.length > 0) {
            // Filter again just in case
            agents = agents.filter(f => f.id !== 'default-agent');
            await chrome.storage.local.set({ synced_models: agents });
            await fetchModels();
        }
    } catch (e) {
        if (!isAuto) console.error("Sync failed", e);
    } finally {
        if (syncBtn && !isAuto) syncBtn.style.opacity = '1';
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    const syncBtn = document.getElementById('sync-btn');

    await fetchModels();

    // Auto-sync silently if we happen to be on the dashboard
    syncWithDashboard(true);

    if (syncBtn) {
        syncBtn.addEventListener('click', () => syncWithDashboard(false));
    }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === "TRANSLATE_NEW_NODES") {
        fetch(`${BACKEND_URL}/translate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ texts: request.texts, targetLanguage: request.targetLang })
        })
            .then(res => res.json())
            .then(data => {
                if (data.translated_texts) {
                    chrome.tabs.sendMessage(sender.tab.id, {
                        type: "INJECT_NEW_TRANSLATIONS",
                        translatedTexts: data.translated_texts,
                        nodeIds: request.nodeIds
                    });
                }
            })
            .catch(err => console.error("Dynamic translation failed:", err));
        sendResponse({ status: "processing" });
        return true;
    } else if (request.type === "SYNC_BLOCKAGENT") {
        fetchModels();
        sendResponse({ status: "success" });
        return true;
    }
});

// Speech Recognition setup
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let isRecording = false;
let silenceTimer = null;

// Audio context and equalizer state
let audioContext = null;
let analyser = null;
let microphoneStream = null;
let eqAnimationId = null;

// Configure Marked.js for Markdown parsing
let translationAbortController = null;

if (typeof marked !== 'undefined') {
    marked.setOptions({
        breaks: true, // Convert \n to <br>
        gfm: true,    // GitHub Flavored Markdown
        highlight: function (code, lang) {
            if (lang && hljs.getLanguage(lang)) {
                return hljs.highlight(code, { language: lang }).value;
            }
            return hljs.highlightAuto(code).value;
        }
    });
}

if (SpeechRecognition) {
    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onstart = function () {
        isRecording = true;
        micBtn.classList.add('recording');
        resetSilenceTimer();
    };

    recognition.onresult = function (event) {
        let interimTranscript = '';
        let finalTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal) {
                finalTranscript += event.results[i][0].transcript;
            } else {
                interimTranscript += event.results[i][0].transcript;
            }
        }

        let base = chatInput.dataset.baseValue || '';
        if (base && !base.endsWith(' ')) {
            base += ' ';
        }

        if (finalTranscript) {
            chatInput.value = base + finalTranscript;
            chatInput.dataset.baseValue = chatInput.value;
        } else if (interimTranscript) {
            chatInput.value = base + interimTranscript;
        }

        // Trigger resize
        chatInput.style.height = 'auto';
        chatInput.style.height = (chatInput.scrollHeight) + 'px';

        resetSilenceTimer();
    };

    recognition.onerror = function (event) {
        console.error('Speech recognition error', event.error);
        if (event.error === 'not-allowed') {
            addMessage('Microphone permission is required. Opening a new tab to grant permission...', 'ai', 'error');
            chrome.tabs.create({ url: chrome.runtime.getURL('permission.html') });
        } else if (event.error !== 'no-speech' && event.error !== 'aborted') {
            addMessage('Speech recognition error: ' + event.error, 'ai', 'error');
        }
        stopRecording();
    };

    recognition.onend = function () {
        stopRecording();
    };
}

// Add a specific reset for silence timeout
function resetSilenceTimer() {
    clearTimeout(silenceTimer);
    silenceTimer = setTimeout(() => {
        if (isRecording) {
            console.log('Sending message due to 2s of silence');
            const hasText = chatInput.value.trim().length > 0;
            if (recognition) {
                if (hasText) {
                    recognition.stop();
                } else {
                    recognition.abort();
                }
            }
            stopRecording();
            if (hasText) {
                sendMessage();
            }
        }
    }, 2000);
}

function stopRecording() {
    isRecording = false;
    micBtn.classList.remove('recording');
    clearTimeout(silenceTimer);

    // Stop and clean up equalizer and audio stream
    if (eqAnimationId) cancelAnimationFrame(eqAnimationId);
    if (equalizer) equalizer.classList.add('hidden');

    if (microphoneStream) {
        microphoneStream.getTracks().forEach(track => track.stop());
        microphoneStream = null;
    }
    if (audioContext && audioContext.state !== 'closed') {
        audioContext.close();
        audioContext = null;
    }
}

function startEqualizer() {
    if (microphoneStream) return;
    navigator.mediaDevices.getUserMedia({ audio: true })
        .then(stream => {
            microphoneStream = stream;
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
            analyser = audioContext.createAnalyser();
            const source = audioContext.createMediaStreamSource(stream);
            source.connect(analyser);

            analyser.fftSize = 256;
            const bufferLength = analyser.frequencyBinCount;
            const dataArray = new Uint8Array(bufferLength);

            if (equalizer) equalizer.classList.remove('hidden');

            function animateEq() {
                if (!isRecording) return;
                eqAnimationId = requestAnimationFrame(animateEq);

                analyser.getByteFrequencyData(dataArray);

                // Use lower frequencies which usually carry voice energy better
                const v1 = dataArray[10] / 255;
                const v2 = dataArray[20] / 255;
                const v3 = dataArray[30] / 255;
                const v4 = dataArray[40] / 255;

                if (eqBars.length >= 4) {
                    eqBars[0].style.height = Math.max(2, v1 * 14) + 'px';
                    eqBars[1].style.height = Math.max(2, v2 * 14) + 'px';
                    eqBars[2].style.height = Math.max(2, v3 * 14) + 'px';
                    eqBars[3].style.height = Math.max(2, v4 * 14) + 'px';
                }
            }

            animateEq();
        })
        .catch(err => {
            console.warn("Could not start equalizer audio stream:", err);
            // We ignore it, speech recognition might still work or has thrown its own error (like not-allowed)
        });
}

micBtn.addEventListener('click', () => {
    if (!recognition) {
        addMessage('Speech recognition is not supported in this browser.', 'ai', 'error');
        return;
    }

    if (isRecording) {
        recognition.stop();
        stopRecording();
    } else {
        chatInput.dataset.baseValue = chatInput.value;
        recognition.lang = speechLang.value;

        try {
            recognition.start();
            startEqualizer();
            chatInput.focus();
        } catch (e) {
            console.warn("Could not start recognition directly:", e);
            // Engine might still be stopping. Abort it completely and retry.
            recognition.abort();
            setTimeout(() => {
                try {
                    recognition.start();
                    startEqualizer();
                    chatInput.focus();
                } catch (err) {
                    console.error("Failed to restart recognition:", err);
                }
            }, 300);
        }
    }
});

// Resize textarea dynamically
chatInput.addEventListener('input', function () {
    this.dataset.baseValue = this.value;
    this.style.height = 'auto';
    this.style.height = (this.scrollHeight) + 'px';
});

// Handle enter key
chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (!isAgentRunning) {
            sendMessage();
        }
    }
});

sendBtn.addEventListener('click', () => {
    if (isAgentRunning) {
        stopAgentLoop();
    } else {
        sendMessage();
    }
});

const uploadBtn = document.getElementById('upload-btn');
const fileUploadInput = document.getElementById('file-upload-input');
const imagePreviewsContainer = document.getElementById('image-previews-container');

function renderImagePreviews() {
    if (!imagePreviewsContainer) return;
    
    imagePreviewsContainer.innerHTML = '';
    
    attachedImagesData.forEach((imgData, index) => {
        const previewItem = document.createElement('div');
        previewItem.className = 'preview-item';
        previewItem.style.backgroundImage = `url(${imgData})`;
        
        const removeBtn = document.createElement('button');
        removeBtn.className = 'remove-preview-btn';
        removeBtn.innerHTML = '×';
        removeBtn.title = 'Remove Image';
        
        removeBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            attachedImagesData.splice(index, 1);
            if (fileUploadInput) fileUploadInput.value = ''; // Reset input to allow re-uploading the same file
            renderImagePreviews();
            updateUploadBtnAppearance();
        });
        
        previewItem.appendChild(removeBtn);
        imagePreviewsContainer.appendChild(previewItem);
    });
}

function updateUploadBtnAppearance() {
    if (!uploadBtn) return;
    if (attachedImagesData.length > 0) {
        uploadBtn.style.color = '#10b981'; // Green to signify attached
    } else {
        uploadBtn.style.color = '';
    }
}

if (uploadBtn && fileUploadInput) {
    uploadBtn.addEventListener('click', () => {
        if (isAgentRunning) return;
        if (attachedImagesData.length >= 5) {
            addMessage('Maximum 5 images can be attached.', 'ai', 'error');
            return;
        }
        fileUploadInput.click();
    });

    fileUploadInput.addEventListener('change', async (e) => {
        const files = Array.from(e.target.files);
        if (files.length === 0) return;

        if (attachedImagesData.length + files.length > 5) {
            addMessage('Maximum 5 images can be attached. Some files were ignored.', 'ai', 'error');
            files.splice(5 - attachedImagesData.length);
        }

        const validTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg'];
        
        for (const file of files) {
            if (!validTypes.includes(file.type)) {
                addMessage(`File ${file.name} ignored: Only JPG, PNG, and WEBP supported.`, 'ai', 'error');
                continue;
            }

            const dataUrl = await new Promise((resolve) => {
                const reader = new FileReader();
                reader.onload = (event) => resolve(event.target.result);
                reader.readAsDataURL(file);
            });
            attachedImagesData.push(dataUrl);
        }
        
        fileUploadInput.value = ''; // Reset allows picking same files again if needed
        renderImagePreviews();
        updateUploadBtnAppearance();
    });
}

function clearAttachedImage() {
    attachedImagesData = [];
    if (fileUploadInput) fileUploadInput.value = '';
    renderImagePreviews();
    updateUploadBtnAppearance();
}

function updateUploadButtonVisibility(modelId) {
    if (!uploadBtn) return;
    const model = modelsData.find(m => m.id === modelId);
    if (model && model.hasFileUpload) {
        uploadBtn.style.display = 'flex';
    } else {
        uploadBtn.style.display = 'none';
        clearAttachedImage();
    }
}
const welcomeScreenHTML = `
                <div class="welcome-screen">
                    <div class="welcome-icon">
                        <img src="logoCS.png" alt="CrewAgent Logo" width="40" height="40">
                    </div>
                    <h2>Welcome to CrewAgent</h2>
                    <p>Your crew, working the web.</p>
                    <p class="subtitle">I can read the page, answer questions, translate, and perform browser actions for you.</p>
                    <div class="welcome-suggestions">
                        <button class="welcome-chip" type="button">Summarise this page</button>
                        <button class="welcome-chip" type="button">Translate to Hindi</button>
                        <button class="welcome-chip" type="button">Fill this form</button>
                    </div>
                </div>
`;

// Suggestion chips: drop their text into the input and focus it. Delegated so
// it keeps working after the welcome screen is re-rendered on clear.
document.addEventListener('click', (e) => {
    const chip = e.target.closest('.welcome-chip');
    if (!chip) return;
    const input = document.getElementById('chat-input');
    if (!input) return;
    input.value = chip.textContent.trim();
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus();
});

clearBtn.addEventListener('click', async () => {
    const modelSelect = document.getElementById('model-select');
    const selectedModel = modelSelect ? modelSelect.value : '';
    if (selectedModel) {
        try {
            await fetch(`${BACKEND_URL}/history?chatflowId=${selectedModel}`, { method: 'DELETE', credentials: 'include' });
        } catch (e) {
            console.error("Failed to clear history", e);
        }
    }

    chatContainer.innerHTML = welcomeScreenHTML;
    const activityContainer = document.getElementById('activity-log');
    if (activityContainer) {
        activityContainer.innerHTML = '';
    }
    
    // RESET AGENT STATE
    chatHistory = [];
    if (translationAbortController) {
        translationAbortController.abort();
        translationAbortController = null;
    }
    stopAgentLoop();


    // Reset translation back to default
    if (translateLang.value !== "") {
        translateLang.value = "";
        await chrome.storage.local.remove(['targetLang', 'langName']);
        await revertPageText();
        const tab = await getActiveTab();
        if (tab) chrome.tabs.sendMessage(tab.id, { type: "SET_TRANSLATION_STATE", lang: null });
    }
});

async function performTranslation(targetLang, langName) {
    if (!targetLang) {
        await chrome.storage.local.remove(['targetLang', 'langName']);
        await revertPageText();
        const tab = await getActiveTab();
        if (tab) chrome.tabs.sendMessage(tab.id, { type: "SET_TRANSLATION_STATE", lang: null });
        addMessage("Reverted to original page language.", "ai");
        return;
    }

    await chrome.storage.local.set({ targetLang, langName });

    translateLang.disabled = true;
    translateLang.value = targetLang;

    if (translationAbortController) translationAbortController.abort();
    translationAbortController = new AbortController();
    const signal = translationAbortController.signal;

    try {
        // REVERT ANY EXISTING TRANSLATION FIRST!
        await revertPageText();

        addMessage(`Scanning and translating page to ${langName}...`, "ai");

        const texts = await getPageTextNodes();

        if (!texts || texts.length === 0) {
            addMessage("No translatable text found on this page.", "ai", "error");
            translateLang.value = "";
            return;
        }

        const response = await fetch(`${BACKEND_URL}/translate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: signal,
            body: JSON.stringify({ texts: texts, targetLanguage: targetLang })
        });

        const data = await response.json();
        if (data.translated_texts) {
            addMessage("Translation complete. Updating the page in-place...", "ai", "translation-success");
            await replacePageTextNodes(data.translated_texts);

            // Notify content script about updated translation state
            addMessage("Translation complete. Updating the page in-place...", "ai", "success");
            await replacePageTextNodes(data.translated_texts);

            setTimeout(async () => {
                const tab = await getActiveTab();
                if (tab) {
                    chrome.tabs.sendMessage(tab.id, { type: "SET_TRANSLATION_STATE", lang: targetLang });
                }
            }, 1000);
        } else {
            throw new Error("Missing translated texts from backend");
        }
    } catch (error) {
        if (error.name === 'AbortError') {
            console.log('Translation aborted.');
            return;
        }
        addMessage("Translation failed. CrewAgent may be incorrect. Please verify connection.", "ai", "error");
        console.error(error);
        translateLang.value = "";
    } finally {
        translateLang.disabled = false;
        translationAbortController = null;
    }
}

translateLang.addEventListener('change', async (e) => {
    const targetLang = e.target.value;
    const langName = e.target.options[e.target.selectedIndex].text;
    await performTranslation(targetLang, langName);
});

let chatHistory = [];
let isAgentRunning = false;
let userRequestedStop = false;
let currentAbortController = null;

function setButtonState(running) {
    if (running) {
        sendBtn.innerHTML = `
            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                <rect x="6" y="6" width="12" height="12" rx="2" ry="2"></rect>
            </svg>
        `;
        sendBtn.classList.add('stop-btn');
    } else {
        sendBtn.innerHTML = `
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
        `;
        sendBtn.classList.remove('stop-btn');
    }

    if (!running) {
        chrome.tabs.query({}, (tabs) => {
            tabs.forEach(tab => {
                if (tab && tab.url && !tab.url.startsWith('chrome://') && !tab.url.startsWith('chrome-extension://')) {
                    chrome.tabs.sendMessage(tab.id, { 
                        type: "TOGGLE_LOADING_UI", 
                        isAgentRunning: false 
                    }, () => chrome.runtime.lastError);
                }
            });
        });
    } else {
        getActiveTab().then(tab => {
            if (tab && tab.url && !tab.url.startsWith('chrome://') && !tab.url.startsWith('chrome-extension://')) {
                chrome.tabs.sendMessage(tab.id, { 
                    type: "TOGGLE_LOADING_UI", 
                    isAgentRunning: running 
                }, () => {
                    if (chrome.runtime.lastError) {
                        // Script might not be fully injected yet, that's okay
                    }
                });
            }
        }).catch(() => {});
    }
}

function stopAgentLoop() {
    // A run paused on a question is not "running", but it is still a live run
    // holding a budget and a checkpoint. Stop has to end that too, or it comes
    // back the next time the panel opens.
    if (activeRun && activeRun.status === 'waiting') {
        document.querySelectorAll('.ask-prompt:not([data-resolved="true"])').forEach((prompt) => {
            prompt.dataset.resolved = 'true';
            prompt.querySelectorAll('button, input').forEach((el) => { el.disabled = true; });
        });
        clearRun();
    }

    if (isAgentRunning) {
        userRequestedStop = true;
        isAgentRunning = false;
        if (currentAbortController) {
            currentAbortController.abort();
            currentAbortController = null;
        }
        if (translationAbortController) {
            translationAbortController.abort();
            translationAbortController = null;
        }
        setButtonState(false);
        // Remove typing indicator immediately if it exists
        const typingElements = document.querySelectorAll('.typing-indicator');
        typingElements.forEach(el => el.remove());
        addMessage("Execution stopped by user.", "ai", true);
    }
}

async function sendMessage() {
    if (isAgentRunning) return;

    const text = chatInput.value.trim();
    if (!text) return;

    chatInput.value = '';
    chatInput.dataset.baseValue = '';
    chatInput.style.height = 'auto';

    // Clone the array in case user attaches more before generation finishes
    let msgImageData = [...attachedImagesData];
    clearAttachedImage();

    if (isRecording && recognition) {
        recognition.stop();
        stopRecording();
    }

    // Remove welcome screen on first message
    const welcomeScreen = document.querySelector('.welcome-screen');
    if (welcomeScreen) welcomeScreen.remove();

    // A run paused on a question treats the next thing you type as the answer,
    // so typing into the box works as well as using the buttons. Without this
    // the reply would start a brand new run and quietly reset every budget.
    if (activeRun && activeRun.status === 'waiting') {
        const pending = document.querySelector('.ask-prompt:not([data-resolved="true"])');
        if (pending) {
            submitAskAnswer(pending, text);
        } else {
            resumeRunWith(text);
        }
        return;
    }

    addMessage(text, 'user', 'normal', msgImageData);
    chatHistory.push({ role: "user", content: text, image_data: msgImageData });

    // Not every message is a job for the browser. Ask first, so "hi" cannot
    // start a run that clicks something.
    if (await isConversation(text)) return;

    runAgentLoop();
}

/**
 * True when the message was conversation and has already been answered.
 *
 * Costs one short text-only turn. It only runs when a new task would otherwise
 * start — never mid-run, and never on a resume — so it does not slow the loop
 * itself. Any failure answers "no" and lets the run proceed, because refusing
 * to work is worse than an unnecessary run.
 */
async function isConversation(text) {
    const modelSelect = document.getElementById('model-select');
    const selectedModel = modelSelect ? modelSelect.value : '';
    if (!selectedModel) return false;

    try {
        const response = await fetch(`${BACKEND_URL}/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
                mode: 'triage',
                model: selectedModel,
                messages: [{ role: 'user', content: text }],
                preferLocal
            })
        });

        if (!response.ok) return false;

        const data = await response.json();
        if (data.kind !== 'chat') return false;

        const reply = data.text || 'What would you like me to do on this page?';
        addMessage(reply, 'ai');
        chatHistory.push({ role: 'assistant', content: reply });
        return true;
    } catch (e) {
        console.warn('Triage failed, running the task anyway:', e.message);
        return false;
    }
}

// Extract the first, original user message from chat history
function getOriginalUserGoal() {
    for (const msg of chatHistory) {
        if (msg.role === 'user' && !msg.content.includes('ORIGINAL USER GOAL') && !msg.content.includes('Action ') && !msg.content.includes('What is the next logical action')) {
            return msg.content;
        }
    }
    return '';
}

/* ------------------------------------------------ vision and loop guards -- */

/** Used until the agent list says otherwise. DOM only, supervised, bounded. */
const DEFAULT_LIMITS = {
    maxSteps: 25,
    maxSeconds: 300,
    autonomy: 'supervised',
    allowlist: [],
    sight: 'off',
    marks: false
};

/** Cycled so two badges that end up adjacent stay tellable apart. */
const MARK_COLORS = [
    '#e6194b', '#3cb44b', '#4363d8', '#f58231',
    '#911eb4', '#008080', '#9a6324', '#800000'
];

/** How long to wait for the page to go quiet after an action. */
const SETTLE_TIMEOUT = 10000;

/** How long a suspended run waits for an answer before giving up. */
const INPUT_TIMEOUT = 20 * 60 * 1000;

/**
 * Screenshots kept in the transcript. Vision tokens dominate prefill, so an
 * unbounded transcript is the single biggest thing that makes a run get slower
 * the longer it goes — by step 10 you would be re-sending 13k image tokens
 * every turn. Two is enough to see what just changed.
 */
const MAX_HISTORY_IMAGES = 2;

const RUN_STORE_KEY = 'blockagent_active_run';

/**
 * Whether to force the on-device model regardless of what the agent's Model
 * block says.
 *
 * This is a session switch rather than a stack edit on purpose: "should this
 * particular run leave my machine" is a decision you make about the page in
 * front of you, not a property of the agent.
 */
let preferLocal = false;

async function setPreferLocal(next, { persist = true } = {}) {
    preferLocal = !!next;

    const toggle = document.getElementById('private-toggle');
    if (toggle) {
        toggle.setAttribute('aria-checked', preferLocal ? 'true' : 'false');
        const label = toggle.querySelector('.tier-label');
        if (label) label.textContent = preferLocal ? 'Local' : 'Cloud';
        toggle.title = preferLocal
            ? 'Running locally — nothing leaves the device. Click for cloud.'
            : 'Running in the cloud. Click to run locally instead.';
    }

    if (persist) {
        try {
            await chrome.storage.local.set({ preferLocal });
        } catch (e) {
            console.warn('Could not remember the tier:', e.message);
        }
    }

    if (preferLocal) checkLocalServer();
    else if (toggle) toggle.removeAttribute('data-status');
}

/**
 * Says up front whether the local server is actually answering.
 *
 * Finding out at send time means the failure lands in the middle of a task,
 * which is the worst moment to learn a background process is not running.
 */
async function checkLocalServer() {
    const toggle = document.getElementById('private-toggle');
    if (!toggle) return;

    try {
        const res = await fetch(`${LOCAL_MODEL_URL}/models`, { signal: AbortSignal.timeout(2500) });
        if (!res.ok) throw new Error(String(res.status));
        toggle.removeAttribute('data-status');
    } catch (e) {
        toggle.dataset.status = 'offline';
        toggle.title = 'The on-device model is not running. Start it with "pnpm dev:model".';
        addActivityLog('system', 'On-device model is not responding — start it with "pnpm dev:model"');
    }
}

const STOP_REASONS = {
    STEP_BUDGET_EXCEEDED: 'I used up the actions allowed for this run without finishing.',
    TIME_BUDGET_EXCEEDED: 'I ran out of working time for this run without finishing.',
    NO_PROGRESS_LOOP: 'The page stopped changing, so I was going in circles. I stopped instead of looping.',
    REPEATED_ACTION: 'I was about to repeat an action that had already done nothing. I stopped instead of looping.',
    CONSECUTIVE_ERRORS: 'Three actions in a row failed, so I stopped rather than keep guessing.',
    BLOCKED_DOMAIN: 'That site is not on this agent’s allowlist, so I did not open it.',
    ACTION_TIMEOUT: 'The page never settled after my last action.',
    INPUT_TIMEOUT: 'I waited for your answer but nothing came, so I let the run go.'
};

/**
 * The state of the run in progress, or null.
 *
 * This lives outside runAgentLoop on purpose. A call stack cannot be suspended;
 * a state machine can. Keeping the counters here is what lets the agent stop
 * for a human and then carry on with the same budget rather than silently
 * starting over — which is how the step cap used to be defeatable by asking a
 * question every twenty steps.
 */
let activeRun = null;
let waitingTimer = null;

function newRun(limits) {
    return {
        runId: `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        step: 0,
        workedMs: 0,
        seen: {},
        consecutiveErrors: 0,
        lastActionKey: null,
        lastSignature: null,
        limits: limits,
        status: 'running',
        pendingAsk: null,
        waitingSince: null,
        pendingApprovalKey: null,
        approvedActionKey: null
    };
}

/**
 * Checkpoints the run so it survives the side panel closing — which it does
 * whenever the user clicks away, taking every JS variable with it.
 */
async function saveRun() {
    try {
        if (!activeRun) {
            await chrome.storage.session.remove(RUN_STORE_KEY);
            return;
        }
        await chrome.storage.session.set({
            [RUN_STORE_KEY]: {
                run: activeRun,
                // Images are dropped: they are large, session storage is not,
                // and a resumed run re-reads the page anyway.
                history: chatHistory.map((message) => ({
                    role: message.role,
                    content: message.content
                }))
            }
        });
    } catch (e) {
        console.warn('Could not checkpoint the run:', e.message);
    }
}

async function clearRun() {
    activeRun = null;
    if (waitingTimer) {
        clearTimeout(waitingTimer);
        waitingTimer = null;
    }
    try {
        await chrome.storage.session.remove(RUN_STORE_KEY);
    } catch (e) {
        console.warn('Could not clear the run:', e.message);
    }
}

/** Re-attaches to a run that was waiting when the panel was last closed. */
async function restoreRun() {
    try {
        const stored = await chrome.storage.session.get(RUN_STORE_KEY);
        const saved = stored && stored[RUN_STORE_KEY];
        if (!saved || !saved.run || saved.run.status !== 'waiting') return;

        if (Date.now() - (saved.run.waitingSince || 0) > INPUT_TIMEOUT) {
            await clearRun();
            return;
        }

        activeRun = saved.run;
        if (!chatHistory.length && Array.isArray(saved.history)) {
            chatHistory = saved.history;
        }

        if (activeRun.pendingAsk) {
            addMessage('Picking up where we left off — I still need this:', 'ai');
            renderAskPrompt(activeRun.pendingAsk);
        }
    } catch (e) {
        console.warn('Could not restore the run:', e.message);
    }
}

function limitsForSelectedAgent() {
    const select = document.getElementById('model-select');
    const selected = select ? select.value : '';
    const agent = (modelsData || []).find(m => m.id === selected);
    return Object.assign({}, DEFAULT_LIMITS, (agent && agent.vision) || {});
}

function reportStop(code, detail) {
    const base = STOP_REASONS[code] || 'I stopped.';
    addMessage(detail ? `${base}\n\n${detail}` : base, 'ai', 'error');
    addActivityLog('system', `Run stopped: ${code}`);
}

/* ---------------------------------------------------------- asking you -- */

/**
 * Renders the question the agent paused on, shaped by what it says it needs.
 *
 * A yes/no rendered as a text box invites a typo where a button cannot have
 * one, and an OTP field that accepts prose is just a slower way to fail — so
 * the control follows the answer, rather than everything falling back to a
 * chat message.
 */
function renderAskPrompt(ask) {
    const container = document.getElementById('chat-container');
    if (!container) return;

    const wrap = document.createElement('div');
    wrap.className = 'ask-prompt';

    const question = document.createElement('p');
    question.className = 'ask-question';
    question.textContent = ask.text || 'I need something from you to carry on.';
    wrap.appendChild(question);

    const expecting = ask.expecting || 'text';

    if (expecting === 'confirmation' || expecting === 'choice') {
        const options = expecting === 'confirmation'
            ? ['Yes', 'No']
            : (ask.options || []);

        const row = document.createElement('div');
        row.className = 'ask-options';

        options.forEach((option, index) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'ask-chip';
            // Lead with the affirmative, but never make it the only easy path.
            if (expecting === 'confirmation' && index === 0) {
                button.dataset.variant = 'primary';
            }
            button.textContent = option;
            button.addEventListener('click', () => submitAskAnswer(wrap, option));
            row.appendChild(button);
        });

        wrap.appendChild(row);
        container.appendChild(wrap);
        const first = row.querySelector('button');
        if (first) setTimeout(() => first.focus(), 50);
    } else {
        const row = document.createElement('div');
        row.className = 'ask-inline';

        const input = document.createElement('input');
        input.type = 'text';
        input.setAttribute('aria-label', ask.text || 'Your answer');

        if (expecting === 'otp' || expecting === 'number') {
            input.inputMode = 'numeric';
            input.autocomplete = expecting === 'otp' ? 'one-time-code' : 'off';
        }

        input.placeholder = expecting === 'otp'
            ? 'Enter the code'
            : expecting === 'number'
                ? 'Enter a number'
                : 'Your answer';

        const send = document.createElement('button');
        send.type = 'button';
        send.className = 'ask-chip';
        send.dataset.variant = 'primary';
        send.textContent = 'Send';

        const submit = () => {
            const value = input.value.trim();
            if (value) submitAskAnswer(wrap, value);
        };

        send.addEventListener('click', submit);
        input.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                submit();
            }
        });

        row.appendChild(input);
        row.appendChild(send);
        wrap.appendChild(row);
        container.appendChild(wrap);
        setTimeout(() => input.focus(), 50);
    }

    container.scrollTop = container.scrollHeight;
}

/** Freezes the prompt so it reads as answered, then resumes the run. */
function submitAskAnswer(wrap, value) {
    if (wrap.dataset.resolved === 'true') return;
    wrap.dataset.resolved = 'true';

    wrap.querySelectorAll('button, input').forEach((el) => { el.disabled = true; });

    const controls = wrap.querySelector('.ask-options, .ask-inline');
    if (controls) {
        const answered = document.createElement('p');
        answered.className = 'ask-answered';
        answered.textContent = `You answered: ${value}`;
        controls.replaceWith(answered);
    }

    resumeRunWith(value);
}

/** Suspends the run on a question and waits, without spending the budget. */
async function suspendForInput(ask) {
    if (!activeRun) return;

    activeRun.status = 'waiting';
    activeRun.pendingAsk = ask;
    activeRun.waitingSince = Date.now();
    await saveRun();

    isAgentRunning = false;
    setButtonState(false);

    renderAskPrompt(ask);
    addActivityLog('system', 'Waiting for you');

    if (waitingTimer) clearTimeout(waitingTimer);
    waitingTimer = setTimeout(async () => {
        if (activeRun && activeRun.status === 'waiting') {
            reportStop('INPUT_TIMEOUT');
            await clearRun();
        }
    }, INPUT_TIMEOUT);
}

async function resumeRunWith(value) {
    if (!activeRun || activeRun.status !== 'waiting') return;

    if (waitingTimer) {
        clearTimeout(waitingTimer);
        waitingTimer = null;
    }

    addMessage(value, 'user');
    chatHistory.push({
        role: 'user',
        content: `The user replied: ${value}\n\nCarry on with the task from where you paused.`
    });

    // An approval unlocks exactly the action it was asked about, once.
    if (activeRun.pendingApprovalKey) {
        const approved = /^(yes|y|ok|okay|sure|go ahead|confirm|do it)$/i.test(value.trim());
        activeRun.approvedActionKey = approved ? activeRun.pendingApprovalKey : null;
        activeRun.pendingApprovalKey = null;

        chatHistory.push({
            role: 'user',
            content: approved
                ? 'The user approved that action. Issue it again now, exactly as before.'
                : 'The user declined that action. Do not attempt it. Choose something else or ANSWER.'
        });
    }

    activeRun.status = 'running';
    activeRun.pendingAsk = null;
    activeRun.waitingSince = null;
    await saveRun();

    runAgentLoop({ resume: true });
}

/* ------------------------------------------------------------- seeing -- */

/**
 * A viewport screenshot with the element ids drawn onto it.
 *
 * This is Set-of-Mark prompting: the model reads a number off a badge and
 * answers with that number, instead of guessing a pixel coordinate that goes
 * stale the moment the page reflows. The id it returns is checked against the
 * element table, so it cannot invent one.
 */
async function captureMarkedScreenshot(context, limits, wanted) {
    if (limits.sight === 'off') return null;
    if (limits.sight === 'auto' && !wanted) return null;

    const tab = await getActiveTab();
    if (!tab) return null;

    let dataUrl;
    try {
        dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
            format: 'jpeg',
            quality: 70
        });
    } catch (e) {
        console.warn('Screenshot failed:', e.message);
        return null;
    }

    const image = new Image();
    image.src = dataUrl;
    try {
        await image.decode();
    } catch (e) {
        console.warn('Screenshot decode failed:', e.message);
        return null;
    }

    // Vision tokens scale with pixels, and the grounding comes from the badges
    // rather than from resolution — so cap the long edge instead of sending a
    // retina capture and paying four times the prefill for nothing.
    const LONG_EDGE = 1280;
    const scale = Math.min(1, LONG_EDGE / Math.max(image.width, image.height));

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(image.width * scale);
    canvas.height = Math.round(image.height * scale);

    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

    if (limits.marks) drawMarks(ctx, canvas, context);

    return canvas.toDataURL('image/jpeg', 0.7);
}

function drawMarks(ctx, canvas, context) {
    const viewport = context.viewport;
    const boxes = ((context.elements || {}).interactable || []).filter(el => el && el.box);
    if (!viewport || !viewport.width || !boxes.length) return;

    // The capture covers the viewport in device pixels; boxes are CSS pixels.
    const k = canvas.width / viewport.width;

    ctx.font = '600 11px -apple-system, system-ui, sans-serif';
    ctx.textBaseline = 'top';

    boxes.forEach((el, index) => {
        const color = MARK_COLORS[index % MARK_COLORS.length];
        const x = el.box.x * k;
        const y = el.box.y * k;

        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x, y, el.box.w * k, el.box.h * k);

        const label = String(el.id);
        const padding = 3;
        const badgeW = ctx.measureText(label).width + padding * 2;
        const badgeH = 14;

        // Keep the badge on canvas for anything flush against an edge.
        const bx = Math.min(Math.max(0, x), canvas.width - badgeW);
        const by = Math.min(Math.max(0, y), canvas.height - badgeH);

        ctx.fillStyle = color;
        ctx.fillRect(bx, by, badgeW, badgeH);
        ctx.fillStyle = '#ffffff';
        ctx.fillText(label, bx + padding, by + 2);
    });
}

/**
 * Strips boxes and trims the element table before it goes over the wire.
 *
 * The model never needs coordinates — it reads the badge. Boxes exist purely
 * to draw those badges here, so sending them is paying tokens for something
 * that gets ignored.
 */
/** How many elements the model is shown. Beyond this, prefill cost dominates. */
const MAX_ELEMENTS_SENT = 200;

/**
 * Ranks an element by how likely it is to be the thing the user meant.
 *
 * The old cap took the first 150 in DOM order, which on a Gmail-shaped page
 * spent the whole budget on 50 inbox-row checkboxes and dropped the Send button
 * at position 155 — the model could not have sent the mail if it had wanted to.
 *
 * Lower sorts first.
 */
function elementRank(el) {
    if (el.kind === 'input') return 0;             // few, and always the target of TYPE
    if (el.kind === 'image') return 3;             // content, never an action
    const label = (el.text || el.name || '').trim();
    if (!label) return 4;
    // A short label is a control ("Send", "Compose"); a long one is usually a
    // content link that happens to be clickable.
    return label.length <= 30 ? 1 : 2;
}

function elementsForModel(elements) {
    if (!elements || !Array.isArray(elements.interactable)) return elements || {};

    // Stable sort by rank, so ties keep DOM order (which is reading order).
    const ordered = elements.interactable
        .map((el, index) => ({ el, index }))
        .sort((a, b) => elementRank(a.el) - elementRank(b.el) || a.index - b.index)
        .slice(0, MAX_ELEMENTS_SENT)
        .sort((a, b) => a.index - b.index)
        .map((entry) => entry.el);

    return {
        interactable: ordered.map((el) => {
            const lean = { id: el.id };
            if (el.kind) lean.kind = el.kind;
            if (el.text) lean.text = el.text;
            if (el.name) lean.name = el.name;
            if (el.type) lean.type = el.type;
            if (el.role) lean.role = el.role;
            if (el.secret) lean.secret = true;
            return lean;
        }),
        headings: (elements.headings || []).slice(0, 12)
    };
}

/**
 * Keeps only the newest screenshots in the transcript.
 *
 * Without this every past screenshot is re-sent on every turn, so each step
 * costs more prefill than the last and a long run crawls — worst on the local
 * tier, which is exactly where the headroom is thinnest.
 */
function pruneHistoryImages() {
    let kept = 0;
    for (let i = chatHistory.length - 1; i >= 0; i--) {
        const message = chatHistory[i];
        if (!message.image_data) continue;
        if (kept < MAX_HISTORY_IMAGES) {
            kept++;
        } else {
            delete message.image_data;
        }
    }
}

/**
 * Whether this turn is worth a screenshot.
 *
 * Measured on the local 4B tier: ~5.6s for a turn with an image against ~0.8s
 * without. Looking is not a free upgrade, it is most of the step — so in `auto`
 * the agent works off the element table and only looks when that table cannot
 * answer the question.
 */
function shouldLook(run, context, requested) {
    if (run.limits.sight === 'off') return false;
    if (run.limits.sight === 'always') return true;

    // The model said it needs to look.
    if (requested) return true;

    // A page with almost nothing addressable is a canvas or a foreign iframe;
    // the DOM is not going to get any more helpful on the next turn.
    const count = ((context.elements || {}).interactable || []).length;
    if (count < 5) return true;

    // The last thing we tried did not work. Look before guessing again.
    if (run.consecutiveErrors > 0) return true;

    return false;
}

/**
 * Words that mean "this cannot be taken back".
 *
 * Deliberately matched against the element's own label rather than the model's
 * intent, because the model is the thing being guarded against.
 */
const IRREVERSIBLE = /\b(buy|purchase|place\s*order|pay|checkout|confirm\s*(and|&)?\s*pay|send|submit|delete|remove|cancel\s*(order|booking)|book\s*now|transfer|withdraw|deactivate|unsubscribe)\b/i;

/**
 * Whether this action needs a yes before it happens.
 *
 * The prompt already tells the agent to ASK before anything irreversible, and
 * on the local 4B tier it measurably does not: asked to "complete the
 * purchase" it clicked Place order directly. A safety gate that depends on the
 * model choosing to use it is not a gate, so this repeats the check in code
 * where the answer does not depend on which model is loaded.
 */
function needsConfirmation(run, data, context) {
    if (run.limits.autonomy !== 'supervised') return null;
    if (data.action !== 'CLICK') return null;

    const actionKey = `${data.action}:${data.elementId}`;
    if (run.approvedActionKey === actionKey) return null;

    const element = ((context.elements || {}).interactable || [])
        .find(el => String(el.id) === String(data.elementId));
    if (!element) return null;

    const label = String(element.text || element.name || '').trim();
    if (!label || !IRREVERSIBLE.test(label)) return null;

    return { actionKey, label };
}

/** Waits for the page to stop mutating, rather than guessing with a delay. */
async function settlePage() {
    const tab = await getActiveTab();
    if (!tab || !tab.id) return { reason: 'no-tab' };

    return new Promise((resolve) => {
        let finished = false;
        const finish = (result) => {
            if (finished) return;
            finished = true;
            resolve(result);
        };

        // The content script may be gone mid-navigation; do not hang on it.
        const guard = setTimeout(() => finish({ reason: 'timeout' }), SETTLE_TIMEOUT + 500);

        chrome.tabs.sendMessage(
            tab.id,
            { type: 'WAIT_FOR_SETTLE', timeout: SETTLE_TIMEOUT },
            (response) => {
                void chrome.runtime.lastError;
                clearTimeout(guard);
                finish(response || { reason: 'unavailable' });
            }
        );
    });
}

function hostAllowed(rawUrl, allowlist) {
    if (!allowlist || !allowlist.length) return true;
    try {
        const host = new URL(rawUrl).hostname.toLowerCase();
        return allowlist.some(entry => host === entry || host.endsWith(`.${entry}`));
    } catch (e) {
        return false;
    }
}

/* --------------------------------------------------------------- loop -- */

async function runAgentLoop(options) {
    const resuming = !!(options && options.resume);

    if (!resuming || !activeRun) {
        activeRun = newRun(limitsForSelectedAgent());
    }

    const run = activeRun;
    run.status = 'running';

    // Set when the model answers SEE, consumed by the next turn's capture.
    let lookNextTurn = false;
    let looksUsed = 0;

    isAgentRunning = true;
    userRequestedStop = false;
    setButtonState(true);

    const typingId = 'typing-' + Date.now();
    addTypingIndicator(typingId);

    // Only time spent working counts. Waiting on a person must not spend the
    // budget, or asking for an OTP times the agent out for being polite.
    const startedAt = Date.now();
    const bankWorkedTime = () => {
        run.workedMs += Date.now() - startedAt;
    };

    const finish = async (code, detail) => {
        removeElement(typingId);
        if (code) reportStop(code, detail);
        await clearRun();
    };

    try {
        while (isAgentRunning && !userRequestedStop) {
            if (run.step >= run.limits.maxSteps) {
                bankWorkedTime();
                await finish('STEP_BUDGET_EXCEEDED', `I got through ${run.step} of ${run.limits.maxSteps} actions. Tell me what to try next, or raise the limit on the Vision block.`);
                return;
            }

            const workedSoFar = run.workedMs + (Date.now() - startedAt);
            if (workedSoFar > run.limits.maxSeconds * 1000) {
                bankWorkedTime();
                await finish('TIME_BUDGET_EXCEEDED', `The limit is ${Math.round(run.limits.maxSeconds / 60)} minutes of working time, set on the Vision block.`);
                return;
            }

            run.step++;

            // 1. Read the page.
            const context = await getPageContext();
            const signature = context.stateSignature || `${context.url}|${run.step}`;

            // The classic deadlock is "the page did not change and the model
            // tried the same thing again". Catch it on the third repeat rather
            // than burning the whole step budget discovering it.
            run.seen[signature] = (run.seen[signature] || 0) + 1;
            if (run.seen[signature] >= 3) {
                bankWorkedTime();
                await finish('NO_PROGRESS_LOOP', `The page has looked identical for ${run.seen[signature]} turns at ${context.url}.`);
                return;
            }

            // 2. See the page, but only when looking will actually tell us
            // something the element table did not.
            const wantsLook = shouldLook(run, context, lookNextTurn);
            lookNextTurn = false;
            const screenshot = await captureMarkedScreenshot(context, run.limits, wantsLook);

            // 3. Ask the model what to do.
            const modelSelect = document.getElementById('model-select');
            const selectedModel = modelSelect ? modelSelect.value : '';

            pruneHistoryImages();
            currentAbortController = new AbortController();

            const response = await fetch(`${BACKEND_URL}/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                signal: currentAbortController.signal,
                body: JSON.stringify({
                    messages: chatHistory,
                    page_content: (context.page_content || '').slice(0, 3000),
                    elements: elementsForModel(context.elements),
                    url: context.url,
                    title: context.title,
                    model: selectedModel,
                    screenshot: screenshot,
                    preferLocal: preferLocal
                })
            });

            currentAbortController = null;

            if (!response.ok) throw new Error('Network response was not ok');
            const data = await response.json();

            // The stack can be edited mid-run, so limits arrive every turn.
            if (data.limits) Object.assign(run.limits, data.limits);

            const assistantMessageStr = typeof data.text === 'string' ? data.text : JSON.stringify(data);
            chatHistory.push({ role: 'assistant', content: assistantMessageStr });

            if (data.usedTool) {
                addActivityLog('action', `Agent used tool: ${data.usedTool}`);
            }

            if (data.memory) {
                fetchMemory();
            }

            // 4. The model wants to look. Grant it, capped, and retry the turn.
            if (data.action === 'SEE') {
                if (looksUsed >= 3) {
                    chatHistory.push({
                        role: 'user',
                        content: 'You have used all your looks for this run. Work from the ELEMENTS table, or ANSWER explaining what you cannot see.'
                    });
                    // Deliberately NOT refunded. A model that keeps asking to
                    // look after being refused would otherwise never run out of
                    // steps, and the budget would never fire.
                } else {
                    looksUsed++;
                    lookNextTurn = true;
                    addActivityLog('action', `Taking a look: ${data.text || 'the page'}`);
                    chatHistory.push({
                        role: 'user',
                        content: 'Here is the page. Now choose your next action.'
                    });
                    // A granted look is not progress, so it does not spend a step.
                    run.step--;
                }
                continue;
            }

            // 5. Pausing for the user — the run survives this.
            if (data.action === 'ASK') {
                bankWorkedTime();
                removeElement(typingId);
                if (data.text) addMessage(data.text, 'ai');
                await suspendForInput({
                    text: data.text,
                    expecting: data.expecting || 'text',
                    options: data.options
                });
                return;
            }

            // 6. Finished for good.
            if (!data.action || data.action === 'ANSWER') {
                bankWorkedTime();
                removeElement(typingId);
                addMessage(data.text || 'Task completed.', 'ai');
                if (Array.isArray(data.citations) && data.citations.length) {
                    addActivityLog('action', `Cited ${data.citations.length} source${data.citations.length === 1 ? '' : 's'}`);
                }
                await clearRun();
                return;
            }

            // 7. Guard the action before it touches the page.
            const actionKey = `${data.action}:${data.elementId ?? data.url ?? data.direction ?? ''}`;
            if (actionKey === run.lastActionKey && signature === run.lastSignature) {
                bankWorkedTime();
                await finish('REPEATED_ACTION', `It wanted to run ${data.action} again with nothing on the page having changed.`);
                return;
            }

            const confirm = needsConfirmation(run, data, context);
            if (confirm) {
                bankWorkedTime();
                removeElement(typingId);
                run.pendingApprovalKey = confirm.actionKey;
                await suspendForInput({
                    text: `This looks final: “${confirm.label}”. Go ahead?`,
                    expecting: 'confirmation'
                });
                return;
            }

            if (data.action === 'NAVIGATE' && !hostAllowed(data.url, run.limits.allowlist)) {
                bankWorkedTime();
                await finish('BLOCKED_DOMAIN', `It tried to open ${data.url}. Allowed: ${run.limits.allowlist.join(', ')}.`);
                return;
            }

            // Keep destructive agentic work off the studio's own editor tab.
            const currentTab = await getActiveTab();
            if (currentTab && currentTab.url && currentTab.url.includes('localhost:3000/agent')) {
                addActivityLog('system', 'Detected the agent editor. Opening a new tab to work in...');
                await new Promise((resolve) => {
                    chrome.tabs.create({ url: 'https://google.com', active: true }, () => {
                        setTimeout(resolve, 1500);
                    });
                });
            }

            removeElement(typingId);

            let executedResponse = null;

            if (data.action === 'TRANSLATE' && data.language) {
                const selectEl = document.getElementById('translate-lang');
                let langName = data.language;
                if (selectEl) {
                    for (let i = 0; i < selectEl.options.length; i++) {
                        if (selectEl.options[i].value === data.language) {
                            langName = selectEl.options[i].text;
                            break;
                        }
                    }
                }

                addMessage(`Translating this page into ${langName}.`, 'ai');
                addTypingIndicator(typingId);
                await performTranslation(data.language, langName);
            } else {
                if (data.text) addMessage(data.text, 'ai');

                let msgText = `Executing ${data.action}${data.elementId ? ` on element #${data.elementId}` : ''}`;
                if (data.action === 'NAVIGATE') msgText = `Navigating to ${data.url}`;
                if (data.action === 'TYPE') msgText = `Typing "${data.text}" into element #${data.elementId}`;
                if (data.action === 'READ_IMAGE') msgText = `Reading image element #${data.elementId}`;
                addMessage(msgText, 'ai');

                addTypingIndicator(typingId);
                executedResponse = await executeCommandInPage(data);

                // Wait for the page to actually go quiet. A fixed delay either
                // wastes time or screenshots a spinner, and a model shown a
                // spinner reasons very carefully about a loading state.
                if (data.action === 'NAVIGATE') {
                    await waitAfterAction(data.action);
                } else {
                    await settlePage();
                }
            }

            run.lastActionKey = actionKey;
            run.lastSignature = signature;

            // One yes buys one action. Clicking the same button again asks again.
            if (run.approvedActionKey === actionKey) {
                run.approvedActionKey = null;
            }

            if (userRequestedStop) break;

            // 8. Count failures, and stop before the model starts flailing.
            const failure = executedResponse && executedResponse.error;
            run.consecutiveErrors = failure ? run.consecutiveErrors + 1 : 0;

            if (run.consecutiveErrors >= 3) {
                bankWorkedTime();
                await finish('CONSECUTIVE_ERRORS', `The last failure was: ${executedResponse.error}`);
                return;
            }

            // 9. Hand the outcome back and go round again.
            const originalGoal = getOriginalUserGoal();
            let nextGoal = `Action ${data.action} was executed.

ORIGINAL USER GOAL: "${originalGoal}"

Review the updated page and element list carefully.

- Do not say the task is done unless the confirmation is visible on the page.
- Email is only sent when you can see the sent confirmation. Filling the recipient is not sending.
- An order is only placed when you can see an order-confirmed page.
- Fill every required field before submitting.
- If a suggestion list opened after your last action, pick from it before moving on.
- If you need something only the user has, use ASK. You keep your progress.

What is the next logical action?`;

            let additionalData = null;

            if (executedResponse && executedResponse.rect) {
                try {
                    const tab = await getActiveTab();
                    const screenshotDataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });

                    // Crop in the side panel, which bypasses page CORS.
                    const image = new Image();
                    image.src = screenshotDataUrl;
                    await image.decode();

                    const rect = executedResponse.rect;
                    const dpr = executedResponse.devicePixelRatio || 1;

                    const canvas = document.createElement('canvas');
                    canvas.width = rect.width * dpr;
                    canvas.height = rect.height * dpr;

                    canvas.getContext('2d').drawImage(
                        image,
                        rect.x * dpr, rect.y * dpr, rect.width * dpr, rect.height * dpr,
                        0, 0, canvas.width, canvas.height
                    );

                    additionalData = canvas.toDataURL('image/png');
                    nextGoal = 'Here is the image you asked to read. Extract the EXACT literal text shown, matching case precisely. Do not interpret it. Reply with {"action":"TYPE","elementId":<input id>,"text":"<exact text>"}.';
                } catch (captureErr) {
                    console.error('Tab capture failed:', captureErr);
                    nextGoal = 'That image could not be captured. Try another approach.';
                }
            } else if (failure) {
                nextGoal = `Action failed: ${executedResponse.error}\n\nTry a different approach, ASK the user if only they can unblock it, or ANSWER explaining what is in the way.`;
            }

            chatHistory.push({ role: 'user', content: nextGoal, image_data: additionalData });
            await saveRun();
        }

        bankWorkedTime();
        removeElement(typingId);
        if (userRequestedStop) await clearRun();
    } catch (error) {
        bankWorkedTime();
        if (error.name === 'AbortError') {
            console.log('Fetch aborted by user.');
            await clearRun();
        } else {
            console.error('Chat error:', error);
            removeElement(typingId);
            addMessage('CrewAgent could not reach the backend. Check your connection and that you are signed in to CrewBlocks.', 'ai', 'error');
            await clearRun();
        }
    } finally {
        isAgentRunning = false;
        setButtonState(false);
    }
}

function addMessage(text, sender, type = 'normal', images = []) {
    const msgDiv = document.createElement('div');
    msgDiv.className = `message ${sender}-message`;
    
    // Add image preview wrapper if images exist
    if (images && images.length > 0) {
        const imagesWrapper = document.createElement('div');
        imagesWrapper.className = 'message-images-wrapper';
        images.forEach(img => {
            const imgEl = document.createElement('img');
            imgEl.className = 'message-inline-img';
            imgEl.src = img;
            imagesWrapper.appendChild(imgEl);
        });
        msgDiv.appendChild(imagesWrapper);
    }

    if (type === 'error' || type === true) {
        msgDiv.innerHTML = `<div class="error-msg">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            ${text}
        </div>`;
    } else if (type === 'success' || type === 'translation-success') {
        const isTranslation = type === 'translation-success';
        msgDiv.innerHTML = `
            <div class="success-msg">
                <div class="success-msg-header">
                    <img src="logoCS.png" alt="Success Logo" width="16" height="16" style="border-radius: 2px;">
                    ${text}
                </div>
                ${isTranslation ? '<button class="cancel-translate-btn">Cancel Translation</button>' : ''}
            </div>`;

        if (isTranslation) {
            const cancelBtn = msgDiv.querySelector('.cancel-translate-btn');
            cancelBtn.addEventListener('click', async () => {
                cancelBtn.disabled = true;
                cancelBtn.textContent = 'Reverting...';
                await revertPageText();
                translateLang.value = "";
                await chrome.storage.local.remove(['targetLang', 'langName']);
                addMessage('Translation reverted.', 'ai');
                msgDiv.remove();
            });
        }
    } else {
        const contentDiv = document.createElement('div');
        contentDiv.className = 'msg-content';

        if (sender === 'ai' && typeof marked !== 'undefined' && typeof DOMPurify !== 'undefined') {
            // Render Markdown for AI messages
            const rawHtml = marked.parse(text);
            contentDiv.innerHTML = DOMPurify.sanitize(rawHtml);
        } else {
            // Simple text formatting for user or if marked is missing
            contentDiv.innerText = text;
        }

        msgDiv.appendChild(contentDiv);
    }

    chatContainer.appendChild(msgDiv);
    scrollToBottom();
}

function addTypingIndicator(id) {
    const div = document.createElement('div');
    div.id = id;
    div.className = 'message ai-message typing-indicator';
    div.innerHTML = `
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
    `;
    chatContainer.appendChild(div);
    scrollToBottom();
}

function removeElement(id) {
    const el = document.getElementById(id);
    if (el) el.remove();
}

function scrollToBottom() {
    const mainContent = document.querySelector('.main-content');
    mainContent.scrollTop = mainContent.scrollHeight;
}

// Extension APIs
async function getActiveTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab;
}

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForTabReady(tabId, timeoutMs = 4500) {
    return new Promise((resolve) => {
        let done = false;
        const timer = setTimeout(() => {
            if (!done) {
                done = true;
                chrome.tabs.onUpdated.removeListener(listener);
                resolve();
            }
        }, timeoutMs);

        const listener = (updatedTabId, changeInfo) => {
            if (updatedTabId === tabId && changeInfo.status === 'complete' && !done) {
                done = true;
                clearTimeout(timer);
                chrome.tabs.onUpdated.removeListener(listener);
                resolve();
            }
        };

        chrome.tabs.onUpdated.addListener(listener);
    });
}

async function waitAfterAction(action) {
    if (action === "NAVIGATE") {
        const tab = await getActiveTab();
        if (tab?.id) {
            await waitForTabReady(tab.id);
        } else {
            await delay(1200);
        }
        return;
    }

    if (action === "SCROLL") {
        await delay(180);
        return;
    }

    if (action === "CLICK") {
        await delay(1500); // Increased for stability during redirects/AJAX
        return;
    }

    if (action === "TYPE") {
        await delay(1000); // Allow some time for auto-validation/scripts
        return;
    }

    await delay(500);
}

async function injectContentScriptIfNeeded(tabId) {
    return new Promise((resolve) => {
        chrome.scripting.executeScript({
            target: { tabId: tabId },
            files: ['content.js']
        }, () => {
            if (chrome.runtime.lastError) {
                console.warn("Script injection failed:", chrome.runtime.lastError.message);
                resolve(false);
            } else {
                resolve(true);
            }
        });
    });
}

async function getPageContext() {
    const tab = await getActiveTab();
    if (!tab || !tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
        return { page_content: "Browser internal page - content access restricted.", elements: {}, url: tab ? tab.url : "", title: tab ? tab.title : "" };
    }

    return new Promise((resolve) => {
        chrome.tabs.sendMessage(tab.id, { type: "EXTRACT_CONTEXT" }, async (response) => {
            if (chrome.runtime.lastError) {
                console.warn("Initial context extraction failed:", chrome.runtime.lastError.message, "Attempting injection...");
                const injected = await injectContentScriptIfNeeded(tab.id);
                if (injected) {
                    // Retry once
                    chrome.tabs.sendMessage(tab.id, { type: "EXTRACT_CONTEXT" }, (retryResponse) => {
                        if (chrome.runtime.lastError) {
                            console.warn("Retry failed:", chrome.runtime.lastError.message);
                            resolve({ page_content: "Script injection failed on this page. Try refreshing.", elements: {}, url: tab.url, title: tab.title });
                        } else {
                            resolve({ ...(retryResponse || { page_content: "", elements: {} }), url: tab.url, title: tab.title });
                        }
                    });
                } else {
                    resolve({ page_content: "Script injection pending or blocked.", elements: {}, url: tab.url, title: tab.title });
                }
            } else {
                resolve({ ...(response || { page_content: "", elements: {} }), url: tab.url, title: tab.title });
            }
        });
    });
}

async function getPageTextNodes() {
    const tab = await getActiveTab();
    if (!tab) return null;

    return new Promise((resolve) => {
        chrome.tabs.sendMessage(tab.id, { type: "EXTRACT_TEXT_NODES" }, async (response) => {
            if (chrome.runtime.lastError) {
                console.warn("Initial extract text nodes failed, attempting injection...");
                const injected = await injectContentScriptIfNeeded(tab.id);
                if (injected) {
                    chrome.tabs.sendMessage(tab.id, { type: "EXTRACT_TEXT_NODES" }, (retryResponse) => {
                        resolve(retryResponse ? retryResponse.texts : null);
                    });
                } else {
                    resolve(null);
                }
            } else {
                resolve(response.texts || null);
            }
        });
    });
}

async function executeCommandInPage(command) {
    const tab = await getActiveTab();
    if (!tab) return;

    if (command.action === "NAVIGATE" && command.url) {
        chrome.tabs.update(tab.id, { url: command.url });
        return;
    }

    return new Promise((resolve) => {
        chrome.tabs.sendMessage(tab.id, {
            type: "EXECUTE_COMMAND",
            command: command
        }, async (response) => {
            if (chrome.runtime.lastError) {
                console.warn("Initial execute command error:", chrome.runtime.lastError.message);
                const injected = await injectContentScriptIfNeeded(tab.id);
                if (injected) {
                    chrome.tabs.sendMessage(tab.id, {
                        type: "EXECUTE_COMMAND",
                        command: command
                    }, (retryResponse) => resolve(retryResponse || {}));
                } else {
                    resolve({});
                }
            } else {
                resolve(response || {});
            }
        });
    });
}

async function replacePageTextNodes(translatedTexts) {
    const tab = await getActiveTab();
    if (!tab) return;

    return new Promise((resolve) => {
        chrome.tabs.sendMessage(tab.id, {
            type: "INJECT_TRANSLATION",
            translatedTexts: translatedTexts
        }, async () => {
            if (chrome.runtime.lastError) {
                const injected = await injectContentScriptIfNeeded(tab.id);
                if (injected) {
                    chrome.tabs.sendMessage(tab.id, {
                        type: "INJECT_TRANSLATION",
                        translatedTexts: translatedTexts
                    }, resolve);
                } else {
                    resolve();
                }
            } else {
                resolve();
            }
        });
    });
}

async function revertPageText() {
    const tab = await getActiveTab();
    if (!tab) return;

    return new Promise((resolve) => {
        chrome.tabs.sendMessage(tab.id, { type: "REVERT_TRANSLATION" }, async () => {
            if (chrome.runtime.lastError) {
                const injected = await injectContentScriptIfNeeded(tab.id);
                if (injected) {
                    chrome.tabs.sendMessage(tab.id, { type: "REVERT_TRANSLATION" }, resolve);
                } else {
                    resolve();
                }
            } else {
                resolve();
            }
        });
    });
}

// -------------------------------------------------------------
// Onboarding Guides
// -------------------------------------------------------------
function showOnboardingGuides() {
    const guides = [
        {
            element: document.getElementById('model-select'),
            text: "Select your preferred AI model here.",
            position: 'bottom',
            delay: 500
        },
        {
            element: document.getElementById('translate-lang'),
            text: "Translate the entire page in one click.",
            position: 'bottom',
            delay: 3500
        },
        {
            element: document.getElementById('clear-btn'),
            text: "Clear chat and reset translation.",
            position: 'bottom',
            delay: 6500
        },
        {
            element: document.getElementById('mic-btn'),
            text: "Use your voice to interact.",
            position: 'top',
            delay: 9500
        }
    ];

    const total = guides.length;
    guides.forEach((guide, index) => {
        setTimeout(() => {
            if (!guide.element) return;

            const guideEl = document.createElement('div');
            guideEl.className = `onboarding-guide ${guide.position}`;
            const step = document.createElement('span');
            step.className = 'onboarding-step';
            step.textContent = `Step ${index + 1} / ${total}`;
            const body = document.createElement('div');
            body.textContent = guide.text;
            guideEl.append(step, body);
            document.body.appendChild(guideEl);

            const rect = guide.element.getBoundingClientRect();
            let top, left;

            // The arrow sits ~31px from the tooltip's left edge; offset so it
            // points at the centre of the highlighted control.
            if (guide.position === 'bottom') {
                top = rect.bottom + 13;
                left = rect.left + (rect.width / 2) - 31;
            } else if (guide.position === 'top') {
                top = rect.top - 84;
                left = rect.left + (rect.width / 2) - 31;
            }

            // Constrain to viewport
            left = Math.max(10, Math.min(window.innerWidth - 220, left));

            guideEl.style.top = `${top}px`;
            guideEl.style.left = `${left}px`;

            // Fade in
            setTimeout(() => guideEl.classList.add('show'), 100);

            // Fade out
            setTimeout(() => {
                guideEl.classList.remove('show');
                setTimeout(() => guideEl.remove(), 500);
            }, 3000);

        }, guide.delay);
    });
}

// -------------------------------------------------------------
// Auto-Restore Persistent Translation and Model State logic
// -------------------------------------------------------------
document.addEventListener('DOMContentLoaded', async () => {
    // Show guides on first load
    chrome.storage.local.get(['guidesShown'], (res) => {
        if (!res.guidesShown) {
            showOnboardingGuides();
            chrome.storage.local.set({ guidesShown: true });
        }
    });

    const data = await chrome.storage.local.get(['targetLang', 'langName', 'selectedModel']);
    // ... rest of the code is unchanged ...


    const modelSelect = document.getElementById('model-select');
    if (modelSelect && data.selectedModel) {
        modelSelect.value = data.selectedModel;
    }

    const privateToggle = document.getElementById('private-toggle');
    if (privateToggle) {
        const stored = await chrome.storage.local.get(['preferLocal']);
        await setPreferLocal(!!stored.preferLocal, { persist: false });

        privateToggle.addEventListener('click', async () => {
            await setPreferLocal(!preferLocal);
            addMessage(
                preferLocal
                    ? 'Switched to the on-device model. Nothing leaves this Mac from here on.'
                    : 'Switched to the cloud model. Faster, but the page and screenshots leave the device.',
                'ai',
                'success'
            );
        });
    }

    if (modelSelect) {
        // Initial load
        setTimeout(() => {
            fetchHistory();
            fetchMemory();
            // Closing the side panel destroys every variable in here, so a run
            // that was waiting on an answer has to be picked back up from the
            // checkpoint rather than silently abandoned.
            restoreRun();
        }, 300);

        modelSelect.addEventListener('change', async (e) => {
            await chrome.storage.local.set({ selectedModel: e.target.value });
            updateUploadButtonVisibility(e.target.value);
            fetchHistory();
            fetchMemory();
            addMessage(`Switched AI model to ${e.target.options[e.target.selectedIndex].text}`, "ai", "success");
        });
    }

    if (data.targetLang && data.langName) {
        translateLang.value = data.targetLang;
        addMessage(`Restoring translation to ${data.langName} for this page...`, "ai");
        performTranslation(data.targetLang, data.langName);
    }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete') {
        const activeTab = await getActiveTab();
        // Only trigger translation if the updated tab is the current active tab
        if (activeTab && activeTab.id === tabId) {
            const data = await chrome.storage.local.get(['targetLang', 'langName']);
            if (data.targetLang && data.langName) {
                console.log("Auto-translating new page load to", data.langName);

                // Add minor delay to let complex SPAs attach initial DOM
                setTimeout(() => {
                    performTranslation(data.targetLang, data.langName);
                }, 500);
            }

            // Re-inject loading UI if agent is running
            if (typeof isAgentRunning !== 'undefined' && isAgentRunning) {
                chrome.tabs.sendMessage(tabId, { 
                    type: "TOGGLE_LOADING_UI", 
                    isAgentRunning: true 
                }, () => {
                    if (chrome.runtime.lastError) {
                        // ignore if content script isn't ready
                    }
                });
            }
        }
    }
});

chrome.tabs.onActivated.addListener(async (activeInfo) => {
    // Clear loading UI on all OTHER tabs
    chrome.tabs.query({}, (tabs) => {
        tabs.forEach(tab => {
            if (tab.id !== activeInfo.tabId) {
                chrome.tabs.sendMessage(tab.id, { 
                    type: "TOGGLE_LOADING_UI", 
                    isAgentRunning: false 
                }, () => chrome.runtime.lastError);
            }
        });
    });

    // Re-inject on the new active tab if running
    if (typeof isAgentRunning !== 'undefined' && isAgentRunning) {
        chrome.tabs.sendMessage(activeInfo.tabId, { 
            type: "TOGGLE_LOADING_UI", 
            isAgentRunning: true 
        }, () => chrome.runtime.lastError);
    }
});

// Tab Switching Logic
const tabBtns = document.querySelectorAll('.tab-btn');
const tabPanes = document.querySelectorAll('.tab-pane');

tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        tabBtns.forEach(b => b.classList.remove('active'));
        tabPanes.forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        const targetId = btn.getAttribute('data-target');
        document.getElementById(targetId).classList.add('active');
    });
});

// Activity & Memory Logging
function addActivityLog(type, content) {
    const container = document.getElementById('activity-log');
    if (!container) return;
    const emptyState = container.querySelector('.empty-state');
    if (emptyState) emptyState.remove();

    const item = document.createElement('div');
    item.className = `activity-item type-${type}`;
    const header = document.createElement('div');
    header.className = `activity-header type-${type}`;
    header.textContent = `${type.toUpperCase()} • ${new Date().toLocaleTimeString()}`;

    const body = document.createElement('div');
    body.className = 'activity-body';
    body.textContent = content;

    item.appendChild(header);
    item.appendChild(body);
    container.insertBefore(item, container.firstChild);
}

function addMemoryLog(content) {
    const container = document.getElementById('memory-log');
    if (!container) return;
    const emptyState = container.querySelector('.empty-state');
    if (emptyState) emptyState.remove();

    const item = document.createElement('div');
    item.className = 'memory-item';
    const body = document.createElement('div');
    body.className = 'memory-body';
    body.textContent = content;

    item.appendChild(body);
    container.insertBefore(item, container.firstChild);
}

async function fetchMemory() {
    const modelSelect = document.getElementById('model-select');
    const selectedModel = modelSelect ? modelSelect.value : '';
    if (!selectedModel) return;

    try {
        const response = await fetch(`${BACKEND_URL}/memory?chatflowId=${selectedModel}`, { credentials: 'include' });
        const data = await response.json();
        
        const container = document.getElementById('memory-log');
        if (!container) return;
        
        container.innerHTML = ''; // clear current memory list

        if (data.memory && data.memory.length > 0) {
            // Memory returns newest first, so we just append them.
            data.memory.forEach(item => {
                const itemDiv = document.createElement('div');
                itemDiv.className = 'memory-item';
                const body = document.createElement('div');
                body.className = 'memory-body';
                body.textContent = item.content;
                itemDiv.appendChild(body);
                container.appendChild(itemDiv);
            });
        } else {
            container.innerHTML = `
            <div class="empty-state">
                <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M12 2a10 10 0 100 20 10 10 0 000-20zM12 6v6l4 2" />
                </svg>
                <p>No memory recorded yet</p>
            </div>`;
        }
    } catch(e) {
        console.error("Failed to fetch memory", e);
    }
}

// Call fetchMemory when switching to memory tab or when the agent changes
document.querySelector('[data-target="memory-view"]').addEventListener('click', fetchMemory);
const modelSelect = document.getElementById('model-select');
if (modelSelect) {
    modelSelect.addEventListener('change', fetchMemory);
}

async function fetchHistory() {
    const modelSelect = document.getElementById('model-select');
    const selectedModel = modelSelect ? modelSelect.value : '';
    if (!selectedModel) return;

    try {
        const response = await fetch(`${BACKEND_URL}/history?chatflowId=${selectedModel}`, { credentials: 'include' });
        const data = await response.json();
        
        chatHistory = [];
        
        if (data.history && data.history.length > 0) {
            chatContainer.innerHTML = '';
            data.history.forEach(item => {
                chatHistory.push({
                    role: item.role,
                    content: item.content
                });
                
                // --- Filter out internal agentic engine prompts & responses ---
                if (item.role === 'user' && typeof item.content === 'string' && item.content.includes('What is the next logical action to achieve the USER GOAL?')) {
                    return; // Skip rendering internal user prompt
                }
                
                let renderContent = item.content;
                let renderImages = [];
                // Load images from history if it exists
                if (item.image_data) {
                    renderImages = Array.isArray(item.image_data) ? item.image_data : [item.image_data];
                }

                if ((item.role === 'assistant' || item.role === 'model' || item.role === 'ai') && typeof item.content === 'string') {
                    try {
                        const parsed = JSON.parse(item.content);
                        if (parsed && typeof parsed === 'object' && parsed.action && parsed.action !== 'ANSWER') {
                            return; // Skip rendering raw JSON actions from the model
                        }
                        if (parsed && parsed.action === 'ANSWER' && parsed.text) {
                            renderContent = parsed.text; // Just in case it was saved as full JSON
                        }
                    } catch (e) {
                        // Not JSON, render normally
                    }
                }

                const sender = item.role === 'user' ? 'user' : 'ai';
                addMessage(renderContent, sender, 'history-load', renderImages);
            });
        } else {
            chatContainer.innerHTML = welcomeScreenHTML;
        }
    } catch(e) {
        console.error("Failed to fetch history", e);
    }
}

// Intercept existing message handling to add logs
const originalAddMessage = addMessage;
addMessage = function (text, sender, type = 'normal', images = []) {
    originalAddMessage(text, sender, type, images);
    if (type !== 'history-load') {
        if (sender === 'ai' && type !== 'error') {
            if (text.startsWith('Executing') || text.startsWith('Navigating') || text.startsWith('Typing') || text.startsWith('Reading')) {
                addActivityLog('action', text);
            } else {
                addActivityLog('system', 'Agent generated a response');
            }
        } else if (sender === 'user') {
            addActivityLog('user', 'User sent a message');
        }
    }
}

/* ========================================================================== *
 * Custom select
 *
 * Chrome renders a native <select> popup with the OS chrome, which reads as a
 * foreign object inside a dark panel and cannot be styled. This replaces the
 * popup with our own listbox.
 *
 * The native <select> stays in the DOM as the source of truth — hidden, but
 * still holding the options and the value. Every existing call site keeps
 * working untouched: `.value` reads, `.value =` writes, `innerHTML` repopulation
 * and `change` listeners all behave exactly as before. This skin only mirrors
 * the element and writes back through it.
 * ========================================================================== */

function enhanceSelect(select) {
    if (!select || select.dataset.enhanced === 'true') return;
    select.dataset.enhanced = 'true';

    const wrap = document.createElement('div');
    wrap.className = 'cbx';
    wrap.dataset.variant = select.dataset.variant || 'pill';
    wrap.dataset.align = select.dataset.align || 'start';
    wrap.dataset.drop = select.dataset.drop || 'down';

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'cbx-trigger';
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    if (select.title) trigger.title = select.title;

    const value = document.createElement('span');
    value.className = 'cbx-value';

    const caret = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    caret.setAttribute('class', 'cbx-caret');
    caret.setAttribute('viewBox', '0 0 24 24');
    caret.setAttribute('fill', 'none');
    caret.setAttribute('stroke', 'currentColor');
    caret.setAttribute('stroke-width', '2.5');
    caret.setAttribute('stroke-linecap', 'round');
    caret.setAttribute('stroke-linejoin', 'round');
    const caretPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    caretPath.setAttribute('d', 'M6 9l6 6 6-6');
    caret.appendChild(caretPath);

    trigger.append(value, caret);

    const menu = document.createElement('div');
    menu.className = 'cbx-menu';
    menu.setAttribute('role', 'listbox');
    menu.hidden = true;

    select.parentNode.insertBefore(wrap, select);
    wrap.append(trigger, menu, select);

    // Hidden from both the pointer and the a11y tree — the trigger carries the
    // semantics now, so exposing both would double up in a screen reader.
    select.classList.add('cbx-native');
    select.setAttribute('aria-hidden', 'true');
    select.tabIndex = -1;

    let activeIndex = -1;

    const options = () => Array.from(select.options);

    function paint() {
        const chosen = select.options[select.selectedIndex];
        value.textContent = chosen ? chosen.textContent : '';
        wrap.classList.toggle('is-placeholder', !!chosen && chosen.value === '');
    }

    function build() {
        menu.textContent = '';
        options().forEach((option, index) => {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'cbx-option';
            item.setAttribute('role', 'option');
            item.setAttribute('aria-selected', index === select.selectedIndex ? 'true' : 'false');
            item.dataset.index = String(index);
            item.textContent = option.textContent;
            if (option.disabled) item.disabled = true;
            item.addEventListener('click', () => choose(index));
            menu.appendChild(item);
        });
        paint();
    }

    function choose(index) {
        const option = select.options[index];
        if (!option || option.disabled) return;
        if (select.selectedIndex !== index) {
            select.selectedIndex = index;
            // The whole point: existing listeners must fire as if a person had
            // used the native control.
            select.dispatchEvent(new Event('change', { bubbles: true }));
        }
        paint();
        close();
        trigger.focus();
    }

    function highlight(next) {
        const items = Array.from(menu.querySelectorAll('.cbx-option:not([disabled])'));
        if (!items.length) return;
        const current = items.findIndex((el) => Number(el.dataset.index) === activeIndex);
        let target = current + next;
        if (target < 0) target = items.length - 1;
        if (target >= items.length) target = 0;
        activeIndex = Number(items[target].dataset.index);
        items.forEach((el) => el.classList.toggle('is-active', Number(el.dataset.index) === activeIndex));
        items[target].scrollIntoView({ block: 'nearest' });
    }

    function open() {
        if (!menu.hidden) return;
        build();
        menu.hidden = false;
        wrap.classList.add('is-open');
        trigger.setAttribute('aria-expanded', 'true');
        activeIndex = select.selectedIndex;
        const current = menu.querySelector(`[data-index="${activeIndex}"]`);
        if (current) {
            current.classList.add('is-active');
            current.scrollIntoView({ block: 'nearest' });
        }
        document.addEventListener('pointerdown', onOutside, true);
    }

    function close() {
        if (menu.hidden) return;
        menu.hidden = true;
        wrap.classList.remove('is-open');
        trigger.setAttribute('aria-expanded', 'false');
        document.removeEventListener('pointerdown', onOutside, true);
    }

    function onOutside(event) {
        if (!wrap.contains(event.target)) close();
    }

    trigger.addEventListener('click', () => (menu.hidden ? open() : close()));

    trigger.addEventListener('keydown', (event) => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            if (menu.hidden) open();
            else highlight(event.key === 'ArrowUp' ? -1 : 1);
            return;
        }
        if (event.key === 'Escape') close();
    });

    menu.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            close();
            trigger.focus();
        }
    });

    wrap.addEventListener('focusout', () => {
        // Leaving the whole control closes it; moving between its own parts does not.
        window.setTimeout(() => {
            if (!wrap.contains(document.activeElement)) close();
        }, 0);
    });

    // Options are rebuilt asynchronously (fetchModels rewrites innerHTML).
    new MutationObserver(() => {
        if (menu.hidden) paint();
        else build();
    }).observe(select, { childList: true, subtree: true });

    // `select.value = x` bypasses events, and several call sites restore the
    // saved agent that way. Mirror the write so the trigger cannot go stale.
    const descriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
    if (descriptor) {
        Object.defineProperty(select, 'value', {
            configurable: true,
            get() {
                return descriptor.get.call(this);
            },
            set(next) {
                descriptor.set.call(this, next);
                paint();
            },
        });
    }

    select.addEventListener('change', paint);
    build();
}

document.querySelectorAll('select[data-custom-select]').forEach(enhanceSelect);
