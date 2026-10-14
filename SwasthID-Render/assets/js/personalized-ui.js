/* =========================================================
 PERSONALIZED UI — all user-facing health panels derive from the signed-in profile
 ========================================================= */
function setText(id, value, fallback = 'Not provided') {
  const el = document.getElementById(id);
  if (el) el.textContent = value === undefined || value === null || String(value).trim() === '' ? fallback : String(value);
}
function careJourneyKey() {
  const email = String(firebaseUser?.email || patientData.email || '').trim().toLowerCase();
  return email ? `swasth_care_journey_${encodeURIComponent(email)}` : '';
}
function getCareJourneyPrefs() {
  const key = careJourneyKey();
  if (!key) return {};
  return safeJsonParse(localStorage.getItem(key) || '{}', {}) || {};
}
function saveCareJourneyPrefs(prefs) {
  const key = careJourneyKey();
  if (!key) return;
  try { localStorage.setItem(key, JSON.stringify(prefs || {})); } catch (_) {}
}
function isRiskScreeningCurrent(riskResult, riskInputs) {
  if (!riskResult || !riskInputs) return false;
  const current = clinicalRiskPayload();
  const keys = ['age','bmi','sex','sbp','totalCholesterol','hdlCholesterol','egfr','diabetes','currentSmoker','bpTreatment','statin'];
  return keys.every(key => String(current[key] ?? '') === String(riskInputs[key] ?? ''));
}
function getCareJourneyState() {
  const profileDone = isProfileActuallyComplete();
  const riskInputs = safeJsonParse(localStorage.getItem('swasth_riskInputs') || 'null', null);
  const riskResult = safeJsonParse(localStorage.getItem('swasth_clinicalRiskResult') || 'null', null);
  const prescriptions = getSavedPrescriptions();
  const meds = getCurrentMedicationList();
  const contact = patientData.emergencyContact || {};
  const prefs = getCareJourneyPrefs();
  const medicationRelevant = meds.length > 0 || prescriptions.length > 0;
  const medicationScheduleReady = meds.length > 0 && meds.every(m => {
    const count = medicationSlotCount(m);
    const times = Array.isArray(m.times) ? m.times.filter(Boolean) : [];
    return times.length >= count;
  });
  const riskCurrent = isRiskScreeningCurrent(riskResult, riskInputs);
  const emergencyReady = !!(contact.name && contact.phone);

  const steps = [
    {
      key:'profile', title:'Build profile',
      state:profileDone ? 'Personal profile is saved' : 'Add your core health details',
      done:profileDone, tab:'profile', action:profileDone ? 'Review profile' : 'Complete profile'
    },
    {
      key:'risk', title:'Screen risk',
      state:riskCurrent ? 'Current reference screening' : (riskResult ? 'Screening is out of date' : 'Run an informational screening'),
      done:riskCurrent, tab:'predict', action:riskCurrent ? 'Review screening' : 'Update screening'
    },
    {
      key:'prescription', title:'Capture prescription',
      state:prescriptions.length ? `${prescriptions.length} confirmed prescription${prescriptions.length === 1 ? '' : 's'}` : 'Scan and verify medicines',
      done:prescriptions.length > 0, tab:'scan', action:prescriptions.length ? 'Review prescription' : 'Scan prescription',
      conditional: true, relevant: medicationRelevant || !!prefs.prescriptionRelevant
    },
    {
      key:'medication', title:'Manage medication',
      state:medicationScheduleReady ? `${meds.length} medicine${meds.length === 1 ? '' : 's'} with dose times set` : meds.length ? 'Dose times still need review' : 'Medication tracking is not applicable',
      done:medicationScheduleReady, tab:'home', action:medicationScheduleReady ? 'View today' : 'Set dose times',
      conditional: true, relevant: medicationRelevant && !prefs.medicationNotApplicable
    },
    {
      key:'emergency', title:'Secure emergency info',
      state:emergencyReady ? 'Emergency contact is ready' : 'Add an emergency contact',
      done:emergencyReady, tab:'emergency', action:emergencyReady ? 'Open Emergency' : 'Set emergency contact'
    }
  ].filter(step => !step.conditional || step.relevant);

  return { steps };
}
function renderCareJourney() {
  const wrap=document.getElementById('careJourney'); const nextEl=document.getElementById('careJourneyNext'); const statusEl=document.getElementById('careJourneyStatus');
  if(!wrap) return;
  const journey=getCareJourneyState();
  if (!journey.steps.length) { wrap.innerHTML=''; return; }
  const nextIndex=journey.steps.findIndex(step=>!step.done); const currentIndex=nextIndex>=0?nextIndex:journey.steps.length-1; const completed=journey.steps.filter(step=>step.done).length;
  wrap.innerHTML=journey.steps.map((step,index)=>`<div class="care-step ${step.done?'done':''} ${index===currentIndex?'is-current':''}" data-care-tab="${escapeHtml(step.tab)}" data-care-key="${escapeHtml(step.key)}" role="button" tabindex="0"><div class="care-step-number">Step ${index+1}${step.done?' · Complete':''}</div><div class="care-step-title">${escapeHtml(step.title)}</div><div class="care-step-state">${escapeHtml(step.state)}</div><span class="care-step-action">${escapeHtml(step.action)}</span>${step.key==='medication'&&!step.done?'<button type="button" class="care-step-skip" data-care-skip="medication">Not applicable</button>':''}</div>`).join('');
  if(statusEl) statusEl.textContent=completed===journey.steps.length?'All done':`${completed} of ${journey.steps.length} done`;
  if(nextEl){
    if(nextIndex>=0){const next=journey.steps[nextIndex]; nextEl.innerHTML=`<b>Next:</b> ${escapeHtml(next.action)} to ${escapeHtml(next.title.toLowerCase())}.` + (next.key==='medication' ? ' If you do not take medication, you can mark this as not applicable.' : '');}
    else nextEl.innerHTML='<b>Journey ready:</b> Your relevant SwasthID workflow is up to date.';
  }
}
function openCareJourneyStep(tab){ showTab(tab); if(tab==='home') document.getElementById('todayMedList')?.scrollIntoView({behavior:'smooth',block:'center'}); }
document.addEventListener('click',e=>{ const skip=e.target.closest('[data-care-skip]'); if(skip){ e.preventDefault(); e.stopPropagation(); const prefs=getCareJourneyPrefs(); prefs.medicationNotApplicable=true; saveCareJourneyPrefs(prefs); renderCareJourney(); return; } const step=e.target.closest('[data-care-tab]'); if(step) openCareJourneyStep(step.dataset.careTab); });
document.addEventListener('keydown',e=>{if(e.key!=='Enter'&&e.key!==' ')return; if(e.target.closest('[data-care-skip]')) return; const step=e.target.closest('[data-care-tab]'); if(!step)return; e.preventDefault(); openCareJourneyStep(step.dataset.careTab);});

function renderTodayStats() {
  const meds = getCurrentMedicationList();
  const today = new Date();
  const expected = meds.reduce((sum, m) => sum + (medicationExpectedOnDate(m, today) ? medicationSlotCount(m) : 0), 0);
  const taken = getMedicationHistory().filter(e => e?.taken && localDayKey(e.date) === localDayKey(today)).length;
  setText('homeDosesStat', expected ? `${Math.min(taken, expected)} of ${expected}` : '', 'None today');
  const summary = document.getElementById('doseSummary');
  if (summary) {
    summary.hidden = !expected;
    const done = Math.min(taken, expected);
    setText('doseSummaryText', expected ? `${done} of ${expected} taken` : '', '');
    const bar = document.getElementById('doseProgress');
    if (bar) bar.style.width = expected ? `${Math.round(done / expected * 100)}%` : '0%';
  }
  const water = typeof getWaterState === 'function' ? getWaterState() : null;
  setText('homeWaterStat', water ? `${Number(water.ml || 0).toLocaleString()} ml` : '', '0 ml');
}
window.renderTodayStats = renderTodayStats;

