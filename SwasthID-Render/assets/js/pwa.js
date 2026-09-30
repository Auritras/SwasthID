/* Installable app and offline start.
   Registers the service worker (sw.js) on every visit so the app keeps a copy
   of itself for offline use, and offers "Install app" in the account menu
   when the browser allows it. iPhones and iPads have no install prompt, so
   there the menu item explains Add to Home Screen instead.
   Once SwasthID is installed, the menu item goes away: inside the installed
   app, and in the browser too (this device remembers it was installed). */
(function () {
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname))) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(err => console.warn('Service worker registration failed:', err));
    });
  }

  const btn = document.getElementById('installAppBtn');
  if (!btn) return;
  // A device setting, not account data, so it is kept on log out.
  const INSTALLED_KEY = 'swasthid:installed';
  const remember = () => { try { localStorage.setItem(INSTALLED_KEY, '1'); } catch (_) {} };
  const remembered = () => { try { return localStorage.getItem(INSTALLED_KEY) === '1'; } catch (_) { return false; } };
  // Running as the installed app (any window style), a Home Screen app on
  // iPhone, or the Android app wrapper.
  const inApp = ['standalone', 'fullscreen', 'minimal-ui', 'window-controls-overlay'].some(mode => window.matchMedia(`(display-mode: ${mode})`).matches)
    || navigator.standalone === true || document.referrer.startsWith('android-app://');
  const iOS = /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
  let deferredPrompt = null;

  if (inApp) remember();
  const installed = () => inApp || remembered();
  if (!installed() && iOS) btn.hidden = false;

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    deferredPrompt = event;
    btn.hidden = installed();
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    remember();
    btn.hidden = true;
    showToast('', 'SwasthID installed', 'Open it from your home screen or app list. It works offline too.');
  });

  btn.addEventListener('click', async () => {
    document.getElementById('accountBtn')?.click();
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice.catch(() => null);
      if (choice?.outcome === 'accepted') { remember(); btn.hidden = true; }
      deferredPrompt = null;
      return;
    }
    if (iOS) showToast('', 'Add SwasthID to your Home Screen', 'In Safari, tap the Share button, then "Add to Home Screen".');
  });
})();
