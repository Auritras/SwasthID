/* =========================================================
 10. SCANNABLE EMERGENCY QR PASSPORT
 ========================================================= */
function getEmergencyContact() {
 const contact=patientData?.emergencyContact;
 return contact && typeof contact==='object' ? contact : {name:'',relation:'',phone:''};
}

// Profile medicines plus those from saved prescriptions, without duplicates.
function getEmergencyMedicines() {
 const profileMeds = Array.isArray(patientData.medications) ? patientData.medications : [];
 const rxMeds = getSavedPrescriptions().flatMap(r=>Array.isArray(r.medicines)?r.medicines:[]);
 const key = m => `${String(m.name||m.medicine||'').toLowerCase()}|${String(m.dose||'').toLowerCase()}`;
 return [...profileMeds, ...rxMeds].filter(Boolean).filter((m,i,a)=>a.findIndex(x=>key(x)===key(m))===i).slice(0, 8);
}

function getEmergencyCompactPayload() {
 const contact = getEmergencyContact();
 const visibility=safeJsonParse(localStorage.getItem('swasth_emergencyVisibility')||'{}',{});
 const activeConditions = (patientData.conditions || [])
   .filter(c => String(c.status || 'Ongoing').toLowerCase() !== 'resolved')
   .slice(0, 6)
   .map(c => c.name)
   .filter(Boolean);
 const activeMeds = getEmergencyMedicines().map(m => [m.name || m.medicine, m.dose, m.schedule || m.frequency].filter(Boolean).join(' ')).filter(Boolean);
 const allergies = formatAllergies(patientData.allergies);
 const otherAllergies = formatNormalAllergies(patientData.normalAllergies);
 return {
   v: 5,
   exp: Date.now() + 365 * 24 * 60 * 60 * 1000,
   n: String(patientData.name || 'Unknown patient'),
   bg: visibility.core===false ? '' : String(patientData.bloodGroup || 'Not provided'),
   da: visibility.core===false ? '' : String(allergies || 'No known drug allergies'),
   oa: visibility.core===false ? '' : String(otherAllergies || 'None recorded'),
   c: activeConditions,
   m: visibility.meds===false ? [] : activeMeds,
   ec: [contact.name || '', contact.relation || '', contact.phone || ''],
   ins: visibility.insurance===false ? [] : [patientData.insurance?.provider || '', patientData.insurance?.policyNumber || '']
 };
}

function encodeEmergencyToken(payload) {
 const json = JSON.stringify(payload);
 return btoa(unescape(encodeURIComponent(json)))
   .replace(/\+/g, '-')
   .replace(/\//g, '_')
   .replace(/=+$/g, '');
}

function decodeEmergencyToken(token) {
 try {
   const base64 = String(token).replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((String(token).length + 3) % 4);
   return JSON.parse(decodeURIComponent(escape(atob(base64))));
 } catch (_) { return null; }
}

async function getEmergencyQRText() {
  const compact = getEmergencyCompactPayload();
  let manageToken = localStorage.getItem('swasth_emergencyManageToken');
  if (!manageToken) {
    const bytes = new Uint8Array(24); crypto.getRandomValues(bytes);
    manageToken = Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
    localStorage.setItem('swasth_emergencyManageToken', manageToken);
    if (typeof syncCloudState === 'function') syncCloudState('swasth_emergencyManageToken');
  }
  // Reuse the current badge while the emergency details are unchanged, so every
  // dashboard render does not mint (and store) a new server-side badge.
  const { exp: _ignoredExp, ...signaturePayload } = getEmergencyCompactPayload();
  const signature = JSON.stringify(signaturePayload);
  const cached = safeJsonParse(localStorage.getItem('swasth_emergencyQrCache') || 'null', null);
  if (cached && cached.sig === signature && cached.url && Number(cached.expiresAt) > Date.now() + 86400000) return cached.url;
  compact.manageToken = manageToken;
  const apiBase = getSwasthApiBase();
  if (!apiBase) {
    // Opened as a local file with no server: an unencrypted preview is the only option.
    return encodeEmergencyToken(compact);
  }
  // Several dashboard renders can ask at once; share one request per payload.
  if (emergencyQrInFlight && emergencyQrInFlight.sig === signature) return emergencyQrInFlight.promise;
  const promise = createSecureEmergencyQr(apiBase, compact, signature);
  emergencyQrInFlight = { sig: signature, promise };
  try { return await promise; } finally { if (emergencyQrInFlight?.promise === promise) emergencyQrInFlight = null; }
}

let emergencyQrInFlight = null;

function getSwasthApiBase() {
  return (window.SWASTH_API_BASE || ((location.protocol === 'http:' || location.protocol === 'https:') ? location.origin : '')).replace(/\/$/, '');
}

// A free Render instance sleeps when idle and can take 30+ seconds to wake.
// Ping it early so it is awake by the time a QR is needed.
function wakeSwasthServer() {
  const apiBase = getSwasthApiBase();
  if (apiBase) fetch(apiBase + '/health', { cache: 'no-store' }).catch(() => {});
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(url, { ...options, signal: controller.signal }); }
  finally { clearTimeout(timer); }
}

