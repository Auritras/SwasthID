 /* Global State */
 let globalKcal = 0;
 let qrGenerated = false;

 const patientData = createBlankPersonalizedProfile('');

 /* =========================================================
 1. AUTHENTICATION, LOGIN WORKFLOW & SESSION
 ========================================================= */
 const loginForm = document.getElementById('loginForm');
 const loginScreen = document.getElementById('loginScreen');
 const dashboard = document.getElementById('dashboard');
 const topHealthId = document.getElementById('topHealthId');
 const idInput = document.getElementById('healthId');
 const pwInput = document.getElementById('password');
 const idError = document.getElementById('idError');
 const pwError = document.getElementById('pwError');

 // Firebase authentication mode switch. The same form supports Login and Create Account.
 const authModeRow = document.createElement('div');
 authModeRow.className = 'auth-mode-row';
 authModeRow.innerHTML = '<span id="authModeText">New to SwasthID?</span><button type="button" id="createAccountBtn">Create account</button>';
 loginForm.insertAdjacentElement('afterend', authModeRow);
 const createAccountBtn = document.getElementById('createAccountBtn');
 const authModeText = document.getElementById('authModeText');
 const confirmPasswordField = document.getElementById('confirmPasswordField');
 const confirmPasswordInput = document.getElementById('confirmPassword');
 const confirmPwError = document.getElementById('confirmPwError');
 let authMode = 'login';