/* ---------- Profile photo ----------
   Photos are cropped to a square and shrunk to 192 px in the browser (about
   10–20 KB), then saved with the profile in Firestore. No separate storage
   service is needed. The photo never goes into the emergency card, the
   doctor summary or exports. */
function isProfilePhoto(v) { return typeof v === 'string' && v.length < 200000 && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(v); }
function renderAvatars(photo) {
  const ok = isProfilePhoto(photo);
  const silhouette = '<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="12.5" r="5.5"/><path d="M4.5 32c.8-7 5.3-11 11.5-11s10.7 4 11.5 11z"/></svg>';
  document.querySelectorAll('[data-avatar]').forEach(el => {
    el.classList.toggle('has-photo', ok);
    el.innerHTML = ok ? `<img src="${photo}" alt="">` : silhouette;
  });
  const remove = document.getElementById('removeProfilePhotoBtn'); if (remove) remove.hidden = !ok;
  const upload = document.getElementById('profilePhotoBtn'); if (upload) upload.textContent = ok ? 'Change photo' : 'Upload photo';
}
async function shrinkProfilePhoto(file) {
  if (!file || !/^image\//.test(file.type)) throw new Error('Choose an image file, such as a JPG or PNG.');
  if (file.size > 20 * 1024 * 1024) throw new Error('That image is over 20 MB. Choose a smaller one.');
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("That image couldn't be opened. Try a JPG or PNG."));
      i.src = url;
    });
    const w = img.naturalWidth, h = img.naturalHeight, side = Math.min(w, h), size = 192;
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d'); ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, (w - side) / 2, (h - side) / 2, side, side, 0, 0, size, size);
    let out = canvas.toDataURL('image/webp', 0.82);
    if (!out.startsWith('data:image/webp')) out = canvas.toDataURL('image/jpeg', 0.85);
    return out;
  } finally { URL.revokeObjectURL(url); }
}
async function saveProfilePhoto(photo) {
  patientData.photo = photo;
  renderAvatars(photo);
  const synced = await syncProfileToCloud();
  if (!synced) cacheProfileLocally();
  return synced || !firebaseUser;
}
(function initProfilePhoto() {
  const input = document.getElementById('profilePhotoInput');
  const btn = document.getElementById('profilePhotoBtn');
  const remove = document.getElementById('removeProfilePhotoBtn');
  const error = document.getElementById('profilePhotoError');
  renderAvatars(patientData?.photo);
  btn?.addEventListener('click', () => input?.click());
  input?.addEventListener('change', async () => {
    const file = input.files?.[0]; input.value = '';
    if (!file) return;
    if (error) error.textContent = '';
    btn.classList.add('is-loading'); btn.disabled = true;
    try {
      const saved = await saveProfilePhoto(await shrinkProfilePhoto(file));
      showToast('', 'Profile photo updated', saved ? '' : "Saved on this device. It will sync when you're back online.");
    } catch (e) {
      if (error) error.textContent = e.message || 'The photo could not be used.';
    } finally { btn.classList.remove('is-loading'); btn.disabled = false; }
  });
  remove?.addEventListener('click', async () => {
    await saveProfilePhoto('');
    showToast('', 'Profile photo removed', '');
  });
})();