// Never fall back to an unencrypted QR here: it would carry health data in the
// URL and could not be revoked. Wait for the server (it may be waking), or fail.
async function createSecureEmergencyQr(apiBase, compact, signature) {
  const status = document.getElementById('qrPayloadStatus');
  const attempts = [8000, 45000];
  let lastError = null;
  for (let i = 0; i < attempts.length; i++) {
    if (i > 0 && status) status.textContent = 'Waking up the secure QR service. This can take up to a minute…';
    let res;
    try {
      res = await fetchWithTimeout(apiBase + '/api/emergency/create', {
        method: 'POST',
        headers: {'Content-Type':'application/json','Accept':'application/json'},
        body: JSON.stringify(compact)
      }, attempts[i]);
    } catch (error) {
      lastError = error;
      continue;
    }
    const body = await res.json().catch(() => ({}));
    if (res.ok && body.url) {
      if (body.tokenId) localStorage.setItem('swasth_emergencyTokenId', body.tokenId);
      if (body.expiresAt) localStorage.setItem('swasth_emergencyExpiresAt', String(body.expiresAt));
      localStorage.setItem('swasth_emergencyQrCache', JSON.stringify({ sig: signature, url: body.url, expiresAt: body.expiresAt }));
      if (typeof syncCloudState === 'function') ['swasth_emergencyTokenId', 'swasth_emergencyExpiresAt', 'swasth_emergencyQrCache'].forEach(syncCloudState);
      return body.url;
    }
    // Gateway errors while the instance starts are worth retrying; others are not.
    lastError = new Error(body.error || `Server returned HTTP ${res.status}`);
    if (![502, 503, 504].includes(res.status) || /not configured/i.test(body.error || '')) break;
  }
  console.warn('Secure emergency QR unavailable:', lastError);
  const timedOut = /abort/i.test(String(lastError?.name || lastError));
  const networkError = lastError instanceof TypeError;
  throw new Error(timedOut ? 'The secure QR service did not respond. Check your connection and try again.'
    : networkError ? 'Could not reach the SwasthID server. Check your connection and try again.'
    : (lastError?.message || 'The secure QR service is unavailable.'));
}

