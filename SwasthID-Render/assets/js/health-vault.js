/* Health Vault file: bring back a record from a file made with "Download
   file" (buildSwasthHealthBundle in records.js). The file is read here on the
   device; nothing is uploaded until the user has seen what it holds and
   chosen to replace their record with it. */
(function(){
  const MAX_BYTES = 25 * 1024 * 1024;
  const list = v => Array.isArray(v) ? v : [];
  const text = v => v == null ? '' : String(v);
  const plainObject = v => v && typeof v === 'object' && !Array.isArray(v);
  let pending = null;

  // Files made before the file held everything have only the readable
  // sections: rebuild the profile from those.
  function profileFromSections(f){
    const p = f.patient || {};
    // The medicines section of those files also listed the latest
    // prescription's medicines, which come back with the prescription.
    const fromRx = new Set(list(list(f.prescriptions)[0]?.medications).map(m => medicationIdentityKey(m?.medicine || m?.name || '')));
    return {
      name: text(p.name), dob: text(p.birthDate), bloodGroup: text(p.bloodGroup),
      conditions: list(f.conditions).map(c => ({ name: text(c.code?.text), status: text(c.clinicalStatus?.text), year: text(c.onsetYear), details: text(c.note) })).filter(c => c.name),
      allergies: list(f.allergies?.drug).map(String),
      normalAllergies: list(f.allergies?.other).map(String),
      medications: list(f.medications).map(m => ({ name: text(m.medication?.text), dose: text(m.dose?.text), schedule: text(m.frequency?.text), instructions: text(m.instructions) })).filter(m => m.name && !fromRx.has(medicationIdentityKey(m.name))),
      visits: list(f.encounters).map(v => ({ date: text(v.date), doctor: text(v.provider), specialty: text(v.specialty), facility: text(v.facility) })),
      reports: list(f.diagnosticReports).map(r => ({ date: text(r.date), name: text(r.code?.text), result: text(r.result?.text) })),
      emergencyContact: plainObject(f.emergencyContact) ? f.emergencyContact : {},
      vitals: plainObject(f.vitals) ? f.vitals : {},
      lifestyle: plainObject(f.lifestyle) ? f.lifestyle : {},
      nutrition: plainObject(f.nutrition) ? f.nutrition : {},
      labs: plainObject(f.labs) ? f.labs : {},
      profileCompleted: true
    };
  }

  // The dose history as the app keeps it: every event, plus the latest
  // "taken" flag for each dose (which marks today's doses taken).
  function medStatusFrom(history){
    const status = { history: history.filter(e => e && e.taken).slice(-500) };
    status.history.forEach(e => { if (e.id) status[e.id] = { taken: true, time: e.time || '', date: e.date }; });
    return status;
  }

  // What the file would restore: the profile, and each stored list or setting
  // it has (a section missing from the file leaves the current one alone).
  function readVault(f){
    if (!plainObject(f) || f.resourceType !== 'Bundle' || !/SwasthID/i.test(text(f.meta?.profile))) throw new Error('This is not a SwasthID Health Vault file.');
    const s = plainObject(f.swasthid) ? f.swasthid : null;
    if (s && Number(s.version) > 1) throw new Error('This file was made by a newer version of SwasthID. Update the app, then try again.');
    const profile = s && plainObject(s.profile) ? { ...s.profile } : profileFromSections(f);
    ['ownerUid', 'ownerEmail', 'email'].forEach(k => delete profile[k]);

    const data = {};
    if ('vitalsLog' in f) data.swasth_vitals = list(f.vitalsLog);
    if ('foodLog' in f) data.swasth_foodLogs = list(f.foodLog);
    if ('family' in f) data.swasth_dependents = list(f.family).filter(plainObject);
    if ('refills' in f) data.swasth_refills = plainObject(f.refills) ? f.refills : {};
    if ('doseHistory' in f) data.swasth_medStatus = medStatusFrom(list(f.doseHistory));
    if (s) {
      Object.entries(HEALTH_VAULT_SETTINGS).forEach(([name, key]) => { if (name in s) data[key] = s[name]; });
    } else if (Array.isArray(f.prescriptions)) {
      data.swasth_prescriptions = f.prescriptions.map(r => ({ id: r.id, date: text(r.authoredOn), doctor: text(r.requester?.display), medicines: list(r.medications) }));
    }
    // The medicines list the app shows comes from here; keep it matching the profile.
    if (data.swasth_profile_medications == null) data.swasth_profile_medications = list(profile.medications);
    return { profile, data, madeAt: f.generatedAt, full: !!s };
  }

  function summary(v){
    const count = (n, one, many) => `${n} ${n === 1 ? one : many}`;
    const p = v.profile, d = v.data;
    // As the app lists them: the profile's medicines and the latest prescription's.
    const rxMeds = list(list(d.swasth_prescriptions)[0]?.medicines);
    const medicines = new Set([...list(p.medications), ...rxMeds].map(m => medicationIdentityKey(m?.name || m?.medicine || '')).filter(Boolean));
    const rows = [
      ['Name', text(p.name) || 'Not set'],
      ['Conditions', count(list(p.conditions).length, 'condition', 'conditions')],
      ['Medicines', count(medicines.size, 'medicine', 'medicines')],
      ['Allergies', count(list(p.allergies).filter(a => a !== '__NONE__').length + list(p.normalAllergies).filter(a => a !== '__NONE__').length, 'allergy', 'allergies')],
      ['Prescriptions', 'swasth_prescriptions' in d ? count(list(d.swasth_prescriptions).length, 'prescription', 'prescriptions') : null],
      ['Visits and lab reports', count(list(p.visits).length + list(p.reports).length, 'record', 'records')],
      ['Vitals', 'swasth_vitals' in d ? count(d.swasth_vitals.length, 'reading', 'readings') : null],
      ['Doses taken', 'swasth_medStatus' in d ? count(d.swasth_medStatus.history.length, 'dose', 'doses') : null],
      ['Food log', 'swasth_foodLogs' in d ? count(d.swasth_foodLogs.length, 'meal', 'meals') : null],
      ['Family', 'swasth_dependents' in d ? count(d.swasth_dependents.length, 'person', 'people') : null],
    ];
    return rows.filter(([, value]) => value !== null);
  }

  function panel(){ return document.getElementById('restoreHealthPanel'); }
  function closePanel(){ pending = null; const el = panel(); if (el) { el.hidden = true; el.innerHTML = ''; } }

  function showPreview(v, fileName){
    const el = panel(); if (!el) return;
    pending = v;
    const made = v.madeAt && !Number.isNaN(new Date(v.madeAt).getTime()) ? new Date(v.madeAt).toLocaleString([], { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'an unknown date';
    el.innerHTML = `<h3 class="card-title">Restore from ${escapeHtml(fileName)}?</h3>
      <p class="card-sub">Made on ${escapeHtml(made)}. It holds:</p>
      <dl class="restore-summary">${summary(v).map(([k, value]) => `<div><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('')}</dl>
      ${v.full ? '' : '<p class="t-meta">This file was made by an earlier version of SwasthID, so it has no vitals log, dose history, food log or family. Those stay as they are.</p>'}
      <p class="restore-warning"><b>This replaces your current record</b> with the one in the file${firebaseUser ? ', on every device you use' : ''}. If you might need what is there now, download it first.</p>
      <div class="restore-actions">
        <button type="button" class="btn btn-danger" data-restore-confirm>Replace my record</button>
        <button type="button" class="btn" data-restore-backup>Download current record</button>
        <button type="button" class="btn" data-restore-cancel>Cancel</button>
      </div>`;
    el.hidden = false;
    el.querySelector('[data-restore-confirm]').addEventListener('click', applyPending);
    el.querySelector('[data-restore-backup]').addEventListener('click', () => document.getElementById('exportHealthJsonBtn')?.click());
    el.querySelector('[data-restore-cancel]').addEventListener('click', () => { closePanel(); setHealthShareStatus('Restore cancelled. Nothing was changed.'); });
    el.scrollIntoView?.({ block: 'nearest' });
    el.querySelector('[data-restore-confirm]').focus();
  }

  async function applyPending(){
    const v = pending; if (!v) return;
    const btn = panel()?.querySelector('[data-restore-confirm]'); if (btn) btn.disabled = true;
    try {
      // This account stays the owner; everything else comes from the file.
      const keep = {};
      ['ownerUid', 'ownerEmail', 'email'].forEach(k => { if (patientData[k] !== undefined) keep[k] = patientData[k]; });
      Object.keys(patientData).forEach(k => delete patientData[k]);
      Object.assign(patientData, v.profile, keep);
      const uid = firebaseUser?.uid || '';
      Object.entries(v.data).forEach(([key, value]) => {
        if (key === 'swasth_dependents') value = value.map(({ ownerUid, ...person }) => uid ? { ...person, ownerUid: uid } : person);
        if (value === null || value === undefined) localStorage.removeItem(key);
        else localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
      });
      let saved = await syncProfileToCloud();
      if (!saved) cacheProfileLocally();
      for (const key of Object.keys(v.data)) saved = (await syncCloudState(key)) !== false && saved;
      closePanel();
      renderPersonalizedUI();
      ['renderAllRecords', 'renderTodayMedications', 'renderMedicationInsights', 'renderVitals', 'renderTodayStats']
        .forEach(name => { try { window[name]?.(); } catch (e) { console.warn(e); } });
      window.refreshDoseReminders?.();
      setHealthShareStatus(firebaseUser && !saved ? 'Record restored on this device, but not all of it could be saved to your account yet. It will be saved when you are back online.' : 'Record restored from the file.');
      showToast('', 'Record restored', `${text(patientData.name) || 'Your record'} is back from the Health Vault file.`);
    } catch (e) {
      console.error('Restore failed:', e);
      setHealthShareStatus('Could not restore: ' + (e?.message || 'unknown error'), true);
      if (btn) btn.disabled = false;
    }
  }

  async function onFileChosen(input){
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    closePanel();
    try {
      if (file.size > MAX_BYTES) throw new Error('This file is too large to be a Health Vault file.');
      let json;
      try { json = JSON.parse(await file.text()); } catch (_) { throw new Error('This file could not be read. Choose the .json file from "Download file".'); }
      showPreview(readVault(json), file.name);
      setHealthShareStatus('');
    } catch (e) {
      setHealthShareStatus(e.message, true);
    }
  }

  const input = document.getElementById('restoreHealthJsonInput');
  document.getElementById('restoreHealthJsonBtn')?.addEventListener('click', () => input?.click());
  input?.addEventListener('change', () => onFileChosen(input));
  window.readHealthVault = readVault;
})();