function renderPersonalizedUI() {
  renderCareJourney();
  const email = patientData.email || firebaseUser?.email || localStorage.getItem('swasth_abhaId') || '';
  const name = patientData.name || 'there';
  setText('topHealthId', email, 'Signed in');
  setText('dashboardGreetingName', name.split(' ')[0] || name, 'there');
  renderAvatars(patientData.photo);
  setText('accountName', name === 'there' ? '' : name, 'SwasthID');
  setText('profileEmail', email, 'Not provided');
  setText('profileDob', patientData.dob ? formatRecordDate(patientData.dob) : '', 'Not provided');
  setText('ageValue', calculateAge(patientData.dob) ?? '', 'Not provided');
  setText('profileOccupation', patientData.occupation, 'Not provided');
  setText('profileHeight', patientData.vitals?.height ? `${patientData.vitals.height} cm` : '', '--');
  const body = bodyMetrics();
  setText('profileWeight', body.weight ? `${body.weight} kg${body.weightAt ? ` (logged ${new Date(body.weightAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })})` : ''}` : '', '--');
  setText('profileBloodGroup', patientData.bloodGroup, '--');
  setText('profileSmoking', patientData.lifestyle?.smoking, 'Not provided');
  setText('profileAlcohol', patientData.lifestyle?.alcohol, 'Not provided');
  setText('profileSmokingTag', patientData.lifestyle?.smoking || '—', '—');
  setText('profileAlcoholTag', patientData.lifestyle?.alcohol || '—', '—');

  const conditions = (patientData.conditions || []).filter(c => String(c.status || '').toLowerCase() !== 'resolved');
  setText('doctorConditions', conditions.length ? conditions.map(c => c.name).join(', ') : '', 'No ongoing conditions recorded.');
  const meds = getCurrentMedicationList();
  setText('doctorMedications', meds.length ? meds.map(m => `${m.medicine || m.name}${m.dose ? ' ' + m.dose : ''}`).join(', ') : '', 'No active medicines recorded.');
  setText('doctorAllergies', formatAllergies(patientData.allergies), 'No known drug allergies');
  setText('doctorNormalAllergies', formatNormalAllergies(patientData.normalAllergies), 'No common/environmental allergies recorded');
  const visits = Array.isArray(patientData.visits) ? patientData.visits.slice().sort((a,b) => new Date(b.date) - new Date(a.date)) : [];
  setText('doctorLatestVisit', visits.length ? `${visits[0].doctor || 'Visit'} · ${formatRecordDate(visits[0].date)}` : '', 'No visits recorded.');
  setText('doctorVitals', doctorVitalsText(), 'No readings logged.');
  setText('doctorLabs', doctorLabsText(), 'No lab values found in your reports.');
  setText('doctorRecordsCount', `${(visits.length + (patientData.reports || []).length + (patientData.conditions || []).length + (patientData.medications || []).length + getSavedPrescriptions().length)} records`);
  setText('doctorSummaryText', buildDoctorSummary(), 'Add health information in your profile, prescriptions, and records to generate a personalized clinical brief.');

  setText('emergencyPatientName', name, '--');
  setText('emergencyBloodGroup', patientData.bloodGroup, 'Not provided');
  setText('emergencyAllergies', formatAllergies(patientData.allergies), 'No known drug allergies');
  setText('emergencyNormalAllergies', formatNormalAllergies(patientData.normalAllergies), 'No common/environmental allergies recorded');
  setText('emergencyConditions', conditions.length ? conditions.map(c => c.name).join(', ') : '', 'No ongoing conditions recorded');
  setText('emergencyMedicines', meds.length ? meds.slice(0,3).map(m => `${m.medicine || m.name}${m.dose ? ' ' + m.dose : ''}`).join(', ') : '', 'No medicines recorded');
  const contact = patientData.emergencyContact || {};
  const emergencyReady = Boolean(patientData.bloodGroup && contact.phone);
  setText('emergencyStatusMain', emergencyReady ? 'Emergency card ready' : 'Emergency card incomplete');
  setText('emergencyStatusSub', emergencyReady ? 'Blood group and emergency contact are added.' : 'Add your blood group and an emergency contact.');
  const statusBanner = document.getElementById('emergencyProfileStatus');
  if (statusBanner) statusBanner.dataset.state = emergencyReady ? 'ready' : 'incomplete';
  setText('emergencyContactDisplay', contact.name && contact.phone ? `${contact.name}${contact.relation ? ' (' + contact.relation + ')' : ''} · ${contact.phone}` : '', 'No emergency contact provided');
  const call = document.getElementById('emergencyContactCall');
  if (call) { call.href = contact.phone ? `tel:${String(contact.phone).replace(/[^+\d]/g,'')}` : '#'; call.style.display = contact.phone ? 'inline-flex' : 'none'; }

  const target = getDailyCalorieTarget();
  setText('nutriCalorieTarget', `${target.toLocaleString()} kcal`, '2,200 kcal');
  setText('heroHealthScore', `${calculatePersonalizedRisk()}%`);
  updateCalorieDisplays();
  renderHistory('historyListRecords'); renderHistory('historyListProfile');
  renderVisits(); renderReports(); renderSavedPrescriptions(); renderRecordFoodLogs(); renderRecordMedicationActivity(); renderRecordTimeline();
  renderTodayMedications();
  updateRiskFactors();
  renderEmergencyQRIfReady();
  window.renderNutritionUpgrades?.();
  if (typeof renderDependents === 'function') renderDependents();
  if (typeof renderMedicationInsights === 'function') renderMedicationInsights();
  renderTodayStats();
  window.refreshDoseReminders?.();
  window.renderVitals?.();
  if (typeof renderActiveDoctorShare === 'function') renderActiveDoctorShare();
}
// Readings and lab values belong in the summary a doctor sees, with their
// dates, so a stale number is never mistaken for a current one.
function shortDate(at) {
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}
function doctorVitalsText() {
  const v = window.swasthVitals;
  if (!v) return '';
  return ['bp', 'glucose', 'weight', 'spo2'].map(type => {
    const list = v.byType(type);
    const r = list[list.length - 1];
    if (!r) return '';
    const extra = type === 'glucose' && v.GLUCOSE_CONTEXT?.[r.context] ? `, ${v.GLUCOSE_CONTEXT[r.context].toLowerCase()}` : '';
    return `${v.TYPES[type].title} ${v.valueText(r)} ${v.TYPES[type].unit}${extra} (${shortDate(r.at)})`;
  }).filter(Boolean).join('; ');
}
function doctorLabsText(limit = 6) {
  if (typeof extractLabTrendPoints !== 'function') return '';
  const trends = extractLabTrendPoints() || {};
  return Object.entries(trends)
    .map(([name, t]) => ({ name, unit: t.unit, last: (t.points || []).slice().sort((a, b) => new Date(a.date) - new Date(b.date)).pop() }))
    .filter(t => t.last)
    .sort((a, b) => new Date(b.last.date) - new Date(a.last.date))
    .slice(0, limit)
    .map(t => `${t.name} ${t.last.value}${t.unit ? ' ' + t.unit : ''} (${shortDate(t.last.date)})`)
    .join('; ');
}
function buildDoctorSummary() {
  const name = patientData.name || 'This patient';
  const conditions = (patientData.conditions || []).filter(c => String(c.status || '').toLowerCase() !== 'resolved').map(c => c.name);
  const meds = getCurrentMedicationList();
  const latest = (patientData.visits || []).slice().sort((a,b)=>new Date(b.date)-new Date(a.date))[0];
  const parts = [`${name} has ${conditions.length ? conditions.join(', ') : 'no ongoing conditions recorded'}.`];
  if (meds.length) parts.push(`Current medication list contains ${meds.length} item${meds.length === 1 ? '' : 's'}.`);
  if (latest) parts.push(`Latest recorded visit: ${latest.doctor || 'physician'} on ${formatRecordDate(latest.date)}.`);
  const vitals = doctorVitalsText();
  if (vitals) parts.push(`Latest readings: ${vitals}.`);
  const labs = doctorLabsText(4);
  if (labs) parts.push(`Recent lab values: ${labs}.`);
  parts.push('This summary is generated from information entered in SwasthID and should be reviewed by a qualified clinician.');
  return parts.join(' ');
}
function getClinicalRiskInputs() {
 const read = id => document.getElementById(id)?.value ?? '';
 return {
   sex: String(read('riskSexInput')).trim(),
   sbp: Number(read('riskSbpInput')),
   totalCholesterol: Number(read('riskTotalCholInput')),
   hdlCholesterol: Number(read('riskHdlInput')),
   egfr: Number(read('riskEgfrInput')),
   diabetes: Number(read('riskDiabetesInput')) === 1,
   currentSmoker: Number(read('riskSmokingInput')) === 1,
   bpTreatment: Number(read('riskBpMedsInput')) === 1,
   statin: Number(read('riskStatinInput')) === 1
 };
}
function restoreClinicalRiskInputs() {
 let data = null;
 try { data = JSON.parse(localStorage.getItem('swasth_riskInputs') || 'null'); } catch (_) {}
 if (!data) return;
 const map = {sex:'riskSexInput',sbp:'riskSbpInput',totalCholesterol:'riskTotalCholInput',hdlCholesterol:'riskHdlInput',egfr:'riskEgfrInput'};
 Object.entries(map).forEach(([key,id]) => { const el=document.getElementById(id); if(el && data[key] !== undefined) el.value=data[key]; });
 const boolMap={diabetes:'riskDiabetesInput',currentSmoker:'riskSmokingInput',bpTreatment:'riskBpMedsInput',statin:'riskStatinInput'};
 Object.entries(boolMap).forEach(([key,id]) => { const el=document.getElementById(id); if(el && data[key] !== undefined) el.value=data[key] ? '1' : '0'; });
}
// ---- Heart risk: start from what the record already says ----
// A risk estimate that assumes "no diabetes" for someone with diabetes is
// confidently wrong, so the form is filled from conditions, medicines and
// lab reports, and refuses to calculate when an answer contradicts them.
const RISK_BP_MEDICINES = /\b(amlodipine|nifedipine|cilnidipine|felodipine|telmisartan|losartan|olmesartan|valsartan|irbesartan|candesartan|azilsartan|ramipril|enalapril|lisinopril|perindopril|metoprolol|atenolol|bisoprolol|nebivolol|carvedilol|propranolol|labetalol|hydrochlorothiazide|chlorthalidone|indapamide|torsemide|spironolactone|eplerenone|prazosin|clonidine|methyldopa)\b/i;
const RISK_LIPID_MEDICINES = /\b(atorvastatin|rosuvastatin|simvastatin|pravastatin|pitavastatin|lovastatin|fluvastatin|ezetimibe|fenofibrate|bempedoic)\b/i;
const RISK_FIELDS = { sex: 'riskSexInput', totalCholesterol: 'riskTotalCholInput', hdlCholesterol: 'riskHdlInput', egfr: 'riskEgfrInput', diabetes: 'riskDiabetesInput', currentSmoker: 'riskSmokingInput', bpTreatment: 'riskBpMedsInput', statin: 'riskStatinInput' };
const RISK_FACT_NAMES = { diabetes: 'Diabetes', currentSmoker: 'Current smoker', bpTreatment: 'Taking blood pressure medicine', statin: 'Taking a statin or other lipid medicine' };
function riskFactsFromRecord() {
 const facts = {};
 const active = (patientData.conditions || []).filter(c => String(c.status || '').toLowerCase() !== 'resolved');
 const diabetes = active.find(c => /diabet/i.test(c.name || '') && !/pre-?\s?diabet|insipidus/i.test(c.name || ''));
 if (diabetes) facts.diabetes = { value: '1', from: diabetes.name };
 const meds = (typeof getCurrentMedicationList === 'function' ? getCurrentMedicationList() : []).map(m => String(m.medicine || m.name || '').trim()).filter(Boolean);
 const bp = meds.find(n => RISK_BP_MEDICINES.test(n));
 if (bp) facts.bpTreatment = { value: '1', from: bp };
 const lipid = meds.find(n => RISK_LIPID_MEDICINES.test(n));
 if (lipid) facts.statin = { value: '1', from: lipid };
 const sex = String(patientData.gender || patientData.sex || '').trim().toLowerCase();
 if (/^(f|female|woman)$/.test(sex)) facts.sex = { value: 'F', from: 'your profile' };
 else if (/^(m|male|man)$/.test(sex)) facts.sex = { value: 'M', from: 'your profile' };
 const smoking = String(patientData.lifestyle?.smoking || '').toLowerCase();
 if (smoking && /current|daily|occasional|yes|smoke/.test(smoking) && !/never|former|quit|stopped|^no/.test(smoking)) facts.currentSmoker = { value: '1', from: 'your lifestyle answers' };
 const labs = typeof extractLabTrendPoints === 'function' ? extractLabTrendPoints() : {};
 [['totalCholesterol', 'Total cholesterol'], ['hdlCholesterol', 'HDL'], ['egfr', 'eGFR']].forEach(([key, test]) => {
   const p = labs[test]?.points?.slice(-1)[0];
   if (p && Number.isFinite(p.value)) facts[key] = { value: String(Math.round(p.value)), from: `${p.report}${p.date ? ', ' + formatRecordDate(p.date) : ''}` };
 });
 return facts;
}
function riskFieldNote(input, text) {
 const id = input.id + 'FromRecord';
 let note = document.getElementById(id);
 if (!text) { note?.remove(); return; }
 if (!note) { note = document.createElement('div'); note.id = id; note.className = 'vital-prefill-note'; input.insertAdjacentElement('afterend', note); input.setAttribute('aria-describedby', id); }
 note.textContent = text;
}
// Fill empty fields from the record; a yes in the record replaces an old saved
// "No" unless the person changed that answer themselves on this visit.
function prefillRiskFromRecord() {
 const facts = riskFactsFromRecord();
 Object.entries(RISK_FIELDS).forEach(([key, id]) => {
   const input = document.getElementById(id); if (!input) return;
   const fact = facts[key];
   if (!fact) { riskFieldNote(input, ''); return; }
   const isSelect = input.tagName === 'SELECT';
   const userChose = input.dataset.userSet === '1';
   if (!userChose && (input.value === '' || (isSelect && key in RISK_FACT_NAMES && input.value !== fact.value))) input.value = fact.value;
   riskFieldNote(input, input.value === fact.value ? `From your record: ${fact.from}.` : '');
 });
}
// An answer that contradicts the record: the message to show instead of a result.
function riskContradiction(data) {
 const facts = riskFactsFromRecord();
 const key = Object.keys(RISK_FACT_NAMES).find(k => facts[k]?.value === '1' && !data[k]);
 if (!key) return '';
 return `Your record lists ${facts[key].from}, but “${RISK_FACT_NAMES[key]}” is set to No. Change it to Yes, or update your record if this is no longer true.`;
}
document.addEventListener('change', e => {
 if (Object.values(RISK_FIELDS).includes(e.target?.id)) { e.target.dataset.userSet = '1'; prefillRiskFromRecord(); }
});
function saveClinicalRiskInputs(data) {
 localStorage.setItem('swasth_riskInputs', JSON.stringify(data));
 if (typeof syncCloudState === 'function') syncCloudState('swasth_riskInputs');
}
function clinicalRiskPayload() {
 const data=getClinicalRiskInputs();
 const age=calculateAge(patientData.dob);
 const bmi=bodyMetrics().bmi;
 return {...data, age, bmi:bmi ? Number(bmi.toFixed(1)) : 0};
}
async function calculateClinicalRisk() {
 const status=document.getElementById('clinicalRiskStatus');
 const result=document.getElementById('clinicalRiskResult');
 const data=clinicalRiskPayload();
 if(!Number.isFinite(data.sbp) || !Number.isFinite(data.totalCholesterol) || !Number.isFinite(data.hdlCholesterol) || !Number.isFinite(data.egfr)){
   if(status) status.textContent='Enter numeric blood-pressure, cholesterol and eGFR values before calculating.';
   if(result) result.style.display='none';
   return;
 }
 const contradiction=riskContradiction(data);
 if(contradiction){ if(status) status.textContent=contradiction; if(result) result.style.display='none'; return; }
 const required=[['age',data.age],['sbp',data.sbp],['totalCholesterol',data.totalCholesterol],['hdlCholesterol',data.hdlCholesterol],['egfr',data.egfr],['bmi',data.bmi]];
 const missing=required.filter(([,v]) => v === '' || v === null || !Number.isFinite(Number(v)) || Number(v) <= 0).map(([k])=>k);
 if (!['M','F'].includes(data.sex)) missing.push('sex');
 if (missing.length) {
   const reason = !['M','F'].includes(data.sex) ? 'Select sex.'
     : (data.age === null ? 'Add your date of birth in your profile.'
     : (!(data.bmi > 0) ? 'Add height and weight in your profile.' : 'Enter blood pressure, cholesterol, HDL and eGFR.'));
   if(status) status.textContent=reason; if(result) result.style.display='none'; return;
 }
 if (data.age < 30 || data.age > 79) { if(status) status.textContent=`PREVENT is validated for ages 30–79; your profile age is ${data.age}.`; if(result) result.style.display='none'; return; }
 if(data.bmi < 18.5 || data.bmi > 39.9 || data.sbp < 90 || data.sbp > 200 || data.totalCholesterol < 130 || data.totalCholesterol > 320 || data.hdlCholesterol < 20 || data.hdlCholesterol > 100 || data.egfr < 15 || data.egfr > 140) { if(status) status.textContent='One or more values are outside the supported PREVENT input ranges.'; if(result) result.style.display='none'; return; }
 saveClinicalRiskInputs(data);
 if(status) status.textContent='Calculating…';
 const calcBtn=document.getElementById('calculateClinicalRiskBtn'); calcBtn?.classList.add('is-loading');
 try {
   const base=(window.SWASTH_RISK_API_BASE || ((location.protocol==='http:'||location.protocol==='https:') ? location.origin + '/api/risk' : '')) .replace(/\/$/,'');
   if(!base) throw new Error('PREVENT risk service is not configured on this deployment.');
   const res=await fetch(base+'/prevent',{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify(data)});
   const body=await res.json();
   if(!res.ok) throw new Error(body.error || 'Risk service error');
   body._swasthInputSnapshot = data; body._swasthCalculatedAt = new Date().toISOString();
   localStorage.setItem('swasth_clinicalRiskResult',JSON.stringify(body));
   if(typeof syncCloudState==='function') syncCloudState('swasth_clinicalRiskResult');
   if(result){ result.style.display='block'; result.innerHTML=riskResultHtml(body,'10-year risk',body.note || 'Reference estimate only. Review it with a qualified clinician.'); }
   if(status) status.textContent='Calculated from the values above.';
 } catch(error) {
   console.error('PREVENT service unavailable:',error);
   const cached=safeJsonParse(localStorage.getItem('swasth_clinicalRiskResult')||'null',null);
   if(cached && cached.tenYearCvd!==undefined){
     if(result){result.style.display='block';result.innerHTML=riskResultHtml(cached,'Last saved result','The risk service is unavailable, so this is your last saved result, not a new calculation.');}
     if(status)status.textContent='The risk service is unavailable. Showing your last saved result.';
   }else if(status)status.textContent='The risk service is unavailable and there is no saved result, so no estimate was made.';
 } finally { calcBtn?.classList.remove('is-loading'); }
}
function riskResultHtml(body, heading, note) {
 const pct = v => `${Number(v).toFixed(1)}<small>%</small>`;
 return `<div class="t-meta risk-result-label">${escapeHtml(heading)}</div>
  <div class="risk-stats">
   <div><b>${pct(body.tenYearCvd)}</b><span>Any cardiovascular disease</span></div>
   <div><b>${pct(body.tenYearAscvd)}</b><span>Heart attack or stroke (ASCVD)</span></div>
   <div><b>${pct(body.tenYearHf)}</b><span>Heart failure</span></div>
  </div>
  <p class="t-meta">${escapeHtml(note)}</p>`;
}
function restoreClinicalRiskResult() {
 let body=null; try { body=JSON.parse(localStorage.getItem('swasth_clinicalRiskResult') || 'null'); } catch (_) {}
 if(!body || body.tenYearCvd === undefined) return;
 const result=document.getElementById('clinicalRiskResult'); if(!result) return;
 result.style.display='block'; result.innerHTML=riskResultHtml(body,'10-year risk',body.note || 'Reference estimate only.');
}

