  /* SwasthID lightweight dependency loader. Keeps first paint small and makes
     feature failures isolated instead of taking down the whole dashboard. */
  const SWASTH_SCRIPT_PROMISES = Object.create(null);
  function loadSwasthScript(key, src, globalName) {
    if (globalName && window[globalName]) return Promise.resolve(window[globalName]);
    if (SWASTH_SCRIPT_PROMISES[key]) return SWASTH_SCRIPT_PROMISES[key];
    SWASTH_SCRIPT_PROMISES[key] = new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[data-swasth-lib="${key}"]`);
      if (existing) {
        existing.addEventListener('load', () => resolve(globalName ? window[globalName] : true), {once:true});
        existing.addEventListener('error', () => reject(new Error(`Could not load ${key}.`)), {once:true});
        return;
      }
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.dataset.swasthLib = key;
      script.onload = () => resolve(globalName ? window[globalName] : true);
      script.onerror = () => { delete SWASTH_SCRIPT_PROMISES[key]; reject(new Error(`Could not load ${key}. Check your internet connection.`)); };
      document.head.appendChild(script);
    });
    return SWASTH_SCRIPT_PROMISES[key];
  }
  async function ensureFirebaseLoaded() {
    // Firebase core creates window.firebase, so it cannot be used as the
    // globalName test for Auth/Firestore. Those compat modules must load
    // explicitly even when the core object already exists.
    if (!window.firebase) {
      await loadSwasthScript(
        'firebase-app',
        'https://www.gstatic.com/firebasejs/12.18.0/firebase-app-compat.js',
        'firebase'
      );
    }
    await Promise.all([
      loadSwasthScript(
        'firebase-auth',
        'https://www.gstatic.com/firebasejs/12.18.0/firebase-auth-compat.js'
      ),
      loadSwasthScript(
        'firebase-firestore',
        'https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore-compat.js'
      )
    ]);
    if (typeof window.firebase?.auth !== 'function' || typeof window.firebase?.firestore !== 'function') {
      throw new Error('Firebase Authentication and Firestore SDKs failed to load.');
    }
    return window.firebase;
  }
  async function ensureTesseractLoaded() {
    await loadSwasthScript('tesseract','https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js','Tesseract');
    return window.Tesseract;
  }
  async function ensurePdfJsLoaded() {
    await loadSwasthScript('pdfjs','https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.min.js','pdfjsLib');
    if (window.pdfjsLib) window.pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';
    return window.pdfjsLib;
  }
  async function ensureQrCodeLoaded() {
    await loadSwasthScript('qrcode','https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js','QRCode');
    return window.QRCode;
  }
