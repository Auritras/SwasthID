/* =========================================================
 9. UNIFIED DATA RENDERING (RECORDS)
 Records are derived from the same state used by the rest of the app.
 ========================================================= */
 function formatRecordDate(value) {
   if (!value) return 'Date unavailable';
   const d = new Date(value);
   return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleDateString([], {day:'numeric', month:'short', year:'numeric'});
 }
 function getRecordFoodLogs() {
   try { return JSON.parse(localStorage.getItem('swasth_foodLogs') || '[]'); } catch (e) { return []; }
 }
 function getRecordMedicationActivity() {
   const history=getMedicationHistory();
   return history.filter(x=>x?.taken).map((item,index)=>({id:item.id||`history_${index}`,medicine:`${item.medicine||'Medication'}${item.dose?' '+item.dose:''}`,time:item.time||'Time unavailable',date:item.date||new Date().toISOString()}));
 }
 function renderHistory(containerId){
   const el = document.getElementById(containerId); if(!el) return;
   const conditions = Array.isArray(patientData.conditions) ? patientData.conditions : [];
   if (!conditions.length) { el.innerHTML = '<div class="empty">No conditions recorded.</div>'; return; }
   el.innerHTML = '<div class="list">' + conditions.map(item => `<div class="list-row"><div class="list-main"><b>${escapeHtml(item.name)}</b><span>${[item.year ? 'Since ' + escapeHtml(item.year) : '', item.details ? escapeHtml(item.details) : ''].filter(Boolean).join(' · ') || 'No details'}</span></div><span class="badge${String(item.status).toLowerCase() === 'ongoing' ? ' badge-info' : ''}">${escapeHtml(item.status || 'Ongoing')}</span></div>`).join('') + '</div>';
 }
 renderHistory('historyListRecords'); renderHistory('historyListProfile');
 const historyToggle = document.getElementById('historyToggle');
 if (historyToggle) historyToggle.addEventListener('click', function(){ document.getElementById('historyBodyProfile')?.classList.toggle('open'); document.getElementById('historyChevron')?.classList.toggle('rot'); });
 function renderVisits(){
   const el=document.getElementById('visitList'); if(!el) return;
   const visits=Array.isArray(patientData.visits)?patientData.visits:[];
   if(!visits.length){el.innerHTML='<div class="empty">No doctor visits recorded yet.</div>';return;}
   el.innerHTML='<div class="list">'+visits.slice().sort((a,b)=>new Date(b.date)-new Date(a.date)).map(v=>`<div class="list-row"><div class="list-main"><b>${escapeHtml(v.doctor)}</b><span>${[v.specialty,v.facility].filter(Boolean).map(escapeHtml).join(' · ')}</span></div><span class="list-end">${formatRecordDate(v.date)}</span></div>`).join('')+'</div>';
 }
 renderVisits();
 // Expandable list rows: a button with aria-expanded controls the panel after it.
 document.addEventListener('click',e=>{const btn=e.target.closest('.disclosure');if(!btn)return;const panel=document.getElementById(btn.getAttribute('aria-controls'));if(!panel)return;const open=btn.getAttribute('aria-expanded')!=='true';btn.setAttribute('aria-expanded',String(open));panel.hidden=!open;});
 let renderedReports=[];
 function renderReports(){
   const el=document.getElementById('reportList'); if(!el)return;
   const reports=Array.isArray(patientData.reports)?patientData.reports:[];
   if(!reports.length){renderedReports=[];el.innerHTML='<div class="empty">No lab reports yet. Scan one to start tracking values like HbA1c and cholesterol.</div>';return;}
   renderedReports=reports.slice().sort((a,b)=>new Date(b.date)-new Date(a.date));
   el.innerHTML=renderedReports.map((r,i)=>{
     const values=Array.isArray(r.values)?r.values:[];
     const body=values.length?`<dl class="value-grid">${values.map(v=>`<div><dt>${escapeHtml(v.test)}</dt><dd>${escapeHtml(String(v.value))} <span>${escapeHtml(v.unit||'')}</span></dd></div>`).join('')}</dl>`:`<p>${escapeHtml(r.result||'No values recorded.')}</p>`;
     return `<div class="list-item"><button type="button" class="list-row disclosure" aria-expanded="false" aria-controls="reportBody${i}"><span class="list-main"><b>${escapeHtml(r.name)}</b><span>${formatRecordDate(r.date)}${values.length?` · ${values.length} value${values.length===1?'':'s'}`:''}${r.source==='scan'?' · Scanned':''}</span></span><svg class="icon icon-sm chevron" aria-hidden="true"><use href="#i-chevron-down"/></svg></button><div class="list-panel" id="reportBody${i}" hidden>${body}<div class="list-panel-actions"><button type="button" class="btn btn-sm btn-danger" onclick="deleteReport(${i})">Delete report</button></div></div></div>`;
   }).join('');
   el.innerHTML='<div class="list">'+el.innerHTML+'</div>';
 }
 window.toggleReport=function(i){document.querySelector(`[aria-controls="reportBody${i}"]`)?.click();};
 window.deleteReport=function(i){const r=renderedReports[i];if(!r||!confirm(`Delete “${r.name||'this report'}”? Its values will be removed from your trends.`))return;patientData.reports=(patientData.reports||[]).filter(x=>x!==r);saveRecordCollections();showToast('','Report deleted','The report was removed from your records.');};
 renderReports();
 function saveRecordCollections(){ cacheProfileLocally(); syncProfileToCloud(); renderVisits(); renderReports(); renderRecordTimeline(); renderLabTrendChart(); }
 // Inline record editor: replaces the old multi-step prompt() flow so record entry works on all browsers.
 function openRecordEntryEditor(kind){
   const overlay=document.getElementById('recordEntryEditor');
   if(!overlay)return;
   const isVisit=kind==='visit';
   document.getElementById('recordEntryTitle').textContent=isVisit?'Add a doctor visit':'Add a lab report';
   document.getElementById('recordEntryHelp').textContent=isVisit?'Record a consultation.':'Type the test names and values, for example “HbA1c 6.4%”.';
   document.getElementById('visitEntryFields').hidden=!isVisit;
   document.getElementById('labEntryFields').hidden=isVisit;
   // Start each entry blank so the previous record is not saved again by accident.
   const setValue=(id,value)=>{const el=document.getElementById(id);if(el)el.value=value;};
   setValue('recordDoctorInput','');setValue('recordSpecialtyInput','General Medicine');setValue('recordFacilityInput','');
   setValue('recordReportNameInput','Blood test');setValue('recordResultInput','');
   document.getElementById('recordDateInput').value=getTodayKey();
   overlay.dataset.kind=kind;
   overlay.hidden=false;
   setTimeout(()=>{
     const first=isVisit?document.getElementById('recordDoctorInput'):document.getElementById('recordReportNameInput');
     first?.focus();
   },20);
 }
 function closeRecordEntryEditor(){
   const overlay=document.getElementById('recordEntryEditor');
   if(overlay)overlay.hidden=true;
 }
 function saveRecordEntry(){
   const overlay=document.getElementById('recordEntryEditor');
   if(!overlay)return;
   const kind=overlay.dataset.kind;
   const date=document.getElementById('recordDateInput')?.value||getTodayKey();
   if(kind==='visit'){
     const doctor=document.getElementById('recordDoctorInput')?.value.trim();
     const specialty=document.getElementById('recordSpecialtyInput')?.value.trim()||'General Medicine';
     const facility=document.getElementById('recordFacilityInput')?.value.trim()||'';
     if(!doctor){showToast('','Doctor name required','Enter the doctor name before saving the visit.');document.getElementById('recordDoctorInput')?.focus();return;}
     patientData.visits=[...(patientData.visits||[]),{id:`visit_${Date.now()}`,doctor,specialty,facility,date}];
     saveRecordCollections();
     closeRecordEntryEditor();
     showToast('','Visit Added','The visit is now part of your health record.');
   }else{
     const name=document.getElementById('recordReportNameInput')?.value.trim();
     const result=document.getElementById('recordResultInput')?.value.trim();
     if(!name){showToast('','Report name required','Enter a name for the lab report.');document.getElementById('recordReportNameInput')?.focus();return;}
     if(!result){showToast('','Result required','Enter the report result or value before saving.');document.getElementById('recordResultInput')?.focus();return;}
     patientData.reports=[...(patientData.reports||[]),{id:`report_${Date.now()}`,name,result,date}];
     saveRecordCollections();
     closeRecordEntryEditor();
     showToast('','Lab Report Added','The report is now available in Records and trend extraction.');
   }
 }
 document.getElementById('addVisitRecordBtn')?.addEventListener('click',()=>openRecordEntryEditor('visit'));
 document.getElementById('addLabReportBtn')?.addEventListener('click',()=>openRecordEntryEditor('lab'));
 document.getElementById('recordEntryCancel')?.addEventListener('click',closeRecordEntryEditor);
 document.getElementById('recordEntrySave')?.addEventListener('click',saveRecordEntry);
 document.getElementById('recordEntryEditor')?.addEventListener('click',e=>{if(e.target.id==='recordEntryEditor')closeRecordEntryEditor();});
 document.getElementById('recordResultInput')?.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key==='Enter')saveRecordEntry();});
 // Records: day-grouped logs. Each list shows 7 days at first; "Show earlier days" adds 7 more.
 const recordDaysShown = { food: 7, meds: 7, timeline: 7 };
 function recordDayKey(value){ const d=new Date(value); return Number.isNaN(d.getTime()) ? String(value||'') : localDayKey(d); }
 function recordDayLabel(key){
   const today=localDayKey(new Date()), y=new Date(); y.setDate(y.getDate()-1);
   if(key===today) return 'Today';
   if(key===localDayKey(y)) return 'Yesterday';
   const d=new Date(`${key}T12:00:00`);
   return Number.isNaN(d.getTime()) ? key : d.toLocaleDateString([], {weekday:'short', day:'numeric', month:'short', year: d.getFullYear()===new Date().getFullYear() ? undefined : 'numeric'});
 }
 function groupRecordsByDay(items, keyOf){
   const map=new Map();
   items.forEach(item=>{ const k=keyOf(item); if(!map.has(k)) map.set(k,[]); map.get(k).push(item); });
   return [...map.entries()].sort((a,b)=>b[0].localeCompare(a[0]));
 }
 function recordEmpty(message, tab, action){
   return `<div class="empty empty-cta"><span>${escapeHtml(message)}</span>${tab?`<button type="button" class="btn btn-sm" data-open-tab="${tab}">${escapeHtml(action)}</button>`:''}</div>`;
 }
 function recordMoreButton(kind, totalDays){
   return totalDays > recordDaysShown[kind] ? `<button type="button" class="record-more-btn" data-record-more="${kind}">Show earlier days</button>` : '';
 }
 function bindRecordListActions(el){
   el.querySelectorAll('[data-open-tab]').forEach(btn=>btn.addEventListener('click',()=>showTab(btn.dataset.openTab)));
   el.querySelectorAll('[data-record-more]').forEach(btn=>btn.addEventListener('click',()=>{
     const kind=btn.dataset.recordMore; recordDaysShown[kind]+=7;
     ({food:renderRecordFoodLogs, meds:renderRecordMedicationActivity, timeline:renderRecordTimeline})[kind]();
   }));
 }
 // Day tabs: one tab per day (newest first) and a panel for the selected day.
 const recordSelectedDay = {};
 function renderDayTabs(el, kind, days, summaryOf, rowsOf){
   const keys=days.map(([k])=>k);
   if(!keys.includes(recordSelectedDay[kind])) recordSelectedDay[kind]=keys[0];
   const sel=recordSelectedDay[kind];
   const items=days.find(([k])=>k===sel)?.[1]||[];
   el.innerHTML=`<div class="day-tabs" role="tablist" aria-label="Days">${days.map(([k,list])=>`<button type="button" role="tab" id="${kind}-tab-${k}" aria-controls="${kind}-panel" aria-selected="${k===sel}" tabindex="${k===sel?0:-1}" data-day="${k}">${escapeHtml(recordDayLabel(k))}<span class="day-tab-count">${list.length}</span></button>`).join('')}</div>`+
     `<div class="record-day" role="tabpanel" id="${kind}-panel" aria-labelledby="${kind}-tab-${sel}"><div class="record-day-head"><span>${escapeHtml(recordDayLabel(sel))}</span><span>${summaryOf(items)}</span></div>${rowsOf(items)}</div>`;
   const tabs=[...el.querySelectorAll('[role="tab"]')];
   const select=(key,focus)=>{ recordSelectedDay[kind]=key; renderDayTabs(el,kind,days,summaryOf,rowsOf); const t=el.querySelector(`[data-day="${key}"]`); t?.scrollIntoView({block:'nearest',inline:'nearest'}); if(focus) t?.focus(); };
   tabs.forEach((t,i)=>{
     t.addEventListener('click',()=>select(t.dataset.day,true));
     t.addEventListener('keydown',e=>{
       const step={ArrowRight:1,ArrowLeft:-1}[e.key]; if(e.key==='Home'||e.key==='End'){e.preventDefault();select(keys[e.key==='Home'?0:keys.length-1],true);return;}
       if(!step) return; e.preventDefault(); select(keys[(i+step+keys.length)%keys.length],true);
     });
   });
   el.querySelector('[aria-selected="true"]')?.scrollIntoView({block:'nearest',inline:'nearest'});
 }

 // Meals store a display time like "06:40 PM"; the id is the creation timestamp, so sort by it.
 function foodLogTimestamp(log){ const t=Number(log.id); return Number.isFinite(t) && t>1e12 ? t : new Date(`${log.date}T12:00:00`).getTime(); }

 function renderRecordFoodLogs(){
   const el=document.getElementById('recordFoodList');if(!el)return;
   const logs=getRecordFoodLogs().slice().sort((a,b)=>foodLogTimestamp(b)-foodLogTimestamp(a));
   if(!logs.length){el.innerHTML=recordEmpty('No meals logged yet.','nutrition','Log a meal');bindRecordListActions(el);return;}
   const days=groupRecordsByDay(logs, log=>log.date || recordDayKey(foodLogTimestamp(log)));
   renderDayTabs(el,'food',days,
     items=>`${Math.round(items.reduce((sum,x)=>sum+Number(x.kcal||0),0)).toLocaleString()} kcal · ${items.length} ${items.length===1?'meal':'meals'}`,
     items=>items.map(log=>{
       const macros=[['P',log.protein],['C',log.carbs],['F',log.fat]].filter(([,v])=>Number(v)>0).map(([k,v])=>`${k} ${Number(v).toFixed(0)}g`).join(' · ');
       const detail=[log.mealType && log.mealType!=='Unspecified' ? log.mealType : '', log.portion, macros].filter(Boolean).join(' · ');
       return `<div class="record-row"><span class="record-row-time">${escapeFoodText(log.time||'')}</span><div class="record-row-main"><b>${escapeFoodText(log.name)}</b><span>${escapeFoodText(detail)}</span></div><span class="record-row-value">${Math.round(Number(log.kcal||0))} kcal</span></div>`;
     }).join(''));
 }

 function renderRecordMedicationActivity(){
   const el=document.getElementById('recordMedicationList');if(!el)return;
   const current=getCurrentMedicationList();
   const doses=getMedicationHistory().filter(x=>x?.taken).slice().sort((a,b)=>new Date(b.date)-new Date(a.date));
   if(!doses.length){el.innerHTML=recordEmpty('No doses marked as taken yet.','home',"Open today's medicines");bindRecordListActions(el);return;}
   const days=groupRecordsByDay(doses, d=>recordDayKey(d.date));
   renderDayTabs(el,'meds',days,
     items=>`${items.length} ${items.length===1?'dose':'doses'} taken`,
     items=>items.map(d=>{
       const med=current.find(m=>medicationIdentityKey(m.medicine)===medicationIdentityKey(d.medicine));
       const count=med ? medicationSlotCount(med) : 0;
       const unit=Number(d.unitIndex);
       const detail=[d.dose, count>1 && unit>=0 ? `Dose ${unit+1} of ${count}` : ''].filter(Boolean).join(' · ');
       return `<div class="record-row"><span class="record-row-time">${escapeHtml(d.time||'')}</span><div class="record-row-main"><b>${escapeHtml(d.medicine||'Medication')}</b>${detail?`<span>${escapeHtml(detail)}</span>`:''}</div><span class="badge badge-brand">Taken</span></div>`;
     }).join(''));
 }

 function renderRecordTimeline(){
   const el=document.getElementById('recordTimeline');if(!el)return; const events=[];
   (patientData.visits||[]).forEach(v=>events.push({day:recordDayKey(v.date),type:'visit',label:'Visit',title:[v.doctor,v.specialty].filter(Boolean).join(' · '),meta:v.facility||''}));
   (patientData.reports||[]).forEach(r=>events.push({day:recordDayKey(r.date),type:'lab',label:'Lab report',title:r.name,meta:r.result||''}));
   getSavedPrescriptions().forEach(r=>{const n=r.medicines?.length||0;events.push({day:recordDayKey(r.date),type:'rx',label:'Prescription',title:`Prescription from ${r.doctor||'your doctor'}`,meta:`${n} ${n===1?'medicine':'medicines'}${n?': '+r.medicines.slice(0,3).map(m=>m.medicine).join(', ')+(n>3?'…':''):''}`});});
   // One summary line per day for routine logs, instead of repeating every dose and meal.
   const daily=new Map();
   getMedicationHistory().filter(x=>x?.taken).forEach(d=>{const k=recordDayKey(d.date);const e=daily.get(k)||{doses:0,meals:0,kcal:0};e.doses++;daily.set(k,e);});
   getRecordFoodLogs().forEach(l=>{const k=l.date||recordDayKey(foodLogTimestamp(l));const e=daily.get(k)||{doses:0,meals:0,kcal:0};e.meals++;e.kcal+=Number(l.kcal||0);daily.set(k,e);});
   daily.forEach((e,k)=>events.push({day:k,type:'log',label:'Daily log',title:[e.doses?`${e.doses} ${e.doses===1?'dose':'doses'} taken`:'',e.meals?`${e.meals} ${e.meals===1?'meal':'meals'} logged (${Math.round(e.kcal).toLocaleString()} kcal)`:''].filter(Boolean).join(' · '),meta:''}));
   if(!events.length){el.innerHTML=recordEmpty('Your visits, lab reports and prescriptions will appear here.','scan','Scan a prescription');bindRecordListActions(el);return;}
   const order={visit:0,lab:1,rx:2,log:3};
   const days=groupRecordsByDay(events, e=>e.day);
   el.innerHTML='<div class="record-timeline">'+days.slice(0,recordDaysShown.timeline).map(([key,items])=>
     `<div class="record-timeline-day"><div class="record-timeline-date">${escapeHtml(recordDayLabel(key))}</div>`+
     items.sort((a,b)=>order[a.type]-order[b.type]).map(e=>`<div class="record-timeline-item type-${e.type}"><span class="record-timeline-dot" aria-hidden="true"></span><div class="record-row-main"><span class="record-type">${escapeHtml(e.label)}</span><b>${escapeHtml(e.title)}</b>${e.meta?`<span>${escapeHtml(e.meta)}</span>`:''}</div></div>`).join('')+'</div>'
   ).join('')+'</div>'+recordMoreButton('timeline',days.length);
   bindRecordListActions(el);
 }
 function buildSwasthHealthBundle(){
   const profile=patientData||{};
   const meds=getCurrentMedicationList ? getCurrentMedicationList() : (Array.isArray(profile.medications)?profile.medications:[]);
   const prescriptions=getSavedPrescriptions();
   const visits=Array.isArray(profile.visits)?profile.visits:[];
   const reports=Array.isArray(profile.reports)?profile.reports:[];
   const conditions=Array.isArray(profile.conditions)?profile.conditions:[];
   const labs=profile.labs && typeof profile.labs==='object' ? profile.labs : {};
   const bundle={
     resourceType:'Bundle', type:'collection', generatedAt:new Date().toISOString(),
     meta:{profile:'SwasthID Health Summary', format:'FHIR-ish portable prototype bundle', prototype:true},
     patient:{resourceType:'Patient', id:profile.ownerUid||profile.email||'patient', name:profile.name||'', birthDate:profile.dob||'', bloodGroup:profile.bloodGroup||'', telecom:profile.email?[{system:'email',value:profile.email}]:[]},
     conditions:conditions.map((c,i)=>({resourceType:'Condition',id:`condition-${i+1}`,code:{text:c.name||''},clinicalStatus:{text:c.status||''},onsetYear:c.year||'',note:c.details||''})),
     allergies:{
       drug:(Array.isArray(profile.allergies)?profile.allergies:[]).map(String).filter(a=>a&&a!=='__NONE__'),
       other:(Array.isArray(profile.normalAllergies)?profile.normalAllergies:[]).map(String).filter(a=>a&&a!=='__NONE__')
     },
     medications:meds.map((m,i)=>({resourceType:'MedicationStatement',id:`medication-${i+1}`,medication:{text:m.name||m.medicine||''},dose:{text:m.dose||''},frequency:{text:medicationScheduleText(m)},instructions:m.instructions||''})),
     prescriptions:prescriptions.map(r=>({resourceType:'MedicationRequest',id:r.id||`rx-${Date.now()}`,authoredOn:r.date||'',requester:{display:r.doctor||''},medications:r.medicines||[]})),
     encounters:visits.map((v,i)=>({resourceType:'Encounter',id:`encounter-${i+1}`,date:v.date||'',provider:v.doctor||'',specialty:v.specialty||'',facility:v.facility||''})),
     diagnosticReports:reports.map((r,i)=>({resourceType:'DiagnosticReport',id:`report-${i+1}`,date:r.date||'',code:{text:r.name||''},result:{text:r.result||''}})),
     emergencyContact:profile.emergencyContact||{},
     vitals:profile.vitals||{},
     lifestyle:profile.lifestyle||{},
     nutrition:profile.nutrition||{},
     labs
   };
   return bundle;
 }
 function downloadTextFile(filename,text,mime='application/json'){
   const blob=new Blob([text],{type:mime}); const url=URL.createObjectURL(blob); const a=document.createElement('a');
   a.href=url; a.download=filename; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),1000);
 }
 function safeHealthName(){return String(patientData?.name||'Patient').replace(/[^a-z0-9]+/gi,'-').replace(/^-|-$/g,'')||'Patient';}
 function setHealthShareStatus(text,error=false){const el=document.getElementById('healthShareStatus');if(el){el.textContent=text;el.classList.toggle('is-error',!!error);}}
 async function exportHealthSummaryPDF(){
   const btn=document.getElementById('exportHealthPdfBtn'); if(btn)btn.disabled=true;
   try{
     const jsPDF=await ensureJsPdfLoaded(); if(!jsPDF)throw new Error('PDF generator could not be loaded.');
     const {doc,filename}=buildHealthSummaryPdf(jsPDF);
     SwasthPdf.save(doc,filename);setHealthShareStatus(`Health summary PDF ready: ${filename}`);
   }catch(e){console.error('Health summary PDF failed:',e);setHealthShareStatus('Health Summary PDF failed: '+(e?.message||'unknown error'),true);alert('The health summary PDF could not be generated. Please try again.');}finally{if(btn)btn.disabled=false;}
 }
 /* ---------------------------------------------------------------
    Lab report reading. The same catalogue parses scanned reports and
    the free-text results people type in, so both feed the trend chart.
    Values are converted to one unit per test so trends stay comparable.
    --------------------------------------------------------------- */
 const LAB_TESTS = [
   { name: 'HbA1c', unit: '%', min: 3, max: 20, dp: 1, panel: 'Diabetes',
     re: /\b(?:h\s*b\s*a\s*[1il]{1,2}\s*c|glyc(?:ated|osylated)\s+ha?emoglobin|a1c)\b/i,
     units: { 'mmol/mol': v => v / 10.929 + 2.15 } },
   { name: 'Fasting glucose', unit: 'mg/dL', min: 30, max: 700, panel: 'Diabetes',
     re: /\b(?:fasting\s+(?:blood\s+|plasma\s+|serum\s+)?(?:glucose|sugar)|(?:blood\s+|plasma\s+)?(?:glucose|sugar)\s*[,(-]?\s*\(?\s*fasting|f\.?\s?b\.?\s?s|f\.?p\.?g)\b/i,
     units: { 'mmol/l': v => v * 18.016 } },
   { name: 'Post-meal glucose', unit: 'mg/dL', min: 30, max: 800, panel: 'Diabetes',
     re: /\b(?:(?:post\s*-?\s*prandial|pp|2\s*-?\s*h(?:ou)?rs?)\s+(?:blood\s+|plasma\s+)?(?:glucose|sugar)|p\.?\s?p\.?\s?b\.?\s?s|(?:glucose|sugar)\s*[,(-]?\s*\(?\s*(?:pp|post\s*-?\s*prandial))\b/i,
     units: { 'mmol/l': v => v * 18.016 } },
   { name: 'Random glucose', unit: 'mg/dL', min: 30, max: 900, panel: 'Diabetes',
     re: /\b(?:random\s+(?:blood\s+|plasma\s+)?(?:glucose|sugar)|(?:glucose|sugar)\s*[,(-]?\s*\(?\s*random|r\.?b\.?s)\b/i,
     units: { 'mmol/l': v => v * 18.016 } },
   { name: 'Total cholesterol', unit: 'mg/dL', min: 50, max: 700, panel: 'Lipid profile',
     re: /\b(?:total\s+cholesterol|cholesterol\s*[,(-]?\s*\(?\s*total|(?:serum\s+|s\.\s*)?cholesterol)\b/i,
     skip: /\b(?:v?[lh]dl|ratio|non)\b/i,
     units: { 'mmol/l': v => v * 38.67 } },
   { name: 'LDL', unit: 'mg/dL', min: 10, max: 500, panel: 'Lipid profile',
     re: /\b(?:ldl|low\s+density\s+lipoprotein)\b/i, skip: /\bratio\b/i,
     units: { 'mmol/l': v => v * 38.67 } },
   { name: 'HDL', unit: 'mg/dL', min: 5, max: 200, panel: 'Lipid profile',
     re: /\b(?:hdl|high\s+density\s+lipoprotein)\b/i, skip: /\bratio\b|\bnon[\s-]*hdl/i,
     units: { 'mmol/l': v => v * 38.67 } },
   { name: 'Triglycerides', unit: 'mg/dL', min: 10, max: 5000, panel: 'Lipid profile',
     re: /\b(?:triglycerides?|triglyceride|t\.?g\.?)\b/i, skip: /\bratio\b/i,
     units: { 'mmol/l': v => v * 88.57 } },
   { name: 'Creatinine', unit: 'mg/dL', min: 0.1, max: 25, panel: 'Kidney',
     re: /\b(?:serum\s+|s\.\s*)?creatinine\b/i, skip: /clearance|urine|urinary|ratio|kinase/i,
     units: { 'umol/l': v => v / 88.4 } },
   { name: 'eGFR', unit: 'mL/min/1.73m²', min: 2, max: 200, panel: 'Kidney',
     re: /\be\s*-?\s*gfr\b/i },
   { name: 'Uric acid', unit: 'mg/dL', min: 0.5, max: 25, panel: 'Kidney',
     re: /\buric\s+acid\b/i, units: { 'umol/l': v => v / 59.48 } },
   { name: 'Hemoglobin', unit: 'g/dL', min: 2, max: 25, panel: 'Blood count',
     re: /\b(?:ha?emoglobin|hb|hgb)\b/i, skip: /glyc|a\s*[1il]{1,2}\s*c|corpuscular|mchc?\b|urine/i,
     units: { 'g/l': v => v / 10 } },
   { name: 'TSH', unit: 'mIU/L', min: 0.001, max: 200, panel: 'Thyroid',
     re: /\b(?:tsh|thyroid\s+stimulating\s+hormone)\b/i },
   { name: 'Vitamin D', unit: 'ng/mL', min: 2, max: 250, panel: 'Vitamins',
     re: /\b(?:(?:vitamin|vit\.?)\s*d\s*3?(?:\s*,?\s*\(?\s*(?:25\s*-?\s*(?:oh|hydroxy)|total)\s*\)?)?|25\s*-?\s*(?:oh|hydroxy)(?:\s*(?:vitamin|vit\.?)\s*d\s*3?)?)/i,
     units: { 'nmol/l': v => v / 2.496 } },
   { name: 'Vitamin B12', unit: 'pg/mL', min: 20, max: 5000, panel: 'Vitamins',
     re: /\b(?:(?:vitamin|vit\.?)\s*b\s*-?\s*12|cobalamin)\b/i,
     units: { 'pmol/l': v => v * 1.355 } },
   { name: 'ALT (SGPT)', unit: 'U/L', min: 1, max: 5000, panel: 'Liver',
     re: /\b(?:sgpt|alt|alanine\s+(?:amino)?transaminase)\b/i },
   { name: 'AST (SGOT)', unit: 'U/L', min: 1, max: 5000, panel: 'Liver',
     re: /\b(?:sgot|ast|aspartate\s+(?:amino)?transaminase)\b/i },
   // Plain "glucose" last, so a more specific name on the same line wins.
   { name: 'Glucose', unit: 'mg/dL', min: 30, max: 900, panel: 'Diabetes',
     re: /\b(?:(?:blood|plasma|serum)\s+)?(?:glucose|sugar)\b/i, skip: /urine|urinary|estimated|average|\beag\b/i,
     units: { 'mmol/l': v => v * 18.016 } },
 ];
 const LAB_UNIT_RE = /(mmol\s*\/\s*mol|mmol\s*\/\s*l|[a-zµ]mol\s*\/\s*l|nmol\s*\/\s*l|pmol\s*\/\s*l|mg\s*\/\s*d\s*l|g\s*\/\s*d\s*l|g\s*\/\s*l|pg\s*\/\s*ml|ng\s*\/\s*ml|m?[iu]u\s*\/\s*m?l|u\s*\/\s*l|ml\s*\/\s*min|%)/i;

 function labRound(value, dp) {
   if (dp != null) return Number(value.toFixed(dp));
   const abs = Math.abs(value);
   return Number(value.toFixed(abs >= 100 ? 0 : abs >= 10 ? 1 : abs >= 1 ? 2 : 3));
 }

 // OCR often drops the decimal point ("13.4" -> "134"). When a whole number is
 // implausible for the test, try putting the point back, preferring the reading
 // closest in size to the reference range printed on the same line.
 function recoverLabDecimal(digits, test, convert, refs) {
   const target = refs.length ? Math.max(...refs) : null;
   // A result the same size as its reference range is not missing a point; the unit was misread.
   if (target && Number(digits) >= target / 4 && Number(digits) <= target * 4) return null;
   let best = null;
   for (let i = digits.length - 1; i >= 1; i--) {
     const raw = Number(digits.slice(0, i) + '.' + digits.slice(i));
     const value = convert ? convert(raw) : raw;
     if (value < test.min || value > test.max) continue;
     const score = target ? Math.abs(Math.log(raw / target)) : digits.length - i;
     if (!best || score < best.score) best = { value, score };
   }
   return best ? best.value : null;
 }

 // Reads one line: finds a test name, then the first number after it (the result;
 // the reference range comes later on the line), then its unit.
 function parseLabLine(line) {
   const found = [];
   for (const test of LAB_TESTS) {
     if (test.skip && test.skip.test(line)) continue;
     const m = line.match(test.re);
     if (!m) continue;
     const rest = line.slice(m.index + m[0].length);
     // Numbers glued to a word (e.g. "T3") are not results.
     const num = rest.match(/(?:^|[^A-Za-z0-9.])[<>≤≥]?\s*(\d{1,5}(?:[.,]\d{1,3})?)(?!\d)/);
     if (!num) continue;
     const text = num[1].replace(',', '.');
     const after = rest.slice(num.index + num[0].length);
     const unitMatch = after.match(LAB_UNIT_RE);
     // "µ" is often read as u, y, h, n or p. Tests only reported in µmol/L (creatinine,
     // uric acid) take any such unit as µmol/L.
     let unitRaw = unitMatch && unitMatch.index <= 14 ? unitMatch[1].replace(/\s+/g, '').toLowerCase().replace(/^[µyh]mol/, 'umol') : '';
     if (/^[a-z]mol\/l$/.test(unitRaw) && unitRaw !== 'mmol/l' && test.units && !test.units[unitRaw] && test.units['umol/l']) unitRaw = 'umol/l';
     const convert = unitRaw && test.units ? test.units[unitRaw] : null;
     let value = convert ? convert(Number(text)) : Number(text);
     let guessed = false;
     if (!Number.isFinite(value)) continue;
     if ((value < test.min || value > test.max) && /^\d{2,4}$/.test(text)) {
       const refs = (after.slice(unitMatch && unitMatch.index <= 14 ? unitMatch.index + unitMatch[0].length : 0).match(/\d+(?:\.\d+)?/g) || []).map(Number).filter(n => n > 0);
       const recovered = recoverLabDecimal(text, test, convert, refs);
       if (recovered == null) continue;
       value = recovered; guessed = true;
     }
     if (value < test.min || value > test.max) continue;
     found.push({ index: m.index, test: test.name, value: labRound(value, test.dp), unit: test.unit, guessed });
   }
   // One test per line: the name found first wins (e.g. "HbA1c (glycated haemoglobin)").
   found.sort((a, b) => a.index - b.index);
   const hit = found[0];
   return hit ? { test: hit.test, value: hit.value, unit: hit.unit, ...(hit.guessed ? { guessed: true } : {}) } : null;
 }

 function parseLabValues(text) {
   const out = [];
   const seen = new Set();
   String(text || '').replace(/\r/g, '').split(/\n|;/).forEach(raw => {
     const line = raw.replace(/[|_]+/g, ' ').replace(/\s+/g, ' ').trim();
     if (line.length < 3) return;
     const hit = parseLabLine(line);
     if (hit && !seen.has(hit.test)) { seen.add(hit.test); out.push(hit); }
   });
   return out;
 }

 const LAB_MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
 function labDateFrom(text) {
   const tryDate = (y, m, d) => {
     y = Number(y); m = Number(m); d = Number(d);
     if (y < 100) y += 2000;
     const dt = new Date(Date.UTC(y, m - 1, d));
     if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return '';
     if (y < 1990 || dt.getTime() > Date.now() + 86400000) return '';
     return dt.toISOString().slice(0, 10);
   };
   const find = line => {
     let m = line.match(/\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
     if (m) { const d = tryDate(m[1], m[2], m[3]); if (d) return d; }
     // Indian reports write day first.
     m = line.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})\b/);
     if (m) { const d = tryDate(m[3], m[2], m[1]); if (d) return d; }
     m = line.match(/\b(\d{1,2})(?:st|nd|rd|th)?[\s\-/.]*([a-z]{3})[a-z]*\.?[\s\-/.,]*(\d{4}|\d{2})\b/i);
     if (m && LAB_MONTHS[m[2].toLowerCase()]) { const d = tryDate(m[3], LAB_MONTHS[m[2].toLowerCase()], m[1]); if (d) return d; }
     m = line.match(/\b([a-z]{3})[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/i);
     if (m && LAB_MONTHS[m[1].toLowerCase()]) { const d = tryDate(m[3], LAB_MONTHS[m[1].toLowerCase()], m[2]); if (d) return d; }
     return '';
   };
   const lines = String(text || '').split('\n').filter(l => !/\b(?:d\.?\s?o\.?\s?b|birth|born)\b/i.test(l));
   // Prefer the sample collection date, then the report date, then any date.
   for (const pattern of [/collect|sampl|drawn/i, /report|receiv|regist|date/i, /./]) {
     for (const line of lines) {
       if (!pattern.test(line)) continue;
       const d = find(line);
       if (d) return d;
     }
   }
   return '';
 }

 function labReportName(values) {
   const panels = [...new Set(values.map(v => LAB_TESTS.find(t => t.name === v.test)?.panel).filter(Boolean))];
   if (!panels.length) return 'Lab report';
   return panels.length > 3 ? 'Blood test' : panels.join(' · ');
 }

 function formatLabValues(values) {
   return values.map(v => `${v.test}: ${v.value} ${v.unit}`).join('; ');
 }


 /* Lab report scanning: OCR a photo or PDF, show the values found for checking,
    then save them as a report that feeds the trend chart. */
 const scanLabReportBtn = document.getElementById('scanLabReportBtn');
 const labReportFileInput = document.getElementById('labReportFileInput');
 let labScanRawText = '';

 async function runLabReportOCR(file) {
   const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
   if (isPdf) {
     const pages = await pdfPrescriptionPages(file);
     if (!pages.length) throw new Error('The PDF contains no readable pages.');
     return ocrDataUrls(pages);
   }
   if (!file.type.startsWith('image/')) throw new Error('Choose a photo (JPG/PNG) or a PDF of the lab report.');
   const versions = await preprocessRxImage(file);
   const normalizedText = await ocrDataUrls([versions.normalized]);
   const contrastText = await ocrDataUrls([versions.contrast]);
   return parseLabValues(contrastText).length > parseLabValues(normalizedText).length ? contrastText : normalizedText;
 }

 function labScanRowHtml(v) {
   const test = LAB_TESTS.find(t => t.name === v.test);
   return `<tr data-test="${escapeHtml(v.test)}"><td><label class="lab-scan-check"><input type="checkbox" checked aria-label="Keep ${escapeHtml(v.test)}"><span>${escapeHtml(v.test)}</span></label></td>`
     + `<td><input class="lab-scan-value" type="number" step="any" inputmode="decimal" value="${escapeHtml(String(v.value))}" aria-label="${escapeHtml(v.test)} value"></td>`
     + `<td class="lab-scan-unit">${escapeHtml(test?.unit || v.unit || '')}</td></tr>`
     + (v.guessed ? `<tr class="lab-scan-note" data-note-for="${escapeHtml(v.test)}"><td colspan="3">Decimal point added by SwasthID — check this value on the report.</td></tr>` : '');
 }

 function refreshLabScanAddOptions() {
   const select = document.getElementById('labScanAddSelect'); if (!select) return;
   const used = new Set([...document.querySelectorAll('#labScanRows tr[data-test]')].map(r => r.dataset.test));
   select.innerHTML = '<option value="">Add a test…</option>' + LAB_TESTS.filter(t => !used.has(t.name))
     .map(t => `<option value="${escapeHtml(t.name)}">${escapeHtml(t.name)} (${escapeHtml(t.unit)})</option>`).join('');
 }

 function updateLabScanEmpty() {
   const rows = document.querySelectorAll('#labScanRows tr[data-test]').length;
   const empty = document.getElementById('labScanEmpty');
   if (empty) empty.hidden = rows > 0;
   const table = document.getElementById('labScanTable');
   if (table) table.hidden = rows === 0;
 }

 function openLabScanReview(text) {
   const values = parseLabValues(text);
   labScanRawText = text;
   document.getElementById('labScanName').value = labReportName(values);
   document.getElementById('labScanDate').value = labDateFrom(text) || getTodayKey();
   document.getElementById('labScanDate').max = getTodayKey();
   document.getElementById('labScanRows').innerHTML = values.map(labScanRowHtml).join('');
   document.getElementById('labScanRaw').textContent = text || '(no text found)';
   document.getElementById('labScanSummary').textContent = values.length
     ? `Found ${values.length} test value${values.length === 1 ? '' : 's'}. Check each one against the report, untick anything read wrongly, and correct values if needed.`
     : 'No test values were recognised. Add them below, or try a sharper, well-lit photo taken straight on.';
   refreshLabScanAddOptions();
   updateLabScanEmpty();
   document.getElementById('labScanReview').hidden = false;
   setTimeout(() => document.querySelector('#labScanRows .lab-scan-value')?.focus(), 30);
 }

 function closeLabScanReview() {
   document.getElementById('labScanReview').hidden = true;
   labScanRawText = '';
 }

 function saveLabScanReview() {
   const name = document.getElementById('labScanName').value.trim() || 'Lab report';
   const date = document.getElementById('labScanDate').value || getTodayKey();
   const values = [];
   let invalid = null;
   document.querySelectorAll('#labScanRows tr[data-test]').forEach(row => {
     if (!row.querySelector('input[type="checkbox"]')?.checked) return;
     const test = LAB_TESTS.find(t => t.name === row.dataset.test); if (!test) return;
     const input = row.querySelector('.lab-scan-value');
     const value = Number(input.value);
     if (input.value.trim() === '' || !Number.isFinite(value) || value < test.min || value > test.max) { invalid = invalid || { input, test }; return; }
     values.push({ test: test.name, value, unit: test.unit });
   });
   if (invalid) {
     showToast('', 'Check this value', `${invalid.test.name} should be between ${invalid.test.min} and ${invalid.test.max} ${invalid.test.unit}. Untick it if it was read wrongly.`);
     invalid.input.focus(); return;
   }
   if (!values.length) { showToast('', 'Nothing to save', 'Tick or add at least one test value.'); return; }
   patientData.reports = [...(patientData.reports || []), { id: `report_${Date.now()}`, name, date, result: formatLabValues(values), values, source: 'scan' }];
   saveRecordCollections();
   closeLabScanReview();
   const panel = document.getElementById('labTrendPanel'), trendBtn = document.getElementById('labTrendBtn');
   if (panel && panel.style.display === 'none') { panel.style.display = 'block'; if (trendBtn) { trendBtn.textContent = 'Hide trends'; trendBtn.setAttribute('aria-expanded', 'true'); } }
   const select = document.getElementById('labTrendMetric');
   renderLabTrendChart();
   if (select && [...select.options].some(o => o.value === values[0].test)) { select.value = values[0].test; renderLabTrendChart(); }
   showToast('', 'Lab report saved', `${values.length} value${values.length === 1 ? '' : 's'} added to your records and trends.`);
 }

 scanLabReportBtn?.addEventListener('click', () => labReportFileInput?.click());
 labReportFileInput?.addEventListener('change', async e => {
   const file = e.target.files?.[0]; if (!file) return;
   const label = scanLabReportBtn.textContent;
   scanLabReportBtn.disabled = true;
   scanLabReportBtn.textContent = 'Preparing report…';
   ocrStatusButton = scanLabReportBtn;
   try {
     const text = await runLabReportOCR(file);
     openLabScanReview(text);
   } catch (err) {
     console.error('Lab report OCR failed:', err);
     showToast('', 'Could not read the report', err?.message || 'Try another photo or PDF.');
   } finally {
     ocrStatusButton = null;
     scanLabReportBtn.disabled = false;
     scanLabReportBtn.textContent = label;
     labReportFileInput.value = '';
   }
 });
 document.getElementById('labScanAddSelect')?.addEventListener('change', e => {
   const test = LAB_TESTS.find(t => t.name === e.target.value); if (!test) return;
   document.getElementById('labScanRows').insertAdjacentHTML('beforeend', labScanRowHtml({ test: test.name, value: '', unit: test.unit }));
   refreshLabScanAddOptions(); updateLabScanEmpty();
   [...document.querySelectorAll('#labScanRows .lab-scan-value')].pop()?.focus();
 });
 document.getElementById('labScanCancel')?.addEventListener('click', closeLabScanReview);
 document.getElementById('labScanSave')?.addEventListener('click', saveLabScanReview);
 document.getElementById('labScanReview')?.addEventListener('click', e => { if (e.target.id === 'labScanReview') closeLabScanReview(); });
 function extractLabTrendPoints(){
   const reports=Array.isArray(patientData?.reports)?patientData.reports:[]; const groups={};
   reports.forEach(r=>{
     // Scanned reports carry their values; typed ones are read from the result text.
     const values=Array.isArray(r.values)&&r.values.length?r.values:parseLabValues(r.result);
     values.forEach(v=>{const value=Number(v.value);if(!v.test||!Number.isFinite(value))return;(groups[v.test] ||= {unit:v.unit||'',points:[]}).points.push({date:r.date||'',value,report:r.name||'Lab report'});});
   });
   const order=name=>{const i=LAB_TESTS.findIndex(t=>t.name===name);return i<0?99:i;};
   const sorted={};Object.keys(groups).sort((a,b)=>order(a)-order(b)).forEach(k=>{groups[k].points.sort((a,b)=>new Date(a.date)-new Date(b.date));sorted[k]=groups[k];});
   return sorted;
 }
 function renderLabTrendChart(){
   const panel=document.getElementById('labTrendPanel'),select=document.getElementById('labTrendMetric'),chart=document.getElementById('labTrendChart'),summary=document.getElementById('labTrendSummary');if(!panel||!select||!chart)return;
   const groups=extractLabTrendPoints();const names=Object.keys(groups);if(!names.length){select.innerHTML='';chart.innerHTML='<div class="empty">No values to chart yet. Scan a lab report, or add results such as “HbA1c 6.1%”.</div>';if(summary)summary.textContent='';return;}
   const current=names.includes(select.value)?select.value:names[0];select.innerHTML=names.map(n=>`<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('');select.value=current;const g=groups[current],pts=g.points;const w=Math.max(chart.clientWidth||560,pts.length*96),h=232,pad=40,vals=pts.map(p=>p.value),min=Math.min(...vals),max=Math.max(...vals),range=(max-min)||1;const x=i=>pad+(i*(w-pad*2)/Math.max(1,pts.length-1)),y=v=>h-pad-((v-min)/range)*(h-pad*2);const manyYears=new Set(pts.map(p=>String(p.date).slice(0,4))).size>1;
   let svg=`<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${escapeHtml(current)} trend"><line x1="${pad}" y1="${h-pad}" x2="${w-pad}" y2="${h-pad}" class="chart-axis"/><line x1="${pad}" y1="${pad}" x2="${pad}" y2="${h-pad}" class="chart-axis"/>`;
   pts.forEach((pt,i)=>{const xx=x(i),yy=y(pt.value);if(i)svg+=`<line x1="${x(i-1)}" y1="${y(pts[i-1].value)}" x2="${xx}" y2="${yy}" class="chart-line"/>`;svg+=`<circle cx="${xx}" cy="${yy}" r="4" class="chart-dot"/><text x="${xx}" y="${h-17}" text-anchor="middle" class="chart-label">${escapeHtml(pt.date?new Date(pt.date).toLocaleDateString([], manyYears?{day:'numeric',month:'short',year:'2-digit'}:{day:'numeric',month:'short'}):'Date')}</text><text x="${xx}" y="${yy-10}" text-anchor="middle" class="chart-value">${pt.value}</text>`;});svg+=`<text x="4" y="${pad+3}" class="chart-label">${max} ${escapeHtml(g.unit)}</text><text x="4" y="${h-pad}" class="chart-label">${min} ${escapeHtml(g.unit)}</text></svg>`;chart.innerHTML=svg;if(summary){const latest=pts[pts.length-1],first=pts[0];summary.textContent=`${pts.length} reading${pts.length===1?'':'s'} · Latest ${latest.value} ${g.unit} on ${latest.date?formatRecordDate(latest.date):'an unknown date'}${pts.length>1?` · ${latest.value-first.value>=0?'Up':'Down'} ${Math.abs(latest.value-first.value).toFixed(2).replace(/\.?0+$/,'')} since ${formatRecordDate(first.date)}`:''}`;}
 }
 function initLabTrendView(){const btn=document.getElementById('labTrendBtn'),panel=document.getElementById('labTrendPanel'),select=document.getElementById('labTrendMetric');if(!btn||!panel)return;btn.addEventListener('click',()=>{const open=panel.style.display!=='none';panel.style.display=open?'none':'block';btn.textContent=open?'View trends':'Hide trends';btn.setAttribute('aria-expanded',String(!open));if(!open)renderLabTrendChart();});select?.addEventListener('change',renderLabTrendChart);}
 function renderActiveDoctorShare(){const panel=document.getElementById('activeDoctorSharePanel'),meta=document.getElementById('activeDoctorShareMeta');if(!panel||!meta)return;const saved=safeJsonParse(localStorage.getItem('swasth_activeDoctorShare')||'null',null);if(!saved?.id){panel.style.display='none';return;}if(saved.expiresAt&&Date.now()>=Number(saved.expiresAt)){localStorage.removeItem('swasth_activeDoctorShare');panel.style.display='none';return;}panel.style.display='block';meta.textContent=`Share ID ${String(saved.id).slice(0,10)}…${saved.expiresAt?` · expires ${new Date(saved.expiresAt).toLocaleString()}`:''}`;}
async function revokeDoctorShare(){const saved=safeJsonParse(localStorage.getItem('swasth_activeDoctorShare')||'null',null);if(!saved?.id){renderActiveDoctorShare();return;}const btn=document.getElementById('revokeDoctorShareBtn');if(btn)btn.disabled=true;try{const apiBase=(window.SWASTH_API_BASE||((location.protocol==='http:'||location.protocol==='https:')?location.origin:'')).replace(/\/$/,'');if(!apiBase)throw new Error('Doctor sharing requires the hosted Render app.');if(!firebaseUser)throw new Error('Sign in before revoking a doctor share.');const idToken=await firebaseUser.getIdToken(true);const res=await fetch(apiBase+'/api/record-share/revoke',{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json','Authorization':`Bearer ${idToken}`},body:JSON.stringify({shareId:saved.id})});const body=await res.json().catch(()=>({}));if(!res.ok)throw new Error(body.error||`Revoke service returned HTTP ${res.status}`);localStorage.removeItem('swasth_activeDoctorShare');syncCloudState('swasth_activeDoctorShare');renderActiveDoctorShare();setHealthShareStatus('Doctor share revoked. The previous link can no longer be opened.');showToast('','Doctor share revoked','The shared health record link is no longer active.');}catch(e){console.error('Doctor share revoke failed:',e);setHealthShareStatus('Could not revoke doctor share: '+(e?.message||'unknown error'),true);}finally{if(btn)btn.disabled=false;}}
async function shareHealthRecordWithDoctor(){
 const btn=document.getElementById('shareHealthRecordBtn');if(btn)btn.disabled=true;setHealthShareStatus('Creating an authenticated, time-limited doctor link…');
 try{
  const apiBase=(window.SWASTH_API_BASE||((location.protocol==='http:'||location.protocol==='https:')?location.origin:'' )).replace(/\/$/,'');if(!apiBase)throw new Error('Doctor sharing requires the hosted Render app.');
  if(!firebaseUser)throw new Error('Sign in before sharing health records.');
  const idToken=await firebaseUser.getIdToken(true);
  const full=buildSwasthHealthBundle();
  const bundle={...full,emergencyContact:undefined,nutrition:undefined,meta:{...(full.meta||{}),shareScope:'doctor-clinical-summary'}};
  const res=await fetch(apiBase+'/api/record-share/create',{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json','Authorization':`Bearer ${idToken}`},body:JSON.stringify({record:bundle,expiresInHours:24,scope:'clinical-summary'})});
  const body=await res.json().catch(()=>({}));if(!res.ok||!body.url)throw new Error(body.error||`Share service returned HTTP ${res.status}`);
  const shareId=body.shareId||body.id||'';if(shareId){localStorage.setItem('swasth_activeDoctorShare',JSON.stringify({id:shareId,expiresAt:body.expiresAt||null}));syncCloudState('swasth_activeDoctorShare');}
  renderActiveDoctorShare();
  await navigator.clipboard?.writeText(body.url).catch(()=>{});
  setHealthShareStatus(`Authenticated doctor link created. It expires ${body.expiresAt?new Date(body.expiresAt).toLocaleString():'after 24 hours'}. ${body.url}${shareId?' — share ID saved for revocation.':''}`);
 }catch(e){console.error('Doctor share failed:',e);setHealthShareStatus('Doctor sharing failed: '+(e?.message||'unknown error')+'. The backend must verify the Firebase bearer token and support scoped/revocable shares.',true);}finally{if(btn)btn.disabled=false;}
}
 document.getElementById('exportHealthJsonBtn')?.addEventListener('click',()=>downloadTextFile(`SwasthID-My-Health-Vault-${safeHealthName()}.json`,JSON.stringify(buildSwasthHealthBundle(),null,2)));
 document.getElementById('exportHealthPdfBtn')?.addEventListener('click',exportHealthSummaryPDF);
 document.getElementById('shareHealthRecordBtn')?.addEventListener('click',shareHealthRecordWithDoctor);
 document.getElementById('revokeDoctorShareBtn')?.addEventListener('click',revokeDoctorShare);
 renderActiveDoctorShare();
 initLabTrendView();

 function renderAllRecords(){renderHistory('historyListRecords');renderVisits();renderReports();renderSavedPrescriptions();renderRecordFoodLogs();renderRecordMedicationActivity();renderRecordTimeline();}
 renderAllRecords(); renderTodayMedications(); renderMedicationInsights();