// Height comes from the profile; weight from the newest Vitals reading, or the
// profile when nothing has been logged. Profile, BMI and heart risk all use this.
function bodyMetrics() {
  const h = Number.parseFloat(patientData.vitals?.height);
  const logged = window.swasthVitals?.byType('weight').slice(-1)[0];
  const w = logged ? Number(logged.weight) : Number.parseFloat(patientData.vitals?.weight);
  const bmi = h > 0 && w > 0 ? w / Math.pow(h / 100, 2) : null;
  return { height: h > 0 ? h : null, weight: w > 0 ? w : null, weightAt: logged?.at || null, bmi };
}
function updateRiskFactors() {
  const { height: h, weight: w, bmi } = bodyMetrics();
  if (bmi !== null) {
    patientData.vitals.bmi = bmi.toFixed(1);
    setText('riskFactorBmi', `BMI ${bmi.toFixed(1)} based on ${h} cm and ${w} kg.`);
  } else setText('riskFactorBmi', '', 'Add height and weight to personalize this factor.');
  const active = (patientData.conditions || []).filter(c => String(c.status || '').toLowerCase() !== 'resolved');
  setText('riskFactorConditions', active.length ? `${active.length} ongoing condition${active.length === 1 ? '' : 's'} recorded: ${active.map(c=>c.name).join(', ')}.` : '', 'No ongoing conditions recorded.');
  const lifestyle = [patientData.lifestyle?.smoking && `Smoking: ${patientData.lifestyle.smoking}`, patientData.lifestyle?.alcohol && `Alcohol: ${patientData.lifestyle.alcohol}`].filter(Boolean);
  setText('riskFactorLifestyle', lifestyle.join(' · '), 'Add lifestyle information to personalize this factor.');
  setText('riskFactorActivity', 'Activity integration is not connected yet. Risk score does not assume activity data.');
}
function isProfileActuallyComplete() {
  const name = String(patientData.name || '').trim();
  const email = String(patientData.email || firebaseUser?.email || '').trim();
  const looksLikeDemo = /aditya\.sharma@abdm|sunita sharma/i.test(`${name} ${email}`);
  return !!name && name !== 'SwasthID User' && !looksLikeDemo && patientData.profileCompleted === true;
}

