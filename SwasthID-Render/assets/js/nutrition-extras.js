/* =========================================================
   NUTRITION UPGRADE: WEEKLY TRENDS, MEDICATION-FOOD FLAGS & BARCODE LOOKUP
   ========================================================= */
(function(){
  const WEEK_DAYS = 7;

  function nLogData(){
    try { return JSON.parse(localStorage.getItem('swasth_foodLogs') || '[]'); }
    catch(e){ return []; }
  }
  function dayKeyOffset(offset){
    const d = new Date(); d.setHours(12,0,0,0); d.setDate(d.getDate()-offset);
    return d.toISOString().slice(0,10);
  }
  function safeNum(v){ const n=Number(v); return Number.isFinite(n)?n:0; }
  function safeFood(v){
    return String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  function renderWeeklyNutritionTrends(){
    const chart=document.getElementById('weeklyNutritionChart');
    if(!chart) return;
    const logs=nLogData();
    const days=[];
    for(let i=WEEK_DAYS-1;i>=0;i--){
      const key=dayKeyOffset(i);
      const dayLogs=logs.filter(x=>x.date===key);
      days.push({
        key,
        label:new Date(key+'T12:00:00').toLocaleDateString([], {weekday:'short'}),
        kcal:dayLogs.reduce((a,x)=>a+safeNum(x.kcal),0),
        protein:dayLogs.reduce((a,x)=>a+safeNum(x.protein),0),
        carbs:dayLogs.reduce((a,x)=>a+safeNum(x.carbs),0),
        fat:dayLogs.reduce((a,x)=>a+safeNum(x.fat),0),
        count:dayLogs.length,
        known:Object.fromEntries(['kcal','protein','carbs','fat'].map(k=>[k,dayLogs.some(x=>x[k]!==undefined&&x[k]!==null&&x[k]!==''&&Number.isFinite(Number(x[k])))]))
      });
    }
    // Average over the days that have a log: an unlogged day is missing
    // data, not a day of fasting, so it must not drag the average down.
    const loggedDays=days.filter(d=>d.count>0);
    const logged=loggedDays.length;
    const avgOf=key=>{const known=loggedDays.filter(d=>d.known[key]);return known.length?known.reduce((a,d)=>a+d[key],0)/known.length:null;};
    const avg=avgOf('kcal'), avgProtein=avgOf('protein'), avgCarbs=avgOf('carbs'), avgFat=avgOf('fat');
    const grams=v=>v===null?'—':v.toFixed(1)+' g';
    const avgEl=document.getElementById('weeklyAvgKcal');
    const protEl=document.getElementById('weeklyProtein');
    const loggedEl=document.getElementById('weeklyAdherenceFood');
    if(avgEl) avgEl.textContent=avg===null?'—':Math.round(avg)+' kcal';
    if(protEl) protEl.textContent=grams(avgProtein);
    const carbsEl=document.getElementById('weeklyCarbs');
    const fatEl=document.getElementById('weeklyFat');
    if(carbsEl) carbsEl.textContent=grams(avgCarbs);
    if(fatEl) fatEl.textContent=grams(avgFat);
    if(loggedEl) loggedEl.textContent=logged+'/7';

    const max=Math.max(1,...days.map(d=>d.kcal));
    const width=Math.max(chart.clientWidth||560,days.length*64), height=200, padL=16,padR=16,padT=24,padB=32;
    const innerW=width-padL-padR, innerH=height-padT-padB;
    const bars=days.map((d,i)=>{
      const bw=Math.min(46,innerW/days.length*0.56);
      const x=padL+i*(innerW/days.length)+(innerW/days.length-bw)/2;
      const bh=d.kcal ? Math.max(3,(d.kcal/max)*innerH) : 2;
      const y=padT+innerH-bh;
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" rx="4" class="chart-bar${d.kcal?'':' is-empty'}"><title>${d.label}: ${Math.round(d.kcal)} kcal · P ${d.protein.toFixed(1)}g · C ${d.carbs.toFixed(1)}g · F ${d.fat.toFixed(1)}g</title></rect>`+
        `<text x="${(x+bw/2).toFixed(1)}" y="${height-10}" text-anchor="middle" class="chart-label">${d.label}</text>`+
        `<text x="${(x+bw/2).toFixed(1)}" y="${Math.max(12,y-6).toFixed(1)}" text-anchor="middle" class="chart-value">${d.kcal?Math.round(d.kcal):''}</text>`;
    }).join('');
    const grid=[0,.25,.5,.75,1].map(r=>{
      const y=padT+innerH-r*innerH;
      return `<line x1="${padL}" y1="${y}" x2="${width-padR}" y2="${y}" class="chart-axis"/>`;
    }).join('');
    const pMax=Math.max(1,...days.map(d=>d.protein));
    const proteinPoints=days.map((d,i)=>{const x=padL+i*(innerW/days.length)+(innerW/days.length)/2;const y=padT+innerH-(d.protein/pMax)*innerH;return `${x.toFixed(1)},${y.toFixed(1)}`;}).join(' ');
    const proteinDots=days.map((d,i)=>{const x=padL+i*(innerW/days.length)+(innerW/days.length)/2;const y=padT+innerH-(d.protein/pMax)*innerH;return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.5" class="chart-dot-2"><title>${d.label}: ${d.protein.toFixed(1)} g protein</title></circle>`;}).join('');
    chart.innerHTML=`<div class="chart-legend"><span><i class="swatch swatch-1"></i>Calories</span><span><i class="swatch swatch-2"></i>Protein</span></div><div class="trend-chart"><svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Calories and protein over the last seven days">${grid}${bars}<polyline points="${proteinPoints}" class="chart-line-2"/>${proteinDots}</svg></div>`;
  }

  const FOOD_MED_RULES=[
    {match:/thyroxine|levothyroxine|thyronorm/i, name:'Thyroxine / levothyroxine', flags:[
      'Calcium-rich foods and calcium supplements can reduce absorption; keep them separated from the dose according to your clinician or pharmacist’s instructions.',
      'Iron supplements can also interfere with absorption; separate them from the dose according to professional advice.',
      'Soy and very high-fiber meals may affect absorption in some people; keep the medication routine consistent and follow your prescriber’s instructions.'
    ]},
    {match:/ciprofloxacin|ciplox/i, name:'Ciprofloxacin', flags:['Calcium, iron and other mineral-containing supplements can reduce absorption; follow the spacing instructions on your prescription or from your pharmacist.']},
    {match:/doxycycline|tetracycline/i, name:'Tetracycline-class antibiotic', flags:['Calcium, iron and other mineral-containing products can reduce absorption; follow the spacing instructions supplied with your medicine.']},
    {match:/warfarin|coumadin/i, name:'Warfarin', flags:['Keep vitamin-K-rich foods consistent rather than making sudden large dietary changes, and follow your anticoagulation team’s advice.']}
  ];
  const DRUG_DRUG_RULES=[
    {a:/warfarin|coumadin/i,b:/ibuprofen|naproxen|diclofenac|aspirin/i,label:'Warfarin + NSAID/aspirin',flag:'This combination can increase bleeding risk. Confirm with a clinician or pharmacist.'},
    {a:/warfarin|coumadin/i,b:/amiodarone/i,label:'Warfarin + amiodarone',flag:'Amiodarone can increase warfarin effect and may require closer monitoring.'},
    {a:/ciprofloxacin|ciplox/i,b:/warfarin|coumadin/i,label:'Ciprofloxacin + warfarin',flag:'Ciprofloxacin may alter warfarin effect. Confirm monitoring instructions with the prescriber or pharmacist.'}
  ];

  function getActiveMedsForNutrition(){
    try{
      if(typeof getCurrentMedicationList==='function') return getCurrentMedicationList().filter(m=>String(m.medicine||'').trim());
    }catch(e){}
    const p=window.patientData||{};
    return Array.isArray(p.medications)?p.medications.filter(m=>String(m.medicine||m.name||'').trim()).map(m=>({...m,medicine:m.medicine||m.name})):[];
  }

  function renderMedicationFoodInteractions(){
    const el=document.getElementById('nutritionMedicationInteractions');
    if(!el) return;
    const meds=getActiveMedsForNutrition();
    const matches=[];
    meds.forEach(m=>{
      const text=String(m.medicine||m.name||'');
      FOOD_MED_RULES.forEach(rule=>{ if(rule.match.test(text)) matches.push({med:text,rule}); });
    });
    const ddiMatches=[];
    for(let i=0;i<meds.length;i++) for(let j=i+1;j<meds.length;j++) {
      const a=String(meds[i].medicine||meds[i].name||''), b=String(meds[j].medicine||meds[j].name||'');
      DRUG_DRUG_RULES.forEach(rule=>{if((rule.a.test(a)&&rule.b.test(b))||(rule.a.test(b)&&rule.b.test(a)))ddiMatches.push({rule});});
    }
    if(!matches.length && !ddiMatches.length){
      el.innerHTML='<div class="callout"><div><b>Nothing flagged for your medicines.</b> SwasthID only knows a few rules, so this doesn’t mean there are no interactions.</div></div>';
      return;
    }
    const foodHtml=matches.map(x=>`<div class="callout callout-warning"><div><b>${safeFood(x.med)} · ${safeFood(x.rule.name)}</b><ul>${x.rule.flags.map(f=>`<li>${safeFood(f)}</li>`).join('')}</ul></div></div>`).join('');
    const ddiHtml=ddiMatches.map(x=>`<div class="callout callout-warning"><div><b>${safeFood(x.rule.label)}</b><p>${safeFood(x.rule.flag)}</p></div></div>`).join('');
    el.innerHTML=foodHtml+ddiHtml+'<p class="t-meta">These are a few built-in rules, not a full interaction check.</p>';
  }

  let barcodeStream=null, barcodeTimer=null, zxingReader=null;
  const video=()=>document.getElementById('barcodeVideo');
  const status=()=>document.getElementById('barcodeStatus');
  const result=()=>document.getElementById('barcodeResult');
  function setBarcodeStatus(t){ if(status()) status().textContent=t; }
  function stopBarcodeScanner(){
    if(barcodeTimer){clearInterval(barcodeTimer);barcodeTimer=null;}
    if(zxingReader && typeof zxingReader.reset==='function'){try{zxingReader.reset();}catch(e){}}
    if(barcodeStream){barcodeStream.getTracks().forEach(t=>t.stop());barcodeStream=null;}
    const v=video(); if(v){v.pause();v.srcObject=null;v.style.display='none';}
    const b=document.getElementById('stopBarcodeScanBtn'); if(b)b.style.display='none';
    const start=document.getElementById('startBarcodeScanBtn'); if(start)start.style.display='';
  }
  function showBarcodeResult(product, barcode){
    const el=result(); if(!el)return;
    const p=product||{};
    const n=p.nutriments||{};
    const name=p.product_name||p.generic_name||'Packaged food';
    const brand=p.brands||'Unknown brand';
    const kcal=safeNum(n['energy-kcal_100g'] ?? n['energy-kcal'] ?? 0);
    const protein=safeNum(n.proteins_100g);
    const carbs=safeNum(n.carbohydrates_100g);
    const fat=safeNum(n.fat_100g);
    el.innerHTML=`<div class="barcode-result">${p.image_front_small_url?`<img src="${safeFood(p.image_front_small_url)}" alt="" class="barcode-thumb">`:''}<div class="list-main"><b>${safeFood(name)}</b><span>${safeFood(brand)} · ${safeFood(barcode)}</span><span>${[kcal?Math.round(kcal)+' kcal':'',protein?'P '+protein.toFixed(1)+' g':'',carbs?'C '+carbs.toFixed(1)+' g':'',fat?'F '+fat.toFixed(1)+' g':''].filter(Boolean).join(' · ')} per 100 g</span></div><div class="section-actions"><button type="button" class="btn btn-primary btn-sm" id="barcodeLogBtn">Log 100 g</button><button type="button" class="btn btn-sm" id="barcodeClearBtn">Clear</button></div></div><p class="t-meta">From Open Food Facts; entries can be incomplete.</p>`;
    const logBtn=document.getElementById('barcodeLogBtn');
    if(logBtn) logBtn.addEventListener('click',()=>{
      if(!kcal){setBarcodeStatus('This product has no usable calorie value, so it cannot be logged automatically.');return;}
      const factor=1;
      const logs=nLogData();
      logs.push({id:Date.now()+Math.random(),date:getTodayKey(),time:new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}),name,portion:'100 g',kcal,protein,carbs,fat,source:'Open Food Facts barcode'});
      if(typeof saveFoodLogs==='function') saveFoodLogs(logs); else localStorage.setItem('swasth_foodLogs',JSON.stringify(logs));
      if(typeof syncTodayCalories==='function') syncTodayCalories();
      if(typeof renderTodayFoodLogs==='function') renderTodayFoodLogs();
      if(typeof renderRecordFoodLogs==='function') renderRecordFoodLogs();
      if(typeof renderRecordTimeline==='function') renderRecordTimeline();
      renderWeeklyNutritionTrends();
      showToast?.('', 'Packaged food logged', `${name} · ${Math.round(kcal)} kcal added to today’s log.`);
    });
    const clearBtn=document.getElementById('barcodeClearBtn'); if(clearBtn) clearBtn.addEventListener('click',()=>{el.innerHTML='';});
  }
  async function lookupBarcode(raw){
    const code=String(raw||'').replace(/\D/g,'');
    if(code.length<8){setBarcodeStatus('Enter a valid barcode with at least 8 digits.');return;}
    setBarcodeStatus('Looking up packaged-food nutrition data…');
    try{
      const r=await fetch('https://world.openfoodfacts.org/api/v2/product/'+encodeURIComponent(code)+'.json',{headers:{Accept:'application/json'}});
      if(!r.ok) throw new Error('Barcode service returned HTTP '+r.status);
      const data=await r.json();
      if(Number(data.status)!==1 || !data.product) throw new Error('No packaged-food product was found for this barcode.');
      showBarcodeResult(data.product,code); setBarcodeStatus('Product found. Review the nutrition values before logging.');
    }catch(e){setBarcodeStatus(e.message||'Barcode lookup failed. You can try entering the barcode again.');}
  }
  async function startBarcodeScanner(){
    const v=video(); if(!v)return;
    if(!navigator.mediaDevices?.getUserMedia){setBarcodeStatus('Camera access is not available in this browser. Enter the barcode manually.');return;}
    try{
      barcodeStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}},audio:false});
      v.srcObject=barcodeStream; v.style.display='block'; await v.play();
      document.getElementById('startBarcodeScanBtn')?.style.setProperty('display','none');
      document.getElementById('stopBarcodeScanBtn')?.style.setProperty('display','inline-flex');
      setBarcodeStatus('Point the camera at the barcode.');
      if('BarcodeDetector' in window){
        let formats=[];
        try{formats=await BarcodeDetector.getSupportedFormats();}catch(e){}
        const preferred=['ean_13','ean_8','upc_a','upc_e','code_128','code_39'];
        const use=preferred.filter(x=>!formats.length||formats.includes(x));
        const detector=new BarcodeDetector({formats:use.length?use:undefined});
        barcodeTimer=setInterval(async()=>{
          if(!v.videoWidth)return;
          try{const codes=await detector.detect(v); if(codes?.length){const val=codes[0].rawValue; stopBarcodeScanner(); document.getElementById('barcodeManualInput').value=val; lookupBarcode(val);}}catch(e){}
        },450);
        return;
      }
      // Lightweight fallback: dynamically load ZXing only when camera scanning is requested.
      if(!window.ZXingBrowser){
        await new Promise((resolve,reject)=>{const sc=document.createElement('script');sc.src='https://cdn.jsdelivr.net/npm/@zxing/browser@0.1.5/umd/zxing-browser.min.js';sc.onload=resolve;sc.onerror=reject;document.head.appendChild(sc);});
      }
      zxingReader=new ZXingBrowser.BrowserMultiFormatReader();
      zxingReader.decodeFromVideoDevice(undefined,v,(res)=>{
        if(res){const val=res.getText();stopBarcodeScanner();document.getElementById('barcodeManualInput').value=val;lookupBarcode(val);}
      });
    }catch(e){stopBarcodeScanner();setBarcodeStatus('Camera permission was unavailable. Enter the barcode manually instead.');}
  }
  document.getElementById('startBarcodeScanBtn')?.addEventListener('click',startBarcodeScanner);
  document.getElementById('stopBarcodeScanBtn')?.addEventListener('click',stopBarcodeScanner);
  document.getElementById('lookupBarcodeBtn')?.addEventListener('click',()=>lookupBarcode(document.getElementById('barcodeManualInput')?.value));
  document.getElementById('barcodeManualInput')?.addEventListener('keydown',e=>{if(e.key==='Enter')lookupBarcode(e.target.value);});
  window.addEventListener('beforeunload',stopBarcodeScanner);

  window.renderWeeklyNutritionTrends=renderWeeklyNutritionTrends;
  window.renderMedicationFoodInteractions=renderMedicationFoodInteractions;
  window.renderNutritionUpgrades=function(){renderWeeklyNutritionTrends();renderMedicationFoodInteractions();};
  setTimeout(()=>window.renderNutritionUpgrades(),0);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)window.renderNutritionUpgrades();});
})();
