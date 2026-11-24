const BRIDGE_BASE = 'http://127.0.0.1:16800';
const POLL_INTERVAL_MS = 800;
const MAX_CONSECUTIVE_FETCH_ERRORS = 10;
const MAX_MISSING_JOB_TICKS = 5;

const MODE_BY_MENU_ID = {
  'yt-dlp-download': 'default',
  'yt-dlp-mode-default': 'default',
  'yt-dlp-mode-audio': 'audio',
  'yt-dlp-mode-single': 'single',
  'yt-dlp-mode-playlist': 'playlist',
  'yt-dlp-mode-page': 'default',
};

const trackedJobs = new Map();
const activeHudTabs = new Set();
let pollTimerId = null;
let pollInFlight = false;
let consecutiveFetchErrors = 0;
let badgeTimerId = null;
let menuRegisterQueue = Promise.resolve();

async function getPrefs() {
  try {
    if (browser.storage && browser.storage.local) {
      const prefs = await browser.storage.local.get({
        notifyBrowser: true,
        notifySystem: false,
        enableOverlay: true,
        overlayDismissSeconds: 4,
        popupRetentionSeconds: 15,
        showContextSubmenu: false,
      });
      return {
        notifyBrowser: prefs.notifyBrowser !== false,
        notifySystem: prefs.notifySystem === true,
        enableOverlay: prefs.enableOverlay !== false,
        overlayDismissSeconds:
          typeof prefs.overlayDismissSeconds === 'number' ? prefs.overlayDismissSeconds : 4,
        popupRetentionSeconds:
          typeof prefs.popupRetentionSeconds === 'number' ? prefs.popupRetentionSeconds : 15,
        showContextSubmenu: prefs.showContextSubmenu === true,
      };
    }
  } catch (err) {
    console.warn('Could not read preferences:', err);
  }
  return {
    notifyBrowser: true,
    notifySystem: false,
    enableOverlay: true,
    overlayDismissSeconds: 4,
    popupRetentionSeconds: 15,
    showContextSubmenu: false,
  };
}

function createMenuItem(props) {
  return new Promise((resolve) => {
    browser.contextMenus.create(props, () => {
      if (browser.runtime.lastError) {
        console.warn('Context menu warning:', browser.runtime.lastError.message);
      }
      resolve();
    });
  });
}

function registerContextMenu() {
  menuRegisterQueue = menuRegisterQueue.then(async () => {
    try {
      await browser.contextMenus.removeAll();
      const prefs = await getPrefs();
      const allContexts = ['page', 'link', 'video', 'audio', 'selection', 'frame'];
      const icons = {
        16: 'icons/icon-16.png',
        32: 'icons/icon-32.png',
      };

      if (!prefs.showContextSubmenu) {
        await createMenuItem({
          id: 'yt-dlp-download',
          title: 'Download video with yt-dlp',
          contexts: allContexts,
          icons,
        });
        return;
      }

      await createMenuItem({
        id: 'yt-dlp-root',
        title: 'Download with yt-dlp',
        contexts: allContexts,
        icons,
      });
      await createMenuItem({
        id: 'yt-dlp-mode-default',
        parentId: 'yt-dlp-root',
        title: 'Best Video (Default)',
        contexts: allContexts,
      });
      await createMenuItem({
        id: 'yt-dlp-mode-audio',
        parentId: 'yt-dlp-root',
        title: 'Audio Only',
        contexts: allContexts,
      });
      await createMenuItem({
        id: 'yt-dlp-mode-single',
        parentId: 'yt-dlp-root',
        title: 'Single Video (No Playlist)',
        contexts: allContexts,
      });
      await createMenuItem({
        id: 'yt-dlp-mode-playlist',
        parentId: 'yt-dlp-root',
        title: 'Playlist',
        contexts: allContexts,
      });
      await createMenuItem({
        id: 'yt-dlp-mode-page',
        parentId: 'yt-dlp-root',
        title: 'Download Page URL',
        contexts: ['link', 'video', 'audio', 'selection', 'frame'],
      });
    } catch (err) {
      console.warn('Could not rebuild context menus:', err);
    }
  });
  return menuRegisterQueue;
}