window.openProfileModal = function openProfileModal(options = {}) {
  try {
  const force = options === true || options.force === true;
  // An incomplete profile must always be offered on login. Do not let an old
  // per-account skip flag suppress the onboarding form indefinitely. The user can
  // close it for now, and it will be offered again on the next login.
  const modal = document.getElementById('profileModal'); if (!modal) return;
  const fullName = patientData.name || '';
  const nameParts = {
    first: patientData.firstName || fullName.trim().split(/\s+/)[0] || '',
    middle: patientData.middleName || (fullName.trim().split(/\s+/).length > 2 ? fullName.trim().split(/\s+/).slice(1,-1).join(' ') : ''),
    last: patientData.lastName || (fullName.trim().split(/\s+/).length > 1 ? fullName.trim().split(/\s+/).slice(-1)[0] : '')
  };
  const fields = {
    profileDobInput: patientData.dob || '', profileBloodInput: patientData.bloodGroup || '',
    profileOccupationInput: patientData.occupation || '', profileHeightInput: patientData.vitals?.height || '', profileWeightInput: patientData.vitals?.weight || '',
    profileSmokingInput: patientData.lifestyle?.smoking || '', profileAlcoholInput: patientData.lifestyle?.alcohol || '',
    profileConditionsInput: (patientData.conditions || []).map(c => c.name).join('\n'),
    profileCalorieInput: getDailyCalorieTarget(),
    profileEmergencyNameInput: patientData.emergencyContact?.name || '', profileEmergencyRelationInput: patientData.emergencyContact?.relation || '', profileEmergencyPhoneInput: patientData.emergencyContact?.phone || '', profileInsuranceProviderInput: patientData.insurance?.provider || '', profileInsurancePolicyInput: patientData.insurance?.policyNumber || '', profileNormalAllergyCustomInput: ''
  };
  Object.entries(fields).forEach(([id,val]) => { const el=document.getElementById(id); if(el) el.value=val; });
  const firstNameEl=document.getElementById('profileFirstNameInput'); if(firstNameEl) firstNameEl.value=nameParts.first;
  const middleNameEl=document.getElementById('profileMiddleNameInput'); if(middleNameEl) middleNameEl.value=nameParts.middle;
  const lastNameEl=document.getElementById('profileLastNameInput'); if(lastNameEl) lastNameEl.value=nameParts.last;
  // Render each dynamic profile section independently so one bad medication row
  // can never prevent the allergy checkboxes or the rest of the editor from loading.
  try { renderAllergyOptions(patientData.allergies || []); } catch (err) { console.error('Drug allergy UI error:', err); }
  try { renderNormalAllergyOptions(patientData.normalAllergies || []); } catch (err) { console.error('Other allergy UI error:', err); }
  try { renderMedicineInputRows(patientData.medications || []); } catch (err) {
    console.error('Medicine editor error:', err);
    const medicineWrap = document.getElementById('medicineInputRows');
    if (medicineWrap) medicineWrap.innerHTML = '<div class="medicine-input-row" data-index="0"><input type="text" class="medicine-name-input" placeholder="Medicine name"><input type="text" class="medicine-dose-input" placeholder="Dose (e.g. 2 tablets)"><input type="text" class="medicine-schedule-input" placeholder="Schedule (e.g. Twice daily)"><input type="text" class="medicine-pack-input" placeholder="Pack size" aria-label="Pack size (optional, e.g. 30 tablets)" title="Optional, e.g. 30 tablets"><button type="button" class="medicine-remove-btn" data-remove-medicine="0">×</button></div>';
  }
  const title = document.getElementById('profileModalTitle');
  const subtitle = document.getElementById('profileModalSubtitle');
  const cancel = document.getElementById('cancelProfileBtn');
  if (profileOnboardingRequired || !isProfileActuallyComplete()) {
    if (title) title.textContent = 'Let’s personalize your SwasthID';
    if (subtitle) subtitle.textContent = 'A few details will help us tailor your dashboard, nutrition, emergency information and health insights. You can add or change them later from Profile.';
    if (cancel) cancel.textContent = 'Skip for now';
  } else {
    if (title) title.textContent = 'Update your SwasthID profile';
    if (subtitle) subtitle.textContent = 'Keep your personal and health information up to date across SwasthID.';
    if (cancel) cancel.textContent = 'Cancel';
  }
  modal.classList.add('show');
  modal.style.display = 'flex';
  document.body.classList.add('profile-modal-open');
  installProfileFocusTrap(); setTimeout(() => document.getElementById('profileFirstNameInput')?.focus(), 50);
  } catch (err) {
    console.error('SwasthID profile editor failed to open:', err);
    const modal = document.getElementById('profileModal');
    if (modal) {
      modal.classList.add('show');
      modal.style.display = 'flex';
      document.body.classList.add('profile-modal-open');
    }
  }
}
async function closeProfileModal() {
  const modal = document.getElementById('profileModal');
  if (!modal) return;
  const incomplete = !isProfileActuallyComplete();
  if (incomplete) {
    // Closing an incomplete onboarding form only dismisses it for this session.
    // Never persist a skip flag that can prevent future account logins from
    // offering personalization again.
    profileOnboardingRequired = true;
  }
  modal.classList.remove('show');
  modal.style.display = 'none';
  document.body.classList.remove('profile-modal-open');
}
window.closeProfileModal = closeProfileModal;
function parseProfileConditions(text) { return String(text||'').split('\n').map(x=>x.trim()).filter(Boolean).map(name=>({name,status:'Ongoing'})); }
function parseProfileMeds(text) { return String(text||'').split('\n').map(x=>x.trim()).filter(Boolean).map(line=>{ const p=line.split('|').map(x=>x.trim()); return {name:p[0],dose:p[1]||'',schedule:p[2]||'Review schedule',reason:''}; }); }
function normalizeAllergies(value) {
  if (Array.isArray(value)) return value.map(x=>String(x).trim()).filter(Boolean);
  const text=String(value||'').trim();
  if (!text || /^not provided$/i.test(text) || /^none$/i.test(text) || /no known allergies/i.test(text)) return [];
  return text.split(/[,;\n]+/).map(x=>x.trim()).filter(Boolean);
}
function formatAllergies(value) {
  const list=normalizeAllergies(value);
  return list.length ? list.join(', ') : 'No known drug allergies';
}
const COMMON_DRUG_ALLERGIES=['Penicillin','Amoxicillin','Sulfa drugs','Aspirin / NSAIDs','Ibuprofen','Paracetamol'];
function renderAllergyOptions(value) {
  const selected=normalizeAllergies(value);
  const wrap=document.getElementById('allergyOptions'); if(!wrap) return;
  const isNone=selected.length===0;
  wrap.innerHTML = `<label class="allergy-option"><input type="checkbox" value="__NONE__" ${isNone?'checked':''}> None / no known drug allergies</label>` +
    COMMON_DRUG_ALLERGIES.map(a=>`<label class="allergy-option"><input type="checkbox" value="${a}" ${selected.some(x=>x.toLowerCase()===a.toLowerCase())?'checked':''}> ${a}</label>`).join('') +
    `<label class="allergy-option"><input type="checkbox" value="__CUSTOM__" id="customAllergyToggle" ${selected.some(x=>!COMMON_DRUG_ALLERGIES.some(a=>a.toLowerCase()===x.toLowerCase()))?'checked':''}> Other</label>`;
  const custom=selected.filter(x=>!COMMON_DRUG_ALLERGIES.some(a=>a.toLowerCase()===x.toLowerCase()));
  const input=document.getElementById('profileAllergyCustomInput'); if(input) input.value=custom.join(', ');
}
function readAllergiesFromUI() {
  const checks=[...document.querySelectorAll('#allergyOptions input[type="checkbox"]')];
  const none=checks.find(c=>c.value==='__NONE__');
  if(none?.checked) return [];
  const selected=checks.filter(c=>c.checked && c.value!=='__NONE__' && c.value!=='__CUSTOM__').map(c=>c.value);
  const custom=document.getElementById('profileAllergyCustomInput')?.value.trim() || '';
  if(custom) selected.push(...custom.split(/[,;\n]+/).map(x=>x.trim()).filter(Boolean));
  return [...new Set(selected)];
}
const COMMON_NORMAL_ALLERGIES=['Dust','Pollen','Pet dander','Mold','Latex','Insect stings','Fragrances / perfumes'];
function normalizeNormalAllergies(value) {
  if (Array.isArray(value)) return value.map(x=>String(x).trim()).filter(Boolean);
  const text=String(value||'').trim();
  if (!text || /^none$/i.test(text) || /no known allergies/i.test(text)) return [];
  return text.split(/[,;\n]+/).map(x=>x.trim()).filter(Boolean);
}
function formatNormalAllergies(value) {
  const list=normalizeNormalAllergies(value);
  return list.length ? list.join(', ') : 'No common/environmental allergies';
}
function renderNormalAllergyOptions(value) {
  const selected=normalizeNormalAllergies(value);
  const wrap=document.getElementById('normalAllergyOptions'); if(!wrap) return;
  const isNone=selected.length===0;
  wrap.innerHTML = `<label class="normal-allergy-option"><input type="checkbox" value="__NONE__" ${isNone?'checked':''}> None / no known allergies</label>` +
    COMMON_NORMAL_ALLERGIES.map(a=>`<label class="normal-allergy-option"><input type="checkbox" value="${a}" ${selected.some(x=>x.toLowerCase()===a.toLowerCase())?'checked':''}> ${a}</label>`).join('') +
    `<label class="normal-allergy-option"><input type="checkbox" value="__CUSTOM__" id="customNormalAllergyToggle" ${selected.some(x=>!COMMON_NORMAL_ALLERGIES.some(a=>a.toLowerCase()===x.toLowerCase()))?'checked':''}> Other</label>`;
  const custom=selected.filter(x=>!COMMON_NORMAL_ALLERGIES.some(a=>a.toLowerCase()===x.toLowerCase()));
  const input=document.getElementById('profileNormalAllergyCustomInput'); if(input) input.value=custom.join(', ');
}
function readNormalAllergiesFromUI() {
  const checks=[...document.querySelectorAll('#normalAllergyOptions input[type="checkbox"]')];
  const none=checks.find(c=>c.value==='__NONE__');
  if(none?.checked) return [];
  const selected=checks.filter(c=>c.checked && c.value!=='__NONE__' && c.value!=='__CUSTOM__').map(c=>c.value);
  const custom=document.getElementById('profileNormalAllergyCustomInput')?.value.trim() || '';
  if(custom) selected.push(...custom.split(/[,;\n]+/).map(x=>x.trim()).filter(Boolean));
  return [...new Set(selected)];
}