async function generateEmergencyQR(force = false) {
 const qrContainer = document.getElementById('realQrContainer');
 if (!qrContainer) return;
 try { await ensureQrCodeLoaded(); } catch (error) {
   qrContainer.innerHTML = '<span class="qr-message is-error">QR library could not be loaded. Check your connection and refresh.</span>';
   console.warn('QRCode library load failed:', error);
   return;
 }
 if (typeof QRCode === 'undefined') return;
 if (!force && qrContainer.dataset.generated) return;
 qrContainer.dataset.generated = 'true';
 qrContainer.innerHTML = '<div class="skeleton qr-skeleton" aria-label="Creating your emergency QR"></div>';
 const pendingStatus = document.getElementById('qrPayloadStatus');
 if (pendingStatus) pendingStatus.textContent = 'Creating a secure QR…';
 qrContainer.style.background = '#fff';
 qrContainer.style.boxShadow = 'none';
 qrContainer.style.border = '1px solid #D3E0E5';
 qrContainer.style.width = '240px';
 qrContainer.style.height = '240px';
 const status = document.getElementById('qrPayloadStatus');
 try {
   const qrText = await getEmergencyQRText();
   qrContainer.innerHTML = '';
   new QRCode(qrContainer, {text: qrText,width:220,height:220,colorDark:'#0F1E26',colorLight:'#ffffff',correctLevel:QRCode.CorrectLevel.M});
   const serverBacked = /emergency=v1\./.test(qrText) || /^v1\./.test(qrText);
   const expiresAt = Number(localStorage.getItem('swasth_emergencyExpiresAt') || 0);
   if (status) status.textContent = serverBacked
     ? `Secure emergency QR ready. The server encrypts the emergency payload. Valid until ${expiresAt ? new Date(expiresAt).toLocaleDateString() : 'its expiry date'} unless you revoke it.`
     : 'Offline preview only: this QR is not encrypted or revocable. Open SwasthID from its website to create a secure QR.';
 } catch (error) {
   qrContainer.innerHTML = '<span class="qr-message is-error">No QR yet. Use Refresh to try again.</span>';
   qrContainer.dataset.generated = '';
   if (status) status.textContent = 'The secure emergency QR could not be created: ' + (error?.message || 'unknown error');
   console.error('Emergency QR generation failed:', error);
 }
}
function showEmergencyPublicView(payload) {
 if (!payload || !payload.n) return;
 const expires = Number(payload.exp || 0);
 const expired = !expires || Date.now() > expires;
 let overlay = document.getElementById('publicEmergencyOverlay');
 if (!overlay) {
   overlay = document.createElement('div');
   overlay.id = 'publicEmergencyOverlay';
   overlay.className = 'public-emergency-overlay';
   document.body.appendChild(overlay);
 }
 if (expired) {
   overlay.innerHTML = `<div class="public-emergency-card"><div class="public-emergency-head"><div><h2>Emergency information unavailable</h2><p>${escapeHtml(payload.reason || 'This QR payload is no longer valid.')}</p></div><span class="public-emergency-badge">${/revoked/i.test(payload.reason || '') ? 'Revoked' : 'Expired'}</span></div><div class="public-emergency-expired">Ask the patient or a caregiver for a new emergency QR. In an emergency, call 112.</div><div class="public-emergency-actions"><a class="btn btn-danger-solid" href="tel:112">Call 112</a><button class="btn" type="button" onclick="document.getElementById('publicEmergencyOverlay').classList.remove('show')">Close</button></div><div class="public-emergency-foot">Verify critical information with the patient or a caregiver when you can.</div></div>`;
 } else {
   const contact = Array.isArray(payload.ec) ? payload.ec : [];
   const contactName = contact[0] || 'Not provided';
   const contactRelation = contact[1] || '';
   const contactPhone = contact[2] || '';
   const conditions = Array.isArray(payload.c) && payload.c.length ? payload.c.join(', ') : 'None recorded';
   const meds = Array.isArray(payload.m) && payload.m.length ? payload.m.join(', ') : 'None recorded';
   const insurance = Array.isArray(payload.ins) && payload.ins.some(Boolean) ? payload.ins.filter(Boolean).join(' · ') : 'Not provided';
   overlay.innerHTML = `<div class="public-emergency-card"><div class="public-emergency-head"><div><h2>${payload.preview ? 'Preview of your emergency card' : 'Emergency health information'}</h2><p>${payload.preview ? 'This is what someone sees after scanning your QR.' : 'Shared by the patient for emergency use. Read only.'}</p></div><span class="public-emergency-badge">${payload.preview ? 'Preview' : 'Emergency'}</span></div><div class="public-emergency-body"><div class="public-emergency-grid"><div class="public-emergency-item full"><label>Patient</label><div>${escapeHtml(payload.n)}</div></div><div class="public-emergency-item"><label>Blood group</label><div>${escapeHtml(payload.bg || 'Not provided')}</div></div><div class="public-emergency-item"><label>Drug allergies</label><div>${escapeHtml(payload.da || 'None recorded')}</div></div><div class="public-emergency-item full"><label>Other allergies</label><div>${escapeHtml(payload.oa || 'None recorded')}</div></div><div class="public-emergency-item full"><label>Conditions</label><div>${escapeHtml(conditions)}</div></div><div class="public-emergency-item full"><label>Daily medicines</label><div>${escapeHtml(meds)}</div></div><div class="public-emergency-item full"><label>Health insurance</label><div>${escapeHtml(insurance)}</div></div><div class="public-emergency-item full"><label>Emergency contact</label><div>${escapeHtml(contactName)}${contactRelation ? ' (' + escapeHtml(contactRelation) + ')' : ''}${contactPhone ? ' · ' + escapeHtml(contactPhone) : ''}</div></div></div><div class="public-emergency-actions"><a class="btn btn-danger-solid" href="tel:112">Call 112</a>${contactPhone ? `<a class="btn" href="tel:${String(contactPhone).replace(/[^+0-9]/g, '')}">Call emergency contact</a>` : ''}<button class="btn" type="button" onclick="document.getElementById('publicEmergencyOverlay').classList.remove('show')">Close</button></div></div><div class="public-emergency-foot">Only the information needed in an emergency is shown. In an emergency, call 112.</div></div>`;
 }
 overlay.classList.add('show');
}