if (browser.runtime.onInstalled) {
  browser.runtime.onInstalled.addListener(() => {
    registerContextMenu();
  });
}
if (browser.runtime.onStartup) {
  browser.runtime.onStartup.addListener(() => {
    registerContextMenu();
  });
}
if (browser.storage && browser.storage.onChanged) {
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.showContextSubmenu) {
      registerContextMenu();
    }
  });
}
registerContextMenu();

function isSupportedHttpUrl(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.href;
    }
  } catch {
    return null;
  }
  return null;
}

function cleanPageTitle(rawTitle) {
  if (!rawTitle || typeof rawTitle !== 'string') return '';
  const cleaned = rawTitle
    .replace(/\s*-\s*YouTube\s*$/i, '')
    .replace(/\s*\|\s*Twitch\s*$/i, '')
    .replace(/\s*\/\s*X\s*$/i, '')
    .replace(/\s*-\s*Reddit\s*$/i, '')
    .replace(/\s*on\s*Vimeo\s*$/i, '')
    .trim();
  if (cleaned.length > 0 && !/^(youtube|twitch|home|feed)$/i.test(cleaned)) {
    return cleaned;
  }
  return '';
}

function resolveContextTarget(info, tab) {
  if (info.menuItemId === 'yt-dlp-mode-page') {
    return isSupportedHttpUrl(info.pageUrl) || isSupportedHttpUrl(tab && tab.url);
  }
  return (
    isSupportedHttpUrl(info.linkUrl) ||
    isSupportedHttpUrl(info.srcUrl) ||
    isSupportedHttpUrl(info.pageUrl) ||
    isSupportedHttpUrl(info.selectionText) ||
    isSupportedHttpUrl(tab && tab.url)
  );
}

function resolveContextTitle(info, tab, targetUrl) {
  if (info.menuItemId !== 'yt-dlp-mode-page') {
    if (info.linkUrl && info.linkText && info.linkText.trim().length > 0) {
      return info.linkText.trim();
    }
    if (
      info.selectionText &&
      info.selectionText.trim().length > 0 &&
      !isSupportedHttpUrl(info.selectionText)
    ) {
      return info.selectionText.trim();
    }
  }
  const cleanedTabTitle = cleanPageTitle(tab && tab.title);
  return cleanedTabTitle || targetUrl;
}

function setToolbarBadge(text, color, autoClearMs = 0) {
  if (!browser.browserAction || !browser.browserAction.setBadgeText) return;
  if (badgeTimerId) {
    clearTimeout(badgeTimerId);
    badgeTimerId = null;
  }
  browser.browserAction.setBadgeText({ text });
  if (color && browser.browserAction.setBadgeBackgroundColor) {
    browser.browserAction.setBadgeBackgroundColor({ color });
  }
  if (autoClearMs > 0) {
    badgeTimerId = setTimeout(() => {
      badgeTimerId = null;
      const activeCount = countActiveTrackedJobs();
      if (activeCount > 0) {
        browser.browserAction.setBadgeText({ text: String(activeCount) });
        browser.browserAction.setBadgeBackgroundColor({ color: '#10b981' });
      } else {
        browser.browserAction.setBadgeText({ text: '' });
      }
    }, autoClearMs);
  }
}

function countActiveTrackedJobs() {
  return trackedJobs.size;
}

function notifyUser(title, message) {
  if (!browser.notifications || !browser.notifications.create) return;
  browser.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon-48.png',
    title,
    message,
  });
}

async function deliverToTabHud(tabId, payload) {
  if (!tabId) return;
  try {
    await browser.tabs.sendMessage(tabId, payload);
    activeHudTabs.add(tabId);
    return;
  } catch {
    // Content script not injected into this tab yet; inject CSS + JS on demand
  }
  try {
    await browser.tabs.insertCSS(tabId, { file: 'content/overlay.css' });
    await browser.tabs.executeScript(tabId, { file: 'content/overlay.js' });
    await browser.tabs.sendMessage(tabId, payload);
    activeHudTabs.add(tabId);
  } catch (err) {
    console.debug('Could not inject or message HUD on tab:', err);
  }
}