function renderMedicineInputRows(medicines=[]) {
  const wrap=document.getElementById('medicineInputRows'); if(!wrap) return;
  const rows=Array.isArray(medicines)&&medicines.length?medicines:[{name:'',dose:'',schedule:'',packSize:'',times:[]}];
  wrap.innerHTML=rows.map((m,i)=>{
    const count=medicationSlotCount({dose:m.dose||'',frequency:m.schedule||m.frequency||''});
    const times=suggestedMedicationTimes(m,count);
    // Days already chosen; an older "weekly" medicine shows the day it has been
    // falling on; anything else starts as every day.
    const legacyWeekly=!medicationDays(m) && medicationFrequencyType({frequency:m.schedule||m.frequency||''})==='weekly';
    const anchor=m.startDate||m.date||m.prescribedDate;
    const anchorDay=anchor && !Number.isNaN(new Date(anchor).getTime()) ? new Date(anchor).getDay() : 1;
    const selected=medicationDays(m) || (legacyWeekly ? [anchorDay] : [0,1,2,3,4,5,6]);
    const label=escapeHtml(String(m.name||m.medicine||'this medicine'));
    return `<div class="medicine-input-row" data-index="${i}">
      <input type="text" class="medicine-name-input" placeholder="Medicine name" value="${escapeHtml(String(m.name||m.medicine||''))}">
      <input type="text" class="medicine-dose-input" placeholder="Dose (e.g. 2 tablets)" value="${escapeHtml(String(m.dose||''))}">
      <input type="text" class="medicine-schedule-input" placeholder="How often a day (e.g. Twice daily)" value="${escapeHtml(String(m.schedule||m.frequency||''))}">
      <input type="text" class="medicine-pack-input" placeholder="Pack size" aria-label="Pack size (optional, e.g. 30 tablets)" title="Optional, e.g. 30 tablets" value="${escapeHtml(String(m.packSize||m.pack||''))}">
      <button type="button" class="medicine-remove-btn" aria-label="Remove medicine" data-remove-medicine="${i}">×</button>
      <div class="med-time-editor">
        <div class="med-time-editor-label">When should each dose be taken?</div>
        ${times.slice(0,count).map((t,j)=>`<label class="med-time-slot">${count>1?'Dose '+(j+1):'Time'} <input type="time" class="medicine-time-input" data-time-index="${j}" value="${escapeHtml(String(t||''))}"></label>`).join('')}
      </div>
      <div class="med-days" role="group" aria-label="Days to take ${label}">
        <div class="med-time-editor-label">Which days? <span class="med-days-summary">${escapeHtml(medicationDaysSummary(selected))}</span></div>
        <div class="med-days-chips">${[1,2,3,4,5,6,0].map(n=>`<button type="button" class="med-day" data-day="${n}" aria-pressed="${selected.includes(n)}" aria-label="${WEEKDAY_LONG[n]}" title="${WEEKDAY_LONG[n]}">${WEEKDAY_SHORT[n].slice(0,2)}</button>`).join('')}</div>
      </div>
    </div>`;
  }).join('');
}
function medicationDaysSummary(days) {
  return days.length >= 7 ? 'Every day' : formatMedicationDays({days}) || 'Every day';
}
// Every row in the medicine editor, including blank ones (used when adding
// or removing a row, so nothing typed is lost). Days are stored only when
// they are not every day.
function readMedicineRowsRaw() {
  return [...document.querySelectorAll('#medicineInputRows .medicine-input-row')].map(row=>{
    const days=[...row.querySelectorAll('.med-day[aria-pressed="true"]')].map(b=>Number(b.dataset.day)).sort((a,b)=>a-b);
    return {
      name:row.querySelector('.medicine-name-input')?.value.trim()||'',
      dose:row.querySelector('.medicine-dose-input')?.value.trim()||'',
      schedule:row.querySelector('.medicine-schedule-input')?.value.trim()||'',
      packSize:row.querySelector('.medicine-pack-input')?.value.trim()||'',
      times:[...row.querySelectorAll('.medicine-time-input')].map(input=>input.value).filter(Boolean),
      ...(days.length && days.length<7 ? {days} : {}),
      reason:''
    };
  });
}
function readMedicineRows() {
  return readMedicineRowsRaw().filter(m=>m.name);
}
async function savePersonalizedProfile() {
  const get = id => document.getElementById(id)?.value.trim() || '';
  const height=get('profileHeightInput'), weight=get('profileWeightInput');
  const h=Number(height), w=Number(weight);
  const dob=get('profileDobInput');
  const kcalRaw=get('profileCalorieInput');
  const validationErrors=[];
  if(height && (!Number.isFinite(h) || h < 80 || h > 250)) validationErrors.push('Height must be between 80 and 250 cm.');
  if(weight && (!Number.isFinite(w) || w < 20 || w > 300)) validationErrors.push('Weight must be between 20 and 300 kg.');
  if(dob) { const d=new Date(dob+'T00:00:00'); if(Number.isNaN(d.getTime()) || d > new Date()) validationErrors.push('Date of birth cannot be in the future.'); }
  if(kcalRaw) { const kcal=Number(kcalRaw); if(!Number.isFinite(kcal) || kcal < 800 || kcal > 6000) validationErrors.push('Daily calorie benchmark must be between 800 and 6000 kcal.'); }
  const profileMedsPreview=readMedicineRows();
  const normalizeMedicineIdentity = value => String(value||'').toLowerCase().replace(/\b(tablets?|capsules?|caplets?|syrup|drops?|injection|cream|ointment|solution|suspension)\b/g,' ').replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
  const normalizeMedicineDose = value => String(value||'').toLowerCase().replace(/\s+/g,' ').trim();
  const seenMedicineNames=new Map();
  profileMedsPreview.forEach(m=>{
    const nameKey=normalizeMedicineIdentity(m.name);
    if(!nameKey) return;
    const doseKey=normalizeMedicineDose(m.dose);
    const key=`${nameKey}\u001f${doseKey}`;
    if(seenMedicineNames.has(key)) validationErrors.push(`Duplicate medicine detected: ${m.name}${m.dose?` (${m.dose})`:''}. Keep one profile row per medicine and dose.`);
    else seenMedicineNames.set(key,m.name);
  });
  if(validationErrors.length){
    const message=validationErrors.join('\n');
    showToast('', 'Please review your profile', message);
    throw new Error(message);
  }
  const first=get('profileFirstNameInput'), middle=get('profileMiddleNameInput'), last=get('profileLastNameInput');
  patientData.firstName=first; patientData.middleName=middle; patientData.lastName=last;
  patientData.name=[first,middle,last].filter(Boolean).join(' ') || patientData.name || 'SwasthID User';
  patientData.email=firebaseUser?.email || localStorage.getItem('swasth_abhaId') || '';
  patientData.ownerUid=firebaseUser?.uid || '';
  patientData.ownerEmail=firebaseUser?.email || patientData.email || '';
  patientData.dob=get('profileDobInput'); patientData.bloodGroup=get('profileBloodInput'); patientData.occupation=get('profileOccupationInput');
  patientData.vitals={...(patientData.vitals||{}),height:height,weight:weight,bmi:h>0&&w>0?(w/Math.pow(h/100,2)).toFixed(1):''};
  patientData.lifestyle={smoking:get('profileSmokingInput'),alcohol:get('profileAlcoholInput')};
  patientData.conditions=parseProfileConditions(get('profileConditionsInput'));
  patientData.medications=profileMedsPreview;
  // Keep the profile medication editor as the authoritative local source for
  // optional pack-size metadata. This makes refill reminders independent of
  // prescription records and resilient to cloud-sync timing.
  try { localStorage.setItem('swasth_profile_medications', JSON.stringify(patientData.medications)); } catch(e) { console.warn('Could not cache profile medicines', e); }
  const journeyPrefs = getCareJourneyPrefs();
  if (patientData.medications.length) journeyPrefs.medicationNotApplicable = false;
  saveCareJourneyPrefs(journeyPrefs);
  patientData.allergies=readAllergiesFromUI();
  patientData.normalAllergies=readNormalAllergiesFromUI();
  const kcal=Number(get('profileCalorieInput'));
  if(Number.isFinite(kcal)&&kcal>=800&&kcal<=6000){ patientData.nutrition={...(patientData.nutrition||{}),calorieTarget:kcal,targetSource:'User profile benchmark'}; localStorage.setItem('swasth_calorieTarget',String(kcal)); Promise.resolve().then(()=>syncCloudState('swasth_calorieTarget')).catch(()=>{}); }
  patientData.emergencyContact={name:get('profileEmergencyNameInput'),relation:get('profileEmergencyRelationInput'),phone:get('profileEmergencyPhoneInput')};
  patientData.insurance={provider:get('profileInsuranceProviderInput'),policyNumber:get('profileInsurancePolicyInput')};
  patientData.profileCompleted=true;
  patientData.onboardingSkipped=false;
  profileOnboardingRequired=false;
  setProfileSkippedForCurrentAccount(false);
  cacheProfileLocally();
  // Local state is the immediate source of truth. Close the editor before any
  // asynchronous cloud work can delay the visible UI response.
  renderPersonalizedUI();
  renderTodayMedications();
  renderMedicationInsights();
  const profileModalNow = document.getElementById('profileModal');
  if (profileModalNow) { profileModalNow.classList.remove('show'); profileModalNow.style.display='none'; }
  document.body.classList.remove('profile-modal-open');
  showToast('', 'Profile updated', 'Your SwasthID dashboard has been personalized.');
  Promise.resolve().then(() => syncProfileToCloud()).then(profileCloudSaved => {
    if (!profileCloudSaved) console.warn('Profile is cached locally for this account; Firestore save will retry on the next successful Firebase connection.');
  }).catch(err => console.warn('Cloud profile sync failed; local profile remains saved.', err));
}
window.savePersonalizedProfile = savePersonalizedProfile;