async function openEmergencyPayloadFromUrl() {
 const params = new URLSearchParams(location.search);
 const token = params.get('emergency') || params.get('token');
 if (!token) return false;
 const apiBase = (window.SWASTH_API_BASE || ((location.protocol === 'http:' || location.protocol === 'https:') ? location.origin : '')).replace(/\/$/, '');
 // Show the public shell immediately so a slow backend never leaves a blank page.
 let overlay = document.getElementById('publicEmergencyOverlay');
 if (!overlay) { overlay = document.createElement('div'); overlay.id = 'publicEmergencyOverlay'; overlay.className = 'public-emergency-overlay'; document.body.appendChild(overlay); }
 overlay.innerHTML = '<div class="public-emergency-card"><div class="public-emergency-head"><div><h2>Loading emergency information</h2><p>Verifying the secure emergency QR…</p></div><span class="public-emergency-badge">Emergency</span></div><div class="public-emergency-body"><div class="public-emergency-item full"><div>Please wait a moment.</div></div><div class="public-emergency-actions"><a class="btn btn-danger-solid" href="tel:112">Call 112</a></div></div></div>';
 overlay.classList.add('show');
 if (apiBase && /^v1\./.test(token)) {
  // The server may be waking from sleep; give it time and retry once.
  for (const timeoutMs of [10000, 30000]) {
   try {
    const res = await fetchWithTimeout(apiBase + '/api/emergency/view?token=' + encodeURIComponent(token), {headers:{'Accept':'application/json'}}, timeoutMs);
    const body = await res.json().catch(() => ({}));
    if (res.ok && body.payload) { showEmergencyPublicView(body.payload); return true; }
    if (res.status === 410) { showEmergencyPublicView({ n: 'Unavailable', exp: 0, reason: body.error }); return false; }
    if (![502, 503, 504].includes(res.status)) break;
   } catch (error) { console.warn('Secure emergency viewer did not respond; retrying.', error); }
   const note = overlay.querySelector('.public-emergency-item div');
   if (note) note.textContent = 'The server is starting up. This can take up to a minute…';
  }
  overlay.innerHTML = '<div class="public-emergency-card"><div class="public-emergency-head"><div><h2>Could not load emergency information</h2><p>The SwasthID server did not respond.</p></div><span class="public-emergency-badge">Retry</span></div><div class="public-emergency-expired">Check the internet connection and scan the QR again. If this is an active emergency, call 112.</div><div class="public-emergency-actions"><a class="btn btn-danger-solid" href="tel:112">Call 112</a><button class="btn" type="button" onclick="location.reload()">Try again</button></div></div>';
  return false;
 }
 const payload = decodeEmergencyToken(token);
 if (payload) { showEmergencyPublicView(payload); return true; }
 overlay.innerHTML = '<div class="public-emergency-card"><div class="public-emergency-head"><div><h2>Emergency QR unavailable</h2><p>The emergency information could not be verified.</p></div><span class="public-emergency-badge">ERROR</span></div><div class="public-emergency-expired">Ask the patient or caregiver for a newly generated Emergency QR Badge. If this is an active emergency, call 112.</div><div class="public-emergency-actions"><a class="btn btn-danger-solid" href="tel:112">Call 112</a></div></div>';
 return false;
}

