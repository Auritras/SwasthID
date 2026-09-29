 /* =========================================================
    FIREBASE DATA + AUTHENTICATION LAYER
    ========================================================= */
 const firebaseConfigAvailable = () => {
   const cfg = window.SWASTH_FIREBASE_CONFIG;
   return !!(cfg && cfg.apiKey && cfg.authDomain && cfg.projectId && cfg.appId &&
     !String(cfg.apiKey).startsWith('YOUR_') && !String(cfg.projectId).startsWith('YOUR_'));
 };

 let db = null;
 let auth = null;
 let firebaseUser = null;
 let cloudSyncReady = false;
 let firebaseInitPromise = null;
 let authLoadSequence = 0;

 const CLOUD_KEYS = [
   'swasth_abhaId',
   'swasth_calorieTarget',
   'swasth_dailyMood',
   'swasth_medStatus',
   'swasth_foodLogs',
   'swasth_prescriptions',
   'swasth_pendingMedicineSearch',
   'swasth_emergencyContact',
   'swasth_chatHistory',
  'swasth_riskInputs', 'swasth_clinicalRiskResult',
   'swasth_waterIntake',
   'swasth_profile_medications',
   'swasth_emergencyManageToken', 'swasth_emergencyTokenId', 'swasth_emergencyExpiresAt', 'swasth_emergencyQrCache',
   'swasth_emergencyVisibility', 'swasth_dependents', 'swasth_activeDoctorShare',
   'swasth_vitals'
 ];

 function cloudDoc() {
   if (!db || !firebaseUser) return null;
   return db.collection('users').doc(firebaseUser.uid);
 }

 function safeJsonParse(value, fallback = null) {
   try { return JSON.parse(value); } catch (_) { return fallback; }
 }

 async function initFirebaseDataLayer() {
   if (firebaseInitPromise) return firebaseInitPromise;
   firebaseInitPromise = (async () => {
     if (!firebaseConfigAvailable()) {
       console.warn('Firebase is not configured. SwasthID will use local demo mode.');
       return false;
     }

     try {
       await ensureFirebaseLoaded();
       if (!firebase.apps.length) firebase.initializeApp(window.SWASTH_FIREBASE_CONFIG);
       auth = firebase.auth();
       db = firebase.firestore();
       // Local Firebase emulators, set by the server in tests and local
       // development. Ignored anywhere but localhost.
       const emu = window.SWASTH_EMULATORS;
       if (emu && ['localhost', '127.0.0.1'].includes(location.hostname)) {
         auth.useEmulator(emu.auth, { disableWarnings: true });
         const [host, port] = String(emu.firestore).split(':');
         db.useEmulator(host, Number(port));
       }

       // Keep the Firebase session after refresh/browser restart. Firestore is the
       // source of truth for the user's profile and app data; localStorage is only
       // a browser cache.
       await auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);

       auth.onAuthStateChanged(async user => {
         firebaseUser = user || null;
         if (user) {
           try { await user.reload(); } catch (_) {}
           if (!user.emailVerified) {
             try { await auth.signOut(); } catch (_) {}
             firebaseUser = null;
             cloudSyncReady = false;
             clearCloudCacheForUserSwitch();
             return;
           }
           cloudSyncReady = await loadCloudState();
           profileOnboardingRequired = !isProfileActuallyComplete();
           if (document.getElementById('dashboard')?.style.display === 'block') {
             renderPersonalizedUI();
           }
         } else {
           cloudSyncReady = false;
           clearCloudCacheForUserSwitch();
         }
       });

       const existingUser = auth.currentUser;
       if (existingUser) {
         firebaseUser = existingUser;
         cloudSyncReady = await loadCloudState();
       }
       return true;
     } catch (error) {
       console.error('Firebase initialization failed:', error);
       cloudSyncReady = false;
       return false;
     }
   })();
   return firebaseInitPromise;
 }

 function createBlankPersonalizedProfile(email = '') {
   const localPart = String(email || '').split('@')[0].replace(/[._-]+/g, ' ').trim();
   const guessedName = localPart ? localPart.replace(/\b\w/g, c => c.toUpperCase()) : 'SwasthID User';
   return {
     name: guessedName,
     firstName: '',
     middleName: '',
     lastName: '',
     email: email || '',
     ownerUid: firebaseUser?.uid || '',
     ownerEmail: email || firebaseUser?.email || '',
     occupation: '',
     photo: '',
     profileCompleted: false,
     dob: '',
     bloodGroup: '',
     conditions: [],
     medications: [],
     allergies: [],
     normalAllergies: [],
     lifestyle: { smoking: '', alcohol: '' },
     vitals: { height: '', weight: '', bmi: '' },
     nutrition: { calorieTarget: 2200, targetSource: 'Personal benchmark' },
     labs: {},
     emergencyContact: { name: '', relation: '', phone: '' },
     insurance: { provider: '', policyNumber: '' },
     doctors: [],
     visits: [],
     reports: []
   };
 }

 const PROFILE_CACHE_PREFIX = 'swasth_profile_cache_';
