document.addEventListener('DOMContentLoaded', async () => {
  const browserApi = (typeof browser !== 'undefined' && browser.runtime) ? browser : (typeof chrome !== 'undefined' ? chrome : null);
  const statusCard = document.getElementById('status-card');
  const statusText = document.getElementById('status-text');
  const detectedOsEl = document.getElementById('detected-os');
  const osBadge = document.getElementById('os-badge');
  const btnRefresh = document.getElementById('btn-refresh');
  const destinationEl = document.getElementById('destination-val');
  const toggleOverlay = document.getElementById('toggle-overlay');
  const selectOverlayTimer = document.getElementById('select-overlay-timer');
  const selectPopupTimer = document.getElementById('select-popup-timer');
  const toggleBrowserNotify = document.getElementById('toggle-browser-notify');
  const toggleSystemNotify = document.getElementById('toggle-system-notify');
  const downloadsCard = document.getElementById('downloads-card');
  const downloadsList = document.getElementById('downloads-list');
  const btnClearDownloads = document.getElementById('btn-clear-downloads');

  const tipsLinux = document.getElementById('tips-linux');
  const tipsWin = document.getElementById('tips-win');

  let popupRetentionSeconds = 15;

  // Load preferences
  if (browserApi && browserApi.storage && browserApi.storage.local) {
    browserApi.storage.local.get({
      enableOverlay: true,
      overlayDismissSeconds: 4,
      popupRetentionSeconds: 15,
      notifyBrowser: true,
      notifySystem: false
    }).then(items => {
      if (toggleOverlay) toggleOverlay.checked = items.enableOverlay !== false;
      if (selectOverlayTimer) selectOverlayTimer.value = String(items.overlayDismissSeconds !== undefined ? items.overlayDismissSeconds : 4);
      if (selectPopupTimer) {
        popupRetentionSeconds = items.popupRetentionSeconds !== undefined ? Number(items.popupRetentionSeconds) : 15;
        selectPopupTimer.value = String(popupRetentionSeconds);
      }
      if (toggleBrowserNotify) toggleBrowserNotify.checked = items.notifyBrowser !== false;
      if (toggleSystemNotify) toggleSystemNotify.checked = items.notifySystem === true;
    }).catch(err => {
      console.warn('Could not load preferences:', err);
    });

    if (toggleOverlay) {
      toggleOverlay.addEventListener('change', () => {
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
        updateActiveDownloads();
      });
    }

    if (toggleBrowserNotify) {
      toggleBrowserNotify.addEventListener('change', () => {
        browserApi.storage.local.set({ notifyBrowser: toggleBrowserNotify.checked });
      });
    }

    if (toggleSystemNotify) {
      toggleSystemNotify.addEventListener('change', () => {
        browserApi.storage.local.set({ notifySystem: toggleSystemNotify.checked });
      });
    }
  }

  // Clear all finished downloads button
  if (btnClearDownloads) {
    btnClearDownloads.addEventListener('click', async () => {
      btnClearDownloads.disabled = true;
      btnClearDownloads.textContent = 'Clearing...';
      try {
        await fetch('http://127.0.0.1:16800/clear', { method: 'POST' });
      } catch (e) {
        console.warn('Failed to clear downloads:', e);
      } finally {
        btnClearDownloads.disabled = false;
        btnClearDownloads.textContent = 'Clear All';
        updateActiveDownloads();
      }
    });
  }

  // Detect OS using Firefox WebExtensions API
  let currentOs = 'linux';
  try {
    if (browserApi && browserApi.runtime && browserApi.runtime.getPlatformInfo) {
      const info = await browserApi.runtime.getPlatformInfo();
      if (info && info.os) {
        currentOs = info.os; // 'linux', 'win', etc.
      }
    } else {
      throw new Error('getPlatformInfo not available');
    }
  } catch (err) {
    // Fallback to user agent / navigator
    const ua = (navigator.userAgent || '').toLowerCase();
    const plat = (navigator.platform || '').toLowerCase();
    if (ua.includes('win') || plat.includes('win')) currentOs = 'win';
    else currentOs = 'linux';
  }

  // Configure UI based on detected OS
  function updateOsDisplay(os) {
    if (tipsLinux) tipsLinux.style.display = 'none';
    if (tipsWin) tipsWin.style.display = 'none';

    if (os === 'win') {
      detectedOsEl.textContent = 'Windows (x64)';
      osBadge.textContent = 'Windows';
      if (tipsWin) tipsWin.style.display = 'block';
    } else {
      detectedOsEl.textContent = 'Linux (X11 / Wayland)';
      osBadge.textContent = 'Linux';
      if (tipsLinux) tipsLinux.style.display = 'block';
    }
  }

  updateOsDisplay(currentOs);

  // Check server health
  async function checkServerHealth() {
    btnRefresh.classList.add('spinning');
    statusCard.className = 'status-card';
    statusText.textContent = 'Checking server...';

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);

      const res = await fetch('http://127.0.0.1:16800/health', {
        method: 'GET',
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        statusCard.className = 'status-card online';
        statusText.textContent = 'Server Online (Ready)';
        if (data.platform) {
          if (data.platform.startsWith('win')) detectedOsEl.textContent = 'Windows (Bridge Active)';
          else detectedOsEl.textContent = 'Linux (Bridge Active)';
        }
        if (destinationEl && data.destination) {
          destinationEl.textContent = data.destination;
          destinationEl.title = data.destination;
        }
      } else {
        throw new Error(`Server returned HTTP ${res.status}`);
      }
    } catch (err) {
      statusCard.className = 'status-card offline';
      statusText.textContent = 'Server Offline (Disconnected)';
      if (destinationEl) {
        destinationEl.textContent = '~/Downloads';
        destinationEl.title = '~/Downloads (Default)';
      }
    } finally {
      setTimeout(() => btnRefresh.classList.remove('spinning'), 350);
    }
  }

  // Refresh button
  btnRefresh.addEventListener('click', checkServerHealth);

  // Collapsible Server Status Details
  const toggleStatus = document.getElementById('toggle-status');
  const statusDetails = document.getElementById('status-details');
  const statusChevron = document.getElementById('status-chevron');

  if (toggleStatus && statusDetails) {
    toggleStatus.addEventListener('click', () => {
      const isHidden = statusDetails.style.display === 'none';
      statusDetails.style.display = isHidden ? 'flex' : 'none';
      if (statusChevron) {
        statusChevron.classList.toggle('open', isHidden);
      }
    });
  }

  // Collapsible Troubleshooting Section
  const toggleTips = document.getElementById('toggle-tips');
  const tipsBody = document.getElementById('tips-body');
  const tipsChevron = document.getElementById('tips-chevron');

  if (toggleTips && tipsBody) {
    toggleTips.addEventListener('click', () => {
      const isHidden = tipsBody.style.display === 'none';
      tipsBody.style.display = isHidden ? 'block' : 'none';
      if (tipsChevron) {
        tipsChevron.classList.toggle('open', isHidden);
      }
    });
  }

  // Copy buttons
  document.querySelectorAll('.btn-copy').forEach(btn => {
    btn.addEventListener('click', async () => {
      const textToCopy = btn.getAttribute('data-copy');
      if (textToCopy) {
        try {
          await navigator.clipboard.writeText(textToCopy);
          btn.textContent = 'Copied!';
          btn.classList.add('copied');
          setTimeout(() => {
            btn.textContent = 'Copy';
            btn.classList.remove('copied');
          }, 1600);
        } catch (e) {
          console.error('Failed to copy text:', e);
        }
      }
    });
  });

  // External Links (Open in browser tab)
  document.querySelectorAll('.link-item').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const url = link.getAttribute('href');
      if (url) {
        if (browserApi && browserApi.tabs && browserApi.tabs.create) {
          browserApi.tabs.create({ url });
        } else {
          window.open(url, '_blank');
        }
      }
    });
  });

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // Active Downloads Monitoring
  async function updateActiveDownloads() {
    if (!downloadsCard || !downloadsList) return;
    try {
      const res = await fetch('http://127.0.0.1:16800/downloads');
      if (!res.ok) {
        downloadsCard.style.display = 'none';
        return;
      }
      const data = await res.json();
      const downloads = data.downloads || [];

      // Filter finished downloads by popup retention timer
      const visibleDownloads = downloads.filter(dl => {
        if (dl.status === 'starting' || dl.status === 'downloading' || dl.status === 'merging') {
          return true;
        }
        if (popupRetentionSeconds > 0 && typeof dl.elapsed_since_finished === 'number') {
          return dl.elapsed_since_finished <= popupRetentionSeconds;
        }
        return true;
      });

      if (visibleDownloads.length === 0) {
        downloadsCard.style.display = 'none';
        downloadsList.innerHTML = '';
        return;
      }

      downloadsCard.style.display = 'flex';
      downloadsList.innerHTML = '';

      visibleDownloads.forEach(dl => {
        const item = document.createElement('div');
        item.className = 'download-item';

        let badgeClass = 'download-item-badge';
        let badgeText = (dl.status || 'starting').toUpperCase();
        if (dl.status === 'completed') badgeClass += ' completed';
        else if (dl.status === 'merging') badgeClass += ' merging';
        else if (dl.status === 'cancelled') badgeClass += ' cancelled';
        else if (dl.status === 'error') badgeClass += ' error';

        const percent = dl.percent || (dl.status === 'completed' ? 100 : 0);
        const percentText = typeof percent === 'number' ? percent.toFixed(1) + '%' : '0.0%';

        let statsText = '';
        if (dl.status === 'downloading') {
          const parts = [];
          if (dl.speed) parts.push(dl.speed);
          if (dl.eta) parts.push(`ETA ${dl.eta}`);
          statsText = parts.join(' - ') || 'Downloading...';
        } else if (dl.status === 'merging') {
          statsText = 'Merging / Remuxing';
        } else if (dl.status === 'completed') {
          statsText = dl.size ? `Done (${dl.size})` : 'Done';
        } else if (dl.status === 'cancelled') {
          statsText = 'Cancelled';
        } else {
          statsText = 'Starting...';
        }

        const canCancel = dl.status === 'starting' || dl.status === 'downloading';

        item.innerHTML = `
          <div class="download-item-header">
            <span class="download-item-title" title="${escapeHtml(dl.title || dl.url)}">${escapeHtml(dl.title || dl.url)}</span>
            <span class="${badgeClass}">${badgeText}</span>
          </div>
          <div class="download-item-bar-bg">
            <div class="download-item-bar-fill${dl.status === 'completed' ? ' completed' : ''}" style="width: ${percent}%;"></div>
          </div>
          <div class="download-item-footer">
            <span>${percentText}</span>
            <div style="display: flex; align-items: center; gap: 6px;">
              <span>${escapeHtml(statsText)}</span>
              ${canCancel ? `<button class="btn-cancel-dl" data-id="${dl.id}">Cancel</button>` : ''}
            </div>
          </div>
        `;

        if (canCancel) {
          const cancelBtn = item.querySelector('.btn-cancel-dl');
          if (cancelBtn) {
            cancelBtn.addEventListener('click', async () => {
              cancelBtn.disabled = true;
              cancelBtn.textContent = '...';
              try {
                await fetch('http://127.0.0.1:16800/cancel', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ job_id: dl.id })
                });
                updateActiveDownloads();
              } catch (e) {
                console.warn('Failed to cancel download:', e);
              }
            });
          }
        }

        downloadsList.appendChild(item);
      });
    } catch (e) {
      downloadsCard.style.display = 'none';
    }
  }

  // Initial check
  checkServerHealth();
  updateActiveDownloads();
  const pollInterval = setInterval(updateActiveDownloads, 800);
  window.addEventListener('unload', () => clearInterval(pollInterval));
});