async function broadcastUpdates(downloads) {
  if (activeHudTabs.size > 0) {
    const staleTabs = [];
    await Promise.all(
      Array.from(activeHudTabs).map(async (tabId) => {
        try {
          await browser.tabs.sendMessage(tabId, {
            action: 'downloads_update',
            downloads,
          });
        } catch {
          staleTabs.push(tabId);
        }
      })
    );
    for (const tabId of staleTabs) {
      activeHudTabs.delete(tabId);
    }
  }
  try {
    await browser.runtime.sendMessage({
      action: 'downloads_update',
      downloads,
    });
  } catch {
    // Popup is closed
  }
}

function ensurePolling() {
  if (pollTimerId !== null) return;
  pollTimerId = setInterval(() => {
    pollDownloads();
  }, POLL_INTERVAL_MS);
}

function stopPolling() {
  if (pollTimerId !== null) {
    clearInterval(pollTimerId);
    pollTimerId = null;
  }
}

async function pollDownloads() {
  if (trackedJobs.size === 0 && activeHudTabs.size === 0) {
    stopPolling();
    return;
  }
  if (pollInFlight) return;
  pollInFlight = true;

  try {
    const res = await fetch(`${BRIDGE_BASE}/downloads`, {
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const data = await res.json();
    const downloads = Array.isArray(data.downloads) ? data.downloads : [];
    consecutiveFetchErrors = 0;

    const byId = new Map(downloads.map((dl) => [dl.id, dl]));
    const prefs = await getPrefs();

    for (const [jobId, tracked] of trackedJobs.entries()) {
      const dl = byId.get(jobId);
      if (!dl) {
        tracked.missingCount += 1;
        if (tracked.missingCount >= MAX_MISSING_JOB_TICKS) {
          trackedJobs.delete(jobId);
        }
        continue;
      }

      tracked.missingCount = 0;
      const finalTitle = dl.title || tracked.title;

      if (dl.status === 'completed') {
        if (prefs.notifyBrowser) {
          notifyUser('Download Complete', finalTitle);
        }
        trackedJobs.delete(jobId);
      } else if (dl.status === 'error') {
        if (prefs.notifyBrowser) {
          const detail = dl.error ? `${finalTitle}\n${dl.error}` : finalTitle;
          notifyUser('Download Failed', detail);
        }
        setToolbarBadge('ERR', '#ef4444', 4000);
        trackedJobs.delete(jobId);
      } else if (dl.status === 'cancelled') {
        trackedJobs.delete(jobId);
      }
    }

    if (!badgeTimerId) {
      const remaining = trackedJobs.size;
      if (remaining > 0) {
        setToolbarBadge(String(remaining), '#10b981', 0);
      } else if (browser.browserAction && browser.browserAction.setBadgeText) {
        browser.browserAction.setBadgeText({ text: '' });
      }
    }

    await broadcastUpdates(downloads);

    if (trackedJobs.size === 0 && activeHudTabs.size === 0) {
      stopPolling();
    }
  } catch {
    consecutiveFetchErrors += 1;
    if (consecutiveFetchErrors >= MAX_CONSECUTIVE_FETCH_ERRORS) {
      trackedJobs.clear();
      await broadcastUpdates([]);
      activeHudTabs.clear();
      stopPolling();
    }
  } finally {
    pollInFlight = false;
  }
}

async function startDownload({ url, title = '', mode = 'default', tabId = null }) {
  const validUrl = isSupportedHttpUrl(url);
  if (!validUrl) {
    notifyUser('yt-dlp Error', 'No valid HTTP or HTTPS URL found to download.');
    setToolbarBadge('ERR', '#ef4444', 4000);
    return { ok: false, error: 'Invalid HTTP/HTTPS URL' };
  }

  const videoTitle = (typeof title === 'string' && title.trim()) || validUrl;
  const prefs = await getPrefs();

  if (prefs.notifyBrowser) {
    notifyUser('Starting Download', videoTitle);
  }
  setToolbarBadge('DL', '#10b981', 3500);

  try {
    const res = await fetch(`${BRIDGE_BASE}/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: validUrl,
        title: videoTitle,
        mode,
        notify: prefs.notifySystem,
      }),
      signal: AbortSignal.timeout(8000),
    });

    const msg = await res.json().catch(() => ({}));
    if (!res.ok || !msg || !msg.job_id) {
      const errDetail = (msg && msg.error) || `Bridge returned HTTP ${res.status}`;
      notifyUser('yt-dlp Error', errDetail);
      setToolbarBadge('ERR', '#ef4444', 4000);
      return { ok: false, error: errDetail };
    }

    trackedJobs.set(msg.job_id, {
      title: videoTitle,
      missingCount: 0,
    });
    consecutiveFetchErrors = 0;

    if (prefs.enableOverlay && tabId !== null) {
      await deliverToTabHud(tabId, {
        action: 'show_progress',
        job_id: msg.job_id,
        title: videoTitle,
        overlayDismissSeconds: prefs.overlayDismissSeconds,
      });
    }

    ensurePolling();
    pollDownloads();
    return { ok: true, job_id: msg.job_id };
  } catch (err) {
    console.error('yt-dlp bridge error:', err);
    notifyUser('yt-dlp Error', 'Could not connect to local bridge server.');
    setToolbarBadge('ERR', '#ef4444', 4000);
    return { ok: false, error: 'Could not connect to local bridge server.' };
  }
}

browser.contextMenus.onClicked.addListener(async (info, tab) => {
  const mode = MODE_BY_MENU_ID[info.menuItemId] || 'default';
  const targetUrl = resolveContextTarget(info, tab);
  if (!targetUrl) {
    notifyUser('yt-dlp Error', 'No valid HTTP or HTTPS video URL found here.');
    setToolbarBadge('ERR', '#ef4444', 4000);
    return;
  }
  const title = resolveContextTitle(info, tab, targetUrl);
  await startDownload({
    url: targetUrl,
    title,
    mode,
    tabId: tab && typeof tab.id === 'number' ? tab.id : null,
  });
});

browser.runtime.onMessage.addListener((message, sender) => {
  if (!message || typeof message !== 'object') return undefined;

  if (message.action === 'start_download') {
    return (async () => {
      let targetTabId = typeof message.tabId === 'number' ? message.tabId : null;
      if (targetTabId === null && message.showOverlayOnActiveTab) {
        const tabs = await browser.tabs.query({ active: true, currentWindow: true });
        if (tabs[0] && typeof tabs[0].id === 'number') {
          targetTabId = tabs[0].id;
        }
      }
      return startDownload({
        url: message.url,
        title: message.title || '',
        mode: message.mode || 'default',
        tabId: targetTabId,
      });
    })();
  }

  if (message.action === 'cancel_job') {
    return (async () => {
      try {
        const res = await fetch(`${BRIDGE_BASE}/cancel`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ job_id: message.job_id }),
          signal: AbortSignal.timeout(4000),
        });
        const data = await res.json().catch(() => ({}));
        pollDownloads();
        return { ok: res.ok, data };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    })();
  }

  if (message.action === 'clear_downloads') {
    return (async () => {
      try {
        const res = await fetch(`${BRIDGE_BASE}/clear`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(message.job_id ? { job_id: message.job_id } : {}),
          signal: AbortSignal.timeout(4000),
        });
        const data = await res.json().catch(() => ({}));
        pollDownloads();
        return { ok: res.ok, data };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    })();
  }

  if (message.action === 'hud_empty') {
    if (sender && sender.tab && typeof sender.tab.id === 'number') {
      activeHudTabs.delete(sender.tab.id);
      if (trackedJobs.size === 0 && activeHudTabs.size === 0) {
        stopPolling();
      }
    }
    return undefined;
  }

  return undefined;
});
