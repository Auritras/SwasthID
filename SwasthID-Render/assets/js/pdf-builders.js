/* Emergency card: one A4 page for the fridge or a bag, with a fold-over
   wallet card to cut out. Drug allergies lead because they change treatment. */
function buildEmergencyPdf(jsPDF) {
  const { C, fmtDate, ageFrom, clean } = SwasthPdf;
  const today = fmtDate(new Date());
  const pdf = SwasthPdf.create(jsPDF, {
    header: (api, first) => {
      const { doc, M, W } = api;
      if (first) {
        api.logo(M, 12.5, 8);
        api.text('SwasthID', M + 11, 16.8, { size: 11, bold: true });
        api.text('Emergency health card', M + 11, 21, { size: 8.5, color: C.text3 });
        api.text('In an emergency, call 112', W - M, 18.5, { size: 11, bold: true, color: C.danger, align: 'right' });
        api.rule(26); api.y = 33;
      } else { api.y = 20; }
    },
    footer: (api, i, n) => {
      const { M, W, H } = api;
      api.text(`Made by the patient in SwasthID on ${today}. Not a diagnosis; confirm details when you can.`, M, H - 9, { size: 7.5, color: C.text3 });
      if (n > 1) api.text(`Page ${i} of ${n}`, W - M, H - 9, { size: 7.5, color: C.text3, align: 'right' });
    }
  });
  const { doc, M, W, H, CW } = pdf;

  const payload = getEmergencyCompactPayload();
  const contact = getEmergencyContact();
  const visibility = safeJsonParse(localStorage.getItem('swasth_emergencyVisibility') || '{}', {});
  const coreShown = visibility.core !== false;
  const meds = visibility.meds === false ? [] : getEmergencyMedicines();
  const conditions = Array.isArray(payload.c) ? payload.c : [];
  const bloodGroup = coreShown && patientData.bloodGroup ? clean(patientData.bloodGroup) : '';
  const drugAllergies = coreShown ? normalizeAllergies(patientData.allergies).join(', ') : '';
  const otherAllergies = coreShown ? normalizeNormalAllergies(patientData.normalAllergies).join(', ') : '';
  const insurance = Array.isArray(payload.ins) ? payload.ins.filter(Boolean).join(' · ') : '';
  const age = ageFrom(patientData.dob);

  // Name, age and a blood-group tile on the right.
  const nameW = CW - 40;
  const nameH = pdf.text(payload.n, M, pdf.y + 7, { size: 22, bold: true, maxW: nameW, lh: 1.2 });
  const meta = [age != null ? `Age ${age}` : '', patientData.dob ? `Born ${fmtDate(patientData.dob)}` : ''].filter(Boolean).join(' · ');
  if (meta) pdf.text(meta, M, pdf.y + 7 + nameH + 3, { size: 10.5, color: C.text2 });
  doc.setFillColor(...C.soft); doc.setDrawColor(...C.border); doc.roundedRect(W - M - 34, pdf.y, 34, 20, 2, 2, 'FD');
  pdf.text('BLOOD GROUP', W - M - 17, pdf.y + 6, { size: 7, bold: true, color: C.text3, align: 'center' });
  pdf.text(bloodGroup || 'Not given', W - M - 17, pdf.y + 15, { size: bloodGroup ? 17 : 10, bold: !!bloodGroup, align: 'center' });
  pdf.y += Math.max(22, 7 + nameH + (meta ? 8 : 0)) + 4;

  if (coreShown) pdf.allergyBox(drugAllergies, otherAllergies);

  // Left column: conditions and medicines. Right column: contact and QR.
  const top = pdf.y, gap = 8, leftW = CW * 0.58, rightX = M + leftW + gap, rightW = CW - leftW - gap;
  let ly = top;
  pdf.text('Ongoing conditions', M, ly + 4, { size: 10.5, bold: true }); ly += 8;
  if (conditions.length) conditions.forEach(c => { ly += pdf.text(`•  ${c}`, M, ly + 3.2, { size: 10, maxW: leftW }) + 2.2; });
  else { ly += pdf.text('None recorded', M, ly + 3.2, { size: 10, color: C.text2 }) + 2.2; }
  ly += 5;
  pdf.text('Daily medicines', M, ly + 4, { size: 10.5, bold: true }); ly += 8;
  if (meds.length) {
    meds.forEach(m => {
      const name = clean(m.name || m.medicine), detail = [m.dose, m.schedule || m.frequency].map(clean).filter(Boolean).join(' · ');
      const h1 = pdf.text(name, M, ly + 3.2, { size: 10, bold: true, maxW: leftW * 0.45 });
      const h2 = detail ? pdf.text(detail, M + leftW * 0.47, ly + 3.2, { size: 10, color: C.text2, maxW: leftW * 0.53 }) : 0;
      ly += Math.max(h1, h2) + 2.2;
      doc.setDrawColor(...C.border); doc.line(M, ly, M + leftW, ly); ly += 2;
    });
  } else { ly += pdf.text(visibility.meds === false ? 'Not included (privacy setting)' : 'None recorded', M, ly + 3.2, { size: 10, color: C.text2 }) + 2.2; }

  let ry = top;
  const contactLines = [clean(contact.name), clean(contact.relation)].filter(Boolean);
  const boxH = 9 + (contactLines[0] ? 6 : 0) + (contactLines[1] ? 5 : 0) + (contact.phone ? 7 : 0) + (contactLines.length || contact.phone ? 0 : 6);
  doc.setFillColor(...C.soft); doc.setDrawColor(...C.border); doc.roundedRect(rightX, ry, rightW, boxH, 2, 2, 'FD');
  pdf.text('EMERGENCY CONTACT', rightX + 4, ry + 6, { size: 7, bold: true, color: C.text3 });
  let cy = ry + 12;
  if (contactLines[0]) { pdf.text(contactLines[0], rightX + 4, cy, { size: 11, bold: true, maxW: rightW - 8, maxLines: 1 }); cy += 5; }
  if (contactLines[1]) { pdf.text(contactLines[1], rightX + 4, cy, { size: 9.5, color: C.text2, maxW: rightW - 8, maxLines: 1 }); cy += 6.5; }
  if (contact.phone) pdf.text(clean(contact.phone), rightX + 4, cy, { size: 12, bold: true, color: C.brand, maxW: rightW - 8, maxLines: 1 });
  if (!contactLines.length && !contact.phone) pdf.text('Not added', rightX + 4, cy, { size: 10, color: C.text2 });
  ry += boxH + 5;
  if (insurance) {
    pdf.text('HEALTH INSURANCE', rightX, ry + 3, { size: 7, bold: true, color: C.text3 });
    ry += 5 + pdf.text(insurance, rightX, ry + 7.5, { size: 9.5, maxW: rightW }) + 5;
  }

  let qrData = null;
  const qrEl = document.querySelector('#realQrContainer canvas, #realQrContainer img');
  try {
    const src = qrEl ? (qrEl.tagName.toLowerCase() === 'canvas' ? qrEl.toDataURL('image/png') : qrEl.src) : '';
    if (src && src !== 'data:,') qrData = src;
  } catch (err) { console.warn('QR could not be read for the PDF:', err); }
  const expiry = Number(localStorage.getItem('swasth_emergencyExpiresAt') || 0);
  if (qrData) {
    const s = Math.min(40, rightW - 8);
    doc.setFillColor(...C.white); doc.setDrawColor(...C.border); doc.roundedRect(rightX, ry, rightW, s + 22, 2, 2, 'FD');
    doc.addImage(qrData, 'PNG', rightX + (rightW - s) / 2, ry + 4, s, s);
    pdf.text('Scan for the live, read-only emergency view', rightX + rightW / 2, ry + s + 9, { size: 8, align: 'center', maxW: rightW - 6 });
    if (expiry > Date.now()) pdf.text(`Works until ${fmtDate(expiry)} unless revoked`, rightX + rightW / 2, ry + s + 17, { size: 7.5, color: C.text3, align: 'center', maxW: rightW - 6 });
    ry += s + 22 + 4;
  } else {
    ry += pdf.text('The QR code was not ready. Open Care > Emergency card in SwasthID to show it.', rightX, ry + 3.2, { size: 8.5, color: C.text3, maxW: rightW }) + 4;
  }
  pdf.y = Math.max(ly, ry) + 6;

  // Wallet card: front and back side by side, joined at the fold.
  const cw = 85.6, ch = 54, x0 = (W - 2 * cw) / 2;
  let wy = H - 18 - ch - 4;
  if (pdf.y > wy - 10) { pdf.newPage(); wy = pdf.y + 8; }
  pdf.text('Wallet card: cut along the dashed line, fold in the middle and keep it with you.', W / 2, wy - 3.5, { size: 8, color: C.text3, align: 'center' });
  doc.setLineDashPattern([1.6, 1.2], 0); doc.setDrawColor(...C.text3); doc.setLineWidth(0.25);
  doc.rect(x0, wy, cw * 2, ch);
  doc.setDrawColor(...C.border); doc.line(x0 + cw, wy, x0 + cw, wy + ch);
  doc.setLineDashPattern([], 0); doc.setLineWidth(0.2);

  // Front
  doc.setFillColor(...C.brand); doc.rect(x0 + 0.3, wy + 0.3, cw - 0.6, 9, 'F');
  pdf.text('SwasthID  ·  Emergency card', x0 + 4, wy + 6, { size: 8, bold: true, color: C.white });
  pdf.text('Call 112', x0 + cw - 4, wy + 6, { size: 8, bold: true, color: C.white, align: 'right' });
  pdf.text(payload.n, x0 + 4, wy + 16, { size: 11.5, bold: true, maxW: cw - 30, maxLines: 1 });
  if (age != null) pdf.text(`Age ${age}`, x0 + 4, wy + 20.5, { size: 8, color: C.text2 });
  doc.setFillColor(...C.soft); doc.setDrawColor(...C.border); doc.roundedRect(x0 + cw - 22, wy + 12, 18, 12, 1.5, 1.5, 'FD');
  pdf.text('BLOOD', x0 + cw - 13, wy + 15.8, { size: 5.5, bold: true, color: C.text3, align: 'center' });
  pdf.text(bloodGroup || '?', x0 + cw - 13, wy + 21.5, { size: 11, bold: true, align: 'center' });
  pdf.text('DRUG ALLERGIES', x0 + 4, wy + 28.5, { size: 6, bold: true, color: drugAllergies ? C.danger : C.text3 });
  pdf.text(drugAllergies || 'No known drug allergies', x0 + 4, wy + 32.8, { size: 9, bold: !!drugAllergies, color: drugAllergies ? C.danger : C.text, maxW: cw - 8, maxLines: 2, lh: 1.3 });
  pdf.text('CONDITIONS', x0 + 4, wy + 43, { size: 6, bold: true, color: C.text3 });
  pdf.text(conditions.join(', ') || 'None recorded', x0 + 4, wy + 47, { size: 8, maxW: cw - 8, maxLines: 2, lh: 1.3 });

  // Back
  const x1 = x0 + cw, qs = 22, textW = qrData ? cw - 8 - qs - 3 : cw - 8;
  pdf.text('EMERGENCY CONTACT', x1 + 4, wy + 6.5, { size: 6, bold: true, color: C.text3 });
  pdf.text(contactLines[0] || 'Not added', x1 + 4, wy + 11.5, { size: 10, bold: true, maxW: textW, maxLines: 1 });
  if (contactLines[1]) pdf.text(contactLines[1], x1 + 4, wy + 15.5, { size: 8, color: C.text2, maxW: textW, maxLines: 1 });
  if (contact.phone) pdf.text(clean(contact.phone), x1 + 4, wy + 21, { size: 10.5, bold: true, color: C.brand, maxW: textW, maxLines: 1 });
  if (qrData) {
    doc.addImage(qrData, 'PNG', x1 + cw - 4 - qs, wy + 4, qs, qs);
    pdf.text('Scan for details', x1 + cw - 4 - qs / 2, wy + 29, { size: 5.5, color: C.text3, align: 'center' });
  }
  pdf.text('DAILY MEDICINES', x1 + 4, wy + 34, { size: 6, bold: true, color: C.text3 });
  const medLine = meds.map(m => [m.name || m.medicine, m.dose].map(clean).filter(Boolean).join(' ')).join(', ');
  pdf.text(medLine || (visibility.meds === false ? 'Not included' : 'None recorded'), x1 + 4, wy + 38.3, { size: 8, maxW: cw - 8, maxLines: 3, lh: 1.3 });

  pdf.finish();
  return { doc, qrEmbedded: !!qrData, filename: `SwasthID-Emergency-${SwasthPdf.fileSafe(payload.n) || 'Card'}.pdf` };
}