let profileOnboardingRequired = false;

 function performLoginSetup(abhaId, options = {}) {
   const skipProfilePrompt = options?.skipProfilePrompt === true;
   const currentEmail = String(firebaseUser?.email || abhaId || '').trim();
   patientData.email = currentEmail;
   topHealthId.textContent = currentEmail || 'Signed in';

   // Set the account-specific greeting immediately, even before any later render pass.
   // This prevents the previous user's initials/name from remaining in the DOM during
   // Firebase account switching or a slow Firestore read.
   const ownerUid = String(patientData.ownerUid || '').trim();
   const ownerEmail = String(patientData.ownerEmail || patientData.email || '').trim().toLowerCase();
   const ownsProfile = !!firebaseUser && (
     (ownerUid && ownerUid === firebaseUser.uid) ||
     (!ownerUid && ownerEmail && ownerEmail === currentEmail.toLowerCase())
   );
   const storedName = ownsProfile ? String(patientData.name || '').trim() : '';
   const emailName = currentEmail ? currentEmail.split('@')[0].replace(/[._-]+/g, ' ').trim().replace(/\b\w/g, c => c.toUpperCase()) : '';
   const displayName = storedName && storedName !== 'Aditya Sharma' ? storedName : (emailName || 'SwasthID User');
   const greeting = document.getElementById('dashboardGreetingName');
   if (greeting) greeting.textContent = displayName.split(/\s+/)[0] || displayName;
   renderAvatars(ownsProfile ? patientData.photo : '');
   const accountName = document.getElementById('accountName');
   if (accountName) accountName.textContent = displayName;

   loginScreen.style.display = 'none';
   dashboard.style.display = 'block';
   if (typeof wakeSwasthServer === 'function') wakeSwasthServer();
   const aiDock = document.getElementById('aiAssistantDock');
   if (aiDock) aiDock.style.display = 'flex';
   window.scrollTo(0, 0);

   initTimeAwareContent();
   restoreMedications();
   initMoodTracker();
   initPremiumPolish();
   renderPersonalizedUI();

   // Existing sessions with incomplete profiles are guided into onboarding as well.
   const needsProfile = profileOnboardingRequired || !isProfileActuallyComplete();
   if (needsProfile && !skipProfilePrompt) {
     setTimeout(() => {
       openProfileModal();
       // A defensive retry handles browsers that restore the page before the modal node is painted.
       setTimeout(() => {
         const modal = document.getElementById('profileModal');
         if (modal && !modal.classList.contains('show')) openProfileModal();
       }, 500);
     }, 320);
   }
 }

 function setAuthMode(mode) {
   authMode = mode === 'signup' ? 'signup' : 'login';
   const isSignup = authMode === 'signup';
   const submitBtn = loginForm.querySelector('.login-btn');
   const loginTitle = loginScreen.querySelector('h1');
   const loginSub = loginScreen.querySelector('.sub');

   authModeText.textContent = isSignup ? 'Already registered?' : 'New to SwasthID?';
   createAccountBtn.textContent = isSignup ? 'Back to login' : 'Create account';
   submitBtn.textContent = isSignup ? 'Create account' : 'Log in';
   confirmPasswordField.style.display = isSignup ? '' : 'none';
   const forgot = loginScreen.querySelector('.forgot-link'); if (forgot) forgot.hidden = isSignup;
   confirmPasswordInput.required = isSignup;
   confirmPasswordInput.value = '';
   confirmPwError.style.display = 'none';
   loginTitle.textContent = isSignup ? 'Create your account' : 'Welcome back';
   loginSub.textContent = isSignup
     ? 'Create an account to keep your health record, prescriptions and medicines in one place.'
     : 'Log in to see your health record, prescriptions and medicines.';
   document.querySelector('.security-note small').textContent = isSignup
     ? 'Your record is stored under your own account, and only you can read it.'
     : 'Only you can read your record. Each account\'s data is locked to its owner, and nothing is shared unless you create a doctor link or an emergency QR.';
   pwInput.autocomplete = isSignup ? 'new-password' : 'current-password';
 }

 createAccountBtn.addEventListener('click', () => {
   setAuthMode(authMode === 'login' ? 'signup' : 'login');
   idInput.focus();
 });

 const forgotPasswordBtn = document.querySelector('.forgot-link');
 if (forgotPasswordBtn) {
   forgotPasswordBtn.addEventListener('click', async () => {
     const email = idInput.value.trim();
     if (!auth) {
       try { await initFirebaseDataLayer(); } catch (_) {}
     }
     if (!auth) {
       alert('Firebase Authentication is not configured yet.');
       return;
     }
     if (!/^[^\s@]+@[^\s@]+$/.test(email)) {
       alert('Enter your email address first, then click Forgot Password.');
       idInput.focus();
       return;
     }
     forgotPasswordBtn.disabled = true;
     try {
       await requestPasswordResetEmail(email);
       // The same answer whether or not an account exists for the address.
       alert('If an account exists for that address, a link to reset the password is on its way. Check your inbox and spam folder.');
     } catch (error) {
       console.error('Password reset error:', error);
       alert(firebaseAuthErrorMessage(error));
     } finally {
       forgotPasswordBtn.disabled = false;
     }
   });
 }

 function initDarkMode(){
 const key='swasth_darkMode';
 const saved=localStorage.getItem(key)==='true';
 const applyTheme=(on)=>{
  document.documentElement.classList.toggle('dark-mode',on);
  document.body.classList.toggle('dark-mode',on); document.documentElement.classList.toggle('dark-mode',on);
  const btn=document.getElementById('darkModeToggle');
  if(btn){
   btn.setAttribute('aria-pressed',String(on));
   btn.setAttribute('aria-label',on?'Switch to light mode':'Switch to dark mode');
   btn.querySelector('use')?.setAttribute('href',on?'#i-sun':'#i-moon');
  }
 };
 applyTheme(saved);
 const btn=document.getElementById('darkModeToggle');
 if(btn&&!btn.dataset.bound){btn.dataset.bound='1';btn.addEventListener('click',()=>{const on=!document.body.classList.contains('dark-mode');localStorage.setItem(key,String(on));applyTheme(on);});}
}
function updateOfflineBanner(){const el=document.getElementById('offlineBanner');if(el)el.classList.toggle('show',navigator.onLine===false);}
initDarkMode(); updateOfflineBanner(); window.addEventListener('online',updateOfflineBanner); window.addEventListener('offline',updateOfflineBanner);

