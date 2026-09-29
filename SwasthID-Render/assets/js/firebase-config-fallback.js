  // Fallback for opening the HTML directly if firebase-config.js is not loaded.
  // Firebase Web config is safe to expose; access is enforced by Auth + Firestore Rules.
  if (!window.SWASTH_FIREBASE_CONFIG || String(window.SWASTH_FIREBASE_CONFIG.projectId || '').startsWith('YOUR_')) {
    window.SWASTH_FIREBASE_CONFIG = {
      apiKey: "AIzaSyA0R72dAU5aAJBMPTpl5ykFpz8TPTlnR4M",
      authDomain: "swasthid-hackathon.firebaseapp.com",
      projectId: "swasthid-hackathon",
      storageBucket: "swasthid-hackathon.firebasestorage.app",
      messagingSenderId: "557813986588",
      appId: "1:557813986588:web:8b22209349799cccd176d9"
    };
  }
