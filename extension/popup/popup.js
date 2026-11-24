document.addEventListener('DOMContentLoaded', async () => {
  const BRIDGE_BASE = 'http://127.0.0.1:16800';
  const browserApi =
    typeof browser !== 'undefined' && browser.runtime
      ? browser
      : typeof chrome !== 'undefined'
        ? chrome
        : null;

  const versionTag = document.getElementById('version-tag');
  const statusCard = document.getElementById('status-card');
  const statusText = document.getElementById('status-text');
  const bridgeVersionEl = document.getElementById('bridge-version');
  const detectedOsEl = document.getElementById('detected-os');
  const osBadge = document.getElementById('os-badge');
  const btnRefresh = document.getElementById('btn-refresh');
  const btnOpenFolder = document.getElementById('btn-open-folder');
  const destinationEl = document.getElementById('destination-val');

  const quickForm = document.getElementById('quick-download-form');
  const inputUrl = document.getElementById('input-url');
  const selectMode = document.getElementById('select-mode');
  const btnDownloadUrl = document.getElementById('btn-download-url');
  const btnDownloadTab = document.getElementById('btn-download-tab');
  const urlErrorEl = document.getElementById('url-error');

  const toggleOverlay = document.getElementById('toggle-overlay');
  const selectOverlayTimer = document.getElementById('select-overlay-timer');
  const selectPopupTimer = document.getElementById('select-popup-timer');
  const toggleContextSubmenu = document.getElementById('toggle-context-submenu');
  const toggleBrowserNotify = document.getElementById('toggle-browser-notify');
  const toggleSystemNotify = document.getElementById('toggle-system-notify');

  const downloadsCard = document.getElementById('downloads-card');
  const downloadsList = document.getElementById('downloads-list');
  const btnClearDownloads = document.getElementById('btn-clear-downloads');

  const tipsLinux = document.getElementById('tips-linux');
  const tipsWin = document.getElementById('tips-win');
  const tipsMac = document.getElementById('tips-mac');

  let popupRetentionSeconds = 15;
  let urlFieldTouched = false;
  const cardRefsById = new Map();

  // Populate extension version dynamically from manifest
  if (versionTag && browserApi && browserApi.runtime && browserApi.runtime.getManifest) {
    const manifest = browserApi.runtime.getManifest();
    if (manifest && manifest.version) {
      versionTag.textContent = `v${manifest.version}`;
    }
  }

  function syncSwitchAria(input) {
    if (input) {
      input.setAttribute('aria-checked', String(Boolean(input.checked)));
    }
  }

  function validateHttpUrl(raw) {
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

  function showFormError(msg) {
    if (!urlErrorEl) return;
    if (msg) {
      urlErrorEl.textContent = msg;
      urlErrorEl.hidden = false;
      if (inputUrl) inputUrl.setAttribute('aria-invalid', 'true');
    } else {
      urlErrorEl.textContent = '';
      urlErrorEl.hidden = true;
      if (inputUrl) inputUrl.removeAttribute('aria-invalid');
    }
  }

  // Load preferences
  if (browserApi && browserApi.storage && browserApi.storage.local) {
    try {
      const items = await browserApi.storage.local.get({
        enableOverlay: true,
        overlayDismissSeconds: 4,
        popupRetentionSeconds: 15,
        showContextSubmenu: false,
        notifyBrowser: true,
        notifySystem: false,
      });
      if (toggleOverlay) {
        toggleOverlay.checked = items.enableOverlay !== false;
        syncSwitchAria(toggleOverlay);
      }
      if (selectOverlayTimer) {
        selectOverlayTimer.value = String(
          items.overlayDismissSeconds !== undefined ? items.overlayDismissSeconds : 4
        );
      }
      if (selectPopupTimer) {
        popupRetentionSeconds =
          items.popupRetentionSeconds !== undefined ? Number(items.popupRetentionSeconds) : 15;
        selectPopupTimer.value = String(popupRetentionSeconds);
      }
      if (toggleContextSubmenu) {
        toggleContextSubmenu.checked = items.showContextSubmenu === true;
        syncSwitchAria(toggleContextSubmenu);
      }
      if (toggleBrowserNotify) {
        toggleBrowserNotify.checked = items.notifyBrowser !== false;
        syncSwitchAria(toggleBrowserNotify);
      }
      if (toggleSystemNotify) {
        toggleSystemNotify.checked = items.notifySystem === true;
        syncSwitchAria(toggleSystemNotify);
      }
    } catch (err) {
      console.warn('Could not load preferences:', err);
    }

    if (toggleOverlay) {
      toggleOverlay.addEventListener('change', () => {
        syncSwitchAria(toggleOverlay);
        browserApi.storage.local.set({ enableOverlay: toggleOverlay.checked });
      });
    }
    if (selectOverlayTimer) {
      selectOverlayTimer.addEventListener('change', () => {
        browserApi.storage.local.set({ overlayDismissSeconds: Number(selectOverlayTimer.value) });
      });
    }
    if (selectPopupTimer) {
      selectPopupTimer.addEventListener('change', () => {
        popupRetentionSeconds = Number(selectPopupTimer.value);
        browserApi.storage.local.set({ popupRetentionSeconds });
        fetchAndRenderDownloads();
      });
    }
    if (toggleContextSubmenu) {
      toggleContextSubmenu.addEventListener('change', () => {
        syncSwitchAria(toggleContextSubmenu);
        browserApi.storage.local.set({ showContextSubmenu: toggleContextSubmenu.checked });
      });
    }
    if (toggleBrowserNotify) {
      toggleBrowserNotify.addEventListener('change', () => {
        syncSwitchAria(toggleBrowserNotify);
        browserApi.storage.local.set({ notifyBrowser: toggleBrowserNotify.checked });
      });
    }
    if (toggleSystemNotify) {
      toggleSystemNotify.addEventListener('change', () => {
        syncSwitchAria(toggleSystemNotify);
        browserApi.storage.local.set({ notifySystem: toggleSystemNotify.checked });
      });
    }
  }

  // Detect OS via WebExtensions API
  let currentOs = 'linux';
  try {
    if (browserApi && browserApi.runtime && browserApi.runtime.getPlatformInfo) {
      const info = await browserApi.runtime.getPlatformInfo();
      if (info && info.os) {
        currentOs = info.os;
      }
    }
  } catch {
    const ua = (navigator.userAgent || '').toLowerCase();
    if (ua.includes('win')) currentOs = 'win';
    else if (ua.includes('mac')) currentOs = 'mac';
    else currentOs = 'linux';
  }

  function updateOsDisplay(os) {
    if (tipsLinux) tipsLinux.hidden = true;
    if (tipsWin) tipsWin.hidden = true;
    if (tipsMac) tipsMac.hidden = true;

    if (os === 'win') {
      detectedOsEl.textContent = 'Windows (x64)';
      osBadge.textContent = 'Windows';
      if (tipsWin) tipsWin.hidden = false;
    } else if (os === 'mac') {
      detectedOsEl.textContent = 'macOS';
      osBadge.textContent = 'macOS';
      if (tipsMac) tipsMac.hidden = false;
    } else {
      detectedOsEl.textContent = 'Linux (X11 / Wayland)';
      osBadge.textContent = 'Linux';
      if (tipsLinux) tipsLinux.hidden = false;
    }
  }

  updateOsDisplay(currentOs);

  async function checkServerHealth({ showSpinner = true } = {}) {
    if (showSpinner && btnRefresh) {
      btnRefresh.classList.add('spinning');
    }
    try {
      const res = await fetch(`${BRIDGE_BASE}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(2000),
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json().catch(() => ({}));
      if (data.ytdlp_found === false) {
        statusCard.className = 'status-card warning';
        statusText.textContent = 'Bridge Online (yt-dlp missing)';
      } else {
        statusCard.className = 'status-card online';
        statusText.textContent = 'Server Online (Ready)';
      }
      if (bridgeVersionEl) {
        bridgeVersionEl.textContent = data.version ? `v${data.version}` : 'Active';
      }
      if (data.platform) {
        if (data.platform.startsWith('win')) detectedOsEl.textContent = 'Windows (Bridge Active)';
        else if (data.platform === 'darwin') detectedOsEl.textContent = 'macOS (Bridge Active)';
        else detectedOsEl.textContent = 'Linux (Bridge Active)';
      }
      if (destinationEl && data.destination) {
        destinationEl.textContent = data.destination;
        destinationEl.title = data.destination;
      }
    } catch {
      statusCard.className = 'status-card offline';
      statusText.textContent = 'Server Offline (Disconnected)';
      if (bridgeVersionEl) bridgeVersionEl.textContent = '-';
      if (destinationEl) {
        destinationEl.textContent = '~/Downloads';
        destinationEl.title = '~/Downloads (Default)';
      }
    } finally {
      if (showSpinner && btnRefresh) {
        setTimeout(() => btnRefresh.classList.remove('spinning'), 350);
      }
    }
  }

  if (btnRefresh) {
    btnRefresh.addEventListener('click', () => checkServerHealth({ showSpinner: true }));
  }

  if (btnOpenFolder) {
    btnOpenFolder.addEventListener('click', async () => {
      btnOpenFolder.disabled = true;
      try {
        await fetch(`${BRIDGE_BASE}/open-folder`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
          signal: AbortSignal.timeout(3000),
        });
      } catch (err) {
        console.warn('Could not open download folder:', err);
      } finally {
        btnOpenFolder.disabled = false;
      }
    });
  }

  // Quick download form validation (show errors only after blur/submit)
  if (inputUrl) {
    inputUrl.addEventListener('blur', () => {
      urlFieldTouched = true;
      const val = inputUrl.value.trim();
      if (val && !validateHttpUrl(val)) {
        showFormError('Enter a valid http:// or https:// URL.');
      } else {
        showFormError('');
      }
    });

    inputUrl.addEventListener('input', () => {
      if (!urlFieldTouched) return;
      const val = inputUrl.value.trim();
      if (!val || validateHttpUrl(val)) {
        showFormError('');
      }
    });
  }

  async function triggerPopupDownload({ url, title = '', tabId = null }) {
    const mode = selectMode ? selectMode.value : 'default';
    if (btnDownloadUrl) btnDownloadUrl.disabled = true;
    if (btnDownloadTab) btnDownloadTab.disabled = true;
    try {
      const resp = await browserApi.runtime.sendMessage({
        action: 'start_download',
        url,
        title,
        mode,
        tabId,
        showOverlayOnActiveTab: tabId === null,
      });
      if (!resp || !resp.ok) {
        showFormError((resp && resp.error) || 'Failed to start download.');
        return false;
      }
      showFormError('');
      await fetchAndRenderDownloads();
      return true;
    } catch (err) {
      showFormError(err && err.message ? err.message : 'Failed to reach extension background.');
      return false;
    } finally {
      if (btnDownloadUrl) btnDownloadUrl.disabled = false;
      if (btnDownloadTab) btnDownloadTab.disabled = false;
    }
  }

  if (quickForm && inputUrl) {
    quickForm.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      urlFieldTouched = true;
      const validUrl = validateHttpUrl(inputUrl.value);
      if (!validUrl) {
        showFormError('Enter a valid http:// or https:// URL.');
        inputUrl.focus();
        return;
      }
      const ok = await triggerPopupDownload({ url: validUrl });
      if (ok) {
        inputUrl.value = '';
        urlFieldTouched = false;
      }
    });
  }

  if (btnDownloadTab) {
    btnDownloadTab.addEventListener('click', async () => {
      try {
        const tabs = await browserApi.tabs.query({ active: true, currentWindow: true });
        const tab = tabs && tabs[0];
        const validUrl = validateHttpUrl(tab && tab.url);
        if (!validUrl) {
          showFormError('Active tab is not a downloadable http:// or https:// page.');
          return;
        }
        await triggerPopupDownload({
          url: validUrl,
          title: (tab && tab.title) || validUrl,
          tabId: tab && typeof tab.id === 'number' ? tab.id : null,
        });
      } catch {
        showFormError('Could not inspect active tab.');
      }
    });
  }

  // Clear all finished downloads
  if (btnClearDownloads) {
    btnClearDownloads.addEventListener('click', async () => {
      btnClearDownloads.disabled = true;
      btnClearDownloads.textContent = 'Clearing...';
      try {
        await browserApi.runtime.sendMessage({ action: 'clear_downloads' });
      } catch (err) {
        console.warn('Failed to clear downloads:', err);
      } finally {
        btnClearDownloads.disabled = false;
        btnClearDownloads.textContent = 'Clear All';
        fetchAndRenderDownloads();
      }
    });
  }

  // Copy buttons
  document.querySelectorAll('.btn-copy').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const textToCopy = btn.getAttribute('data-copy');
      if (!textToCopy) return;
      try {
        await navigator.clipboard.writeText(textToCopy);
        btn.textContent = 'Copied!';
        btn.classList.add('copied');
        setTimeout(() => {
          btn.textContent = 'Copy';
          btn.classList.remove('copied');
        }, 1600);
      } catch (err) {
        console.error('Failed to copy text:', err);
      }
    });
  });

  // External links
  document.querySelectorAll('.link-item').forEach((link) => {
    link.addEventListener('click', (ev) => {
      ev.preventDefault();
      const url = link.getAttribute('href');
      if (!url) return;
      if (browserApi && browserApi.tabs && browserApi.tabs.create) {
        browserApi.tabs.create({ url });
      } else {
        window.open(url, '_blank');
      }
    });
  });

  function createDownloadCard(dl) {
    const item = document.createElement('div');
    item.className = 'download-item';

    const header = document.createElement('div');
    header.className = 'download-item-header';

    const titleSpan = document.createElement('span');
    titleSpan.className = 'download-item-title';

    const badgeSpan = document.createElement('span');
    badgeSpan.className = 'download-item-badge';

    header.appendChild(titleSpan);
    header.appendChild(badgeSpan);

    const progress = document.createElement('progress');
    progress.className = 'download-progress';
    progress.max = 100;

    const footer = document.createElement('div');
    footer.className = 'download-item-footer';

    const percentSpan = document.createElement('span');

    const footerRight = document.createElement('div');
    footerRight.className = 'download-item-footer-right';

    const statsSpan = document.createElement('span');
    statsSpan.className = 'download-item-stats';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'btn-cancel-dl';
    cancelBtn.textContent = 'Cancel';

    const retryBtn = document.createElement('button');
    retryBtn.type = 'button';
    retryBtn.className = 'btn-retry-dl';
    retryBtn.textContent = 'Retry';

    const dismissBtn = document.createElement('button');
    dismissBtn.type = 'button';
    dismissBtn.className = 'btn-dismiss-dl';
    dismissBtn.title = 'Dismiss';
    dismissBtn.setAttribute('aria-label', 'Dismiss finished download');
    dismissBtn.textContent = '×';

    const refs = {
      item,
      titleSpan,
      badgeSpan,
      progress,
      percentSpan,
      statsSpan,
      cancelBtn,
      retryBtn,
      dismissBtn,
      currentDl: dl,
    };

    cancelBtn.addEventListener('click', async () => {
      cancelBtn.disabled = true;
      cancelBtn.textContent = '...';
      try {
        await browserApi.runtime.sendMessage({
          action: 'cancel_job',
          job_id: refs.currentDl.id,
        });
        fetchAndRenderDownloads();
      } catch (err) {
        console.warn('Failed to cancel download:', err);
      }
    });

    retryBtn.addEventListener('click', async () => {
      retryBtn.disabled = true;
      await browserApi.runtime.sendMessage({
        action: 'start_download',
        url: refs.currentDl.url,
        title: refs.currentDl.title,
        mode: refs.currentDl.mode || 'default',
        showOverlayOnActiveTab: true,
      });
      retryBtn.disabled = false;
      fetchAndRenderDownloads();
    });

    dismissBtn.addEventListener('click', async () => {
      dismissBtn.disabled = true;
      await browserApi.runtime.sendMessage({
        action: 'clear_downloads',
        job_id: refs.currentDl.id,
      });
      fetchAndRenderDownloads();
    });

    footerRight.appendChild(statsSpan);
    footerRight.appendChild(cancelBtn);
    footerRight.appendChild(retryBtn);
    footerRight.appendChild(dismissBtn);

    footer.appendChild(percentSpan);
    footer.appendChild(footerRight);

    item.appendChild(header);
    item.appendChild(progress);
    item.appendChild(footer);

    return refs;
  }

  function updateDownloadCard(refs, dl) {
    refs.currentDl = dl;
    const displayTitle = dl.title || dl.url || '';
    refs.titleSpan.textContent = displayTitle;
    refs.titleSpan.title = displayTitle;

    const status = dl.status || 'starting';
    let badgeClass = 'download-item-badge';
    if (status === 'completed') badgeClass += ' completed';
    else if (status === 'merging') badgeClass += ' merging';
    else if (status === 'cancelled') badgeClass += ' cancelled';
    else if (status === 'error') badgeClass += ' error';
    refs.badgeSpan.className = badgeClass;
    refs.badgeSpan.textContent = status.toUpperCase();

    const pct = typeof dl.percent === 'number' ? dl.percent : status === 'completed' ? 100 : 0;
    if (status === 'starting' || status === 'merging' || (status === 'downloading' && pct <= 0)) {
      refs.progress.removeAttribute('value');
    } else {
      refs.progress.value = pct;
    }

    let progressClass = 'download-progress';
    if (status === 'completed') progressClass += ' completed';
    else if (status === 'error') progressClass += ' error';
    refs.progress.className = progressClass;

    refs.percentSpan.textContent =
      status === 'merging'
        ? 'Post-processing'
        : typeof pct === 'number'
          ? `${pct.toFixed(1)}%`
          : '0.0%';

    let statsText = 'Starting...';
    if (status === 'downloading') {
      const parts = [];
      if (dl.speed) parts.push(dl.speed);
      if (dl.eta) parts.push(`ETA ${dl.eta}`);
      statsText = parts.join(' - ') || dl.size || 'Downloading...';
    } else if (status === 'merging') {
      statsText = 'Merging / Remuxing';
    } else if (status === 'completed') {
      statsText = dl.size ? `Done (${dl.size})` : 'Done';
    } else if (status === 'cancelled') {
      statsText = 'Cancelled';
    } else if (status === 'error') {
      statsText = dl.error || 'Download failed';
    }
    refs.statsSpan.textContent = statsText;
    refs.statsSpan.title = statsText;

    const isActive = status === 'starting' || status === 'downloading' || status === 'merging';
    const isTerminal = status === 'completed' || status === 'cancelled' || status === 'error';
    const canRetry = status === 'cancelled' || status === 'error';

    if (isActive && refs.cancelBtn.textContent === '...' && status !== 'cancelled') {
      refs.cancelBtn.disabled = false;
      refs.cancelBtn.textContent = 'Cancel';
    }
    refs.cancelBtn.hidden = !isActive;
    refs.retryBtn.hidden = !canRetry;
    refs.dismissBtn.hidden = !isTerminal;
  }

  function renderDownloads(downloads) {
    if (!downloadsCard || !downloadsList) return;
    const list = Array.isArray(downloads) ? downloads : [];

    const visibleDownloads = list.filter((dl) => {
      if (dl.status === 'starting' || dl.status === 'downloading' || dl.status === 'merging') {
        return true;
      }
      if (popupRetentionSeconds > 0 && typeof dl.elapsed_since_finished === 'number') {
        return dl.elapsed_since_finished <= popupRetentionSeconds;
      }
      return true;
    });

    if (visibleDownloads.length === 0) {
      downloadsCard.hidden = true;
      cardRefsById.clear();
      downloadsList.replaceChildren();
      return;
    }

    downloadsCard.hidden = false;
    const visibleIds = new Set(visibleDownloads.map((dl) => dl.id));

    for (const [id, refs] of cardRefsById.entries()) {
      if (!visibleIds.has(id)) {
        refs.item.remove();
        cardRefsById.delete(id);
      }
    }

    const orderedNodes = visibleDownloads.map((dl) => {
      let refs = cardRefsById.get(dl.id);
      if (!refs) {
        refs = createDownloadCard(dl);
        cardRefsById.set(dl.id, refs);
      }
      updateDownloadCard(refs, dl);
      return refs.item;
    });

    // Update order only when card set or sequence changes, preserving hover/focus on stable cards
    const currentChildren = Array.from(downloadsList.children);
    const sameOrder =
      currentChildren.length === orderedNodes.length &&
      currentChildren.every((el, idx) => el === orderedNodes[idx]);
    if (!sameOrder) {
      downloadsList.replaceChildren(...orderedNodes);
    }
  }

  async function fetchAndRenderDownloads() {
    if (!downloadsCard || !downloadsList) return;
    try {
      const res = await fetch(`${BRIDGE_BASE}/downloads`, {
        signal: AbortSignal.timeout(2000),
      });
      if (!res.ok) {
        renderDownloads([]);
        return;
      }
      const data = await res.json();
      renderDownloads(data.downloads || []);
      if (statusCard.classList.contains('offline')) {
        checkServerHealth({ showSpinner: false });
      }
    } catch {
      renderDownloads([]);
      if (!statusCard.classList.contains('offline')) {
        checkServerHealth({ showSpinner: false });
      }
    }
  }

  if (browserApi && browserApi.runtime && browserApi.runtime.onMessage) {
    browserApi.runtime.onMessage.addListener((message) => {
      if (message && message.action === 'downloads_update') {
        renderDownloads(message.downloads || []);
      }
    });
  }

  // Initial checks & live refresh while popup is open
  checkServerHealth({ showSpinner: true });
  fetchAndRenderDownloads();
  const pollInterval = setInterval(fetchAndRenderDownloads, 1000);
  window.addEventListener('pagehide', () => clearInterval(pollInterval));
});