window.addEventListener('DOMContentLoaded', async () => {
   const aiDock = document.getElementById('aiAssistantDock');
   if (aiDock) aiDock.style.display = 'none';
   // Firebase is only loaded on startup when a previous authenticated session
   // may need restoring. New visitors keep the login screen lightweight until
   // they actually submit the auth form.
   if (localStorage.getItem('swasth_loggedIn') === 'true') await initFirebaseDataLayer();

   // If Firebase already has a signed-in session, use it instead of the old local demo session.
   if (auth && auth.currentUser) {
     firebaseUser = auth.currentUser;
     try { await firebaseUser.reload(); } catch (_) {}
     if (!firebaseUser.emailVerified) {
       try { await auth.signOut(); } catch (_) {}
       firebaseUser = null;
       cloudSyncReady = false;
       clearCloudCacheForUserSwitch();
       alert('Your Firebase session is signed in but the email is not verified yet. Please verify your email before continuing.');
       return;
     }
     cloudSyncReady = await loadCloudState();
     const savedId = firebaseUser.email || 'SwasthID User';
     profileOnboardingRequired = !isProfileActuallyComplete();
     performLoginSetup(savedId);
     await migrateLocalDataToCloud();
     return;
   }

   // Legacy local sessions are only restored when Firebase isn't available.
   if (!auth && localStorage.getItem('swasth_loggedIn') === 'true') {
     const savedId = localStorage.getItem('swasth_abhaId') || 'aditya.sharma@abdm';
     performLoginSetup(savedId);
   }
 });

 loginForm.addEventListener('submit', async function(e){
   e.preventDefault();
   const email = idInput.value.trim();
   const password = pwInput.value;
   const confirmPassword = confirmPasswordInput.value;
   const isSignup = authMode === 'signup';

   idError.style.display = email ? 'none' : 'block';
   pwError.style.display = password ? 'none' : 'block';
   confirmPwError.style.display = isSignup && confirmPassword !== password ? 'block' : 'none';
   if (!email || !password || (isSignup && confirmPassword !== password)) return;

   if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
     idError.textContent = 'Please enter a valid email address.';
     idError.style.display = 'block';
     return;
   }

   if (isSignup && password.length < 6) {
     pwError.textContent = 'Password must be at least 6 characters.';
     pwError.style.display = 'block';
     return;
   }

   const submitBtn = loginForm.querySelector('.login-btn');
   const originalText = isSignup ? 'Create account' : 'Log in';
   submitBtn.disabled = true;
   submitBtn.classList.add('is-loading');

   try {
     if (!auth) await initFirebaseDataLayer();
     if (!auth) {
       throw new Error('Firebase is not configured. Check firebase-config.js and reload the page.');
     }

     if (isSignup) {
       const result = await firebaseCreateAccount(email, password);
       localStorage.removeItem('swasth_loggedIn');
       localStorage.setItem('swasth_abhaId', email);
       // Do not enter the dashboard until the email ownership check is complete.
       profileOnboardingRequired = true;
       showAccountCreatedModal(result.cloudReady);
     } else {
       await firebaseLogin(email, password);
       localStorage.setItem('swasth_loggedIn', 'true');
       localStorage.setItem('swasth_abhaId', email);
       profileOnboardingRequired = !isProfileActuallyComplete();
       performLoginSetup(email);
       renderPersonalizedUI();
       setTimeout(() => {
         showNextMedicationToast();
       }, 1200);
     }
   } catch (error) {
     console.error('Authentication error:', error);
     alert(firebaseAuthErrorMessage(error));
   } finally {
     submitBtn.disabled = false;
     submitBtn.textContent = originalText; submitBtn.classList.remove('is-loading');
   }
 });

 async function deleteAccountAndData(){
 const status=document.getElementById('deleteAccountStatus');if(!firebaseUser){if(status)status.textContent='Sign in first.';return;}
 if(!window.confirm('Delete your SwasthID account and stored data? This cannot be undone.'))return;
 try{
  if(status)status.textContent='Deleting account data…';
  const apiBase=(window.SWASTH_API_BASE||location.origin).replace(/\/$/,'');
  const clearLocal=()=>Object.keys(localStorage).filter(k=>k.startsWith('swasth_')).forEach(k=>localStorage.removeItem(k));
  // Emergency QRs are tied to the manage token rather than the account, so revoke them first.
  const tokenId=localStorage.getItem('swasth_emergencyTokenId'),manageToken=localStorage.getItem('swasth_emergencyManageToken');
  if(tokenId&&manageToken)await fetch(apiBase+'/api/emergency/revoke',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tokenId,manageToken})}).catch(()=>{});
  // Prefer the server: it also removes doctor share links and does not need a recent sign-in.
  const idToken=await firebaseUser.getIdToken(true);
  const res=await fetch(apiBase+'/api/account/delete',{method:'POST',headers:{'Authorization':`Bearer ${idToken}`}}).catch(()=>null);
  if(res&&res.ok){clearLocal();try{await auth.signOut();}catch(_){}window.location.reload();return;}
  if(res&&res.status!==503&&res.status!==404){const b=await res.json().catch(()=>({}));throw new Error(b.error||`Server returned HTTP ${res.status}`);}
  // Server unavailable: delete what the client is allowed to delete.
  if(db){
    const userRef=db.collection('users').doc(firebaseUser.uid);
    try{const entries=await userRef.collection('entries').get();for(let i=0;i<entries.docs.length;i+=400){const batch=db.batch();entries.docs.slice(i,i+400).forEach(d=>batch.delete(d.ref));await batch.commit();}}catch(e){console.warn('Could not delete record entries:',e);}
    await userRef.delete();
  }
  clearLocal();
  await firebaseUser.delete();window.location.reload();
 }catch(error){console.error('Account deletion failed:',error);if(status)status.textContent='Deletion failed: '+(error?.message||'unknown error')+'. Recent sign-in may be required.';}
}
document.getElementById('deleteAccountBtn')?.addEventListener('click',deleteAccountAndData);

