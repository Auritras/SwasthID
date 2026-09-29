 /* =========================================================
 8. DYNAMIC PRESCRIPTION OCR SCANNER (TESSERACT)
 ========================================================= */
 const chooseRxBtn = document.getElementById('chooseRxBtn');
 const rxFileInput = document.getElementById('rxFileInput');
 const scanResults = document.getElementById('scanResults');
 let currentPrescription = null;
 let rxOcrWorkerPromise = null;
 let ocrStatusButton = null; // the button showing OCR progress (prescription or lab report)

 function getSavedPrescriptions() {
 try { return JSON.parse(localStorage.getItem('swasth_prescriptions')) || []; }
 catch (e) { return []; }
 }

 function savePrescriptions(items) {
 localStorage.setItem('swasth_prescriptions', JSON.stringify(items));
 syncCloudState('swasth_prescriptions');
 }

 function cleanOcrText(text) {
 return String(text || '')
 .replace(/\r/g, '')
 // Common OCR misreads on prescriptions.
 .replace(/\b([0-9SOIl]*[0-9SO][0-9SOIl]*)(\s*)(mg|mcg|m[Il1i]|ml|g)\b/g, (all, num, space, unit) =>
   /^[0-9]+$/.test(num) ? all : (/[0-9]/.test(num) || num.length >= 2 || num === 'S') ? num.replace(/S/g, '5').replace(/O/g, '0').replace(/[Il]/g, '1') + space + unit : all)
 .replace(/(\d)\s*m[Il1i]\b/g, '$1 ml')
 .replace(/\b0D\b/g, 'OD')
 .replace(/\bT\.\s?D\.\s?S\.?/gi, 'TDS')
 .replace(/\bB\.\s?D\.?(?=\s|$)/gi, 'BD')
 .replace(/\bO\.\s?D\.?(?=\s|$)/gi, 'OD')
 .replace(/\bH\.\s?S\.?(?=\s|$)/gi, 'HS')
 .replace(/[ \t]+/g, ' ')
 .replace(/\n{3,}/g, '\n\n')
 .trim();
 }

 /** @param {string} text @returns {{doctor:string,medicines:Array}} */
 function parsePrescription(text) {
 const raw = cleanOcrText(text);
 const lines = raw.split('\n').map(x => x.trim()).filter(Boolean);

 const normalizeMedicineName = value => String(value || '')
   .replace(/^[\-•*]+\s*/, '')
   .replace(/^\(?\d{1,2}\s*[.)]\s*/, '')
   .replace(/^\d{1,2}\s+(?=[A-Za-z])/, '')
   .replace(/^(?:rx|medications?|medicines?)\s*[:\-]?\s*/i, '')
   .replace(/^(?:(?:tab(?:let)?s?|cap(?:sule)?s?|caps?|syr(?:up)?|syp|inj(?:ection)?|injection|cream|ointment|drops?)\.?\s+|(?:t|tab|c|cap|syp|syr|inj)\.\s*)/i, '')
   // Stop the name where the dosing instructions begin (1-0-1, x 5 days, OD, after food...).
   .replace(/\s+(?:\(?\s*[0-2½]\s*-\s*[0-2½]\s*-\s*[0-2½]|x\s*\d|for\s+\d|\((?:after|before|with|at)\b|(?:od|bd|bid|tds|tid|qid|hs|sos|prn|stat)\b|once\b|twice\b|thrice\b|daily\b|before\s+(?:food|meals?|breakfast)|after\s+(?:food|meals?)|at\s+(?:night|bedtime)).*$/i, '')
   .replace(/\s+\b\d+(?:[.,]\d+)?\s*(?:mg|mcg|µg|ug|g|kg|ml|mL|l|IU|units?|%|mmol)\b.*$/i, '')
   .replace(/\s+(?:tablets?|tabs?|capsules?|caps?|syrup|injection|inj\.?|cream|ointment|drops?)\b.*$/i, '')
   .replace(/\s{2,}/g, ' ')
   .replace(/\s*[-:]\s*$/, '')
   .trim();

 const doseFrom = value => (String(value || '').match(/\b\d+(?:[.,]\d+)?\s*(?:mg|mcg|µg|ug|g|kg|ml|mL|l|IU|units?|%|mmol)\b/i) || [])[0] || '';

 const frequencyFrom = value => {
   const line = String(value || '').toLowerCase().replace(/[–—]/g, '-');
   const every = line.match(/\bevery\s+(\d+(?:\.5)?)\s*(hours?|hrs?|h|minutes?|mins?)\b/i);
   if (every) return `Every ${every[1]} ${/^h/i.test(every[2]) ? 'hours' : every[2].toLowerCase().replace(/s$/, '') + 's'}`;
   const q = line.match(/\bq(\d+(?:\.5)?)(?:h|hr|hrs)\b/i);
   if (q) return `Every ${q[1]} hours`;
   // Indian dosing notation: morning-afternoon-night(-bedtime), e.g. 1-0-1, 1-1-1, 0-0-1.
   const slots = line.match(/(?:^|[^\d./-])([0-2]|½|1\/2)\s*-\s*([0-2]|½|1\/2)\s*-\s*([0-2]|½|1\/2)(?:\s*-\s*([0-2]|½|1\/2))?(?![\d./-])/);
   if (slots) {
     const parts = slots.slice(1).filter(x => x !== undefined);
     const taken = parts.filter(x => x !== '0').length;
     const names = parts.length === 4 ? ['morning', 'afternoon', 'evening', 'night'] : ['morning', 'afternoon', 'night'];
     const when = parts.map((x, i) => x !== '0' ? names[i] : '').filter(Boolean).join(', ');
     if (taken === 1) return `Once daily (${when})`;
     if (taken === 2) return `Twice daily (${when})`;
     if (taken === 3) return 'Three times daily';
     if (taken === 4) return 'Four times daily';
   }
   if (/\b(?:qid|four times daily|4\s*(?:times|x)\s*(?:a\s*)?day|4-?times?\s*daily)\b/i.test(line)) return 'Four times daily';
   if (/\b(?:tds|tid|thrice daily|three times daily|3\s*(?:times|x)\s*(?:a\s*)?day|3-?times?\s*daily)\b/i.test(line)) return 'Three times daily';
   if (/\b(?:bd|bid|twice daily|2\s*(?:times|x)\s*(?:a\s*)?day|2-?times?\s*daily)\b/i.test(line)) return 'Twice daily';
   if (/\b(?:od|qd|once daily|daily|every day|1\s*(?:time|x)\s*(?:a\s*)?day|1-?time\s*daily)\b/i.test(line)) return 'Once daily';
   if (/\b(?:qhs|hs|at bedtime|bedtime|before bed|at night)\b/i.test(line)) return 'At bedtime';
   if (/\b(?:weekly|once a week|1\s*(?:time|x)\s*(?:a\s*)?week)\b/i.test(line)) return 'Once weekly';
   if (/\b(?:monthly|once a month)\b/i.test(line)) return 'Once monthly';
   if (/\b(?:prn|sos|as needed|when needed)\b/i.test(line)) return 'As needed';
   return '';
 };

 const instructionsFrom = value => {
   const line = String(value || '').replace(/\s+/g, ' ').trim();
   const action = line.match(/\b(?:take|give|apply|use|inject|inhale|swallow|dissolve|drink)\b[^.]*?(?:\.|$)/i);
   if (action) return action[0].trim().replace(/[.;]+$/, '');
   if (/\b(?:on an? empty stomach|empty stomach|before breakfast|before food|before meals?|before meal)\b/i.test(line)) return 'Before food';
   if (/\b(?:after breakfast|after food|after meals?|after meal|with food|with meals?|with meal)\b/i.test(line)) return 'After/with food';
   if (/\b(?:at bedtime|bedtime|before bed|at night)\b/i.test(line)) return 'At bedtime';
   if (/\b(?:as needed|when needed|for pain|for fever)\b/i.test(line)) {
     const matches = line.match(/\b(?:as needed|when needed|for pain|for fever)\b/ig);
     return matches ? matches.join('; ') : '';
   }
   return '';
 };

 const durationFrom = value => {
   const m = String(value || '').match(/\b(?:for|x)\s*(\d+)\s*(days?|d|weeks?|wks?|w|months?|m)\b/i);
   if (!m) return '';
   const unit = /^d/i.test(m[2]) ? 'day' : /^w/i.test(m[2]) ? 'week' : 'month';
   return `for ${m[1]} ${unit}${m[1] === '1' ? '' : 's'}`;
 };

 const isInstructionLine = line => /^(?:take|give|apply|use|inject|inhale|swallow|dissolve|drink|instill|place|insert|chew|crush|dilute|mix|administer)\b/i.test(String(line || '').trim());
 const isAdministrativeLine = line => /^(?:rx|prescription|medications?|medicines?|refills?|quantity|physician|doctor|patient|date|address|phone|license|signature|allerg(?:y|ies)|diagnosis|dob|mrn)\b/i.test(String(line || '').trim());
 const isLikelyMedicineStart = line => {
   const l = String(line || '').trim();
   if (!l || isInstructionLine(l) || isAdministrativeLine(l)) return false;
   if (/^(?:\d+[.)]|[-•*])\s*$/.test(l)) return false;
   if (/^(?:[-•*]\s*|\(?\d{1,2}\s*[.)]?\s*)?(?:t|c|tab|cap|syp|syr|inj)\.\s*[A-Za-z]/i.test(l)) return true;
   return /^(?:[-•*]\s*|\(?\d{1,2}\s*[.)]\s*|\d{1,2}\s+)?(?:tab(?:let)?s?|cap(?:sule)?s?|syr(?:up)?|syp|inj(?:ection)?|cream|ointment|drops?|solution|suspension|inhaler|patch|powder)\.?\s+/i.test(l)
     || /\b\d+(?:[.,]\d+)?\s*(?:mg|mcg|µg|ug|g|kg|ml|mL|l|IU|units?|%)\b/i.test(l)
     || /\b(?:tablet|tablets|capsule|capsules|syrup|injection|cream|ointment|drops?|solution|suspension|inhaler|patch|powder)\b/i.test(l);
 };

 const medicineBlocks = [];
 for (let i = 0; i < lines.length; i++) {
   if (!isLikelyMedicineStart(lines[i])) continue;
   let block = lines[i];
   let j = i + 1;
   while (j < lines.length && j < i + 6 && !isLikelyMedicineStart(lines[j]) && !isAdministrativeLine(lines[j])) {
     const candidate = lines[j];
     if (isInstructionLine(candidate)
       || /\b(?:times daily|once daily|twice daily|three times daily|four times daily|every\s+\d+|\b(?:od|qd|bd|bid|tid|tds|qid|q\d+h|prn|sos)\b|for\s+\d+\s+(?:days?|weeks?|months?)|before food|after food|with food|at bedtime|as needed|when needed)\b/i.test(candidate)) {
       block += ' ' + candidate;
       j++;
       continue;
     }
     break;
   }
   medicineBlocks.push({ text: block, index: i });
   i = j - 1;
 }

 const found = medicineBlocks.map(({ text }) => {
   const dose = doseFrom(text);
   const frequency = frequencyFrom(text);
   const duration = durationFrom(text);
   const instructions = instructionsFrom(text);
   let medicine = normalizeMedicineName(text);
   medicine = medicine.replace(/\s+(?:take|give|apply|use|swallow|drink|inject|inhale)\b.*$/i, '').trim();
   medicine = medicine.replace(/\s*[-:]\s*$/, '').trim();
   if (!medicine) medicine = 'Medicine — verify manually';
   let finalInstructions = instructions || '';
   if (duration && !new RegExp(duration.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(finalInstructions)) {
     finalInstructions = [finalInstructions, duration].filter(Boolean).join('; ');
   }
   return {
     medicine: medicine.slice(0, 100),
     dose,
     frequency: frequency || 'Needs review',
     instructions: finalInstructions,
     sourceLine: text
   };
 });

 if (!found.length) {
   lines.filter(l => !isInstructionLine(l) && /\d+\s*(?:mg|mcg|µg|ug|g|ml|iu|units?)\b|\b(?:tablet|capsule|syrup|injection)\b/i.test(l))
     .slice(0, 8)
     .forEach(line => found.push({ medicine: normalizeMedicineName(line).slice(0, 100) || line.slice(0, 100), dose: doseFrom(line), frequency: frequencyFrom(line) || 'Needs review', instructions: instructionsFrom(line), sourceLine: line }));
 }

 const doctorPatterns = [
   /^(?:physician|doctor|prescribed\s+by|prescriber)\s*[:\-]?\s*(.+)$/i,
   /\b((?:Dr\.?|Doctor)\s+[A-Z][^\n]{1,80})/i
 ];
 let doctor = '';
 for (const line of lines) {
   for (const pattern of doctorPatterns) {
     const match = line.match(pattern);
     if (match) { doctor = (match[1] || match[0]).trim(); break; }
   }
   if (doctor) break;
 }
 if (!doctor) doctor = 'Not detected — verify manually';

 return { doctor, medicines: found, rawText: raw };
 }
 function extractJsonObject(text){
 const cleaned=String(text||'').replace(/```(?:json)?/gi,'').replace(/```/g,'').trim();
 try{return JSON.parse(cleaned);}catch(_){ }
 const start=cleaned.indexOf('{'); const end=cleaned.lastIndexOf('}');
 if(start<0||end<=start)throw new Error('No JSON object returned by the local model');
 return JSON.parse(cleaned.slice(start,end+1));
 }
 function validateStructuredPrescription(candidate, rawText, fallback){
   if(!candidate || !Array.isArray(candidate.medicines) || !candidate.medicines.length) throw new Error('Structured output contains no medicines');
   const source=String(rawText||'').toLowerCase();
   const medicines=candidate.medicines.map(m=>{
     const medicine=String(m?.medicine||'').trim();
     const dose=String(m?.dose||'').trim();
     const frequency=String(m?.frequency||'').trim();
     const instructions=String(m?.instructions||'').trim();
     if(!medicine) throw new Error('A medicine entry is missing its name');
     const tokens=medicine.toLowerCase().split(/\s+/).filter(t=>t.length>=4).slice(0,4);
     if(tokens.length && !tokens.some(t=>source.includes(t))) throw new Error(`Medicine not grounded in OCR text: ${medicine}`);
     return {medicine,dose,frequency:frequency||'Needs review',instructions};
   });
   const doctor=String(candidate.doctor||fallback.doctor||'Needs review').trim()||'Needs review';
   return {doctor,medicines,rawText:cleanOcrText(rawText),parser:'local-llm',structuredValidated:true};
 }
 async function parsePrescriptionWithSwasthAI(rawText){
 const fallback=parsePrescription(rawText);
 // Only use the local model if the user already loaded it through SwasthAI;
 // never start a large model download just to read a prescription.
 if(!swasthaiEngine) return {...fallback,parser:'regex-fallback',structuredValidated:false};
 try{
  const engine=swasthaiEngine;
  const response=await engine.chat.completions.create({messages:[
    {role:'system',content:'You extract prescription OCR into a strict JSON object. Return ONLY valid JSON, with no markdown. Schema: {"doctor":"string","medicines":[{"medicine":"string","dose":"string","frequency":"string","instructions":"string"}]}. Never invent or normalize away uncertain information. Use empty strings when a field is not present. Every medicine must be supported by the OCR text.'},
    {role:'user',content:`OCR TEXT:\n${String(rawText).slice(0,12000)}`}
  ],temperature:0,max_tokens:700});
  return validateStructuredPrescription(extractJsonObject(response?.choices?.[0]?.message?.content),rawText,fallback);
 }catch(e){console.warn('Structured local-LLM prescription parsing rejected; using regex fallback.',e);return {...fallback,parser:'regex-fallback',structuredValidated:false,parserWarning:String(e?.message||e)};}
}

function renderEditablePrescription(parsed) {
 const confirmBtn=document.getElementById('confirmRxBtn'); if(confirmBtn){confirmBtn.disabled=false;confirmBtn.textContent='Save to records';}
 const shopBtnReset=document.getElementById('shopRxBtn'); if(shopBtnReset)shopBtnReset.style.display='none';
 const shopHintReset=document.getElementById('shopRxHint'); if(shopHintReset)shopHintReset.style.display='none';
 const rawOcrText = document.getElementById('rawOcrText');
 if (rawOcrText) rawOcrText.textContent = parsed.rawText.slice(0, 1800);
 const physicianField = document.getElementById('detectedDocName');
 if (physicianField) physicianField.value = parsed.doctor;
 const medsList = document.getElementById('dynamicMedsList');
 medsList.innerHTML = parsed.medicines.map((m, i) => `
 <div class="medicine-row rx-med" data-med-index="${i}">
 <div class="rx-med-head"><span class="t-meta">Medicine ${i+1}</span><button type="button" class="link-btn" data-remove-med="${i}">Remove</button></div>
 <input class="rx-med-field rx-med-name" data-field="medicine" value="${escapeHtml(m.medicine)}" aria-label="Medicine ${i+1} name">
 <div class="rx-med-grid">
 <input class="rx-med-field" data-field="dose" value="${escapeHtml(m.dose)}" placeholder="Dose" aria-label="Medicine ${i+1} dose">
 <input class="rx-med-field" data-field="frequency" value="${escapeHtml(m.frequency)}" placeholder="How often" aria-label="Medicine ${i+1} frequency">
 <input class="rx-med-field" data-field="instructions" value="${escapeHtml(m.instructions)}" placeholder="Instructions" aria-label="Medicine ${i+1} instructions">
 </div>
 </div>`).join('');

 medsList.querySelectorAll('[data-remove-med]').forEach(btn => btn.addEventListener('click', () => {
 btn.closest('.medicine-row').remove();
 if (!medsList.querySelector('.medicine-row')) medsList.innerHTML = '<div class="empty">No medicines left. Scan the prescription again to continue.</div>';
 }));

 currentPrescription = { ...parsed, scannedAt: new Date().toISOString() };
 document.getElementById('ocrConfBadge').textContent = parsed.parser==='local-llm' && parsed.structuredValidated ? 'Read by on-device AI' : parsed.parser==='demo' ? 'Sample' : 'Read by OCR';
 const reviewNote = document.getElementById('rxReviewNote');
 if (reviewNote) reviewNote.textContent = 'Correct anything that was misread before saving. Fields marked “verify manually” weren’t read confidently.';
 scanResults.classList.add('show');
 scanResults.scrollIntoView({ behavior: 'smooth', block: 'start' });
 }

 function readCurrentPrescriptionFromUI() {
 const medicines = [...document.querySelectorAll('#dynamicMedsList .medicine-row')].map(row => {
 const get = field => row.querySelector(`[data-field="${field}"]`)?.value.trim() || '';
 return { medicine: get('medicine'), dose: get('dose'), frequency: get('frequency'), instructions: get('instructions') };
 }).filter(m => m.medicine);
 return {
 doctor: document.getElementById('detectedDocName')?.value.trim() || 'Not specified',
 medicines,
 rawText: currentPrescription?.rawText || ''
 };
 }

 function rxProgress(status, progress) {
 const pct = Math.round((Number(progress) || 0) * 100);
 const btn = ocrStatusButton || chooseRxBtn;
 if (!btn) return;
 if (status === 'recognizing text') btn.textContent = `Extracting via OCR… ${pct}%`;
 else if (status === 'loading language traineddata') btn.textContent = `Loading OCR language… ${pct}%`;
 else if (status === 'initializing api') btn.textContent = `Starting OCR… ${pct}%`;
 }

 async function getRxOcrWorker() {
 await ensureTesseractLoaded();
 if (!window.Tesseract) throw new Error('Tesseract OCR library could not be loaded.');
 if (!rxOcrWorkerPromise) {
   rxOcrWorkerPromise = (async () => {
     const worker = await Promise.race([
       Tesseract.createWorker('eng', 1, {
         workerBlobURL: true,
         logger: m => rxProgress(m.status, m.progress),
         errorHandler: err => console.error('Tesseract worker error:', err)
       }),
       new Promise((_, reject) => setTimeout(() => reject(new Error('OCR engine took too long to initialize. Check that the browser can access the Tesseract CDN, then hard-refresh the page.')), 45000))
     ]);
     await worker.setParameters({
       tessedit_pageseg_mode: Tesseract.PSM.AUTO,
       preserve_interword_spaces: '1',
       user_defined_dpi: '300'
     });
     return worker;
   })().catch(err => {
     rxOcrWorkerPromise = null;
     console.error('Tesseract initialization failed:', err);
     throw err;
   });
 }
 return rxOcrWorkerPromise;
 }

 function loadImageElementFromDataUrl(dataUrl) {
 return new Promise((resolve, reject) => {
   const img = new Image();
   img.onload = () => resolve(img);
   img.onerror = () => reject(new Error('The prescription image could not be decoded. Try a JPG or PNG image.'));
   img.src = dataUrl;
 });
 }

 async function preprocessRxImage(file) {
 if (!file || !file.size) throw new Error('The selected prescription file is empty.');
 if (!file.type.startsWith('image/')) throw new Error('This file is not an image. PDF files are converted to images automatically; other file types are not supported.');
 const dataUrl = await new Promise((resolve, reject) => {
   const reader = new FileReader();
   reader.onload = () => resolve(reader.result);
   reader.onerror = () => reject(new Error('The prescription image could not be loaded.'));
   reader.readAsDataURL(file);
 });
 const img = await loadImageElementFromDataUrl(dataUrl);
 const maxDimension = 3000;
 const scale = Math.min(3, maxDimension / Math.max(img.naturalWidth, img.naturalHeight));
 const width = Math.max(1, Math.round(img.naturalWidth * scale));
 const height = Math.max(1, Math.round(img.naturalHeight * scale));
 const canvas = document.createElement('canvas');
 canvas.width = width;
 canvas.height = height;
 const ctx = canvas.getContext('2d', { willReadFrequently: true });
 if (!ctx) throw new Error('The browser could not prepare the prescription image.');
 ctx.drawImage(img, 0, 0, width, height);
 // Two versions: a simple contrast boost (best for clean or slightly blurred
 // scans) and a background-normalised one (needed for phone photos).
 const contrast = document.createElement('canvas');
 contrast.width = width; contrast.height = height;
 const cctx = contrast.getContext('2d', { willReadFrequently: true });
 cctx.drawImage(canvas, 0, 0);
 const image = cctx.getImageData(0, 0, width, height);
 const d = image.data;
 for (let i = 0; i < d.length; i += 4) {
   const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
   d[i] = d[i + 1] = d[i + 2] = Math.max(0, Math.min(255, (gray - 128) * 1.35 + 128));
 }
 cctx.putImageData(image, 0, 0);
 normalizeCanvasForOcr(canvas);
 return { normalized: canvas.toDataURL('image/png'), contrast: contrast.toDataURL('image/png') };
 }

 // Phone photos have grey, unevenly lit paper, and Tesseract then finds no text
 // at all. Divide each pixel by an estimate of the local paper brightness so the
 // page becomes white and the ink dark, then stretch the contrast.
 function normalizeCanvasForOcr(canvas) {
   const width = canvas.width, height = canvas.height;
   const ctx = canvas.getContext('2d', { willReadFrequently: true });
   // Background estimate: shrink the page (small text disappears) and scale it back up.
   const small = document.createElement('canvas');
   small.width = Math.max(1, Math.round(width / 24));
   small.height = Math.max(1, Math.round(height / 24));
   const sctx = small.getContext('2d');
   sctx.imageSmoothingQuality = 'high';
   sctx.drawImage(canvas, 0, 0, small.width, small.height);
   const bg = document.createElement('canvas');
   bg.width = width; bg.height = height;
   const bctx = bg.getContext('2d', { willReadFrequently: true });
   bctx.imageSmoothingQuality = 'high';
   bctx.drawImage(small, 0, 0, width, height);
   const image = ctx.getImageData(0, 0, width, height);
   const d = image.data;
   const b = bctx.getImageData(0, 0, width, height).data;
   const ratio = new Float32Array(width * height);
   for (let i = 0, j = 0; i < d.length; i += 4, j++) {
     const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
     const paper = Math.max(1, 0.299 * b[i] + 0.587 * b[i + 1] + 0.114 * b[i + 2]);
     ratio[j] = Math.min(1, lum / paper); // 1 = paper, lower = ink
   }
   // Map the darkest 2% of pixels to black and the paper to white.
   const sample = [];
   for (let j = 0; j < ratio.length; j += 97) sample.push(ratio[j]);
   sample.sort((x, y) => x - y);
   const dark = sample[Math.floor(sample.length * 0.02)] || 0;
   const range = Math.max(0.05, 1 - dark);
   for (let i = 0, j = 0; i < d.length; i += 4, j++) {
     const v = Math.max(0, Math.min(255, (ratio[j] - dark) / range * 255));
     d[i] = d[i + 1] = d[i + 2] = v;
   }
   ctx.putImageData(image, 0, 0);
 }

 async function pdfPrescriptionPages(file) {
 await ensurePdfJsLoaded();
 if (!window.pdfjsLib) throw new Error('PDF support could not be loaded. Please use a JPG or PNG prescription image.');
 const buffer = await file.arrayBuffer();
 const loadingTask = window.pdfjsLib.getDocument({ data: buffer });
 const pdf = await loadingTask.promise;
 const pages = [];
 const totalPages = pdf.numPages;
 if(totalPages>4) showToast('', 'Multi-page prescription', `This PDF has ${totalPages} pages. SwasthID will scan all pages; processing may take longer.`);
 for (let pageNo = 1; pageNo <= totalPages; pageNo++) {
   const page = await pdf.getPage(pageNo);
   const base = page.getViewport({ scale: 1 });
   const scale = Math.min(2.5, 2200 / Math.max(base.width, base.height));
   const viewport = page.getViewport({ scale: Math.max(1.5, scale) });
   const canvas = document.createElement('canvas');
   canvas.width = Math.ceil(viewport.width);
   canvas.height = Math.ceil(viewport.height);
   const ctx = canvas.getContext('2d', { willReadFrequently: true });
   await page.render({ canvasContext: ctx, viewport }).promise;
   normalizeCanvasForOcr(canvas);
   pages.push(canvas.toDataURL('image/png'));
 }
 return pages;
 }

 async function ocrDataUrls(dataUrls) {
 const worker = await getRxOcrWorker();
 const texts = [];
 for (let i = 0; i < dataUrls.length; i++) {
   const btn = ocrStatusButton || chooseRxBtn;
   if (btn) btn.textContent = dataUrls.length > 1 ? `Reading page ${i + 1}/${dataUrls.length}…` : 'Extracting via OCR…';
   const result = await worker.recognize(dataUrls[i]);
   texts.push(result?.data?.text || '');
 }
 return cleanOcrText(texts.join('\n\n'));
 }

 async function runPrescriptionOCR(file) {
 const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
 if (isPdf) {
   const pages = await pdfPrescriptionPages(file);
   if (!pages.length) throw new Error('The PDF contains no readable pages.');
   return ocrDataUrls(pages);
 }
 const versions = await preprocessRxImage(file);
 // Read both versions and keep the one from which more medicines can be parsed.
 const normalizedText = await ocrDataUrls([versions.normalized]);
 const contrastText = await ocrDataUrls([versions.contrast]);
 const count = text => parsePrescription(text).medicines.filter(m => !/verify manually/i.test(m.medicine)).length;
 return count(contrastText) > count(normalizedText) ? contrastText : normalizedText;
 }

 chooseRxBtn.addEventListener('click', () => rxFileInput.click());
 // Dropping a file on the scan area uses the same path as choosing one.
 const rxDropzone = document.getElementById('rxDropzone');
 if (rxDropzone) {
   ['dragenter', 'dragover'].forEach(type => rxDropzone.addEventListener(type, e => { e.preventDefault(); rxDropzone.classList.add('is-dragover'); }));
   ['dragleave', 'dragend'].forEach(type => rxDropzone.addEventListener(type, e => { if (!rxDropzone.contains(e.relatedTarget)) rxDropzone.classList.remove('is-dragover'); }));
   rxDropzone.addEventListener('drop', e => {
     e.preventDefault(); rxDropzone.classList.remove('is-dragover');
     const file = e.dataTransfer?.files?.[0]; if (!file || chooseRxBtn.disabled) return;
     const dt = new DataTransfer(); dt.items.add(file); rxFileInput.files = dt.files;
     rxFileInput.dispatchEvent(new Event('change'));
   });
 }

 rxFileInput.addEventListener('change', async (e) => {
 if (!e.target.files.length) return;
 const file = e.target.files[0];
 chooseRxBtn.textContent = 'Preparing prescription…';
 chooseRxBtn.disabled = true;
 try {
   const text = await runPrescriptionOCR(file);
   if (!text || text.length < 3) {
     throw new Error('OCR returned no readable text. Use a sharp, well-lit prescription image with the writing facing the camera.');
   }
   const parsed = await parsePrescriptionWithSwasthAI(text);
   renderEditablePrescription(parsed);
   showToast('', parsed.parser==='local-llm' ? 'OCR + local AI Complete' : 'OCR Complete', `${parsed.medicines.length} medication item(s) extracted. Please verify every field before saving.`);
 } catch (err) {
   console.error('Prescription OCR failed:', err);
   showToast('', 'OCR Failed', err?.message || 'Could not read this prescription.');
   if (document.getElementById('ocrConfBadge')) document.getElementById('ocrConfBadge').textContent = 'OCR failed — try another image';
 } finally {
   chooseRxBtn.textContent = 'Choose file';
   chooseRxBtn.disabled = false;
   rxFileInput.value = '';
 }
 });

 document.getElementById('demoRxBtn').addEventListener('click', () => {
   // Demo mode is deterministic and instant. It must never initialize/download WebLLM.
   renderEditablePrescription({
     doctor:'Dr. Rohan Iyer',
     medicines:[
       {medicine:'Thyroxine 12.5 mcg',dose:'12.5 mcg',frequency:'Once daily',instructions:''},
       {medicine:'Vitamin D3 1000 IU',dose:'1000 IU',frequency:'Weekly',instructions:''}
     ],
     rawText:'Dr. Rohan Iyer\nRx\nThyroxine 12.5 mcg — OD\nVitamin D3 1000 IU — Weekly',
     parser:'demo'
   });
   document.getElementById('ocrConfBadge').textContent = 'Sample';
 });

 document.getElementById('confirmRxBtn').addEventListener('click', function(){
 const prescription = readCurrentPrescriptionFromUI();
 if (!prescription.medicines.length) {
 showToast('', 'Nothing to Save', 'Add at least one medicine before confirming.');
 return;
 }
 const saved = getSavedPrescriptions();
 const normalizePrescriptionMedicine = value => String(value||'').toLowerCase().replace(/\b(tablets?|capsules?|caplets?|syrup|drops?|injection|cream|ointment|solution|suspension)\b/g,' ').replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
 const normalizeMedicineDose = value => String(value||'').toLowerCase().replace(/\s+/g,' ').trim();
 const medicinesMatchForDuplicate = (a,b) => {
   const sameName = normalizePrescriptionMedicine(a?.medicine) === normalizePrescriptionMedicine(b?.medicine);
   if(!sameName) return false;
   const doseA = normalizeMedicineDose(a?.dose);
   const doseB = normalizeMedicineDose(b?.dose);
   return doseA === doseB;
 };
 const duplicateMedicines = prescription.medicines.filter(m => saved.some(r => (r.medicines||[]).some(existing => medicinesMatchForDuplicate(existing,m))));
 const record = {
 id: `rx_${Date.now()}_${Math.random().toString(36).slice(2,7)}`,
 doctor: prescription.doctor,
 medicines: prescription.medicines,
 rawText: prescription.rawText,
 date: new Date().toISOString(),
 source: currentPrescription?.source || 'OCR',
   isRefillOrRepeat: duplicateMedicines.length > 0,
   duplicateMatches: duplicateMedicines.map(m=>m.medicine)
 };
 saved.unshift(record);
 savePrescriptions(saved);
 renderSavedPrescriptions(); renderTodayMedications(); renderRecordTimeline(); renderCareJourney();
 this.textContent = 'Saved';
 this.disabled = true;
 showToast('', duplicateMedicines.length ? 'Saved as a repeat prescription' : 'Prescription saved', `${record.medicines.length} medicine${record.medicines.length === 1 ? '' : 's'} added to your records.${duplicateMedicines.length ? ' Your existing medicines were kept.' : ''}`);
 const shopBtn = document.getElementById('shopRxBtn');
 const shopHint = document.getElementById('shopRxHint');
 if (shopBtn) shopBtn.style.display = 'inline-flex';
 if (shopHint) shopHint.style.display = 'block';
 });

 function connectPrescriptionToMedicineSearch(medicines) {
 const clean = (medicines || []).map(m => ({
  medicine: String(m.medicine || '').trim(),
  dose: String(m.dose || '').trim(),
  frequency: String(m.frequency || '').trim(),
  instructions: String(m.instructions || '').trim()
 })).filter(m => m.medicine);
 localStorage.setItem('swasth_pendingMedicineSearch', JSON.stringify(clean));
 syncCloudState('swasth_pendingMedicineSearch');
 window.__pendingPrescriptionMedicines = clean;

 const queue = document.getElementById('prescriptionMedicineQueue');
 const list = document.getElementById('prescriptionMedicineQueueList');
 if (queue && list) {
  queue.style.display = clean.length ? 'block' : 'none';
  list.innerHTML = clean.map((m, i) => `
   <div class="queue-row">
    <div class="list-main"><b>${escMed(m.medicine)}</b><span>${escMed([m.dose,m.frequency].filter(Boolean).join(' · '))}</span></div>
    <button class="btn btn-sm" type="button" data-prescription-med-index="${i}">Search</button>
   </div>`).join('');
  list.querySelectorAll('[data-prescription-med-index]').forEach(btn => btn.addEventListener('click', () => {
   const med = clean[Number(btn.dataset.prescriptionMedIndex)];
   if (med) searchPrescriptionMedicine(med);
  }));
 }
 return clean;
 }


 document.getElementById('shopRxBtn')?.addEventListener('click', () => {
 const verified = readCurrentPrescriptionFromUI();
 if (!verified.medicines.length) {
  showToast('', 'No medicines to search', 'Verify at least one medicine before opening Medicine Search.');
  return;
 }
 connectPrescriptionToMedicineSearch(verified.medicines);
 showTab('order');
 setTimeout(() => renderPrescriptionOrderCards(verified.medicines), 0);
 showToast('', 'Prescription Connected', `${verified.medicines.length} verified medicine(s) are being searched separately.`);
 });

 function renderSavedPrescriptions() {
 const el = document.getElementById('prescriptionList');
 if (!el) return;
 const saved = getSavedPrescriptions();
 if (!saved.length) {
 el.innerHTML = '<div class="empty">No prescriptions yet. Scan one and confirm the medicines to save it here.</div>';
 return;
 }
 const groupKey = r => (r.medicines||[]).map(m=>`${String(m.medicine||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()}|${String(m.dose||'').toLowerCase().replace(/\s+/g,' ').trim()}`).sort().join(';;');
 const groups = new Map(); saved.forEach((r,i)=>{ const key=groupKey(r); if(!groups.has(key)) groups.set(key,[]); groups.get(key).push({r,i}); });
 const repeatGroups=[...groups.values()].filter(g=>g.length>1);
 const summary=repeatGroups.length?`<div class="list-summary"><span>${saved.length} prescription${saved.length===1?'':'s'} · ${repeatGroups.length} repeat${repeatGroups.length===1?'':'s'} found</span><button type="button" class="btn btn-sm" id="togglePrescriptionGroups">Show repeats</button></div><div id="prescriptionGroupedView" class="list-summary-panel" style="display:none;"></div>`:'';
 const cards = saved.map((r, i) => `<div class="list-item">
 <button type="button" class="list-row disclosure" aria-expanded="false" aria-controls="rxBody${i}"><span class="list-main"><b>${escapeHtml(r.doctor || 'Prescription')}${r.isRefillOrRepeat ? ' <span class="badge">Repeat</span>' : ''}</b><span>${new Date(r.date).toLocaleDateString([], {day:'numeric',month:'short',year:'numeric'})} · ${r.medicines.length} medicine${r.medicines.length===1?'':'s'}</span></span><svg class="icon icon-sm chevron" aria-hidden="true"><use href="#i-chevron-down"/></svg></button>
 <div class="list-panel" id="rxBody${i}" hidden>
 <ul class="plain-list">${r.medicines.map(m => `<li><b>${escapeHtml(m.medicine)}</b><span>${[m.dose, m.frequency, m.instructions].filter(Boolean).map(escapeHtml).join(' · ')}</span></li>`).join('')}</ul>
 <p class="t-meta">You confirmed these after scanning. Check them against the original prescription.</p>
 <div class="list-panel-actions"><button type="button" class="btn btn-sm" onclick="shopSavedPrescription(${i})">Find these medicines</button></div>
 </div>
 </div>`).join('');
 el.innerHTML = summary + '<div class="list">' + cards + '</div>';
 const grouped=document.getElementById('prescriptionGroupedView'); const toggle=document.getElementById('togglePrescriptionGroups');
 toggle?.addEventListener('click',()=>{const open=grouped.style.display!=='none';grouped.style.display=open?'none':'block';toggle.textContent=open?'Show repeats':'Hide repeats';if(!open){if(!repeatGroups.length){grouped.innerHTML='<div class="empty">No repeat prescriptions found.</div>';return;}grouped.innerHTML=repeatGroups.map(group=>{const latest=group[0].r;const names=(latest.medicines||[]).map(m=>`${escapeHtml(m.medicine)}${m.dose?' · '+escapeHtml(m.dose):''}`).join(', ');return `<div class="repeat-row"><b>${group.length} scans</b> · ${names}<div class="t-meta">Latest: ${new Date(latest.date).toLocaleDateString([], {day:'numeric',month:'short',year:'numeric'})}. Older scans remain stored below; this view groups them without deleting data.</div></div>`;}).join('');}});
 }

 window.togglePrescription = function(i) { document.querySelector(`[aria-controls="rxBody${i}"]`)?.click(); };
 window.shopSavedPrescription = function(i) {
  const saved = getSavedPrescriptions();
  const record = saved[i];
  if (!record || !record.medicines?.length) return;
  connectPrescriptionToMedicineSearch(record.medicines);
  const first = record.medicines[0];
  showTab('order');
  setTimeout(() => searchPrescriptionMedicine(first), 0);
  showToast('', 'Prescription Connected', `${record.medicines.length} saved medicine(s) are ready in Medicine Search.`);
 };
