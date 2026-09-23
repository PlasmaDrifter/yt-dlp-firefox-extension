function registerContextMenu() {
    browser.contextMenus.removeAll().then(() => {
        browser.contextMenus.create({
            id: "yt-dlp-download",
            title: "Download video with yt-dlp",
            contexts: ["page", "link", "video", "audio", "selection", "frame"],
            icons: {
                "16": "icons/icon-16.png",
                "32": "icons/icon-32.png"
            }
        }, () => {
            if (browser.runtime.lastError) {
                console.warn("Context menu create warning:", browser.runtime.lastError.message);
            }
        });
    }).catch(err => {
        console.warn("Could not remove old context menus:", err);
    });
}

// Register on install, startup, and direct execution
if (browser.runtime.onInstalled) {
    browser.runtime.onInstalled.addListener(registerContextMenu);
}
if (browser.runtime.onStartup) {
    browser.runtime.onStartup.addListener(registerContextMenu);
}
registerContextMenu();

browser.contextMenus.onClicked.addListener((info, tab) => {
    const rawUrl = info.linkUrl || info.srcUrl || info.pageUrl || info.selectionText || (tab && tab.url);
    if (!rawUrl) {
        console.warn("No valid URL found to download.");
        return;
    }

    const url = rawUrl.trim();
    const videoTitle = (tab && tab.title) ? tab.title.replace(" - YouTube", "") : url;

    // 1. Instant Extension Notification Popup
    if (browser.notifications && browser.notifications.create) {
        browser.notifications.create({
            type: "basic",
            iconUrl: "icons/icon-48.png",
            title: "Download with yt-dlp",
            message: `Starting download:\n${videoTitle}`
        });
    }

    // 2. Toolbar Badge Feedback
    if (browser.browserAction && browser.browserAction.setBadgeText) {
        browser.browserAction.setBadgeText({ text: "DL" });
        browser.browserAction.setBadgeBackgroundColor({ color: "#10b981" });
        setTimeout(() => {
            browser.browserAction.setBadgeText({ text: "" });
        }, 4000);
    }

    fetch("http://127.0.0.1:16800/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url })
    })
    .then(res => res.json().catch(() => res.text()))
    .then(msg => {
        console.log("yt-dlp response:", msg);
    })
    .catch(err => {
        console.error("yt-dlp error:", err);
        if (browser.notifications && browser.notifications.create) {
            browser.notifications.create({
                type: "basic",
                iconUrl: "icons/icon-48.png",
                title: "yt-dlp Error",
                message: "Could not connect to local bridge server."
            });
        }
        if (browser.browserAction && browser.browserAction.setBadgeText) {
            browser.browserAction.setBadgeText({ text: "ERR" });
            browser.browserAction.setBadgeBackgroundColor({ color: "#ef4444" });
            setTimeout(() => {
                browser.browserAction.setBadgeText({ text: "" });
            }, 4000);
        }
    });
});