async function ensureJsPdfLoaded() {
 if (window.jspdf?.jsPDF) return window.jspdf.jsPDF;
 try {
  await new Promise((resolve, reject) => {
   const script = document.createElement('script'); script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'; script.async = true;
   script.onload = resolve; script.onerror = reject; document.head.appendChild(script);
  });
 } catch (_) {}
 return window.jspdf?.jsPDF || null;
}
async function downloadEmergencyPDF() {
  const downloadBtn = document.getElementById('downloadEmergencyPdfBtn');
  const statusEl = document.getElementById('qrPayloadStatus');
  const originalStatusText = statusEl ? statusEl.textContent : '';
  const originalStatusColor = statusEl ? statusEl.style.color : '';
  const setStatus = (msg, isError) => {
    if (statusEl) { statusEl.textContent = msg; statusEl.style.color = isError ? '#b44e39' : '#04506F'; }
    console[isError ? 'error' : 'log']('[Emergency PDF]', msg);
  };
  const restoreStatus = () => setTimeout(() => {
    if (statusEl) { statusEl.textContent = originalStatusText; statusEl.style.color = originalStatusColor; }
  }, 5000);

  if (downloadBtn) { downloadBtn.disabled = true; downloadBtn.textContent = 'Preparing PDF…'; }
  try {
    const jsPDF = await ensureJsPdfLoaded();
    if (!jsPDF) {
      setStatus('The PDF generator could not be loaded. Check your internet connection and try again.', true);
      alert('The PDF generator could not be loaded. Please check your internet connection and try again.');
      restoreStatus();
      return;
    }

    const { doc, filename, qrEmbedded } = buildEmergencyPdf(jsPDF);
    SwasthPdf.save(doc, filename);
    setStatus(qrEmbedded ? `PDF ready: ${filename}` : `PDF ready: ${filename} (without the QR code; it wasn't ready yet)`, false);
    restoreStatus();
  } catch (error) {
    console.error('Emergency PDF generation failed:', error);
    setStatus('PDF generation failed: ' + (error?.message || 'unknown error') + ' — check the browser console for details.', true);
    alert('The emergency PDF could not be generated' + (error && error.message ? ': ' + error.message : '.') + '\n\nPlease try again.');
    restoreStatus();
  } finally {
    if (downloadBtn) { downloadBtn.disabled = false; downloadBtn.textContent = 'Download PDF'; }
  }
}

const emergencyDownloadBtn = document.getElementById('downloadEmergencyPdfBtn');
function prepareEmergencyResources(forceQr = false) {
  if (emergencyDownloadBtn) {
    emergencyDownloadBtn.disabled = false;
    emergencyDownloadBtn.textContent = 'Download PDF';
  }
  void generateEmergencyQR(forceQr).catch(error => console.warn('Emergency QR warm-up failed:', error));
}

