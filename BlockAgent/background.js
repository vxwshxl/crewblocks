// Basic background tasks can be added here
chrome.runtime.onInstalled.addListener(() => {
    console.log("CrewBlocks extension installed");
});

// Allows users to open the side panel by clicking on the action toolbar icon
chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error) => console.error(error));

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === "TOGGLE_BLOCKAGENT" && sender.tab) {
        const tabId = sender.tab.id;
        const windowId = sender.tab.windowId;
        // Always open — Chrome's side panel has its own close button.
        // Trying to track open/close state is unreliable because Chrome
        // does not notify extensions when the user closes the panel via its X button.
        chrome.sidePanel.open({ tabId, windowId })
            .catch((err) => console.warn("sidePanel.open failed:", err));
        sendResponse({ status: "success" });
    }

    if (request.type === "SYNC_BLOCKAGENT") {
        sendResponse({ status: "ok" });
    }

    return true;
});
