 /* Medicine search / pharmacy handoff */
 const MEDICINE_API_BASE = window.SWASTH_MEDICINE_API_BASE || ((location.protocol === 'http:' || location.protocol === 'https:') ? location.origin + '/api/medicines' : 'local');
 const medicineCatalogue = [
 {name:'Thyroxine 12.5 mcg', salt:'Levothyroxine Sodium', brand:'Thyronorm', pack:'15 tablets', mrp:38.50, rx:true},
 {name:'Thyroxine 25 mcg', salt:'Levothyroxine Sodium', brand:'Thyronorm', pack:'30 tablets', mrp:75.00, rx:true},
 {name:'Metformin 500 mg', salt:'Metformin Hydrochloride', brand:'Glycomet', pack:'20 tablets', mrp:18.50, rx:true},
 {name:'Metformin 500 mg', salt:'Metformin Hydrochloride', brand:'Glyciphage', pack:'20 tablets', mrp:22.00, rx:true},
 {name:'Pantoprazole 40 mg', salt:'Pantoprazole Sodium', brand:'Pantocid', pack:'15 tablets', mrp:105.00, rx:true},
 {name:'Azithromycin 500 mg', salt:'Azithromycin', brand:'Azithral', pack:'5 tablets', mrp:148.00, rx:true},
 {name:'Amlodipine 5 mg', salt:'Amlodipine', brand:'Amlong', pack:'30 tablets', mrp:42.00, rx:true},
 {name:'Atorvastatin 10 mg', salt:'Atorvastatin Calcium', brand:'Atorva', pack:'15 tablets', mrp:65.00, rx:true},
 {name:'Vitamin D3 1000 IU', salt:'Cholecalciferol', brand:'Vitamin D3', pack:'30 tablets', mrp:42.00, rx:false},
 {name:'Vitamin D3 60000 IU', salt:'Cholecalciferol', brand:'Uprise-D3', pack:'4 capsules', mrp:110.00, rx:false},
 {name:'Paracetamol 500 mg', salt:'Paracetamol', brand:'Crocin', pack:'15 tablets', mrp:20.00, rx:false},
 {name:'Cetirizine 10 mg', salt:'Cetirizine Hydrochloride', brand:'Cetcip', pack:'10 tablets', mrp:18.00, rx:false},
 {name:'ORS Powder', salt:'Oral Rehydration Salts', brand:'Electral', pack:'21.8 g sachet', mrp:21.00, rx:false}
 ];
 // search(q) opens that pharmacy's results for the medicine; sites without a
 // known search URL open their home page instead.
 const pharmacyLinks = [
 {platform:'Tata 1mg', search:q=>`https://www.1mg.com/search/all?name=${encodeURIComponent(q)}`},
 {platform:'PharmEasy', search:q=>`https://pharmeasy.in/search/all?name=${encodeURIComponent(q)}`},
 {platform:'Apollo Pharmacy', search:q=>`https://www.apollopharmacy.in/search-medicines/${encodeURIComponent(q)}`},
 {platform:'Netmeds', home:'https://www.netmeds.com/'},
 {platform:'MedPlus', home:'https://www.medplusmart.com/'}
 ];
 function pharmacyHref(p,query){ return query && p.search ? p.search(query) : p.home; }
 function escMed(v){ const d=document.createElement('div'); d.textContent=String(v ?? ''); return d.innerHTML; }
 function normalizeMedicineResult(item){
 return {
 name:item.name || item.product_name || item.productName || item.brand || 'Medicine',
 salt:item.salt || item.composition || item.generic_name || '',
 brand:item.brand || item.marketing_company || item.manufacturer || '',
 pack:item.pack || item.pack_size || item.packaging || '',
 mrp:Number(item.mrp ?? item.price ?? 0) || 0,
 rx:Boolean(item.rx ?? item.prescription_required ?? item.prescriptionRequired)
 };
 }
 function localMedicineSearch(query){
 const q=query.trim().toLowerCase();
 if(!q) return [];
 const tokens=q.split(/\s+/).filter(Boolean);
 // Units and numbers ("mg", "5") appear in almost every item, so they only rank
 // results; at least one medicine-name token has to match.
 const isDoseToken=t => /^[\d.,]+$/.test(t) || /^(?:mg|mcg|µg|ug|g|ml|iu|units?|%|tabs?|tablets?|caps?|capsules?|syp|syrup|inj|x|od|bd|tds)$/.test(t) || /^\d/.test(t);
 const nameTokens=tokens.filter(t => !isDoseToken(t) && t.replace(/[^a-z]/g,'').length >= 3);
 if(!nameTokens.length) return [];
 return medicineCatalogue.map((m, index) => {
  const haystack=[m.name,m.salt,m.brand,m.pack].join(' ').toLowerCase();
  const compact=haystack.replace(/[^a-z0-9]+/g,'');
  const hit=t => haystack.includes(t) || compact.includes(t.replace(/[^a-z0-9]+/g,''));
  if(!nameTokens.some(hit)) return null;
  const tokenHits=tokens.filter(hit).length;
  const exact=haystack.includes(q) ? 100 : 0;
  return { ...m, __score: exact + tokenHits*5 + 10, __index:index };
 }).filter(Boolean).sort((a,b) => b.__score-a.__score || a.__index-b.__index).map(({__score,__index,...m}) => m);
 }
 async function searchMedicines(){
 const input=document.getElementById('medSearch');
 const button=document.getElementById('searchBtn');
 if(!input) return;
 const query=input.value.trim();
 if(query.length<2){
  renderMedicineResults([],query,'local');
  return;
 }
 if(button) { button.disabled=true; button.classList.add('is-loading'); }
 const status=document.getElementById('resultsLabel');
 if(status) status.textContent='Searching…';
 const listEl=document.getElementById('priceList'); if(listEl) listEl.innerHTML='<div class="list">'+medSkeletonRows(3)+'</div>';
 try{
  const apiResults=await fetchMedicineApi(query);
  if(apiResults && apiResults.length){
   window.__medicineApiLastError='';
   renderMedicineResults(apiResults,query,'api');
   return;
  }
  const localResults=localMedicineSearch(query);
  renderMedicineResults(localResults,query,'local');
 }catch(error){
  console.warn('DrugSetu search failed:',error);
  window.__medicineApiLastError=String(error?.message || error);
  const localResults=localMedicineSearch(query);
  renderMedicineResults(localResults,query,'local');
  const disclaimer=document.getElementById('medicineDisclaimer');
  if(disclaimer){
   disclaimer.style.display='block';
   disclaimer.textContent='Live search is unavailable right now, so these results come from SwasthID’s reference catalogue.';
  }
 }finally{
  if(button){ button.disabled=false; button.classList.remove('is-loading'); }
 }
 }
 window.searchMedicines=searchMedicines;
 document.getElementById('searchBtn')?.addEventListener('click',searchMedicines);
 document.getElementById('medSearch')?.addEventListener('keydown',e=>{ if(e.key==='Enter') searchMedicines(); });

 async function fetchMedicineApi(query){
 if(!MEDICINE_API_BASE || MEDICINE_API_BASE === 'local') return null;
 const controller=new AbortController();
 const timer=setTimeout(()=>controller.abort(),7000);
 try{
 const url=MEDICINE_API_BASE.replace(/\/$/,'') + '/search?q=' + encodeURIComponent(query);
 const res=await fetch(url,{headers:{'Accept':'application/json'},signal:controller.signal});
 if(!res.ok) throw new Error('Medicine API returned ' + res.status);
 const data=await res.json();
 const rows=Array.isArray(data) ? data : (data.data || data.results || data.medicines || []);
 return rows.map(normalizeMedicineResult).filter(x=>x.name);
 } finally { clearTimeout(timer); }
 }
 function medResultRow(m, action){
  const detail=[m.salt,m.brand,m.pack].filter(Boolean).map(escMed).join(' · ');
  return `<div class="med-result">
   <div class="med-result-main"><b>${escMed(m.name)}</b>${detail?`<span>${detail}</span>`:''}<span class="badge ${m.rx?'badge-warning':''}">${m.rx?'Prescription may be needed':'Over the counter'}</span></div>
   <div class="med-result-price"><b>${m.mrp ? '₹'+m.mrp.toFixed(2) : '—'}</b><span>Reference MRP</span></div>
   ${action}
  </div>`;
 }
 function pharmacyOptionsHtml(title,query){
  const q=String(query||'').replace(/\s+/g,' ').trim();
  const homeOnly=pharmacyLinks.filter(p=>!p.search).map(p=>p.platform);
  return `<div class="pharmacy-options-head"><b>Where to buy</b><span>${title}</span></div>
   <div class="pharmacy-links">${pharmacyLinks.map(p=>`<a class="btn btn-sm" href="${escMed(pharmacyHref(p,q))}" target="_blank" rel="noopener" data-pharmacy="${escMed(p.platform)}">${p.platform}</a>`).join('')}</div>
   <p class="t-meta">${q?`Links open each pharmacy's search for “${escMed(q)}”. ${homeOnly.length?`${homeOnly.join(' and ')} open${homeOnly.length===1?'s':''} the home page, so search there. `:''}`:''}The pharmacy sets the selling price, availability, pack size and whether a prescription is needed.</p>`;
 }
 function medSkeletonRows(n){
  return Array.from({length:n},()=>`<div class="med-result" aria-hidden="true"><div class="skeleton-lines"><span class="skeleton w-50"></span><span class="skeleton w-70"></span></div><span class="skeleton med-skeleton-price"></span><span class="skeleton med-skeleton-btn"></span></div>`).join('');
 }
 window.medSkeletonRows=medSkeletonRows;
 function renderMedicineResults(results, query, source){
 const el=document.getElementById('priceList');
 const label=document.getElementById('resultsLabel');
 const badge=document.getElementById('medicineSourceBadge');
 const disclaimer=document.getElementById('medicineDisclaimer');
 badge.textContent=source === 'api' ? 'Live data' : 'Reference catalogue';
 if(!results.length){
  label.textContent=query && query.length>=2 ? `No match for “${query}”. Try the brand name, generic name or salt.` : 'Type at least two letters to search.';
  el.innerHTML=query && query.length>=2 ? '<div class="empty empty-cta"><span>You can also check the medicine and its official ceiling price on NPPA Pharma Sahi Daam.</span><a class="btn btn-sm" href="https://nppa.gov.in/en/pharma_sahi_daam" target="_blank" rel="noopener">Open NPPA</a></div>' : '';
  disclaimer.style.display='none';
  return;
 }
 label.textContent=`${results.length} result${results.length===1?'':'s'} for “${query}”`;
 el.innerHTML='<div class="list">'+results.slice(0,12).map((m,i)=>medResultRow(m,`<button class="btn btn-sm" type="button" onclick="showPharmacyOptions(${i})">Where to buy</button>`)).join('')+'</div>';
 window.__medicineResults=results.slice(0,12);
 disclaimer.style.display='block';
 disclaimer.innerHTML='Reference MRP is not the price a pharmacy will charge. Check the seller and pack before buying. NPPA runs an official price-checking service.' + (source === 'api' ? ' Data from DrugSetu is standardised but not guaranteed to be accurate.' : '');
 }

 function medicineResultRows(results, cardIndex){
  if(!results.length) return '<div class="empty">No catalogue match. Check the medicine name, or look it up on NPPA.</div>';
  return '<div class="list">'+results.slice(0,4).map((m,i)=>medResultRow(m,`<button class="btn btn-sm" type="button" data-rx-order="${cardIndex}-${i}">Where to buy</button>`)).join('')+'</div>';
 }

 async function renderPrescriptionOrderCards(medicines){
  const el=document.getElementById('priceList');
  const label=document.getElementById('resultsLabel');
  const badge=document.getElementById('medicineSourceBadge');
  const disclaimer=document.getElementById('medicineDisclaimer');
  if(!el || !medicines?.length) return;
  window.__pendingPrescriptionMedicines=medicines;
  label.textContent=`Searching ${medicines.length} medicine${medicines.length===1?'':'s'} from your prescription…`;
  badge.textContent='From your prescription';
  el.innerHTML=medicines.map((m,i)=>`
   <section class="card rx-order-card" data-rx-card="${i}">
    <div class="card-head">
     <div><h3 class="card-title">${escMed(m.medicine)}</h3><p class="card-sub">${escMed([m.dose,m.frequency,m.instructions].filter(Boolean).join(' · '))}</p></div>
     <span class="badge badge-info">From prescription</span>
    </div>
    <p class="t-meta rx-card-status">Searching…</p>
    <div class="rx-card-results"><div class="list">${medSkeletonRows(2)}</div></div>
   </section>`).join('');
  disclaimer.style.display='block';
  disclaimer.textContent='Each medicine is searched separately. Check the match, pack size and reference MRP before choosing a pharmacy. Nothing is ordered automatically.';
  const allResults=[];
  for(let i=0;i<medicines.length;i++){
   const m=medicines[i], card=el.querySelector(`[data-rx-card="${i}"]`);
   const status=card?.querySelector('.rx-card-status'), resultsEl=card?.querySelector('.rx-card-results');
   const query=[m.medicine,m.dose].filter(Boolean).join(' ');
   let results=null, source='local';
   try { results=await fetchMedicineApi(query); if(results?.length) source='api'; } catch(e) { results=null; }
   if(!results?.length) results=localMedicineSearch(query);
   results=results || []; allResults[i]=results;
   if(status) status.textContent=results.length ? `${results.length} match${results.length===1?'':'es'} · ${source==='api'?'Live data':'Reference catalogue'}` : 'No catalogue match';
   if(resultsEl){
    resultsEl.innerHTML=medicineResultRows(results,i);
    resultsEl.querySelectorAll('[data-rx-order]').forEach(btn=>{
     const parts=btn.dataset.rxOrder.split('-');
     btn.addEventListener('click',()=>showPrescriptionPharmacyOptions(Number(parts[0]),Number(parts[1])));
    });
   }
  }
  label.textContent=`Results for ${medicines.length} medicine${medicines.length===1?'':'s'} from your prescription`;
  window.__prescriptionOrderResults=allResults;
 }

 window.showPharmacyOptions=function(resultIndex){
  const med=(window.__medicineResults || [])[resultIndex];
  const row=document.querySelectorAll('#priceList .med-result')[resultIndex];
  if(!med || !row) return;
  document.querySelectorAll('#priceList .rx-pharmacy-options').forEach(x=>x.remove());
  const box=document.createElement('div'); box.className='rx-pharmacy-options';
  box.innerHTML=pharmacyOptionsHtml(`${escMed(med.name)}${med.pack?' · '+escMed(med.pack):''}`, med.name);
  row.after(box); box.scrollIntoView({behavior:'smooth',block:'nearest'});
 };

 window.showPrescriptionPharmacyOptions=function(cardIndex,resultIndex){
  const med=(window.__prescriptionOrderResults?.[cardIndex] || [])[resultIndex];
  const prescriptionMed=(window.__pendingPrescriptionMedicines || [])[cardIndex];
  const card=document.querySelector(`[data-rx-card="${cardIndex}"]`);
  if(!med || !card) return;
  card.querySelector('.rx-pharmacy-options')?.remove();
  const box=document.createElement('div'); box.className='rx-pharmacy-options';
  box.innerHTML=pharmacyOptionsHtml(`${escMed(med.name)}${prescriptionMed?.dose?' · '+escMed(prescriptionMed.dose):''}`, med.name);
  card.appendChild(box); box.scrollIntoView({behavior:'smooth',block:'nearest'});
 };

 async function searchPrescriptionMedicine(med) {
  const input=document.getElementById('medSearch'); if(!input) return;
  input.value=[med.medicine,med.dose].filter(Boolean).join(' ');
  showTab('order');
  await renderPrescriptionOrderCards(window.__pendingPrescriptionMedicines || [med]);
 }
 window.searchPrescriptionMedicine=searchPrescriptionMedicine;

 function restorePendingPrescriptionQueue() {
  try {
   const pending = JSON.parse(localStorage.getItem('swasth_pendingMedicineSearch') || '[]');
   if (!Array.isArray(pending) || !pending.length) return;
   window.__pendingPrescriptionMedicines = pending;
   const queue = document.getElementById('prescriptionMedicineQueue');
   const list = document.getElementById('prescriptionMedicineQueueList');
   if (!queue || !list) return;
   queue.style.display='block';
   list.innerHTML=pending.map((m,i)=>`<div class="queue-row"><div class="list-main"><b>${escMed(m.medicine)}</b><span>${escMed([m.dose,m.frequency].filter(Boolean).join(' · '))}</span></div><button class="btn btn-sm" type="button" data-prescription-med-index="${i}">Search</button></div>`).join('');
   list.querySelectorAll('[data-prescription-med-index]').forEach(btn=>btn.addEventListener('click',()=>{ const med=pending[Number(btn.dataset.prescriptionMedIndex)]; if(med) searchPrescriptionMedicine(med); }));
  } catch(e) { console.warn('Could not restore prescription medicine queue', e); }
 }
 restorePendingPrescriptionQueue();
 searchMedicines();
