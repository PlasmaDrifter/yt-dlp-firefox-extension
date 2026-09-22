document.addEventListener('DOMContentLoaded', async () => {
  const browserApi = (typeof browser !== 'undefined' && browser.runtime) ? browser : (typeof chrome !== 'undefined' ? chrome : null);
  const statusCard = document.getElementById('status-card');
  const statusText = document.getElementById('status-text');
  const detectedOsEl = document.getElementById('detected-os');
  const osBadge = document.getElementById('os-badge');
  const btnRefresh = document.getElementById('btn-refresh');
  const destinationEl = document.getElementById('destination-val');

  const tipsLinux = document.getElementById('tips-linux');
  const tipsWin = document.getElementById('tips-win');

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

  // Initial check
  checkServerHealth();
});