document.getElementById('logoutBtn').addEventListener('click', async function(){
   try { await firebaseLogout(); } catch (error) { console.error('Logout failed:', error); }
   localStorage.removeItem('swasth_loggedIn');
   localStorage.removeItem('swasth_abhaId');

   dashboard.style.display = 'none';
   loginScreen.style.display = 'flex';
   const aiDock = document.getElementById('aiAssistantDock');
   if (aiDock) aiDock.style.display = 'none';
   aiChatWindow.classList.remove('open');
   loginForm.reset();
   idError.style.display = 'none';
   pwError.style.display = 'none';
   setAuthMode('login');
   document.getElementById('medToast').classList.remove('show');
 });

 document.getElementById('togglePwBtn').addEventListener('click', function() {
 const show = pwInput.type === 'password';
 pwInput.type = show ? 'text' : 'password';
 this.setAttribute('aria-pressed', String(show));
 this.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
 this.querySelector('use')?.setAttribute('href', show ? '#i-eye-off' : '#i-eye');
 });

 /* =========================================================
 2. NAVIGATION
 Five sections in the header (bottom bar on phones); a section with more
 than one screen shows a segmented control under its title. Everything
 navigates through showTab(panelName).
 ========================================================= */
 const NAV_GROUPS = {
   home:      { title: 'Home',      tabs: [['home', 'Home']] },
   records:   { title: 'Records',   tabs: [['records', 'Your record'], ['timeline', 'Timeline'], ['doctor', 'Doctor summary'], ['share', 'Share and export']] },
   medicines: { title: 'Medicines', tabs: [['mymeds', 'My medicines'], ['scan', 'Scan prescription'], ['order', 'Find medicines']] },
   health:    { title: 'Health',    tabs: [['vitals', 'Vitals'], ['nutrition', 'Nutrition'], ['predict', 'Heart risk']] },
   // Emergency is a top-level destination of its own: in a crisis it must be one tap away.
   emergency: { title: 'Emergency card', tabs: [['emergency', 'Emergency card']] },
   account:   { title: 'Account',   tabs: [['profile', 'Profile'], ['register', 'Family']] }
 };
 const TAB_GROUP = {};
 Object.entries(NAV_GROUPS).forEach(([group, def]) => def.tabs.forEach(([tab]) => { TAB_GROUP[tab] = group; }));
 const lastTabInGroup = {};

 function onTabShown(tab) {
   if (tab === 'predict') { animateRiskMeter(); window.prefillRiskFromVitals?.(); prefillRiskFromRecord(); }
   if (tab === 'nutrition') window.renderNutritionUpgrades?.();
   if (tab === 'vitals') window.renderVitals?.();
   if (tab === 'mymeds') window.renderMyMedicines?.();
   if (tab === 'emergency') {
     if (typeof wakeSwasthServer === 'function') wakeSwasthServer();
     if (!qrGenerated) { generateEmergencyQR(); qrGenerated = true; }
   }
 }

 function showTab(tab, options = {}) {
   if (!document.getElementById('panel-' + tab)) tab = 'home';
   const group = TAB_GROUP[tab] || 'home';
   const def = NAV_GROUPS[group];
   lastTabInGroup[group] = tab;
   document.querySelectorAll('.panel').forEach(panel => panel.classList.toggle('active', panel.id === 'panel-' + tab));
   document.querySelectorAll('[data-group]').forEach(btn => {
     if (btn.dataset.group === group) btn.setAttribute('aria-current', 'page'); else btn.removeAttribute('aria-current');
   });
   const head = document.getElementById('pageHead');
   const sub = document.getElementById('subnav');
   if (head) head.hidden = group === 'home';
   const title = document.getElementById('pageTitle');
   if (title) title.textContent = def.title;
   if (sub) {
     sub.hidden = def.tabs.length < 2;
     sub.setAttribute('aria-label', `${def.title} sections`);
     sub.innerHTML = def.tabs.map(([t, label]) =>
       `<button type="button" role="tab" data-tab="${t}" aria-selected="${t === tab}" tabindex="${t === tab ? 0 : -1}">${label}</button>`).join('');
   }
   const label = def.tabs.find(([t]) => t === tab)?.[1] || def.title;
   document.title = group === 'home' ? 'SwasthID — Your health record, medicines and emergency card' : `${label} · SwasthID`;
   if (!options.keepScroll) window.scrollTo({ top: 0 });
   onTabShown(tab);
 }
 window.showTab = showTab;

 function setAccountMenu(open) {
   const btn = document.getElementById('accountBtn'), menu = document.getElementById('accountMenu');
   if (!btn || !menu) return;
   btn.setAttribute('aria-expanded', String(open));
   menu.classList.toggle('open', open);
   if (open) menu.querySelector('[role="menuitem"]')?.focus();
 }
 document.getElementById('accountBtn')?.addEventListener('click', e => {
   e.stopPropagation();
   setAccountMenu(document.getElementById('accountBtn').getAttribute('aria-expanded') !== 'true');
 });
 document.addEventListener('click', e => {
   if (!e.target.closest('#accountMenu')) setAccountMenu(false);
   const groupBtn = e.target.closest('[data-group]');
   if (groupBtn) { showTab(lastTabInGroup[groupBtn.dataset.group] || NAV_GROUPS[groupBtn.dataset.group].tabs[0][0]); return; }
   const subBtn = e.target.closest('#subnav [data-tab]');
   if (subBtn) { showTab(subBtn.dataset.tab, { keepScroll: true }); return; }
   const go = e.target.closest('[data-go]');
   if (go) { e.preventDefault(); setAccountMenu(false); showTab(go.dataset.go); }
 });
 document.addEventListener('keydown', e => {
   if (e.key === 'Escape' && document.getElementById('accountBtn')?.getAttribute('aria-expanded') === 'true') {
     setAccountMenu(false); document.getElementById('accountBtn').focus(); return;
   }
   const tab = e.target.closest?.('#subnav [role="tab"]');
   if (tab && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
     const tabs = [...document.querySelectorAll('#subnav [role="tab"]')];
     const next = tabs[(tabs.indexOf(tab) + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
     showTab(next.dataset.tab, { keepScroll: true });
     document.querySelector(`#subnav [data-tab="${next.dataset.tab}"]`)?.focus();
   }
 });
 showTab('home', { keepScroll: true });
 const footerYear = document.getElementById('footerYear');
 if (footerYear) footerYear.textContent = String(new Date().getFullYear());