document.addEventListener('click', async e => {
  const target = e.target instanceof Element ? e.target : null;
  if (target && target.id === 'editProfileBtn') {
    e.preventDefault();
    e.stopPropagation();
    window.openProfileModal({force:true});
    return;
  }
  const addMed=target?.closest('#addMedicineRowBtn');
  if(addMed){
    const current=readMedicineRowsRaw();
    current.push({name:'',dose:'',schedule:'',packSize:'',times:[],reason:''});
    renderMedicineInputRows(current);
    setTimeout(()=>document.querySelector('#medicineInputRows .medicine-input-row:last-child .medicine-name-input')?.focus(),30);
    return;
  }
  // Day buttons in the medicine editor. At least one day stays selected.
  const dayBtn=target?.closest('#medicineInputRows .med-day');
  if(dayBtn){
    const row=dayBtn.closest('.med-days');
    const on=dayBtn.getAttribute('aria-pressed')==='true';
    if(on && row.querySelectorAll('.med-day[aria-pressed="true"]').length===1) return;
    dayBtn.setAttribute('aria-pressed',String(!on));
    const days=[...row.querySelectorAll('.med-day[aria-pressed="true"]')].map(b=>Number(b.dataset.day));
    row.querySelector('.med-days-summary').textContent=medicationDaysSummary(days);
    return;
  }
  const removeMed=target?.closest('[data-remove-medicine]');
  if(removeMed){
    const current=readMedicineRowsRaw();
    const idx=Number(removeMed.dataset.removeMedicine);
    current.splice(idx,1);
    renderMedicineInputRows(current);
    return;
  }
  const allergyCheck=target?.closest('#allergyOptions input[type="checkbox"]');
  if(allergyCheck){
    const checks=[...document.querySelectorAll('#allergyOptions input[type="checkbox"]')];
    const none=checks.find(c=>c.value==='__NONE__');
    if(allergyCheck.value==='__NONE__' && allergyCheck.checked){ checks.filter(c=>c!==allergyCheck).forEach(c=>c.checked=false); }
    if(allergyCheck.value!=='__NONE__' && allergyCheck.checked && none) none.checked=false;
    return;
  }
  const normalAllergyCheck=target?.closest('#normalAllergyOptions input[type="checkbox"]');
  if(normalAllergyCheck){
    const checks=[...document.querySelectorAll('#normalAllergyOptions input[type="checkbox"]')];
    const none=checks.find(c=>c.value==='__NONE__');
    if(normalAllergyCheck.value==='__NONE__' && normalAllergyCheck.checked){ checks.filter(c=>c!==normalAllergyCheck).forEach(c=>c.checked=false); }
    if(normalAllergyCheck.value!=='__NONE__' && normalAllergyCheck.checked && none) none.checked=false;
    return;
  }
  const editProfileButton = target?.closest('#editProfileBtn');
  if (editProfileButton) return;
  const cancelProfileButton = target?.closest('#cancelProfileBtn');
  if (cancelProfileButton) {
    e.preventDefault();
    closeProfileModal();
    return;
  }
  if (target?.id === 'profileModal') closeProfileModal();
  if (target?.closest('#authSuccessContinue')) {
    const modal = document.getElementById('authSuccessModal');
    try {
      if (!firebaseUser) throw new Error('Please sign in again after verifying your email.');
      await firebaseUser.reload();
      if (!firebaseUser.emailVerified) {
        alert('Your email is not verified yet. Open the verification email, click the link, then try again.');
        return;
      }
      localStorage.setItem('swasth_loggedIn', 'true');
      localStorage.setItem('swasth_abhaId', firebaseUser.email || '');
      if (modal) modal.classList.remove('show');
      performLoginSetup(firebaseUser.email, { skipProfilePrompt:true });
      setTimeout(() => openProfileModal({force:true}), 180);
    } catch (error) {
      console.error('Email verification check failed:', error);
      alert(error.message || 'Could not verify the email yet.');
    }
  }
});
document.addEventListener('submit', async e => {
  if (e.target.id !== 'profileForm') return;
  e.preventDefault();
  const b=document.getElementById('saveProfileBtn');
  if(b){b.disabled=true;b.textContent='Saving…';}
  try{await savePersonalizedProfile();}
  catch(err){console.error(err);alert('We could not save your profile right now. Please try again.');}
  finally{if(b){b.disabled=false;b.textContent='Save profile';}}
});