const PROFILE_SKIP_PREFIX = 'swasth_profile_skip_';
function accountCacheKey(prefix, email = '') {
  const normalized = String(email || firebaseUser?.email || '').trim().toLowerCase();
  return normalized ? prefix + encodeURIComponent(normalized) : '';
}
function cacheProfileLocally() {
  const key = accountCacheKey(PROFILE_CACHE_PREFIX);
  if (!key || !firebaseUser) return;
  try { localStorage.setItem(key, JSON.stringify(patientData)); } catch (e) { console.warn('Local profile cache failed:', e); }
}
function getCachedProfileForCurrentAccount() {
  const key = accountCacheKey(PROFILE_CACHE_PREFIX);
  if (!key) return null;
  try {
    const value = safeJsonParse(localStorage.getItem(key), null);
    return value && typeof value === 'object' ? value : null;
  } catch (_) { return null; }
}
function setProfileSkippedForCurrentAccount(skipped = true) {
  const key = accountCacheKey(PROFILE_SKIP_PREFIX);
  if (!key) return;
  try { if (skipped) localStorage.setItem(key, 'true'); else localStorage.removeItem(key); } catch (_) {}
}
function isProfileSkippedForCurrentAccount() {
  const key = accountCacheKey(PROFILE_SKIP_PREFIX);
  return !!key && localStorage.getItem(key) === 'true';
}

