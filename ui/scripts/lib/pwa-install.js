// ============================================================
// pwa-install.js — PWA install logic
// ============================================================

let deferredPrompt = null;

const PWAInstall = (() => {
  const _isIOS        = /ipad|iphone|ipod/i.test(navigator.userAgent) && !window.MSStream;
  const _isFirefox    = /firefox/i.test(navigator.userAgent);
  const _isMobile     = /android|ipad|iphone|ipod/i.test(navigator.userAgent);
  const _isStandalone = window.matchMedia('(display-mode: standalone)').matches
                     || window.navigator.standalone === true;

  function _activateInstallBtn() {
    const btn      = document.getElementById('installBtn');
    const fallback = document.getElementById('installFallback');
    if (btn)      btn.disabled = false;
    if (fallback) fallback.style.display = 'none';
  }

  function init() {
    if (_isStandalone) return; // app already installed

    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredPrompt = e;
      _activateInstallBtn();
    });

    window.addEventListener('appinstalled', () => {
      deferredPrompt = null;
      const sec = document.getElementById('installSection');
      if (sec) sec.style.display = 'none';
    });

    document.addEventListener('DOMContentLoaded', () => {
      if (_isIOS) {
        const hint = document.getElementById('iosInstallHint');
        if (hint) hint.style.display = '';
      } else if (_isFirefox && _isMobile) {
        const ffHint = document.getElementById('firefoxInstallHint');
        if (ffHint) ffHint.style.display = '';
      } else if (_isMobile) {
        const sec = document.getElementById('installSection');
        if (sec) sec.style.display = '';
        if (deferredPrompt) _activateInstallBtn();
      }

      const btn = document.getElementById('installBtn');
      if (btn) {
        btn.addEventListener('click', async () => {
          if (!deferredPrompt) return;
          deferredPrompt.prompt();
          await deferredPrompt.userChoice;
          deferredPrompt = null;
          const sec = document.getElementById('installSection');
          if (sec) sec.style.display = 'none';
        });
      }
    });
  }

  return { init };
})();

export default PWAInstall;