/* Health summary for a doctor: the essentials first (allergies, medicines,
   conditions), then measurements, lab results and visits as tables. */
function buildHealthSummaryPdf(jsPDF) {
  const { C, fmtDate, ageFrom, clean, toDate } = SwasthPdf;
  const p = patientData || {};
  const today = fmtDate(new Date());
  const name = clean(p.name) || 'Patient';
  const pdf = SwasthPdf.create(jsPDF, {
    header: (api, first) => {
      const { M, W } = api;
      if (first) {
        api.logo(M, 12.5, 8);
        api.text('SwasthID', M + 11, 16.8, { size: 11, bold: true });
        api.text('Health summary', M + 11, 21, { size: 8.5, color: C.text3 });
        api.text(`Prepared ${today}`, W - M, 18.5, { size: 8.5, color: C.text3, align: 'right' });
        api.rule(26); api.y = 33;
      } else {
        api.logo(M, 9.5, 5);
        api.text(`Health summary · ${name}`, M + 7.5, 13.3, { size: 8.5, color: C.text2, maxW: 120, maxLines: 1 });
        if (p.dob) api.text(`Born ${fmtDate(p.dob)}`, W - M, 13.3, { size: 8.5, color: C.text3, align: 'right' });
        api.rule(17); api.y = 23;
      }
    },
    footer: (api, i, n) => {
      const { M, W, H } = api;
      api.rule(H - 13);
      api.text(`Compiled by the patient in SwasthID on ${today}. For information; not a diagnosis.`, M, H - 9, { size: 7.5, color: C.text3 });
      api.text(`Page ${i} of ${n}`, W - M, H - 9, { size: 7.5, color: C.text3, align: 'right' });
    }
  });
  const { M, CW } = pdf;

  const age = ageFrom(p.dob);
  pdf.y += pdf.text(name, M, pdf.y + 7, { size: 20, bold: true, maxW: CW, lh: 1.2 }) + 5;
  const meta = [age != null ? `Age ${age}` : '', p.dob ? `Born ${fmtDate(p.dob)}` : '', p.bloodGroup ? `Blood group ${clean(p.bloodGroup)}` : ''].filter(Boolean).join('  ·  ');
  if (meta) pdf.y += pdf.text(meta, M, pdf.y + 4, { size: 10.5, color: C.text2 }) + 3;
  pdf.y += pdf.text('Compiled from information the patient entered or scanned into SwasthID. Please confirm important details with the patient.', M, pdf.y + 3.5, { size: 8.5, color: C.text3, maxW: CW }) + 5;

  pdf.allergyBox(normalizeAllergies(p.allergies).join(', '), normalizeNormalAllergies(p.normalAllergies).join(', '));

  const meds = typeof getCurrentMedicationList === 'function' ? getCurrentMedicationList() : (Array.isArray(p.medications) ? p.medications : []);
  pdf.section('Current medicines');
  if (meds.length) pdf.table(
    [{ label: 'Medicine', w: 0.3, bold: true }, { label: 'Dose', w: 0.16 }, { label: 'When', w: 0.24 }, { label: 'Notes', w: 0.3 }],
    meds.map(m => [clean(m.name || m.medicine), clean(m.dose), clean(m.frequency || m.schedule) + (Array.isArray(m.times) && m.times.length ? ` (${m.times.join(', ')})` : ''), clean(m.instructions)]));
  else pdf.note('None recorded.');

  const conditions = Array.isArray(p.conditions) ? p.conditions.filter(c => clean(c.name)) : [];
  pdf.section('Conditions');
  if (conditions.length) pdf.table(
    [{ label: 'Condition', w: 0.34, bold: true }, { label: 'Status', w: 0.16 }, { label: 'Since', w: 0.12 }, { label: 'Notes', w: 0.38 }],
    conditions.map(c => [clean(c.name), clean(c.status), clean(c.year), clean(c.details || c.note)]));
  else pdf.note('None recorded.');

  // Latest reading of each vital with a 30-day overview.
  const V = window.swasthVitals;
  if (V) {
    const rows = [];
    const since = Date.now() - 30 * 864e5;
    Object.entries(V.TYPES).forEach(([type, t]) => {
      const list = V.byType(type); if (!list.length) return;
      const last = list[list.length - 1], a = V.assess(last);
      const recent = list.filter(r => new Date(r.at).getTime() >= since);
      let overview = '';
      if (recent.length > 1) {
        const avg = f => Math.round(recent.reduce((s, r) => s + Number(r[f]), 0) / recent.length);
        if (type === 'bp') overview = `Average ${avg('sys')}/${avg('dia')} over ${recent.length} readings`;
        else if (type === 'glucose') { const v = recent.map(r => Number(r.glucose)); overview = `${Math.min(...v)}–${Math.max(...v)} mg/dL over ${recent.length} readings`; }
        else if (type === 'weight') { const d = Number(recent[recent.length - 1].weight) - Number(recent[0].weight); overview = Math.abs(d) < 0.05 ? 'No change' : `${d > 0 ? 'Up' : 'Down'} ${Math.abs(d).toFixed(1)} kg`; }
        else { overview = `Lowest ${Math.min(...recent.map(r => Number(r.spo2)))}% over ${recent.length} readings`; }
      } else overview = recent.length ? 'One reading' : 'No readings in 30 days';
      const notes = [a.label && a.level !== 'none' ? a.label : '', type === 'glucose' ? (V.GLUCOSE_CONTEXT[last.context] || '').toLowerCase() : ''].filter(Boolean);
      const status = notes.length ? ` · ${notes.join(', ')}` : '';
      rows.push([t.title.replace(/\s*\(SpO₂\)/, ' (SpO2)'), `${V.valueText(last)} ${t.unit}${status}`, fmtDate(last.at), overview]);
    });
    if (rows.length) {
      pdf.section('Latest vitals');
      pdf.table([{ label: 'Measure', w: 0.22, bold: true }, { label: 'Latest', w: 0.3 }, { label: 'Date', w: 0.16 }, { label: 'Last 30 days', w: 0.32 }], rows);
    }
  }

  // Lab results: latest value of each test, compared with the one before.
  const groups = typeof extractLabTrendPoints === 'function' ? extractLabTrendPoints() : {};
  const labRows = Object.entries(groups).map(([test, g]) => {
    const pts = g.points, last = pts[pts.length - 1], prev = pts[pts.length - 2];
    const unit = g.unit ? ` ${g.unit}` : '';
    let change = '';
    if (prev) { const d = last.value - prev.value; const n = Math.abs(d).toFixed(2).replace(/\.?0+$/, ''); change = d === 0 ? 'No change' : `${d > 0 ? 'Up' : 'Down'} ${n}`; }
    return [test, `${last.value}${unit}`, fmtDate(last.date), prev ? `${prev.value}${unit} on ${fmtDate(prev.date)}` : '', change];
  });
  if (labRows.length) {
    pdf.section('Lab results');
    pdf.table([{ label: 'Test', w: 0.22, bold: true }, { label: 'Latest', w: 0.18 }, { label: 'Date', w: 0.16 }, { label: 'Previous', w: 0.28 }, { label: 'Change', w: 0.16 }], labRows);
  }

  // Reports whose values couldn't be read into the table above.
  const reports = (Array.isArray(p.reports) ? p.reports : []).filter(r => !(Array.isArray(r.values) && r.values.length) && !(typeof parseLabValues === 'function' && parseLabValues(r.result).length));
  if (reports.length) {
    pdf.section('Other reports');
    pdf.table([{ label: 'Date', w: 0.18 }, { label: 'Report', w: 0.3, bold: true }, { label: 'Result', w: 0.52 }],
      reports.sort((a, b) => (toDate(b.date) || 0) - (toDate(a.date) || 0)).slice(0, 15).map(r => [fmtDate(r.date), clean(r.name), clean(r.result)]));
  }

  const visits = (Array.isArray(p.visits) ? p.visits : []).slice().sort((a, b) => (toDate(b.date) || 0) - (toDate(a.date) || 0)).slice(0, 10);
  if (visits.length) {
    pdf.section('Recent visits');
    pdf.table([{ label: 'Date', w: 0.18 }, { label: 'Doctor', w: 0.28, bold: true }, { label: 'Specialty', w: 0.24 }, { label: 'Facility', w: 0.3 }],
      visits.map(v => [fmtDate(v.date), clean(v.doctor || v.provider), clean(v.specialty), clean(v.facility)]));
  }

  const vit = p.vitals || {}, life = p.lifestyle || {};
  const body = [['Height', vit.height ? `${clean(vit.height)} cm` : ''], ['Weight', vit.weight ? `${clean(vit.weight)} kg` : ''], ['BMI', clean(vit.bmi)], ['Smoking', clean(life.smoking)], ['Alcohol', clean(life.alcohol)]];
  if (body.some(([, v]) => v)) { pdf.section('Body and lifestyle'); pdf.facts(body); }

  const ec = p.emergencyContact || {};
  if (clean(ec.name) || clean(ec.phone)) { pdf.section('Emergency contact'); pdf.facts([['Name', clean(ec.name)], ['Relation', clean(ec.relation)], ['Phone', clean(ec.phone)]]); }

  pdf.finish();
  return { doc: pdf.doc, filename: `SwasthID-Health-Summary-${SwasthPdf.fileSafe(name) || 'Patient'}.pdf` };
}