document.querySelectorAll('[data-emergency-visibility]').forEach(btn=>{
  btn.addEventListener('click',()=>{
    const key=btn.dataset.emergencyVisibility; const state=safeJsonParse(localStorage.getItem('swasth_emergencyVisibility')||'{}',{});
    const next=state[key]===false ? true : false; state[key]=next; localStorage.setItem('swasth_emergencyVisibility',JSON.stringify(state)); syncCloudState('swasth_emergencyVisibility');
    btn.classList.toggle('on',next); btn.setAttribute('aria-pressed',String(next)); generateEmergencyQR(true);
  });
});
// Revoking breaks every printed card and saved image of the QR, so it asks
// first, inline, and says what stops working.
document.getElementById('revokeEmergencyQrBtn')?.addEventListener('click',()=>{
  const box=document.getElementById('revokeConfirm'); if(!box) return;
  box.hidden=false; box.querySelector('[data-revoke-yes]')?.focus();
});
document.getElementById('revokeConfirm')?.addEventListener('click',e=>{
  const box=e.currentTarget;
  if(e.target.closest('[data-revoke-no]')){ box.hidden=true; document.getElementById('revokeEmergencyQrBtn')?.focus(); }
  if(e.target.closest('[data-revoke-yes]')){ box.hidden=true; revokeEmergencyQr(); }
});
async function revokeEmergencyQr(){
  const tokenId=localStorage.getItem('swasth_emergencyTokenId'), manageToken=localStorage.getItem('swasth_emergencyManageToken');
  if(!tokenId||!manageToken){showToast('','No QR to revoke yet','Open the emergency card once to create the QR.');return;}
  try{const base=(window.SWASTH_API_BASE||location.origin).replace(/\/$/,'');const r=await fetch(base+'/api/emergency/revoke',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tokenId,manageToken})});const b=await r.json().catch(()=>({}));if(!r.ok)throw new Error(b.error||'Could not revoke QR.');showToast('','Emergency QR revoked','Old cards and saved images no longer open your details. Refresh to make a new QR, then print a new card.');['swasth_emergencyTokenId','swasth_emergencyQrCache'].forEach(k=>{localStorage.removeItem(k);if(typeof syncCloudState==='function')syncCloudState(k);});const st=document.getElementById('qrPayloadStatus');if(st)st.textContent='Emergency QR revoked. Generate a new badge when needed.';}catch(e){showToast('','Revoke failed',e.message);}
}
document.getElementById('emergencyAccessLogBtn')?.addEventListener('click',async()=>{const out=document.getElementById('emergencyAccessLog');const tokenId=localStorage.getItem('swasth_emergencyTokenId'),manageToken=localStorage.getItem('swasth_emergencyManageToken');if(!out||!tokenId||!manageToken)return;try{const base=(window.SWASTH_API_BASE||location.origin).replace(/\/$/,'');const r=await fetch(base+'/api/emergency/activity?tokenId='+encodeURIComponent(tokenId)+'&manageToken='+encodeURIComponent(manageToken),{cache:'no-store'});const b=await r.json();if(!r.ok)throw new Error(b.error||'Unavailable');out.style.display='block';out.innerHTML='<b>Access activity</b><br>Opened '+(b.accessLog?.length||0)+' time(s). Last access: '+(b.accessLog?.length?new Date(b.accessLog[b.accessLog.length-1].at).toLocaleString():'Never')+'.';}catch(e){out.style.display='block';out.textContent='Access activity unavailable: '+e.message;}});

function renderEmergencyQRIfReady(){
  if (typeof generateEmergencyQR === 'function' && document.getElementById('realQrContainer')) { try { generateEmergencyQR(true); } catch(e) { console.warn('Emergency QR refresh skipped:', e); } }
}