function clearCloudCacheForUserSwitch() {
   if (typeof stopRecordSync === 'function') stopRecordSync();
   CLOUD_KEYS.forEach(key => localStorage.removeItem(key));
   // An unfinished profile draft belongs to whoever typed it.
   localStorage.removeItem('swasth_profileWizardDraft');
   localStorage.removeItem('swasth_doseReminders');
   localStorage.removeItem('swasth_profileWizardStep');
   localStorage.removeItem('swasth_addedKcal');
   localStorage.removeItem('swasth_stepsToday');
   localStorage.removeItem('swasth_lastActiveDate');
   localStorage.removeItem('swasth_profile_medications');
   if (typeof window.__resetSwasthAIChat === 'function') {
     try { window.__resetSwasthAIChat(); } catch (error) { console.warn('AI chat reset skipped:', error); }
   }
 }

 function isSeedDemoProfile(profile) {
   if (!profile || typeof profile !== 'object') return false;
   const name = String(profile.name || '').trim().toLowerCase();
   const email = String(profile.email || '').trim().toLowerCase();
   const meds = Array.isArray(profile.medications) ? profile.medications.map(m => String(m?.name || '').toLowerCase()).join(' ') : '';
   const conditions = Array.isArray(profile.conditions) ? profile.conditions.map(c => String(c?.name || '').toLowerCase()).join(' ') : '';

   // The original prototype seeded Aditya Sharma's health data. That seed must never
   // appear in a newly authenticated user's account, even if the Firebase document
   // has already been created with a different email address.
   const looksLikePrototypePatient =
     name === 'aditya sharma' &&
     (meds.includes('thyroxine') || meds.includes('vitamin d3') || conditions.includes('hypothyroidism'));

   return looksLikePrototypePatient || email === 'aditya.sharma@abdm';
 }

 function profileBelongsToCurrentAccount(profile) {
   if (!profile || typeof profile !== 'object' || !firebaseUser) return false;
   const ownerUid = String(profile.ownerUid || '').trim();
   const ownerEmail = String(profile.ownerEmail || profile.email || '').trim().toLowerCase();
   if (ownerUid) return ownerUid === firebaseUser.uid;
   return !!ownerEmail && ownerEmail === String(firebaseUser.email || '').trim().toLowerCase();
 }

 function resetAuthenticatedUserToBlankProfile() {
   const email = firebaseUser?.email || '';
   const blankProfile = createBlankPersonalizedProfile(email);
   Object.keys(patientData).forEach(key => delete patientData[key]);
   Object.assign(patientData, blankProfile);
   clearCloudCacheForUserSwitch();
   profileOnboardingRequired = true;
   return blankProfile;
 }

 async function loadCloudState() {
   const userAtStart = firebaseUser;
   const uidAtStart = userAtStart?.uid || '';
   if (!uidAtStart || !db) {
     if (firebaseUser) resetAuthenticatedUserToBlankProfile();
     return false;
   }
   const loadSequence = ++authLoadSequence;
   const ref = db.collection('users').doc(uidAtStart);

   // Start every account load from a blank in-memory profile so the previous
   // account's name and health data can never remain visible during the switch.
   resetAuthenticatedUserToBlankProfile();

   try {
     const snap = await ref.get();
     if (loadSequence !== authLoadSequence || firebaseUser?.uid !== uidAtStart) return false;
     let data = snap.exists ? snap.data() : {};
     let localState = data.localState || {};

     // Never carry user-owned app-state cached data from another Firebase account.
     // Profile data is separately keyed by Firebase email so it can survive a
     // Firestore write failure without leaking between accounts.
     const accountProfileCache = getCachedProfileForCurrentAccount();
     clearCloudCacheForUserSwitch();

     // Older prototype builds stored the demo patient's health profile in Firestore.
     // Never show that seed data to a real Firebase account. Treat it as an uninitialized
     // profile and start the account with a clean personalized record.
     if (isSeedDemoProfile(data.profile)) {
       const blankProfile = createBlankPersonalizedProfile(firebaseUser.email || '');
       Object.keys(patientData).forEach(key => delete patientData[key]);
       Object.assign(patientData, blankProfile);
       localState = {};
       data = { ...data, profile: blankProfile, localState: {} };
       await ref.set({
         profile: blankProfile,
         localState: {},
         updatedAt: firebase.firestore.FieldValue.serverTimestamp()
       }, { merge: true });
     } else {
       // Cloud data is the source of truth when present; localStorage remains a cache/fallback.
       CLOUD_KEYS.forEach(key => {
         if (Object.prototype.hasOwnProperty.call(localState, key)) {
           const value = localState[key];
           // Older builds synced missing keys as null; never turn that into the string "null".
           if (value === null || value === undefined) localStorage.removeItem(key);
           else localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
         }
       });

       if (data.profile && typeof data.profile === 'object' && profileBelongsToCurrentAccount(data.profile)) {
         Object.assign(patientData, data.profile);
       } else if (data.profile && typeof data.profile === 'object') {
         // Reject profile data that is not bound to the authenticated Firebase account.
         const blankProfile = createBlankPersonalizedProfile(firebaseUser.email || '');
         Object.keys(patientData).forEach(key => delete patientData[key]);
         Object.assign(patientData, blankProfile);
         localState = {};
         await ref.set({ profile: blankProfile, localState: {}, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
       }
       // If Firestore contains only an old/blank profile (or a previous save failed),
       // restore this account's locally cached profile. This is account-keyed and is
       // only a persistence fallback; Firestore remains the preferred source of truth.
       if (accountProfileCache && !isProfileActuallyComplete()) {
         Object.assign(patientData, accountProfileCache);
       }
     }
     patientData.email = firebaseUser.email || patientData.email || '';
     if (patientData.onboardingSkipped === true) setProfileSkippedForCurrentAccount(true);

     const savedTarget = localStorage.getItem('swasth_calorieTarget');
     if (savedTarget) {
       const n = Number(savedTarget);
       if (Number.isFinite(n) && n >= 800 && n <= 6000 && patientData.nutrition) {
         patientData.nutrition.calorieTarget = n;
       }
     }

     // If this is a brand-new account, start with a blank personalized profile instead
     // of copying the demo patient's health information into the new user's account.
     if (!snap.exists) {
       const blankProfile = createBlankPersonalizedProfile(firebaseUser.email || '');
       Object.keys(patientData).forEach(key => delete patientData[key]);
       Object.assign(patientData, blankProfile);
       await ref.set({
         profile: blankProfile,
         localState: {},
         createdAt: firebase.firestore.FieldValue.serverTimestamp(),
         updatedAt: firebase.firestore.FieldValue.serverTimestamp()
       }, { merge: true });
     }
     if (loadSequence !== authLoadSequence || firebaseUser?.uid !== uidAtStart) return false;
     await initRecordSync(localState, data.profile);
     if (loadSequence !== authLoadSequence || firebaseUser?.uid !== uidAtStart) return false;
     return true;
   } catch (error) {
     if (loadSequence !== authLoadSequence || firebaseUser?.uid !== uidAtStart) return false;
     console.error('Could not load Firestore data:', error);

     // Authentication succeeded, but Firestore may still be unavailable because
     // rules have not been published yet. Never fall back to the prototype patient's
     // hardcoded health data for an authenticated user. Start this account clean and
     // send the user through the profile onboarding flow instead.
     if (firebaseUser) {
       const cachedProfile = getCachedProfileForCurrentAccount();
       resetAuthenticatedUserToBlankProfile();
       if (cachedProfile) {
         Object.assign(patientData, cachedProfile);
         patientData.email = firebaseUser.email || patientData.email || '';
       }
     }
     return false;
   }
 }

 // Cloud saves are silent when they work. When one fails, the change stays on this
 // device, the user is told once, and the save is retried automatically.
 const pendingCloudKeys = new Set();
 let cloudSaveWarned = false;
 let cloudRetryTimer = null;
 function retryPendingCloudSaves() {
   clearTimeout(cloudRetryTimer); cloudRetryTimer = null;
   if (!pendingCloudKeys.size || !firebaseUser || !db) return;
   const keys = [...pendingCloudKeys]; pendingCloudKeys.clear();
   keys.forEach(key => key === '__profile' ? syncProfileToCloud() : syncCloudState(key));
 }
 function noteCloudSaveResult(ok, key) {
   if (ok) {
     cloudSaveWarned = false;
     if (pendingCloudKeys.size && !cloudRetryTimer) cloudRetryTimer = setTimeout(retryPendingCloudSaves, 500);
     return;
   }
   if (key) pendingCloudKeys.add(key);
   if (!cloudRetryTimer) cloudRetryTimer = setTimeout(retryPendingCloudSaves, 60000);
   if (!cloudSaveWarned) {
     cloudSaveWarned = true;
     showToast('', 'Not saved to your account yet', 'Your change is kept on this device. SwasthID will keep trying to save it to your account.');
   }
 }
 window.addEventListener('online', retryPendingCloudSaves);
 document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') retryPendingCloudSaves(); });


 /* ---------------------------------------------------------------
    Record sync. Lists (meals, vitals, prescriptions, doses, family,
    lab reports, visits) are stored as one small Firestore document per
    item under users/{uid}/entries, so two devices never overwrite each
    other's items, deletions are explicit, and the account is not
    limited by Firestore's 1 MB-per-document cap. A live listener keeps
    open devices up to date. If the security rules for entries have not
    been published yet, everything falls back to the older whole-list
    storage in the user document.
    --------------------------------------------------------------- */
 function stableHash(text) {
   let h = 0x811c9dc5;
   for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
   return (h >>> 0).toString(36) + text.length.toString(36);
 }
 function listEntries(items) {
   const map = new Map();
   (Array.isArray(items) ? items : []).forEach(item => {
     if (!item || typeof item !== 'object') return;
     const json = JSON.stringify(item);
     map.set(item.id != null && item.id !== '' ? String(item.id) : 'c' + stableHash(json), json);
   });
   return map;
 }
 function storageList(key, sortFn) {
   return {
     read: () => listEntries(safeJsonParse(localStorage.getItem(key) || '[]', [])),
     write: map => {
       const items = [...map.values()].map(v => safeJsonParse(v, null)).filter(Boolean);
       if (sortFn) items.sort(sortFn);
       if (items.length) localStorage.setItem(key, JSON.stringify(items)); else localStorage.removeItem(key);
     },
     legacyField: `localState.${key}`
   };
 }
 function profileList(field) {
   return {
     read: () => listEntries(patientData[field]),
     write: map => {
       patientData[field] = [...map.values()].map(v => safeJsonParse(v, null)).filter(Boolean)
         .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
     },
     legacyField: `profile.${field}`
   };
 }
 const byTime = field => (a, b) => new Date(a[field] || 0) - new Date(b[field] || 0);
 const RECORD_COLLECTIONS = {
   swasth_foodLogs: storageList('swasth_foodLogs', (a, b) => Number(a.id || 0) - Number(b.id || 0)),
   swasth_vitals: storageList('swasth_vitals', byTime('at')),
   swasth_prescriptions: storageList('swasth_prescriptions', (a, b) => new Date(b.date || 0) - new Date(a.date || 0)),
   swasth_dependents: storageList('swasth_dependents', (a, b) => String(b.id).localeCompare(String(a.id))),
   'profile.reports': profileList('reports'),
   'profile.visits': profileList('visits'),
   swasth_medStatus: {
     // History events and today's "taken" flags become separate entries.
     read: () => {
       const status = safeJsonParse(localStorage.getItem('swasth_medStatus') || '{}', {});
       const map = new Map();
       (Array.isArray(status.history) ? status.history : []).forEach(e => { if (e) map.set(`h:${e.id}|${e.date}`, JSON.stringify(e)); });
       Object.entries(status).forEach(([k, v]) => { if (k !== 'history' && v) map.set(`f:${k}`, JSON.stringify(v)); });
       return map;
     },
     write: map => {
       const status = { history: [] };
       map.forEach((json, k) => {
         const v = safeJsonParse(json, null); if (!v) return;
         if (k.startsWith('h:')) status.history.push(v); else status[k.slice(2)] = v;
       });
       status.history.sort(byTime('date'));
       localStorage.setItem('swasth_medStatus', JSON.stringify(status));
     },
     legacyField: 'localState.swasth_medStatus'
   }
 };
 let recordSyncMode = 'legacy';          // 'entries' once the entries collection is readable
 let recordSyncUid = '';
 let recordSyncUnsubscribe = null;
 const recordBase = new Map();           // collection -> Map(entryKey -> json) as last seen in the cloud
 const recordQueues = new Map();
 let recordRenderTimer = null;

 function entriesRef() { return cloudDoc()?.collection('entries') || null; }
 function entryDocId(collection, key) {
   const id = `${collection}~${encodeURIComponent(key)}`;
   return id.length > 700 ? `${collection}~h${stableHash(key)}` : id;
 }
 function stopRecordSync() {
   if (recordSyncUnsubscribe) { try { recordSyncUnsubscribe(); } catch (_) {} }
   recordSyncUnsubscribe = null; recordSyncMode = 'legacy'; recordSyncUid = ''; recordBase.clear();
 }

 // Write only what changed since the cloud copy we know, and delete only what
 // this device actually removed.
 function syncRecordCollection(collection) {
   const adapter = RECORD_COLLECTIONS[collection];
   const col = entriesRef();
   if (!adapter || !col || recordSyncMode !== 'entries') return Promise.resolve(false);
   const uid = recordSyncUid;
   const prev = recordQueues.get(collection) || Promise.resolve();
   const next = prev.catch(() => {}).then(async () => {
     if (recordSyncUid !== uid) return false;
     const base = recordBase.get(collection) || new Map();
     const current = adapter.read();
     const ops = [];
     current.forEach((json, k) => { if (base.get(k) !== json) ops.push(['set', k, json]); });
     base.forEach((_, k) => { if (!current.has(k)) ops.push(['delete', k]); });
     for (let i = 0; i < ops.length; i += 400) {
       const batch = db.batch();
       ops.slice(i, i + 400).forEach(([op, k, json]) => {
         const doc = col.doc(entryDocId(collection, k));
         if (op === 'set') batch.set(doc, { c: collection, k, v: json, t: firebase.firestore.FieldValue.serverTimestamp() });
         else batch.delete(doc);
       });
       await batch.commit();
     }
     if (recordSyncUid === uid) recordBase.set(collection, new Map(current));
     noteCloudSaveResult(true);
     return true;
   }).catch(error => {
     console.error('Record sync failed for', collection, error?.code || '', error);
     noteCloudSaveResult(false, collection);
     return false;
   });
   recordQueues.set(collection, next);
   return next;
 }

 // Three-way merge: start from the cloud, then re-apply this device's changes
 // that the cloud has not seen yet (relative to the last known cloud copy).
 function mergeRecordMaps(base, local, remote) {
   const out = new Map(remote);
   local.forEach((json, k) => { if (base.get(k) !== json) out.set(k, json); });
   base.forEach((_, k) => { if (!local.has(k)) out.delete(k); });
   return out;
 }
 function sameMap(a, b) { if (a.size !== b.size) return false; for (const [k, v] of a) if (b.get(k) !== v) return false; return true; }

 function scheduleRecordRender() {
   clearTimeout(recordRenderTimer);
   recordRenderTimer = setTimeout(() => {
     try {
       if (typeof syncTodayCalories === 'function') syncTodayCalories();
       if (typeof renderTodayFoodLogs === 'function') renderTodayFoodLogs();
       if (document.getElementById('dashboard')?.style.display === 'block') renderPersonalizedUI();
       if (typeof renderMedicationInsights === 'function') renderMedicationInsights();
     } catch (e) { console.warn('Refresh after sync failed:', e); }
   }, 120);
 }

 async function initRecordSync(legacyState, legacyProfile) {
   stopRecordSync();
   const col = entriesRef();
   if (!col || !firebaseUser) return;
   const uid = firebaseUser.uid;
   let snap;
   try { snap = await col.get(); }
   catch (error) {
     console.warn('Per-record sync unavailable (publish the updated firestore.rules); using whole-list storage.', error?.code || error);
     return;
   }
   if (firebaseUser?.uid !== uid) return;
   recordSyncMode = 'entries'; recordSyncUid = uid;
   const remote = new Map(Object.keys(RECORD_COLLECTIONS).map(c => [c, new Map()]));
   snap.forEach(doc => { const d = doc.data(); if (remote.has(d.c) && typeof d.v === 'string') remote.get(d.c).set(d.k, d.v); });
   const cleanup = {};
   for (const [collection, adapter] of Object.entries(RECORD_COLLECTIONS)) {
     // Items still in the old whole-list fields are merged in once, then those fields are removed.
     const legacy = adapter.read();
     const merged = new Map(remote.get(collection));
     legacy.forEach((json, k) => { if (!merged.has(k)) merged.set(k, json); });
     adapter.write(merged);
     recordBase.set(collection, remote.get(collection));
     const [scope, field] = adapter.legacyField.split('.');
     const hadLegacy = scope === 'profile' ? Array.isArray(legacyProfile?.[field]) : legacyState && Object.prototype.hasOwnProperty.call(legacyState, field);
     if (hadLegacy) { cleanup[scope] = cleanup[scope] || {}; cleanup[scope][field] = firebase.firestore.FieldValue.delete(); }
   }
   await Promise.all(Object.keys(RECORD_COLLECTIONS).map(c => syncRecordCollection(c)));
   if (Object.keys(cleanup).length && firebaseUser?.uid === uid) {
     try { await cloudDoc().set(cleanup, { merge: true }); } catch (e) { console.warn('Could not remove old list fields:', e); }
   }
   if (firebaseUser?.uid !== uid) return;
   recordSyncUnsubscribe = col.onSnapshot(live => {
     if (recordSyncUid !== uid) return;
     const touched = new Set();
     const remoteNow = new Map(Object.keys(RECORD_COLLECTIONS).map(c => [c, new Map()]));
     live.forEach(doc => { const d = doc.data(); if (remoteNow.has(d.c) && typeof d.v === 'string') remoteNow.get(d.c).set(d.k, d.v); });
     live.docChanges().forEach(ch => { const c = ch.doc.data()?.c; if (c) touched.add(c); });
     touched.forEach(collection => {
       const adapter = RECORD_COLLECTIONS[collection]; if (!adapter) return;
       const base = recordBase.get(collection) || new Map();
       const local = adapter.read();
       const merged = mergeRecordMaps(base, local, remoteNow.get(collection));
       recordBase.set(collection, remoteNow.get(collection));
       if (!sameMap(merged, local)) { adapter.write(merged); scheduleRecordRender(); }
       if (!sameMap(merged, remoteNow.get(collection))) syncRecordCollection(collection);
     });
   }, error => console.warn('Live sync stopped:', error));
 }

 async function syncCloudState(changedKey) {
   // Do not make the in-memory cloudSyncReady flag the gate for persistence.
   // Firebase Auth/Firestore can finish initializing a moment after a login, and
   // the old gate could silently leave data only in localStorage. If a signed-in
   // Firebase user and Firestore are available, always attempt the write.
   if (!firebaseUser || !db) return false;
   if (RECORD_COLLECTIONS[changedKey] && recordSyncMode === 'entries') return syncRecordCollection(changedKey);
   const ref = cloudDoc();
   if (!ref || !CLOUD_KEYS.includes(changedKey)) return false;
   try {
     const raw = localStorage.getItem(changedKey);
     const value = raw === null ? firebase.firestore.FieldValue.delete() : (safeJsonParse(raw, raw));
     await ref.set({
       localState: { [changedKey]: value },
       updatedAt: firebase.firestore.FieldValue.serverTimestamp()
     }, { merge: true });
     cloudSyncReady = true;
     noteCloudSaveResult(true);
     return true;
   } catch (error) {
     console.error('Firestore sync failed for', changedKey, error?.code || '', error);
     cloudSyncReady = false;
     noteCloudSaveResult(false, changedKey);
     return false;
   }
 }

 async function clearAndSyncCloudKey(key) {
   localStorage.removeItem(key);
   await syncCloudState(key);
 }

 async function syncProfileToCloud() {
   // Same rule as syncCloudState: if Auth and Firestore are ready, attempt the
   // write even when cloudSyncReady is temporarily false. This prevents a race
   // between Firebase login/auth-state callbacks from turning a real save into a
   // local-only save.
   if (!firebaseUser || !db) return false;
   const ref = cloudDoc();
   if (!ref) return false;
   try {
     const profile = { ...patientData, ownerUid: firebaseUser.uid, ownerEmail: firebaseUser.email || '', email: firebaseUser.email || patientData.email || '' };
     if (recordSyncMode === 'entries') {
       // Lab reports and visits are stored as separate records; keep them out of the profile document.
       profile.reports = firebase.firestore.FieldValue.delete();
       profile.visits = firebase.firestore.FieldValue.delete();
     }
     await ref.set({
       profile,
       updatedAt: firebase.firestore.FieldValue.serverTimestamp()
     }, { merge: true });
     if (recordSyncMode === 'entries') await Promise.all([syncRecordCollection('profile.reports'), syncRecordCollection('profile.visits')]);
     cloudSyncReady = true;
     cacheProfileLocally();
     noteCloudSaveResult(true);
     return true;
   } catch (error) {
     console.error('Profile sync failed:', error?.code || '', error);
     cloudSyncReady = false;
     cacheProfileLocally();
     noteCloudSaveResult(false, '__profile');
     return false;
   }
 }

 async function migrateLocalDataToCloud() {
   if (!cloudSyncReady || !firebaseUser) return;
   for (const key of CLOUD_KEYS) await syncCloudState(key);
   await syncProfileToCloud();
 }

 function firebaseAuthErrorMessage(error) {
   const code = error && error.code ? error.code : '';
   const messages = {
     'auth/invalid-email': 'Please enter a valid email address.',
     'auth/user-not-found': 'No Firebase account exists for this address. Use Create account first.',
     'auth/wrong-password': 'Incorrect password. Try again or use Forgot Password.',
     'auth/invalid-credential': 'The email or password is incorrect.',
     'auth/email-already-in-use': 'An account already exists for this address. Use Login instead.',
     'auth/weak-password': 'Password must be at least 6 characters.',
     'auth/network-request-failed': 'Network error. Check your internet connection and try again.',
     'auth/too-many-requests': 'Too many attempts. Please wait a while and try again.',
     'auth/email-not-verified': 'Please verify your email address before signing in. Check your inbox (and spam folder) for the verification link.'
   };
   return messages[code] || (error && error.message) || 'Authentication failed. Please try again.';
 }

 async function firebaseLogin(email, password) {
   if (!auth) throw new Error('Firebase Authentication is not initialized.');
   const credential = await auth.signInWithEmailAndPassword(email, password);
   firebaseUser = credential.user;
   await credential.user.reload();
   if (!credential.user.emailVerified) {
     try { await credential.user.sendEmailVerification(); } catch (_) {}
     await auth.signOut();
     firebaseUser = null;
     throw Object.assign(new Error('Please verify your email address before signing in. A new verification email has been sent.'), { code: 'auth/email-not-verified' });
   }
   cloudSyncReady = await loadCloudState();
   profileOnboardingRequired = !isProfileActuallyComplete();
   if (cloudSyncReady) await migrateLocalDataToCloud();
   return credential.user;
 }

 async function firebaseCreateAccount(email, password) {
   if (!auth) throw new Error('Firebase Authentication is not initialized.');
   const credential = await auth.createUserWithEmailAndPassword(email, password);
   firebaseUser = credential.user;
   try { await credential.user.sendEmailVerification(); } catch (verificationError) { console.warn('Verification email could not be sent:', verificationError); }

   // A new Firebase account must start with a clean user-owned cache.
   clearCloudCacheForUserSwitch();
   const blankProfile = createBlankPersonalizedProfile(email);
   Object.keys(patientData).forEach(key => delete patientData[key]);
   Object.assign(patientData, blankProfile);
   cacheProfileLocally();
   setProfileSkippedForCurrentAccount(false);
   localStorage.setItem('swasth_abhaId', email);
   cloudSyncReady = false;
   try {
     await cloudDoc().set({
       profile: blankProfile,
       localState: { swasth_abhaId: email },
       createdAt: firebase.firestore.FieldValue.serverTimestamp(),
       updatedAt: firebase.firestore.FieldValue.serverTimestamp()
     }, { merge: true });
     cloudSyncReady = true;
   } catch (error) {
     console.error('Account created, but Firestore profile could not be written yet:', error);
     // Auth account remains valid. The user can continue locally until Firestore rules
     // are published; the next login will retry the cloud connection.
   }
   return { user: credential.user, cloudReady: cloudSyncReady };
 }

 async function firebaseLogout() {
   authLoadSequence++;
   if (auth) await auth.signOut();
   firebaseUser = null;
   cloudSyncReady = false;
 }
