// /auth/action: where the links in SwasthID's account emails land.
// ?mode=resetPassword&oobCode=... shows a new-password form;
// ?mode=verifyEmail&oobCode=... confirms the address.
(function () {
  const params = new URLSearchParams(location.search);
  const mode = params.get('mode');
  const code = params.get('oobCode');
  // Keep the one-time code out of the address bar and history.
  history.replaceState(null, '', location.pathname);

  function show(state) {
    document.querySelectorAll('[data-state]').forEach(el => { el.hidden = el.dataset.state !== state; });
    const heading = document.querySelector(`[data-state="${state}"] h1`);
    if (heading) document.title = `${heading.textContent} · SwasthID`;
  }

  function invalid(title, text) {
    if (title) document.getElementById('invalidTitle').textContent = title;
    if (text) document.getElementById('invalidText').textContent = text;
    show('invalid');
  }

  function linkProblem(error) {
    const code = error && error.code;
    if (code === 'auth/network-request-failed') {
      return invalid('No connection', 'Check your internet connection, then open the link from your email again.');
    }
    if (code === 'auth/user-disabled' || code === 'auth/user-not-found') {
      return invalid('Account unavailable', 'This account no longer exists or has been disabled.');
    }
    // Expired, already used, or mangled by the mail app.
    invalid();
  }

  async function firebaseAuth() {
    const config = window.SWASTH_FIREBASE_CONFIG || {};
    if (!config.apiKey) throw Object.assign(new Error('Accounts are not set up on this server.'), { code: 'swasth/no-config' });
    await ensureFirebaseLoaded();
    if (!firebase.apps.length) firebase.initializeApp(config);
    const auth = firebase.auth();
    const emu = window.SWASTH_EMULATORS;
    if (emu && ['localhost', '127.0.0.1'].includes(location.hostname)) auth.useEmulator(emu.auth, { disableWarnings: true });
    return auth;
  }

  async function resetPassword(auth) {
    const email = await auth.verifyPasswordResetCode(code);
    document.getElementById('resetEmail').textContent = email;
    show('reset');
    const form = document.getElementById('resetForm');
    const pw = document.getElementById('newPassword');
    const confirm = document.getElementById('confirmNewPassword');
    const error = document.getElementById('resetError');
    const submit = document.getElementById('resetSubmit');
    const fail = message => { error.textContent = message; error.hidden = false; };
    pw.focus();

    form.addEventListener('submit', async event => {
      event.preventDefault();
      error.hidden = true;
      if (pw.value.length < 6) { fail('Use at least 6 characters.'); return pw.focus(); }
      if (pw.value !== confirm.value) { fail("The two passwords don't match."); return confirm.focus(); }
      submit.disabled = true;
      submit.classList.add('is-loading');
      try {
        await auth.confirmPasswordReset(code, pw.value);
        show('reset-done');
      } catch (e) {
        if (e.code === 'auth/weak-password') fail('Choose a stronger password.');
        else if (e.code === 'auth/network-request-failed') fail('Network error. Check your connection and try again.');
        else linkProblem(e);
      } finally {
        submit.disabled = false;
        submit.classList.remove('is-loading');
      }
    });
  }

  (async () => {
    if (!code || !['resetPassword', 'verifyEmail'].includes(mode)) {
      return invalid('This link is incomplete', 'Open the link from your email again, or copy the whole link into your browser.');
    }
    let auth;
    try { auth = await firebaseAuth(); } catch (e) {
      return e.code === 'swasth/no-config' ? invalid('Accounts are unavailable', e.message) : linkProblem({ code: 'auth/network-request-failed' });
    }
    try {
      if (mode === 'resetPassword') await resetPassword(auth);
      else { await auth.applyActionCode(code); show('verified'); }
    } catch (e) {
      console.warn('Account link failed:', e && e.code);
      linkProblem(e);
    }
  })();
})();