document.getElementById('refreshEmergencyQrBtn')?.addEventListener('click', () => { prepareEmergencyResources(true); qrGenerated = true; });
emergencyDownloadBtn?.addEventListener('click', downloadEmergencyPDF);
document.getElementById('calculateClinicalRiskBtn')?.addEventListener('click', calculateClinicalRisk);
restoreClinicalRiskInputs();
restoreClinicalRiskResult();
document.querySelectorAll('#panel-emergency .switch').forEach(sw => {
 sw.addEventListener('click', function(){ this.classList.toggle('on'); });
});
document.getElementById('simulateScanBtn').addEventListener('click', () => {
 showEmergencyPublicView({ ...getEmergencyCompactPayload(), preview: true });
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') document.getElementById('publicEmergencyOverlay')?.classList.remove('show'); });

(async () => { await openEmergencyPayloadFromUrl(); })();
 /* Family Registration — linked dependent profiles with local/cloud persistence. */
 function getDependents(){const list=safeJsonParse(localStorage.getItem('swasth_dependents')||'[]',[]);const uid=firebaseUser?.uid||'';return Array.isArray(list)?list.filter(x=>!x?.ownerUid||!uid||x.ownerUid===uid):[];}
 function saveDependents(list){localStorage.setItem('swasth_dependents',JSON.stringify(list));if(typeof syncCloudState==='function')syncCloudState('swasth_dependents');}
 function renderDependents(){const el=document.getElementById('dependentList');if(!el)return;const list=getDependents();if(!list.length){el.innerHTML='<div class="empty">No family members yet.</div>';return;}el.innerHTML='<div class="list">'+list.map(d=>`<div class="list-row"><div class="list-main"><b>${escapeHtml(d.name||'Unnamed')}</b><span>${escapeHtml(d.relation||'Relationship not set')}${d.createdAt?` · Added ${formatRecordDate(d.createdAt)}`:''}</span></div><div class="section-actions"><button type="button" class="btn btn-sm" data-dependent-edit="${escapeHtml(d.id)}">Edit</button><button type="button" class="btn btn-sm btn-danger" data-dependent-delete="${escapeHtml(d.id)}">Remove</button></div></div>`).join('')+'</div>';el.querySelectorAll('[data-dependent-edit]').forEach(btn=>btn.addEventListener('click',()=>openDependentEditor(btn.dataset.dependentEdit)));el.querySelectorAll('[data-dependent-delete]').forEach(btn=>btn.addEventListener('click',()=>{const d=getDependents().find(x=>x.id===btn.dataset.dependentDelete);if(!d)return;if(!window.confirm(`Remove ${d.name||'this family member'}?`))return;saveDependents(getDependents().filter(x=>x.id!==d.id));renderDependents();showToast('','Family member removed',`${d.name||'They'} ${d.name?'was':'were'} removed from your account.`);}));}
 function openDependentEditor(id){const d=getDependents().find(x=>x.id===id);if(!d)return;const modal=document.getElementById('dependentEditor');if(!modal)return;modal.dataset.id=id;document.getElementById('dependentEditName').value=d.name||'';document.getElementById('dependentEditRelation').value=d.relation||'';modal.hidden=false;document.getElementById('dependentEditName')?.focus();}
 function closeDependentEditor(){document.getElementById('dependentEditor')?.setAttribute('hidden','');}
 function saveDependentEditor(){const modal=document.getElementById('dependentEditor');if(!modal)return;const id=modal.dataset.id,name=document.getElementById('dependentEditName')?.value.trim(),relation=document.getElementById('dependentEditRelation')?.value;if(!name||!relation){showToast('','Name and relationship required','Complete both fields before saving.');return;}const list=getDependents();const idx=list.findIndex(x=>x.id===id);if(idx<0)return;list[idx]={...list[idx],name,relation,updatedAt:new Date().toISOString()};saveDependents(list);closeDependentEditor();renderDependents();showToast('','Family member updated','Details updated.');}
 function registerDependentProfile(){const name=document.getElementById('regName').value.trim(),relation=document.getElementById('regRel').value;if(!name){showToast('','Name required','Enter their full name.');return;}if(!relation){showToast('','Relationship required','Select the relationship first.');return;}const list=getDependents();list.unshift({id:`dep_${Date.now()}_${Math.random().toString(36).slice(2,7)}`,name,relation,ownerUid:firebaseUser?.uid||'',createdAt:new Date().toISOString(),status:'family member'});saveDependents(list);document.getElementById('regName').value='';document.getElementById('regRel').value='';renderDependents();showToast('','Family member added',`${name} was added.`);}
 document.getElementById('registerDepBtn')?.addEventListener('click',registerDependentProfile);document.getElementById('dependentEditCancel')?.addEventListener('click',closeDependentEditor);document.getElementById('dependentEditSave')?.addEventListener('click',saveDependentEditor);document.getElementById('dependentEditor')?.addEventListener('click',e=>{if(e.target.id==='dependentEditor')closeDependentEditor();});renderDependents();
