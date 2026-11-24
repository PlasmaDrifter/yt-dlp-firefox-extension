(() => {
  if (window.__yt_dlp_hud_injected) return;
  window.__yt_dlp_hud_injected = true;

  const browserApi =
    typeof browser !== 'undefined' && browser.runtime
      ? browser
      : typeof chrome !== 'undefined'
        ? chrome
        : null;
  if (!browserApi) return;

  let hudContainer = null;
  const activeCards = new Map();
  let overlayDismissSeconds = 4;
  const MAX_MISSING_TICKS = 5;

  if (browserApi.storage && browserApi.storage.local) {
    browserApi.storage.local
      .get({ overlayDismissSeconds: 4 })
      .then((res) => {
        if (typeof res.overlayDismissSeconds === 'number') {
          overlayDismissSeconds = res.overlayDismissSeconds;
        }
      })
      .catch(() => {});

    if (browserApi.storage.onChanged) {
      browserApi.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes.overlayDismissSeconds) {
          const val = Number(changes.overlayDismissSeconds.newValue);
          if (!Number.isNaN(val)) {
            overlayDismissSeconds = val;
          }
        }
      });
    }
  }

  function ensureContainer() {
    if (!hudContainer || !document.documentElement.contains(hudContainer)) {
      hudContainer = document.getElementById('yt-dlp-hud-container');
      if (!hudContainer) {
        hudContainer = document.createElement('div');
        hudContainer.id = 'yt-dlp-hud-container';
        hudContainer.setAttribute('role', 'region');
        hudContainer.setAttribute('aria-label', 'yt-dlp Downloads');
        if ('showPopover' in HTMLElement.prototype) {
          hudContainer.setAttribute('popover', 'manual');
        }
        (document.body || document.documentElement).appendChild(hudContainer);
      }
    }
    if ('showPopover' in hudContainer && !hudContainer.matches(':popover-open')) {
      try {
        hudContainer.showPopover();
      } catch {
        // Fallback to fixed z-index overlay
      }
    }
    return hudContainer;
  }

  function hideContainerIfEmpty() {
    if (!hudContainer || activeCards.size > 0) return;
    if ('hidePopover' in hudContainer && hudContainer.matches(':popover-open')) {
      try {
        hudContainer.hidePopover();
      } catch {
        // Ignore
      }
    }
    browserApi.runtime.sendMessage({ action: 'hud_empty' }).catch(() => {});
  }

  function formatPercent(pct) {
    if (typeof pct === 'number' && !Number.isNaN(pct)) {
      return `${pct.toFixed(1)}%`;
    }
    return '0.0%';
  }

  function scheduleAutoDismiss(jobId, seconds) {
    const item = activeCards.get(jobId);
    if (!item || seconds <= 0 || item.removing) return;
    if (item.removeTimeout) {
      clearTimeout(item.removeTimeout);
      item.removeTimeout = null;
    }
    item.autoDismissDelayMs = seconds * 1000;
    if (item.isPaused) return;
    item.removeTimeout = setTimeout(() => {
      removeCard(jobId);
    }, item.autoDismissDelayMs);
  }

  function removeCard(jobId) {
    const item = activeCards.get(jobId);
    if (!item || item.removing) return;
    item.removing = true;

    if (item.removeTimeout) {
      clearTimeout(item.removeTimeout);
      item.removeTimeout = null;
    }

    item.element.classList.add('yt-dlp-hud-leaving');
    const cleanup = () => {
      if (item.element.parentNode) {
        item.element.parentNode.removeChild(item.element);
      }
      activeCards.delete(jobId);
      hideContainerIfEmpty();
    };
    setTimeout(cleanup, 260);
  }

  async function cancelJob(jobId) {
    const item = activeCards.get(jobId);
    if (item && item.cancelBtn) {
      item.cancelBtn.disabled = true;
      item.cancelBtn.textContent = '...';
    }
    try {
      await browserApi.runtime.sendMessage({ action: 'cancel_job', job_id: jobId });
    } catch (err) {
      console.warn('[yt-dlp-hud] Failed to cancel job:', err);
    }
  }

  function createJobCard(jobId, title) {
    const container = ensureContainer();
    if (activeCards.has(jobId)) {
      return activeCards.get(jobId).element;
    }

    const displayTitle = title || 'Downloading video...';
    const card = document.createElement('div');
    card.className = 'yt-dlp-hud-card';

    const header = document.createElement('div');
    header.className = 'yt-dlp-hud-header';

    const titleEl = document.createElement('span');
    titleEl.className = 'yt-dlp-hud-title';
    titleEl.title = displayTitle;
    titleEl.textContent = displayTitle;

    const badge = document.createElement('span');
    badge.className = 'yt-dlp-hud-badge';
    badge.textContent = 'STARTING';

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'yt-dlp-hud-close';
    closeBtn.setAttribute('aria-label', `Dismiss ${displayTitle}`);
    closeBtn.title = 'Dismiss';
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', () => removeCard(jobId));

    header.appendChild(titleEl);
    header.appendChild(badge);
    header.appendChild(closeBtn);

    const progress = document.createElement('progress');
    progress.className = 'yt-dlp-hud-progress';
    progress.max = 100;
    progress.setAttribute('aria-label', `Download progress for ${displayTitle}`);

    const stats = document.createElement('div');
    stats.className = 'yt-dlp-hud-stats';

    const statsLeft = document.createElement('span');
    statsLeft.textContent = '0.0%';

    const statsRightWrapper = document.createElement('div');
    statsRightWrapper.className = 'yt-dlp-hud-stats-right';

    const statsRight = document.createElement('span');
    statsRight.className = 'yt-dlp-hud-stats-msg';
    statsRight.textContent = 'Starting yt-dlp...';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'yt-dlp-hud-btn-cancel';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => cancelJob(jobId));

    statsRightWrapper.appendChild(statsRight);
    statsRightWrapper.appendChild(cancelBtn);

    stats.appendChild(statsLeft);
    stats.appendChild(statsRightWrapper);

    card.appendChild(header);
    card.appendChild(progress);
    card.appendChild(stats);

    const item = {
      element: card,
      titleEl,
      badge,
      progress,
      statsLeft,
      statsRight,
      cancelBtn,
      title: displayTitle,
      status: 'starting',
      missingTicks: 0,
      removeTimeout: null,
      autoDismissDelayMs: 0,
      isPaused: false,
      removing: false,
    };

    const pauseDismiss = () => {
      item.isPaused = true;
      if (item.removeTimeout) {
        clearTimeout(item.removeTimeout);
        item.removeTimeout = null;
      }
    };
    const resumeDismiss = () => {
      item.isPaused = false;
      if (item.autoDismissDelayMs > 0 && !item.removing && !item.removeTimeout) {
        item.removeTimeout = setTimeout(() => removeCard(jobId), item.autoDismissDelayMs);
      }
    };
    card.addEventListener('mouseenter', pauseDismiss);
    card.addEventListener('mouseleave', resumeDismiss);
    card.addEventListener('focusin', pauseDismiss);
    card.addEventListener('focusout', (ev) => {
      if (!card.contains(ev.relatedTarget)) {
        resumeDismiss();
      }
    });

    container.appendChild(card);
    activeCards.set(jobId, item);
    return card;
  }

  function applyUpdate(downloads) {
    if (activeCards.size === 0) return;

    const byId = new Map((downloads || []).map((dl) => [dl.id, dl]));

    for (const [jobId, item] of activeCards.entries()) {
      if (item.removing) continue;
      const dl = byId.get(jobId);

      if (!dl) {
        // Avoid leaving stale cards polling forever if server cleared or restarted
        const isTerminal =
          item.status === 'completed' || item.status === 'cancelled' || item.status === 'error';
        if (!isTerminal) {
          item.missingTicks += 1;
          if (item.missingTicks >= MAX_MISSING_TICKS) {
            removeCard(jobId);
          }
        }
        continue;
      }
      item.missingTicks = 0;

      if (dl.title && item.title !== dl.title) {
        item.title = dl.title;
        item.titleEl.textContent = dl.title;
        item.titleEl.title = dl.title;
      }

      if (dl.status === 'starting') {
        item.badge.className = 'yt-dlp-hud-badge';
        item.badge.textContent = 'STARTING';
        item.progress.removeAttribute('value');
        item.statsLeft.textContent = 'Preparing...';
        item.statsRight.textContent = 'Starting yt-dlp...';
      } else if (dl.status === 'downloading') {
        item.status = 'downloading';
        item.badge.className = 'yt-dlp-hud-badge';
        item.badge.textContent = 'DOWNLOADING';
        if (typeof dl.percent === 'number' && dl.percent > 0) {
          item.progress.value = dl.percent;
          item.statsLeft.textContent = dl.size
            ? `${formatPercent(dl.percent)} (${dl.size})`
            : formatPercent(dl.percent);
        } else {
          item.progress.removeAttribute('value');
          item.statsLeft.textContent = dl.size || 'Downloading...';
        }
        const parts = [];
        if (dl.speed) parts.push(dl.speed);
        if (dl.eta) parts.push(`ETA ${dl.eta}`);
        item.statsRight.textContent = parts.join(' - ') || 'Downloading...';
      } else if (dl.status === 'merging') {
        item.status = 'merging';
        item.badge.className = 'yt-dlp-hud-badge merging';
        item.badge.textContent = 'MERGING';
        item.progress.removeAttribute('value');
        item.statsLeft.textContent = 'Post-processing...';
        item.statsRight.textContent = 'Remuxing / Merging';
        item.cancelBtn.hidden = false;
      } else if (dl.status === 'completed') {
        if (item.status !== 'completed') {
          item.status = 'completed';
          item.badge.className = 'yt-dlp-hud-badge completed';
          item.badge.textContent = 'COMPLETED';
          item.progress.className = 'yt-dlp-hud-progress completed';
          item.progress.value = 100;
          item.statsLeft.textContent = '100% Downloaded';
          item.statsRight.textContent = dl.size || 'Done';
          item.cancelBtn.hidden = true;
          scheduleAutoDismiss(jobId, overlayDismissSeconds);
        }
      } else if (dl.status === 'cancelled') {
        if (item.status !== 'cancelled') {
          item.status = 'cancelled';
          item.badge.className = 'yt-dlp-hud-badge cancelled';
          item.badge.textContent = 'CANCELLED';
          item.progress.value = typeof dl.percent === 'number' ? dl.percent : 0;
          item.statsLeft.textContent = 'Stopped';
          item.statsRight.textContent = 'Cancelled';
          item.cancelBtn.hidden = true;
          scheduleAutoDismiss(
            jobId,
            overlayDismissSeconds > 0 ? Math.min(overlayDismissSeconds, 4) : 0
          );
        }
      } else if (dl.status === 'error') {
        if (item.status !== 'error') {
          item.status = 'error';
          item.badge.className = 'yt-dlp-hud-badge error';
          item.badge.textContent = 'ERROR';
          item.progress.className = 'yt-dlp-hud-progress error';
          item.progress.value = typeof dl.percent === 'number' ? dl.percent : 0;
          item.statsLeft.textContent = 'Failed';
          const errText = dl.error || 'Download failed';
          item.statsRight.textContent = errText;
          item.statsRight.title = errText;
          item.cancelBtn.hidden = true;
          scheduleAutoDismiss(
            jobId,
            overlayDismissSeconds > 0 ? Math.max(overlayDismissSeconds, 6) : 0
          );
        }
      }
    }
  }

  browserApi.runtime.onMessage.addListener((message) => {
    if (!message || typeof message !== 'object') return;
    if (message.action === 'show_progress' && message.job_id) {
      if (typeof message.overlayDismissSeconds === 'number') {
        overlayDismissSeconds = message.overlayDismissSeconds;
      }
      createJobCard(message.job_id, message.title);
    } else if (message.action === 'downloads_update') {
      applyUpdate(message.downloads);
    }
  });
})();
