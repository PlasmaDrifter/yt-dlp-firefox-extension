(() => {
  // Ensure we don't inject multiple times
  if (window.__yt_dlp_hud_injected) return;
  window.__yt_dlp_hud_injected = true;

  const browserApi = (typeof browser !== 'undefined' && browser.runtime) ? browser : (typeof chrome !== 'undefined' ? chrome : null);
  if (!browserApi) return;

  let hudContainer = null;
  const activeCards = new Map();
  let pollIntervalId = null;
  let overlayDismissSeconds = 4;

  if (browserApi.storage && browserApi.storage.local) {
    browserApi.storage.local.get({ overlayDismissSeconds: 4 }).then(res => {
      if (typeof res.overlayDismissSeconds === 'number') {
        overlayDismissSeconds = res.overlayDismissSeconds;
      }
    }).catch(() => {});
    if (browserApi.storage.onChanged) {
      browserApi.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes.overlayDismissSeconds) {
          overlayDismissSeconds = Number(changes.overlayDismissSeconds.newValue);
        }
      });
    }
  }

  function ensureContainer() {
    if (!hudContainer || !document.body.contains(hudContainer)) {
      hudContainer = document.getElementById('yt-dlp-hud-container');
      if (!hudContainer) {
        hudContainer = document.createElement('div');
        hudContainer.id = 'yt-dlp-hud-container';
        document.body.appendChild(hudContainer);
      }
    }
    return hudContainer;
  }

  function formatPercent(pct) {
    if (typeof pct === 'number') {
      return pct.toFixed(1) + '%';
    }
    return '0.0%';
  }

  function createJobCard(jobId, title) {
    const container = ensureContainer();
    if (activeCards.has(jobId)) {
      return activeCards.get(jobId).element;
    }

    const card = document.createElement('div');
    card.className = 'yt-dlp-hud-card';
    card.id = `yt-dlp-hud-${jobId}`;

    const displayTitle = title || 'Downloading video...';

    // 1. Header
    const header = document.createElement('div');
    header.className = 'yt-dlp-hud-header';

    const titleEl = document.createElement('span');
    titleEl.className = 'yt-dlp-hud-title';
    titleEl.title = displayTitle;
    titleEl.textContent = displayTitle;

    const badge = document.createElement('span');
    badge.className = 'yt-dlp-hud-badge';
    badge.id = `badge-${jobId}`;
    badge.textContent = 'STARTING';

    const closeBtn = document.createElement('button');
    closeBtn.className = 'yt-dlp-hud-close';
    closeBtn.id = `close-${jobId}`;
    closeBtn.title = 'Dismiss';
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', () => removeCard(jobId));

    header.appendChild(titleEl);
    header.appendChild(badge);
    header.appendChild(closeBtn);

    // 2. Progress Bar
    const barBg = document.createElement('div');
    barBg.className = 'yt-dlp-hud-bar-bg';

    const barFill = document.createElement('div');
    barFill.className = 'yt-dlp-hud-bar-fill';
    barFill.id = `bar-${jobId}`;
    barFill.style.width = '0%';
    barBg.appendChild(barFill);

    // 3. Stats Row
    const stats = document.createElement('div');
    stats.className = 'yt-dlp-hud-stats';

    const statsLeft = document.createElement('span');
    statsLeft.id = `stats-left-${jobId}`;
    statsLeft.textContent = '0.0%';

    const statsRightWrapper = document.createElement('div');
    statsRightWrapper.style.display = 'flex';
    statsRightWrapper.style.alignItems = 'center';
    statsRightWrapper.style.gap = '8px';

    const statsRight = document.createElement('span');
    statsRight.id = `stats-right-${jobId}`;
    statsRight.textContent = 'Connecting...';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'yt-dlp-hud-btn-cancel';
    cancelBtn.id = `cancel-${jobId}`;
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => cancelJob(jobId));

    statsRightWrapper.appendChild(statsRight);
    statsRightWrapper.appendChild(cancelBtn);

    stats.appendChild(statsLeft);
    stats.appendChild(statsRightWrapper);

    card.appendChild(header);
    card.appendChild(barBg);
    card.appendChild(stats);

    container.appendChild(card);

    activeCards.set(jobId, {
      element: card,
      title: displayTitle,
      status: 'starting',
      removeTimeout: null
    });

    startPolling();
    return card;
  }

  function removeCard(jobId) {
    const item = activeCards.get(jobId);
    if (!item) return;

    if (item.removeTimeout) {
      clearTimeout(item.removeTimeout);
    }

    item.element.style.opacity = '0';
    item.element.style.transform = 'translateY(10px)';

    setTimeout(() => {
      if (item.element.parentNode) {
        item.element.parentNode.removeChild(item.element);
      }
      activeCards.delete(jobId);
      if (activeCards.size === 0) {
        stopPolling();
      }
    }, 300);
  }

  async function cancelJob(jobId) {
    const cancelBtn = document.getElementById(`cancel-${jobId}`);
    if (cancelBtn) {
      cancelBtn.disabled = true;
      cancelBtn.textContent = '...';
    }

    try {
      await fetch('http://127.0.0.1:16800/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_id: jobId })
      });
    } catch (e) {
      console.warn('[yt-dlp-hud] Failed to cancel job:', e);
    }
  }

  function startPolling() {
    if (pollIntervalId) return;
    pollDownloads();
    pollIntervalId = setInterval(pollDownloads, 750);
  }

  function stopPolling() {
    if (pollIntervalId) {
      clearInterval(pollIntervalId);
      pollIntervalId = null;
    }
  }

  async function pollDownloads() {
    if (activeCards.size === 0) {
      stopPolling();
      return;
    }

    try {
      const res = await fetch('http://127.0.0.1:16800/downloads');
      if (!res.ok) return;

      const data = await res.json();
      const downloads = data.downloads || [];
      const downloadsMap = new Map();
      downloads.forEach(dl => downloadsMap.set(dl.id, dl));

      for (const [jobId, item] of activeCards.entries()) {
        const dl = downloadsMap.get(jobId);
        if (!dl) continue;

        if (dl.title && item.title !== dl.title) {
          item.title = dl.title;
          const titleEl = item.element.querySelector('.yt-dlp-hud-title');
          if (titleEl) {
            titleEl.textContent = dl.title;
            titleEl.title = dl.title;
          }
        }

        const badge = document.getElementById(`badge-${jobId}`);
        const bar = document.getElementById(`bar-${jobId}`);
        const statsLeft = document.getElementById(`stats-left-${jobId}`);
        const statsRight = document.getElementById(`stats-right-${jobId}`);
        const cancelBtn = document.getElementById(`cancel-${jobId}`);

        if (dl.status === 'downloading') {
          if (badge) {
            badge.className = 'yt-dlp-hud-badge';
            badge.textContent = 'DOWNLOADING';
          }
          if (bar) {
            bar.className = 'yt-dlp-hud-bar-fill';
            bar.style.width = `${dl.percent || 0}%`;
          }
          if (statsLeft) {
            statsLeft.textContent = `${formatPercent(dl.percent)} (${dl.size || '...'})`;
          }
          if (statsRight) {
            const parts = [];
            if (dl.speed) parts.push(dl.speed);
            if (dl.eta) parts.push(`ETA ${dl.eta}`);
            statsRight.textContent = parts.join(' - ') || 'Downloading...';
          }
        } else if (dl.status === 'merging') {
          if (badge) {
            badge.className = 'yt-dlp-hud-badge merging';
            badge.textContent = 'MERGING';
          }
          if (bar) {
            bar.className = 'yt-dlp-hud-bar-fill';
            bar.style.width = '100%';
          }
          if (statsLeft) statsLeft.textContent = 'Post-processing...';
          if (statsRight) statsRight.textContent = 'Remuxing/Merging';
          if (cancelBtn) cancelBtn.style.display = 'none';
        } else if (dl.status === 'completed') {
          if (item.status !== 'completed') {
            item.status = 'completed';
            if (badge) {
              badge.className = 'yt-dlp-hud-badge completed';
              badge.textContent = 'COMPLETED';
            }
            if (bar) {
              bar.className = 'yt-dlp-hud-bar-fill completed';
              bar.style.width = '100%';
            }
            if (statsLeft) statsLeft.textContent = '100% Downloaded';
            if (statsRight) statsRight.textContent = dl.size || 'Done';
            if (cancelBtn) cancelBtn.style.display = 'none';

            // Auto-dismiss based on user preference (0 means manual dismiss only)
            if (overlayDismissSeconds > 0) {
              item.removeTimeout = setTimeout(() => {
                removeCard(jobId);
              }, overlayDismissSeconds * 1000);
            }
          }
        } else if (dl.status === 'cancelled') {
          if (item.status !== 'cancelled') {
            item.status = 'cancelled';
            if (badge) {
              badge.className = 'yt-dlp-hud-badge cancelled';
              badge.textContent = 'CANCELLED';
            }
            if (bar) {
              bar.className = 'yt-dlp-hud-bar-fill';
            }
            if (statsLeft) statsLeft.textContent = 'Stopped';
            if (statsRight) statsRight.textContent = 'Cancelled';
            if (cancelBtn) cancelBtn.style.display = 'none';

            if (overlayDismissSeconds > 0) {
              item.removeTimeout = setTimeout(() => {
                removeCard(jobId);
              }, Math.min(overlayDismissSeconds, 4) * 1000);
            }
          }
        } else if (dl.status === 'error') {
          if (item.status !== 'error') {
            item.status = 'error';
            if (badge) {
              badge.className = 'yt-dlp-hud-badge error';
              badge.textContent = 'ERROR';
            }
            if (statsLeft) statsLeft.textContent = 'Failed';
            if (statsRight) statsRight.textContent = 'Check logs';
            if (cancelBtn) cancelBtn.style.display = 'none';

            if (overlayDismissSeconds > 0) {
              item.removeTimeout = setTimeout(() => {
                removeCard(jobId);
              }, Math.min(overlayDismissSeconds, 4) * 1000);
            }
          }
        }
      }
    } catch (e) {
      // Server might be busy or unreachable
    }
  }

  // Listen for messages from background script
  browserApi.runtime.onMessage.addListener((message) => {
    if (message && message.action === 'show_progress') {
      createJobCard(message.job_id, message.title);
    }
  });
})();
