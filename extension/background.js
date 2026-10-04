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

browser.contextMenus.onClicked.addListener(async (info, tab) => {
    const rawUrl = info.linkUrl || info.srcUrl || info.pageUrl || info.selectionText || (tab && tab.url);
    if (!rawUrl) {
        console.warn("No valid URL found to download.");
        return;
    }

    const url = rawUrl.trim();

    // Determine the most accurate title available from link text or tab title
    let videoTitle = "";
    if (info.linkUrl && info.linkText && info.linkText.trim().length > 0) {
        videoTitle = info.linkText.trim();
    } else if (info.selectionText && info.selectionText.trim().length > 0) {
        videoTitle = info.selectionText.trim();
    } else if (tab && tab.title) {
        let clean = tab.title
            .replace(/\s*-\s*YouTube\s*$/i, "")
            .replace(/\s*\|\s*Twitch\s*$/i, "")
            .replace(/\s*\/\s*X\s*$/i, "")
            .replace(/\s*-\s*Reddit\s*$/i, "")
            .replace(/\s*on\s*Vimeo\s*$/i, "")
            .trim();
        if (clean.length > 0 && !/^(youtube|twitch|home|feed)$/i.test(clean)) {
            videoTitle = clean;
        }
    }
    if (!videoTitle) {
        videoTitle = url;
    }

    // Load preferences
    let notifyBrowser = true;
    let notifySystem = false;
    let enableOverlay = true;
    try {
        if (browser.storage && browser.storage.local) {
            const prefs = await browser.storage.local.get({
                notifyBrowser: true,
                notifySystem: false,
                enableOverlay: true
            });
            notifyBrowser = prefs.notifyBrowser !== false;
            notifySystem = prefs.notifySystem === true;
            enableOverlay = prefs.enableOverlay !== false;
        }
    } catch (e) {
        console.warn("Could not read preferences:", e);
    }

    // 1. Instant Extension Notification Popup (if enabled)
    if (notifyBrowser && browser.notifications && browser.notifications.create) {
        browser.notifications.create({
            type: "basic",
            iconUrl: "icons/icon-48.png",
            title: "Starting Download",
            message: videoTitle
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
        body: JSON.stringify({ url, title: videoTitle, notify: notifySystem })
    })
    .then(res => res.json().catch(() => res.text()))
    .then(msg => {
        console.log("yt-dlp response:", msg);
        if (enableOverlay && tab && tab.id && msg && msg.job_id) {
            browser.tabs.sendMessage(tab.id, {
                action: "show_progress",
                job_id: msg.job_id,
                title: videoTitle
            }).catch(err => {
                console.debug("Could not send progress to tab:", err);
            });
        }

        // Track completion to display finish notification with full title
        if (notifyBrowser && msg && msg.job_id) {
            trackCompletion(msg.job_id, videoTitle);
        }
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

function trackCompletion(jobId, initialTitle) {
    let attempts = 0;
    const interval = setInterval(async () => {
        attempts++;
        if (attempts > 1800) {
            clearInterval(interval);
            return;
        }
        try {
            const res = await fetch("http://127.0.0.1:16800/downloads");
            if (!res.ok) return;
            const data = await res.json();
            const job = (data.downloads || []).find(d => d.id === jobId);
            if (!job) return;

            if (job.status === "completed") {
                clearInterval(interval);
                const finalTitle = job.title || initialTitle;
                if (browser.notifications && browser.notifications.create) {
                    browser.notifications.create({
                        type: "basic",
                        iconUrl: "icons/icon-48.png",
                        title: "Download Complete",
                        message: finalTitle
                    });
                }
            } else if (job.status === "error" || job.status === "cancelled") {
                clearInterval(interval);
            }
        } catch (e) {
            // Ignore temporary network connection issues
        }
    }, 1500);
}

