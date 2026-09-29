/* Installable app and offline start.
   Registers the service worker (sw.js) on every visit so the app keeps a copy
   of itself for offline use, and offers "Install app" in the account menu
   when the browser allows it. iPhones and iPads have no install prompt, so
   there the menu item explains Add to Home Screen instead. */
(function () {
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname))) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(err => console.warn('Service worker registration failed:', err));
    });
  }

  const btn = document.getElementById('installAppBtn');
  if (!btn) return;
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const iOS = /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
  let deferredPrompt = null;

  if (!standalone && iOS) btn.hidden = false;

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    deferredPrompt = event;
    btn.hidden = false;
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    btn.hidden = true;
    showToast('', 'SwasthID installed', 'Open it from your home screen or app list. It works offline too.');
  });

  btn.addEventListener('click', async () => {
    document.getElementById('accountBtn')?.click();
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice.catch(() => null);
      if (choice?.outcome === 'accepted') btn.hidden = true;
      deferredPrompt = null;
      return;
    }
    if (iOS) showToast('', 'Add SwasthID to your Home Screen', 'In Safari, tap the Share button, then "Add to Home Screen".');
  });
})();
