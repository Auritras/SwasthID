 /* =========================================================
 3. TIME-OF-DAY ENGINE & METRICS (WITH CALORIE PERSISTENCE)
 ========================================================= */
 function initTimeAwareContent(){
 const now = new Date();
 const timeStr = now.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
 const dateStr = now.toLocaleDateString([], {weekday: 'long', day: 'numeric', month: 'short'});
 const heroTime = document.getElementById('heroTime');
 if (heroTime) heroTime.textContent = `${dateStr} · ${timeStr}`;

 const savedKcal = localStorage.getItem('swasth_addedKcal');
 globalKcal = savedKcal ? (parseInt(savedKcal, 10) || 0) : getTodayLogs().reduce((sum, item) => sum + Number(item.kcal || 0), 0);
 syncTodayCalories();
 renderTodayFoodLogs();

 const steps = Number(localStorage.getItem('swasth_stepsToday') || 0);
 const activityNote = document.getElementById('activityNote');
 const stepsEl = document.getElementById('homeStepsStat');
 if (steps > 0) {
   if (activityNote) activityNote.textContent = `${steps.toLocaleString()} steps recorded today.`;
   if (stepsEl) stepsEl.textContent = steps.toLocaleString();
 } else {
   if (activityNote) activityNote.textContent = 'Activity data is not connected yet. Connect a supported activity source to see live metrics.';
   if (stepsEl) stepsEl.textContent = 'Not connected';
 }
 const runEl=document.getElementById('homeRunStat'); const sleepEl=document.getElementById('homeSleepStat');
 if (runEl) runEl.textContent = 'Not connected';
 if (sleepEl) sleepEl.textContent = 'Not connected';
 updateCalorieDisplays();

 const history = Array.isArray(patientData.activityHistory) ? patientData.activityHistory : [];
 const hasActivityHistory = history.some(x => Number(x?.value || 0) > 0) || steps > 0;
 const barsContainer = document.getElementById('stepBars');
 if (barsContainer) {
   if (!hasActivityHistory) {
     barsContainer.className = 'activity-empty';
     barsContainer.innerHTML = 'No activity history yet. Connect a supported activity source to populate the weekly view.';
   } else {
     barsContainer.className = 'bars';
     const todayEntry = { label:'Today', value:steps };
     const week = [...history.slice(-6), todayEntry];
     const days = week.map(x => x.label || 'Day');
     const vals = week.map(x => Number(x.value || 0));
     const maxVal = Math.max(1, ...vals);
     barsContainer.innerHTML = '';
     week.forEach((entry, i) => {
       const col = document.createElement('div'); col.className = 'bar-col';
       col.innerHTML = `<div class="bar" style="height:${Math.max(4, (Number(entry.value||0) / maxVal * 100))}%;"></div><div class="day">${escapeHtml(days[i] || 'Day')}</div>`;
       barsContainer.appendChild(col);
     });
   }
 }
 if (document.getElementById('ageValue')) document.getElementById('ageValue').textContent = calculateAge(patientData.dob) !== null ? `${calculateAge(patientData.dob)} years` : 'Not provided';
 }

 function getDailyCalorieTarget() {
   const fallback = Number(patientData?.nutrition?.calorieTarget) || 2200;
   const saved = Number(localStorage.getItem('swasth_calorieTarget'));
   return Number.isFinite(saved) && saved >= 800 && saved <= 6000 ? Math.round(saved) : fallback;
 }

 function setDailyCalorieTarget(value) {
   const target = Math.round(Number(value));
   if(!Number.isFinite(target) || target < 800 || target > 6000) {
     showToast('', 'Invalid calorie target', 'Choose a daily target between 800 and 6,000 kcal.');
     return false;
   }
   localStorage.setItem('swasth_calorieTarget', String(target));
 syncCloudState('swasth_calorieTarget');
   if(patientData.nutrition) patientData.nutrition.calorieTarget = target;
   updateCalorieDisplays();
   return true;
 }

 function updateCalorieDisplays() {
 const hk = document.getElementById('homeKcalStat');
 const nk = document.getElementById('nutriKcal');
 const ns = document.getElementById('nutritionCalorieStatus');
 const target = getDailyCalorieTarget();
 const intake = Math.max(0, Number(globalKcal) || 0);
 if(hk) hk.textContent = `${Math.round(intake)} kcal`;
 if(nk) nk.textContent = `${Math.round(intake)} kcal`;
 const nt = document.getElementById('nutriCalorieTarget');
 if(nt) nt.textContent = `${Math.round(target).toLocaleString()} kcal`;

 if(ns) {
   let label = 'On track';
   let color = 'var(--ok)';
   if(intake === 0) {
     label = 'No intake';
     color = 'var(--muted)';
   } else if(intake < target * 0.50) {
     label = 'Low intake';
     color = 'var(--danger)';
   } else if(intake < target * 0.80) {
     label = 'Below target';
     color = 'var(--warn, #B7791F)';
   } else if(intake < target) {
     label = 'On track';
     color = 'var(--ok)';
   } else if(intake <= target * 1.10) {
     label = 'Target reached';
     color = 'var(--ok)';
   } else {
     label = 'Above target';
     color = 'var(--danger)';
   }
   ns.textContent = label;
   ns.className = 'badge' + (/Above|Low/.test(label) ? ' badge-warning' : /track|reached/.test(label) ? ' badge-brand' : '');
 }
 const kp = document.getElementById('kcalProgress');
 if (kp) kp.style.width = `${Math.min(100, target ? Math.round(intake / target * 100) : 0)}%`;
 }

 const editCalorieTargetBtn = document.getElementById('editCalorieTargetBtn');
 if(editCalorieTargetBtn) {
   editCalorieTargetBtn.addEventListener('click', () => {
     const current = getDailyCalorieTarget();
     const value = window.prompt('Set your daily calorie target (800–6000 kcal):', String(current));
     if(value === null) return;
     if(setDailyCalorieTarget(value)) {
       showToast('', 'Daily target updated', `Nutrition benchmark set to ${getDailyCalorieTarget().toLocaleString()} kcal/day.`);
     }
   });
 }

 function showAccountCreatedModal(cloudReady) {
 const modal = document.getElementById('authSuccessModal');
 const message = document.getElementById('authSuccessMessage');
 const note = document.getElementById('authSuccessNote');
 const btn = document.getElementById('authSuccessContinue');
 if(!modal) return;
 profileOnboardingRequired = true;
 message.textContent = 'Account created. Please verify your email address before entering your SwasthID dashboard.';
 if (btn) btn.textContent = 'I’ve verified my email';
 if (note) note.textContent = 'A verification link was sent to your email address. Check your inbox and spam folder. You can request another verification email by trying Login again.';
 modal.classList.add('show');
 if(btn) setTimeout(() => btn.focus(), 50);
 }

 function installProfileFocusTrap(){
  const modal=document.getElementById('profileModal'); if(!modal || modal.dataset.focusTrapBound) return;
  modal.dataset.focusTrapBound='true';
  modal.addEventListener('keydown', e=>{
    if(e.key!=='Tab' || !modal.classList.contains('show')) return;
    const focusables=[...modal.querySelectorAll('button,input,select,textarea,a[href],[tabindex]:not([tabindex="-1"])')].filter(x=>!x.disabled && x.offsetParent!==null);
    if(!focusables.length) return;
    const first=focusables[0], last=focusables[focusables.length-1];
    if(e.shiftKey && document.activeElement===first){e.preventDefault();last.focus();}
    else if(!e.shiftKey && document.activeElement===last){e.preventDefault();first.focus();}
  });
}
const profileModalEl = document.getElementById('profileModal');
const profileFormEl = document.getElementById('profileForm');
const editProfileBtnEl = document.getElementById('editProfileBtn');
const cancelProfileBtnEl = document.getElementById('cancelProfileBtn');
if (editProfileBtnEl) editProfileBtnEl.addEventListener('click', () => openProfileModal({force:true}));
if (cancelProfileBtnEl) cancelProfileBtnEl.addEventListener('click', () => closeProfileModal());
if (profileModalEl) profileModalEl.addEventListener('click', e => { if (e.target === profileModalEl) closeProfileModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && profileModalEl?.classList.contains('show')) closeProfileModal(); });

