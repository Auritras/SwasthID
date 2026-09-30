 /* =========================================================
 5. MEDICATION TRACKER (MARK AS TAKEN & PERSISTENCE)
 ========================================================= */
 function parseMedicationDoseCount(m) {
 const text = `${m?.dose || ''} ${m?.medicine || ''}`.toLowerCase();
 const match = text.match(/(?:^|\s)(\d+)\s*(?:tablet|tablets|tab|tabs|capsule|capsules|cap|caps|pill|pills)\b/i);
 return match ? Math.max(1, Math.min(12, Number(match[1]))) : 1;
 }
 function parseMedicationFrequencyCount(m) {
 const f = String(m?.frequency || m?.schedule || '').toLowerCase();
 const everyHours = f.match(/every\s+(\d+)\s*hours?|q(\d+)h/);
 if (everyHours) return Math.max(1, Math.min(12, Math.floor(24 / Number(everyHours[1] || everyHours[2]))));
 if (/four times|four times daily|\bqid\b|4\s*times/.test(f)) return 4;
 if (/three times|thrice|\btds\b|\btid\b|3\s*times/.test(f)) return 3;
 if (/twice|two times|\bbd\b|\bbid\b|2\s*times/.test(f)) return 2;
 if (/weekly|once a week|one time a week|q7d/.test(f)) return 1;
 if (/monthly|once a month|q30d/.test(f)) return 1;
 return 1;
 }
 // Chosen days of the week (0 = Sunday), or null for every day. Missing, empty
 // or all seven days all mean every day, so older medicines are unaffected.
 const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
 const WEEKDAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
 function medicationDays(m) {
   const days = Array.isArray(m?.days) ? [...new Set(m.days.map(Number).filter(n => Number.isInteger(n) && n >= 0 && n <= 6))].sort((a, b) => a - b) : [];
   return days.length && days.length < 7 ? days : null;
 }
 // "Weekdays", "Weekends", "Mon, Thu" or '' for every day (Monday first).
 function formatMedicationDays(m) {
   const days = medicationDays(m);
   if (!days) return '';
   const key = days.join('');
   if (key === '12345') return 'Weekdays';
   if (key === '06') return 'Weekends';
   return [1, 2, 3, 4, 5, 6, 0].filter(n => days.includes(n)).map(n => WEEKDAY_SHORT[n]).join(', ');
 }
 // The schedule text plus any chosen days, e.g. "Once daily · Mon, Thu".
 function medicationScheduleText(m) {
   return [String(m?.frequency || m?.schedule || '').trim(), formatMedicationDays(m)].filter(Boolean).join(' · ');
 }
 function medicationFrequencyType(m) {
   if (medicationDays(m)) return 'days';
   const f=String(m?.frequency||m?.schedule||'').toLowerCase();
   if (/weekly|once a week|one time a week|q7d/.test(f)) return 'weekly';
   if (/monthly|once a month|q30d/.test(f)) return 'monthly';
   return 'daily';
 }
 /** @param {{frequency?:string,dose?:string}} m @returns {number} */
 function medicationSlotCount(m) {
   // Dose quantity (e.g. 2 tablets) is quantity per slot, not number of slots.
   return Math.max(1, parseMedicationFrequencyCount(m));
 }
 function medicationExpectedOnDate(m, date=new Date()) {
   const days=medicationDays(m);
   if(days) return days.includes(date.getDay());
   const type=medicationFrequencyType(m);
   if(type==='daily') return true;
   const anchor = m?.startDate || m?.date || m?.prescribedDate;
   if(!anchor) return type==='weekly' ? date.getDay()===1 : date.getDate()===1;
   const a=new Date(anchor); if(Number.isNaN(a.getTime())) return false;
   if(type==='weekly') return a.getDay()===date.getDay();
   return a.getDate()===date.getDate();
 }
 function suggestedMedicationTimes(m, count) {
 const existing = Array.isArray(m?.times) ? m.times.filter(Boolean) : [];
 if (existing.length >= count) return existing.slice(0, count);
 const defaults = ['08:00','14:00','20:00','22:00','09:00','18:00'];
 const out = existing.slice();
 while (out.length < count) out.push(defaults[Math.min(out.length, defaults.length - 1)]);
 return out;
 }
 function formatMedicationTime(value) {
 if (!value) return 'Set time';
 const [h, min] = String(value).split(':').map(Number);
 if (!Number.isFinite(h) || !Number.isFinite(min)) return value;
 const d = new Date(); d.setHours(h, min, 0, 0);
 return d.toLocaleTimeString([], {hour:'numeric', minute:'2-digit'});
 }
 function medicationIdentityKey(value) {
 const raw=String(value||'').toLowerCase().trim();
 return raw.replace(/\b(tablets?|tabs?|capsules?|caps?|syrups?|syr|injections?|inj|creams?|ointments?|drops?|solutions?|suspensions?|inhalers?|patches?|powders?)\b/g,' ').replace(/\b\d+(?:[.,]\d+)?\s*(?:mg|mcg|µg|ug|g|kg|ml|mL|l|iu|units?|%)\b/g,' ').replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
}
function medicationScheduleIdentity(m){
 const name=medicationIdentityKey(m?.medicine||m?.name);
 const dose=String(m?.dose||'').toLowerCase().replace(/\s+/g,' ').trim();
 const frequency=String(m?.frequency||m?.schedule||'').toLowerCase().replace(/\s+/g,' ').trim();
 return [name,dose,frequency].filter(Boolean).join(' | ');
}
function ensureMedicationStableId(m){
 const key=medicationScheduleIdentity(m) || medicationIdentityKey(m?.medicine||m?.name);
 return key ? `med_${key.replace(/[^a-z0-9]+/gi,'_').slice(0,90)}` : '';
}
function getCurrentMedicationList() {
 const saved = getSavedPrescriptions();
 const latest = saved[0];
 const profileMeds = Array.isArray(patientData.medications) ? patientData.medications : [];
 const prescriptionMeds = latest && Array.isArray(latest.medicines) ? latest.medicines : [];
 const out = [];
 const key = value => medicationIdentityKey(value);
 const scheduleKey = value => medicationScheduleIdentity(value);

 // Build a UNION rather than choosing either Profile or Prescription data.
 // Profile is where optional pack-size metadata is normally entered; the
 // prescription supplies the active dose/schedule.
 profileMeds.forEach(pm => {
   const name = String(pm?.name || pm?.medicine || '').trim();
   if (!name) return;
   out.push({
     ...pm,
     medicine: name,
     medicationId: ensureMedicationStableId(pm),
     dose: pm.dose || '',
     frequency: pm.schedule || pm.frequency || '',
     instructions: pm.reason || pm.instructions || '',
     times: Array.isArray(pm.times) ? pm.times : [],
     packSize: pm.packSize || pm.pack || ''
   });
 });

 prescriptionMeds.forEach(rx => {
   const name = String(rx?.medicine || rx?.name || '').trim();
   if (!name) return;
   const existing = out.find(m => scheduleKey(m) === scheduleKey(rx));
   if (existing) {
     existing.dose = rx.dose || existing.dose || '';
     existing.frequency = rx.frequency || rx.schedule || existing.frequency || '';
     existing.instructions = rx.instructions || rx.reason || existing.instructions || '';
     existing.times = Array.isArray(rx.times) && rx.times.length ? rx.times : existing.times;
     // IMPORTANT: preserve the Profile pack size unless the prescription also
     // explicitly contains one.
     existing.packSize = rx.packSize || rx.pack || existing.packSize || '';
   } else {
     out.push({
       ...rx,
       medicine: name,
       medicationId: ensureMedicationStableId(rx),
       frequency: rx.frequency || rx.schedule || '',
       instructions: rx.instructions || rx.reason || '',
       times: Array.isArray(rx.times) ? rx.times : [],
       packSize: rx.packSize || rx.pack || ''
     });
   }
 });
 return out;
 }
 function medicationScheduleKey(index, unitIndex) { const m=getCurrentMedicationList()[index]||{}; const stable=ensureMedicationStableId(m)||`unknown_${index}`; return `med_${stable.replace(/[^a-zA-Z0-9_]/g,'').slice(0,100)}_${unitIndex}`; }
 function legacyMedicationScheduleKey(index, unitIndex) { return `med_${index}_${unitIndex}`; }
 function saveMedicationTimes(index, times) {
 const meds = getCurrentMedicationList();
 const target = meds[index];
 if (!target) return;
 const clean = times.map(v => String(v || '').trim()).filter(Boolean);
 if (!clean.length) return;
 target.times = clean;
 const saved = getSavedPrescriptions();
 if (saved[0] && saved[0].medicines?.length) {
   saved[0].medicines = meds;
   savePrescriptions(saved);
 } else {
   const patientIndex = (patientData.medications || []).findIndex(m => String(m.name || '') === String(target.medicine || ''));
   if (patientIndex >= 0) {
     patientData.medications[patientIndex].times = clean;
     cacheProfileLocally();
     syncProfileToCloud();
   }
 }
 renderTodayMedications();
 renderCareJourney();
 showToast('', 'Medication time saved', `${target.medicine} schedule updated.`);
 }
 function renderTodayMedications() {
 const list = document.getElementById('todayMedList');
 if (!list) return;
 const meds = getCurrentMedicationList();
 const status = safeJsonParse(localStorage.getItem('swasth_medStatus') || '{}', {});
 if (!meds.length) {
   list.innerHTML = '<div class="today-med-empty">No medications added yet. Add medicines in Profile or upload a prescription.</div>';
   return;
 }
 const scheduledDoses = [];
 const notToday = [];
 meds.forEach((m, i) => {
   const count = medicationSlotCount(m);
   if (!medicationExpectedOnDate(m, new Date())) { notToday.push(m); return; }
   const times = suggestedMedicationTimes(m, count);
   for (let unit = 0; unit < count; unit++) {
     scheduledDoses.push({ m, i, unit, time: times[unit] || '' });
   }
 });

 // Keep Today's medication in chronological order, regardless of prescription/profile order.
 // Doses without a time stay at the end so they can still be configured.
 scheduledDoses.sort((a, b) => {
   if (!a.time && !b.time) return a.i - b.i || a.unit - b.unit;
   if (!a.time) return 1;
   if (!b.time) return -1;
   return a.time.localeCompare(b.time) || a.i - b.i || a.unit - b.unit;
 });

 let html = '';
 scheduledDoses.forEach(({ m, i, unit, time }) => {
     const count = medicationSlotCount(m);
     const id = medicationScheduleKey(i, unit);
     const storedStatus = status[id] || status[legacyMedicationScheduleKey(i, unit)];
     // Only today's flag counts; another device may have synced yesterday's.
     const savedStatus = storedStatus?.taken && storedStatus?.date && new Date(storedStatus.date).toDateString() === new Date().toDateString() ? storedStatus : null;
     const label = count > 1 ? `Dose ${unit + 1} of ${count}` : '';
     const due = /^(\d{1,2}):(\d{2})$/.exec(time || '');
     const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
     const overdue = !savedStatus?.taken && due && nowMin - (Number(due[1]) * 60 + Number(due[2])) >= 60;
     const overdueBadge = overdue ? `<span class="badge badge-warning">${medicationIsCritical(m) ? 'Overdue · critical' : 'Overdue'}</span>` : '';
     html += `<div class="today-med-item ${savedStatus?.taken ? 'taken' : ''}" id="${id}">
       <div class="today-med-time">${time ? formatMedicationTime(time) : 'No time'}${label ? `<small>${label}</small>` : ''}</div>
       <div>
         <div class="today-med-name">${escapeHtml(m.medicine)}${m.dose ? ' · ' + escapeHtml(m.dose) : ''}</div>
         <div class="today-med-meta">${escapeHtml(medicationScheduleText(m) || 'Review schedule')}${m.instructions ? ' · ' + escapeHtml(m.instructions) : ''}${overdueBadge}</div>
         ${time ? `<button type="button" class="link-btn" data-edit-med-time aria-expanded="false">Change time</button>` : ''}
         <div class="today-med-time-editor"${time ? ' hidden' : ''}>
           <input type="time" value="${escapeHtml(time)}" data-med-time-index="${i}" data-med-time-unit="${unit}" aria-label="Time for ${escapeHtml(m.medicine)} dose ${unit + 1}">
           <button type="button" class="btn btn-sm" data-save-med-time="1" data-med-time-index="${i}" data-med-time-unit="${unit}">Save time</button>
         </div>
       </div>
       <button class="med-action" type="button" data-mark-med="${id}" data-med-name="${escapeHtml(m.medicine)}">${savedStatus?.taken ? `Taken ${escapeHtml(savedStatus.time || '')}` : 'Mark taken'}</button>
     </div>`;
   });
 if (!scheduledDoses.length) html = '<div class="today-med-empty">No medicines due today.</div>';
 // Medicines on other days, so they don't look like they have gone missing.
 if (notToday.length) html += `<p class="today-med-later">Not due today: ${notToday.map(m => `${escapeHtml(m.medicine)} (${escapeHtml(formatMedicationDays(m) || medicationScheduleText(m))})`).join(', ')}</p>`;
 list.innerHTML = html;
 list.querySelectorAll('[data-edit-med-time]').forEach(btn => btn.addEventListener('click', () => {
   const editor = btn.nextElementSibling;
   const open = editor.hidden;
   editor.hidden = !open;
   btn.setAttribute('aria-expanded', String(open));
   btn.textContent = open ? 'Cancel' : 'Change time';
   if (open) editor.querySelector('input')?.focus();
 }));
 list.querySelectorAll('[data-save-med-time]').forEach(btn => btn.addEventListener('click', () => {
   const i = Number(btn.dataset.medTimeIndex), unit = Number(btn.dataset.medTimeUnit);
   const inputs = [...list.querySelectorAll(`[data-med-time-index="${i}"]`)];
   const times = inputs.map(input => input.value);
   saveMedicationTimes(i, times);
 }));
 list.querySelectorAll('[data-mark-med]').forEach(btn => btn.addEventListener('click', () => {
   window.markMedTaken(btn.dataset.markMed, btn.dataset.medName);
 }));
 }
 function restoreMedications() { renderTodayMedications(); }

 function medicationPackUnits(m) {
   const text = String(m?.packSize || m?.pack || '').trim().toLowerCase();
   if (!text) return null;
   // Accept the common inputs users are likely to type: 30, 30 tablets,
   // 30 tabs, 10 capsules, strip of 10, pack of 30, etc.
   const match = text.match(/(?:pack|strip|box|bottle|of)?\s*(\d+(?:\.\d+)?)/i);
   if (!match) return null;
   const value = Number(match[1]);
   return Number.isFinite(value) && value > 0 ? value : null;
 }
 // Units used on a day the medicine is taken.
 function medicationDailyUnits(m) { return Math.max(1, parseMedicationDoseCount(m) * parseMedicationFrequencyCount(m)); }
 // Days a pack lasts, counting only the days it is taken.
 function medicationSupplyDays(m, pack) {
   const perDay = medicationDailyUnits(m);
   const days = medicationDays(m);
   const type = medicationFrequencyType(m);
   const daysPerWeek = days ? days.length : type === 'weekly' ? 1 : 7;
   if (type === 'monthly') return Math.max(0, Math.floor(pack / perDay) * 30);
   return Math.max(0, Math.floor(pack / perDay / daysPerWeek * 7));
 }
 // ---- What is left in the pack ----
 // A pack counts as full from when its size was entered (or "Refilled" was
 // tapped); each dose marked taken since then uses up its units. Stored per
 // medicine in swasth_refills: { at, units, label } (label = pack size text,
 // so editing the pack size starts a new pack).
 function readRefills() { return safeJsonParse(localStorage.getItem('swasth_refills') || '{}', {}) || {}; }
 function saveRefills(refills) {
   localStorage.setItem('swasth_refills', JSON.stringify(refills));
   if (typeof syncCloudState === 'function') syncCloudState('swasth_refills');
 }
 // Only start a pack once the account's own records have loaded, so a
 // half-loaded device can't replace the count kept on another one.
 function canStartPacks() { return typeof firebaseUser === 'undefined' || !firebaseUser || cloudSyncReady; }
 function medicationStock(m, pack, label) {
   const key = medicationIdentityKey(m.medicine);
   const refills = readRefills();
   let rec = refills[key];
   if (!rec || rec.label !== label) {
     rec = { at: new Date().toISOString(), units: pack, label };
     if (canStartPacks()) { refills[key] = rec; saveRefills(refills); }
   }
   const since = new Date(rec.at).getTime();
   const history = safeJsonParse(localStorage.getItem('swasth_medStatus') || '{}', {}).history || [];
   const taken = history.filter(e => e?.taken && medicationIdentityKey(e.medicine) === key && new Date(e.date).getTime() >= since).length;
   return { left: Math.max(0, rec.units - taken * parseMedicationDoseCount(m)), units: rec.units };
 }
 function markMedicationRefilled(name, pack, label) {
   const refills = readRefills();
   refills[medicationIdentityKey(name)] = { at: new Date().toISOString(), units: pack, label };
   saveRefills(refills);
 }
 function medicationIsCritical(m) {
   return /\b(insulin|levothyroxine|thyroxine|euthyrox|insulin pen)\b/i.test(`${m?.medicine||''} ${m?.dose||''}`);
 }
 function getMedicationHistory() {
   const status = safeJsonParse(localStorage.getItem('swasth_medStatus') || '{}', {});
   if (Array.isArray(status.history)) return status.history;
   return Object.entries(status).filter(([k,v]) => /^med_.+_\d+$/.test(k) && v?.taken).map(([id,v]) => ({id,...v,medicine:'Medication'}));
 }
 function localDayKey(d) { const x=new Date(d); return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}`; }
 function renderMedicationAdherence() {
   const panel=document.getElementById('medAdherencePanel'); if(!panel) return;
   const meds=getCurrentMedicationList();
   if(!meds.length){panel.innerHTML='<b>Adherence</b><div class="adherence-sub">Add a medicine to start tracking how often you take your doses.</div>';return;}
   const history=getMedicationHistory(); const now=new Date(); const days=[];
   let totalExpected=0,totalTaken=0;
   for(let offset=6;offset>=0;offset--){
     const d=new Date(now); d.setHours(0,0,0,0); d.setDate(d.getDate()-offset);
     const key=localDayKey(d); const expected=meds.reduce((sum,m)=>sum+(medicationExpectedOnDate(m,key ? d : d) ? medicationSlotCount(m) : 0),0);
     const taken=history.filter(e=>e?.taken && localDayKey(e.date)===key).length;
     const pct=expected?Math.min(100,Math.round(taken/expected*100)):0;
     totalExpected+=expected; totalTaken+=Math.min(taken,expected); days.push({d,pct,taken,expected});
   }
   const pct=totalExpected?Math.round(totalTaken/totalExpected*100):0;
   let streak=0;
   for(let i=days.length-1;i>=0;i--){ if(days[i].expected && days[i].taken>=days[i].expected) streak++; else break; }
   panel.innerHTML=`<div class="adherence-head"><div><b>Medication adherence</b><div class="adherence-sub">Based on doses you mark as taken. No new tracking input is required.</div></div><div class="adherence-summary"><div class="adherence-stat">${pct}%</div><div class="adherence-sub">7-day adherence · ${streak}-day streak</div></div></div><div class="adherence-chart">${days.map(x=>`<div class="adherence-day"><div class="adherence-day-pct">${x.pct}%</div><div class="adherence-bar-wrap"><div class="adherence-bar" style="height:${Math.max(3,x.pct)}%"></div></div><div class="adherence-day-label">${x.d.toLocaleDateString([], {weekday:'short'})}</div></div>`).join('')}</div>`;
 }
 function renderMedicationRefills() {
   const panel=document.getElementById('medRefillPanel');
   if(!panel) return;

   // Refill reminders are based directly on the medicines currently saved in
   // the user's Profile. Pack size is optional; only medicines with a valid
   // user-entered pack size are shown here.
   let profileMeds = Array.isArray(patientData?.medications) ? patientData.medications : [];
   // Prefer the exact medication rows saved by the Profile editor. This is
   // where optional pack sizes are entered and prevents prescription/cloud
   // state from accidentally replacing them before the refill panel renders.
   try {
     const cachedProfileMeds = JSON.parse(localStorage.getItem('swasth_profile_medications') || 'null');
     if (Array.isArray(cachedProfileMeds)) profileMeds = cachedProfileMeds;
   } catch(e) {}
   const prescriptionMeds = getSavedPrescriptions()[0]?.medicines || [];
   const normalise = v => String(v ?? '').trim().toLowerCase().replace(/\s+/g,' ');
   const extractPack = value => {
     const text=String(value ?? '').trim();
     if(!text) return null;
     const m=text.match(/(\d+(?:\.\d+)?)/);
     if(!m) return null;
     const n=Number(m[1]);
     return Number.isFinite(n) && n>0 ? n : null;
   };

   // Start with Profile medicines so pack size is never lost when a saved
   // prescription contains the same medicine without pack metadata.
   const merged=[];
   profileMeds.forEach(m=>{
     const name=String(m?.name || m?.medicine || '').trim();
     if(!name) return;
     merged.push({
       ...m,
       medicine:name,
       dose:String(m?.dose || '').trim(),
       frequency:String(m?.schedule || m?.frequency || '').trim(),
       packSize:String(m?.packSize || m?.pack || '').trim(),
       times:Array.isArray(m?.times) ? m.times : [],
       days:Array.isArray(m?.days) ? m.days : undefined
     });
   });
   prescriptionMeds.forEach(rx=>{
     const name=String(rx?.medicine || rx?.name || '').trim();
     if(!name) return;
     const existing=merged.find(m=>normalise(m.medicine)===normalise(name));
     if(existing){
       existing.dose=existing.dose || String(rx?.dose || '').trim();
       existing.frequency=existing.frequency || String(rx?.frequency || rx?.schedule || '').trim();
       existing.times=existing.times?.length ? existing.times : (Array.isArray(rx?.times) ? rx.times : []);
       if(!existing.packSize) existing.packSize=String(rx?.packSize || rx?.pack || '').trim();
     } else {
       merged.push({...rx, medicine:name, packSize:String(rx?.packSize || rx?.pack || '').trim()});
     }
   });

   const items=[];
   merged.forEach(m=>{
     const rawPack=String(m?.packSize || '').trim();
     const pack=extractPack(rawPack);
     if(!rawPack || pack===null) return;
     const daily=medicationDailyUnits(m);
     const stock=medicationStock(m,pack,rawPack);
     const days=medicationSupplyDays(m,stock.left);
     items.push({m,days,pack,daily,rawPack,left:stock.left,units:stock.units,when:formatMedicationDays(m)});
   });

   panel.style.display='block';
   if(!items.length){
     panel.innerHTML='<b>Refill reminders</b><div class="adherence-sub">Add a pack size to a medicine in your profile to see when it will run out.</div>';
     return;
   }
   panel.innerHTML=`<b>Refill reminders</b><div class="adherence-sub">Counts down as you mark doses taken. Tap Refilled when you open a new pack.</div>${items.map(x=>`<div class="refill-item"><div><b>${escapeHtml(x.m.medicine||'Medication')}</b><div class="adherence-sub">${escapeHtml(x.m.packSize)} · ${x.daily} unit${x.daily===1?'':'s'} ${x.when?`on ${escapeHtml(x.when)}`:'per day'}</div></div><div class="refill-side"><div class="refill-count${x.days<=7?' is-low':''}"><b>${x.left===0||x.days===0?'Refill due now':`~${x.days} day${x.days===1?'':'s'} left`}</b><span>${x.left} of ${x.units} left</span></div><div class="refill-actions"><button type="button" class="btn btn-sm" data-refilled-med="${escapeHtml(x.m.medicine||'')}" data-pack="${x.pack}" data-label="${escapeHtml(x.rawPack)}">Refilled</button><button type="button" class="btn btn-sm" data-refill-med="${escapeHtml(x.m.medicine||'')}">Reorder</button></div></div></div>`).join('')}`;
   panel.querySelectorAll('[data-refilled-med]').forEach(btn=>btn.addEventListener('click',()=>{
     markMedicationRefilled(btn.dataset.refilledMed, Number(btn.dataset.pack), btn.dataset.label);
     renderMedicationRefills();
     showToast('', 'Pack refilled', `${btn.dataset.refilledMed}: ${btn.dataset.pack} left. Each dose you mark taken counts down from here.`);
   }));
   panel.querySelectorAll('[data-refill-med]').forEach(btn=>btn.addEventListener('click',()=>{
     const q=btn.dataset.refillMed||'';
     showTab('order');
     const input=document.getElementById('medSearch');
     if(input){ input.value=q; window.searchMedicines?.(); }
   }));
 }
 function renderMedicationMissedDoses() {
   const panel = document.getElementById('medMissedDosePanel');
   if (!panel) return;
   const meds = getCurrentMedicationList();
   if (!meds.length) { panel.style.display = 'none'; panel.innerHTML = ''; return; }

   const status = safeJsonParse(localStorage.getItem('swasth_medStatus') || '{}', {});
   const now = new Date();
   const nowMinutes = now.getHours() * 60 + now.getMinutes();
   const missed = [];

   meds.forEach((m, i) => {
     const count = medicationSlotCount(m);
     const times = suggestedMedicationTimes(m, count);
     for (let unit = 0; unit < count; unit++) {
       const id = medicationScheduleKey(i, unit);
       const saved = status[id] || status[legacyMedicationScheduleKey(i, unit)];
       const takenToday = saved?.taken && saved?.date && new Date(saved.date).toDateString() === now.toDateString();
       if (takenToday) continue;

       const match = String(times[unit] || '').match(/^(\d{1,2}):(\d{2})$/);
       if (!match) continue;
       const scheduledMinutes = Number(match[1]) * 60 + Number(match[2]);
       if (nowMinutes - scheduledMinutes >= 60) {
         missed.push({ id, medicine: m.medicine, dose: m.dose || '', time: times[unit], critical: medicationIsCritical(m) });
       }
     }
   });

   if (!missed.length) { panel.style.display = 'none'; panel.innerHTML = ''; return; }

   panel.style.display = 'block';
   panel.innerHTML = `<div class="med-alert-title">Missed dose${missed.length === 1 ? '' : 's'}</div>` +
     missed.map(x => `<div class="med-alert-item"><div><b>${escapeHtml(x.medicine)}</b>${x.dose ? ' · ' + escapeHtml(x.dose) : ''} — was due at ${formatMedicationTime(x.time)}${x.critical ? ' <span style="color:var(--danger,#b91c1c);font-weight:700;">(critical)</span>' : ''}</div><button type="button" class="med-action" id="${escapeHtml(x.id)}" data-mark-med="${escapeHtml(x.id)}" data-med-name="${escapeHtml(x.medicine)}">Mark taken</button></div>`).join('');

   panel.querySelectorAll('[data-mark-med]').forEach(btn =>
     btn.addEventListener('click', () => window.markMedTaken(btn.dataset.markMed, btn.dataset.medName))
   );
 }
 function renderMedicationInsights(){ renderMedicationAdherence(); renderMedicationRefills(); renderMedicationMissedDoses(); }
 window.markMedTaken = function(id, name) {
 const el = document.getElementById(id);
 if(!el) return;
 if(el.classList.contains('taken')) return;
 const now = new Date();
 const nowStr = now.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
 const meds = safeJsonParse(localStorage.getItem('swasth_medStatus') || '{}', {});
 const history = Array.isArray(meds.history) ? meds.history : [];
 const current = getCurrentMedicationList();
 let medIndex = -1;
 let unitIndex = -1;
 for (let i = 0; i < current.length; i++) {
   const count = medicationSlotCount(current[i]);
   for (let u = 0; u < count; u++) {
     if (medicationScheduleKey(i,u) === id || legacyMedicationScheduleKey(i,u) === id) { medIndex=i; unitIndex=u; break; }
   }
   if (medIndex >= 0) break;
 }
 const med = medIndex >= 0 ? current[medIndex] : null;
 const event = {
   id, medicine: med?.medicine || name || 'Medication', dose: med?.dose || '',
   unitIndex, taken: true, time: nowStr, date: now.toISOString()
 };
 history.push(event);
 meds.history = history.slice(-500);
 meds[id] = { taken: true, time: nowStr, date: now.toISOString() };
 localStorage.setItem('swasth_medStatus', JSON.stringify(meds));
 syncCloudState('swasth_medStatus');
 el.classList.add('taken');
 const btn = el.querySelector('.med-action');
 if (btn) btn.innerHTML = `Taken ${escapeHtml(nowStr)}`;
 renderRecordMedicationActivity(); renderRecordTimeline(); renderMedicationInsights(); renderCareJourney(); renderTodayStats();
 window.refreshDoseReminders?.(); // a taken dose is left out of its reminder
 showToast('', 'Medication Tracked', `${name} logged successfully.`);
 };