const authSuccessModal = document.getElementById('authSuccessModal');
 if(authSuccessModal) {
   authSuccessModal.addEventListener('click', (event) => {
     if(event.target === authSuccessModal) authSuccessModal.classList.remove('show');
   });
 }
 document.addEventListener('keydown', (event) => {
   if(event.key === 'Escape' && authSuccessModal && authSuccessModal.classList.contains('show')) {
     authSuccessModal.classList.remove('show');
   }
 });

 function escapeHtml(value) {
  const div = document.createElement('div');
  div.textContent = String(value ?? '');
  return div.innerHTML;
}

let toastTimer = null;
function showToast(icon, title, body) {
 document.getElementById('toastTitleText').textContent = title;
 document.getElementById('toastBodyText').textContent = body || '';
 const t = document.getElementById('medToast');
 t.classList.add('show');
 clearTimeout(toastTimer);
 toastTimer = setTimeout(() => t.classList.remove('show'), 6000);
 }

 function getNextMedicationDose() {
 const meds = getCurrentMedicationList();
 if (!meds.length) return null;

 const now = new Date();
 const nowMinutes = now.getHours() * 60 + now.getMinutes();
 const status = safeJsonParse(localStorage.getItem('swasth_medStatus') || '{}', {});
 const candidates = [];

 meds.forEach((m, i) => {
   const count = medicationSlotCount(m);
   if (!medicationExpectedOnDate(m, new Date())) return;
   const times = suggestedMedicationTimes(m, count);
   for (let unit = 0; unit < count; unit++) {
     const id = medicationScheduleKey(i, unit);
     const saved = status[id];
     const takenToday = saved?.taken && saved?.date && new Date(saved.date).toDateString() === now.toDateString();
     if (takenToday) continue;

     const value = String(times[unit] || '');
     const match = value.match(/^(\d{1,2}):(\d{2})$/);
     if (!match) continue;
     const hours = Number(match[1]);
     const minutes = Number(match[2]);
     if (hours > 23 || minutes > 59) continue;

     const scheduledMinutes = hours * 60 + minutes;
     const overdue = scheduledMinutes < nowMinutes;
     candidates.push({
       medicine: m.medicine,
       dose: m.dose || '',
       time: value,
       scheduledMinutes,
       overdue,
       id
     });
   }
 });

 if (!candidates.length) return null;

 candidates.sort((a, b) => {
   if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
   if (a.overdue) return a.scheduledMinutes - b.scheduledMinutes;
   return a.scheduledMinutes - b.scheduledMinutes;
 });

 return candidates[0];
 }

 function showNextMedicationToast() {
 const next = getNextMedicationDose();
 if (!next) return;
 const doseText = next.dose ? ` — ${next.dose}` : '';
 const whenText = next.overdue ? `overdue since ${formatMedicationTime(next.time)}` : `scheduled for ${formatMedicationTime(next.time)}`;
 showToast('', next.overdue ? 'Medication Due' : 'Next Medication', `${next.medicine}${doseText} — ${whenText}.`);
 }
 document.getElementById('toastClose').addEventListener('click', () => {
 document.getElementById('medToast').classList.remove('show');
 });

 /* =========================================================
 4. MENTAL HEALTH MOOD TRACKER
 ========================================================= */
 function initMoodTracker() {
 const savedMoodStr = localStorage.getItem('swasth_dailyMood');
 const todayStr = new Date().toDateString();

 const moodMsgEl = document.getElementById('moodResponseText');

 if (savedMoodStr) {
 const savedData = JSON.parse(savedMoodStr);
 if (savedData.date === todayStr) {
 document.querySelectorAll('.mood-emoji').forEach(btn => {
 if(btn.dataset.mood === savedData.mood) {
 btn.classList.add('active');
 if(moodMsgEl) moodMsgEl.textContent = btn.dataset.msg || '';
 }
 else btn.classList.remove('active');
 });
 } else {
 localStorage.removeItem('swasth_dailyMood');
 }
 }

 document.querySelectorAll('.mood-emoji').forEach(btn => {
 btn.addEventListener('click', function() {
 const mood = this.dataset.mood;
 document.querySelectorAll('.mood-emoji').forEach(b => b.classList.remove('active'));
 this.classList.add('active');
 if(moodMsgEl) moodMsgEl.textContent = this.dataset.msg || '';

 localStorage.setItem('swasth_dailyMood', JSON.stringify({ mood: mood, date: new Date().toDateString() }));
 syncCloudState('swasth_dailyMood');
 });
 });

 const supportBtn = document.getElementById('callSupportBtn');
if (supportBtn && !supportBtn.dataset.bound) {
 supportBtn.dataset.bound = 'true';
 supportBtn.addEventListener('click', () => {
 window.location.href = 'tel:14416';
 });
}
 }
