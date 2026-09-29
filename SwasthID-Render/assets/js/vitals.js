/* Vitals log: blood pressure, blood sugar, weight and SpO2, with reference
   ranges, small-multiple trend charts and Heart Risk pre-fill. */
(function(){
  const KEY = 'swasth_vitals';
  const TYPES = {
    bp: { title: 'Blood pressure', unit: 'mmHg' },
    glucose: { title: 'Blood sugar', unit: 'mg/dL' },
    weight: { title: 'Weight', unit: 'kg' },
    spo2: { title: 'Oxygen level (SpO₂)', unit: '%' }
  };
  const GLUCOSE_CONTEXT = { fasting: 'Fasting', 'after-meal': 'After a meal', random: 'Random' };

  function load(){ const v = safeJsonParse(localStorage.getItem(KEY) || '[]', []); return Array.isArray(v) ? v : []; }
  function save(list){ localStorage.setItem(KEY, JSON.stringify(list)); if (typeof syncCloudState === 'function') syncCloudState(KEY); }
  function byType(type){ return load().filter(r => r.type === type).sort((a, b) => new Date(a.at) - new Date(b.at)); }

  function valueText(r){
    if (r.type === 'bp') return `${r.sys}/${r.dia}`;
    if (r.type === 'weight') return Number(r.weight).toFixed(1);
    if (r.type === 'glucose') return String(r.glucose);
    return String(r.spo2);
  }

  // Adult reference ranges: AHA blood-pressure categories, ADA glucose ranges.
  function assess(r){
    if (r.type === 'bp') {
      if (r.sys >= 180 || r.dia >= 120) return { level: 'critical', label: 'Very high', advice: 'Seek medical help now if you have chest pain, breathlessness, weakness or trouble speaking.' };
      if (r.sys >= 140 || r.dia >= 90) return { level: 'serious', label: 'High (stage 2)' };
      if (r.sys >= 130 || r.dia >= 80) return { level: 'warning', label: 'High (stage 1)' };
      if (r.sys >= 120) return { level: 'warning', label: 'Elevated' };
      if (r.sys < 90 || r.dia < 60) return { level: 'warning', label: 'Low' };
      return { level: 'good', label: 'Normal' };
    }
    if (r.type === 'glucose') {
      if (r.glucose < 70) return { level: 'serious', label: 'Low', advice: 'If you feel shaky, sweaty or confused, take fast-acting sugar and seek help.' };
      if (r.context === 'fasting') {
        if (r.glucose >= 126) return { level: 'serious', label: 'High' };
        if (r.glucose >= 100) return { level: 'warning', label: 'Above normal' };
        return { level: 'good', label: 'Normal' };
      }
      if (r.glucose >= 200) return { level: 'serious', label: 'High' };
      if (r.glucose >= 140) return { level: 'warning', label: 'Above normal' };
      return { level: 'good', label: 'Normal' };
    }
    if (r.type === 'spo2') {
      if (r.spo2 < 92) return { level: 'critical', label: 'Low', advice: 'Contact a doctor promptly, sooner if you are breathless.' };
      if (r.spo2 < 95) return { level: 'warning', label: 'Below typical' };
      return { level: 'good', label: 'Typical' };
    }
    const h = Number.parseFloat(patientData.vitals?.height);
    if (h > 0) {
      const bmi = r.weight / Math.pow(h / 100, 2);
      return { level: 'none', label: `BMI ${bmi.toFixed(1)}` };
    }
    return { level: 'none', label: '' };
  }
  const STATUS_ICON = { good: '✓', warning: '!', serious: '!', critical: '!!' };
  function statusHtml(a){
    if (!a.label) return '';
    if (a.level === 'none') return `<span class="vital-status none">${escapeHtml(a.label)}</span>`;
    return `<span class="vital-status ${a.level}"><span aria-hidden="true">${STATUS_ICON[a.level]}</span> ${escapeHtml(a.label)}</span>`;
  }
  function when(at){ const d = new Date(at); return `${d.toLocaleDateString([], { day: 'numeric', month: 'short' })} · ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`; }

  // ---------- latest tiles ----------
  function renderLatest(){
    const el = document.getElementById('vitalsLatest'); if (!el) return;
    const tiles = Object.entries(TYPES).map(([type, t]) => {
      const list = byType(type); const r = list[list.length - 1];
      if (!r) return `<div class="vital-tile empty"><div class="vital-tile-label">${t.title}</div><div class="vital-tile-value">—</div><div class="vital-tile-meta">No readings yet</div></div>`;
      const a = assess(r);
      const extra = r.type === 'glucose' ? ` · ${GLUCOSE_CONTEXT[r.context] || ''}` : (r.pulse ? ` · pulse ${r.pulse}` : '');
      return `<div class="vital-tile"><div class="vital-tile-label">${t.title}</div><div class="vital-tile-value">${escapeHtml(valueText(r))} <small>${t.unit}</small></div>
        <div class="vital-tile-meta">${escapeHtml(when(r.at) + extra)}</div>${statusHtml(a)}${a.advice ? `<div class="vital-advice">${escapeHtml(a.advice)}</div>` : ''}</div>`;
    });
    el.innerHTML = tiles.join('');
  }

  // ---------- charts ----------
  function niceTicks(min, max, count = 4){
    if (min === max) { min -= 1; max += 1; }
    const span = max - min, step0 = span / count, mag = Math.pow(10, Math.floor(Math.log10(step0)));
    const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= step0) || 10 * mag;
    const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
    const ticks = []; for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v * 100) / 100);
    return ticks;
  }
  const svgNS = 'http://www.w3.org/2000/svg';
  function svgEl(tag, attrs){ const e = document.createElementNS(svgNS, tag); Object.entries(attrs || {}).forEach(([k, v]) => e.setAttribute(k, v)); return e; }

  function lineChart(container, { title, unit, series, readings, floor }){
    const card = document.createElement('div'); card.className = 'vital-chart';
    const head = document.createElement('div'); head.className = 'vital-chart-head';
    const h = document.createElement('h4'); h.textContent = `${title}, ${unit}`; head.appendChild(h);
    if (series.length > 1) {
      const legend = document.createElement('div'); legend.className = 'vital-legend';
      series.forEach(s => { const item = document.createElement('span'); const key = document.createElement('i'); key.style.background = `var(${s.color})`; item.appendChild(key); item.appendChild(document.createTextNode(s.name)); legend.appendChild(item); });
      head.appendChild(legend);
    }
    card.appendChild(head);
    container.appendChild(card);

    const W = Math.max(260, card.clientWidth - 32), H = 170, m = { t: 12, r: 44, b: 26, l: 40 };
    const times = readings.map(r => new Date(r.at).getTime());
    const t0 = Math.min(...times), t1 = Math.max(...times);
    const values = series.flatMap(s => readings.map(s.value));
    // A fixed floor keeps small, normal changes (e.g. SpO2 96-98%) from looking dramatic.
    const lo = floor ? Math.min(floor[0], ...values) : Math.min(...values);
    const hi = floor ? Math.max(floor[1], ...values) : Math.max(...values);
    const ticks = niceTicks(lo, hi);
    const y0 = ticks[0], y1 = ticks[ticks.length - 1];
    const x = t => readings.length === 1 ? m.l + (W - m.l - m.r) / 2 : m.l + (t - t0) / (t1 - t0 || 1) * (W - m.l - m.r);
    const y = v => m.t + (1 - (v - y0) / (y1 - y0 || 1)) * (H - m.t - m.b);

    const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img', tabindex: '0', 'aria-label': `${title} trend, ${readings.length} readings. Use the arrow keys to read each one.` });
    ticks.forEach(v => {
      svg.appendChild(svgEl('line', { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), class: 'vc-grid' }));
      const lbl = svgEl('text', { x: m.l - 6, y: y(v) + 4, 'text-anchor': 'end', class: 'vc-tick' }); lbl.textContent = v.toLocaleString(); svg.appendChild(lbl);
    });
    const fmtDate = t => new Date(t).toLocaleDateString([], { day: 'numeric', month: 'short' });
    [[t0, 'start'], [t1, 'end']].forEach(([t, anchor], i) => {
      if (i === 1 && t1 === t0) return;
      const lbl = svgEl('text', { x: x(t), y: H - 6, 'text-anchor': readings.length === 1 ? 'middle' : anchor, class: 'vc-tick' }); lbl.textContent = fmtDate(t); svg.appendChild(lbl);
    });
    series.forEach(s => {
      const pts = readings.map(r => `${x(new Date(r.at).getTime()).toFixed(1)},${y(s.value(r)).toFixed(1)}`);
      if (pts.length > 1) svg.appendChild(svgEl('polyline', { points: pts.join(' '), class: 'vc-line', style: `stroke:var(${s.color})` }));
      readings.forEach(r => svg.appendChild(svgEl('circle', { cx: x(new Date(r.at).getTime()), cy: y(s.value(r)), r: 4, class: 'vc-dot', style: `fill:var(${s.color})` })));
      const last = readings[readings.length - 1];
      const end = svgEl('text', { x: x(new Date(last.at).getTime()) + 8, y: y(s.value(last)) + 4, class: 'vc-end' }); end.textContent = s.fmt(s.value(last)); svg.appendChild(end);
    });
    const cross = svgEl('line', { y1: m.t, y2: H - m.b, class: 'vc-cross', visibility: 'hidden' }); svg.appendChild(cross);
    const hit = svgEl('rect', { x: m.l - 10, y: 0, width: W - m.l - m.r + 20, height: H, fill: 'transparent' }); svg.appendChild(hit);
    const plot = document.createElement('div'); plot.className = 'vital-chart-plot'; plot.appendChild(svg);
    const tip = document.createElement('div'); tip.className = 'vital-tip'; tip.hidden = true; plot.appendChild(tip);
    card.appendChild(plot);

    let current = readings.length - 1;
    function show(i){
      current = Math.max(0, Math.min(readings.length - 1, i));
      const r = readings[current], cx = x(new Date(r.at).getTime());
      cross.setAttribute('x1', cx); cross.setAttribute('x2', cx); cross.setAttribute('visibility', 'visible');
      tip.replaceChildren();
      series.forEach(s => {
        const row = document.createElement('div'); row.className = 'vital-tip-row';
        const key = document.createElement('i'); key.style.background = `var(${s.color})`;
        const b = document.createElement('b'); b.textContent = `${s.fmt(s.value(r))} ${unit}`;
        row.append(key, b, document.createTextNode(series.length > 1 ? ` ${s.name}` : ''));
        tip.appendChild(row);
      });
      const meta = document.createElement('div'); meta.className = 'vital-tip-meta';
      meta.textContent = when(r.at) + (r.type === 'glucose' ? ` · ${GLUCOSE_CONTEXT[r.context] || ''}` : '') + (r.note ? ` · ${r.note}` : '');
      tip.appendChild(meta);
      tip.hidden = false;
      const left = Math.min(Math.max(cx - 70, 0), W - 150);
      tip.style.left = `${left}px`;
    }
    function hide(){ cross.setAttribute('visibility', 'hidden'); tip.hidden = true; }
    hit.addEventListener('pointermove', e => {
      const rect = svg.getBoundingClientRect(); const px = (e.clientX - rect.left) * (W / rect.width);
      let best = 0; readings.forEach((r, i) => { if (Math.abs(x(new Date(r.at).getTime()) - px) < Math.abs(x(new Date(readings[best].at).getTime()) - px)) best = i; });
      show(best);
    });
    hit.addEventListener('pointerleave', hide);
    svg.addEventListener('focus', () => show(current));
    svg.addEventListener('blur', hide);
    svg.addEventListener('keydown', e => {
      if (e.key === 'ArrowLeft') { e.preventDefault(); show(current - 1); }
      if (e.key === 'ArrowRight') { e.preventDefault(); show(current + 1); }
    });
  }

  function renderCharts(){
    const el = document.getElementById('vitalsCharts'); if (!el) return;
    el.replaceChildren();
    const plan = [
      ['bp', [{ name: 'Systolic', color: '--viz-1', value: r => r.sys, fmt: v => String(v) }, { name: 'Diastolic', color: '--viz-2', value: r => r.dia, fmt: v => String(v) }]],
      ['glucose', [{ name: 'Blood sugar', color: '--viz-1', value: r => r.glucose, fmt: v => String(v) }]],
      ['weight', [{ name: 'Weight', color: '--viz-1', value: r => Number(r.weight), fmt: v => v.toFixed(1) }]],
      ['spo2', [{ name: 'SpO₂', color: '--viz-1', value: r => r.spo2, fmt: v => String(v) }]]
    ];
    let drawn = 0;
    plan.forEach(([type, series]) => {
      const readings = byType(type).slice(-30);
      if (!readings.length) return;
      drawn++;
      lineChart(el, { title: TYPES[type].title, unit: TYPES[type].unit, series, readings, floor: type === 'spo2' ? [90, 100] : null });
    });
    if (!drawn) el.innerHTML = '<div class="record-empty">Charts appear here once you add readings.</div>';
  }

  // ---------- list ----------
  let listDays = 7;
  function renderList(){
    const el = document.getElementById('vitalsList'); if (!el) return;
    const all = load().slice().sort((a, b) => new Date(b.at) - new Date(a.at));
    if (!all.length) { el.innerHTML = '<div class="record-empty">No readings yet. Add your first one above.</div>'; return; }
    const days = new Map();
    all.forEach(r => { const k = localDayKey(new Date(r.at)); if (!days.has(k)) days.set(k, []); days.get(k).push(r); });
    const dayEntries = [...days.entries()];
    el.innerHTML = dayEntries.slice(0, listDays).map(([k, items]) => `<div class="record-day"><div class="record-day-head"><span>${escapeHtml(new Date(`${k}T12:00:00`).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }))}</span><span>${items.length} ${items.length === 1 ? 'reading' : 'readings'}</span></div>` +
      items.map(r => {
        const a = assess(r);
        const detail = [r.type === 'glucose' ? GLUCOSE_CONTEXT[r.context] : '', r.pulse ? `pulse ${r.pulse}` : '', r.note].filter(Boolean).join(' · ');
        return `<div class="record-row vital-row"><span class="record-row-time">${escapeHtml(new Date(r.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }))}</span>
          <div class="record-row-main"><b>${escapeHtml(TYPES[r.type].title)}: ${escapeHtml(valueText(r))} ${TYPES[r.type].unit}</b>${detail ? `<span>${escapeHtml(detail)}</span>` : ''}</div>
          <span class="vital-row-end">${statusHtml(a)}<button type="button" class="vital-delete" data-vital-delete="${escapeHtml(r.id)}" aria-label="Delete this reading">Delete</button></span></div>`;
      }).join('') + '</div>').join('') + (dayEntries.length > listDays ? '<button type="button" class="record-more-btn" data-vitals-more>Show earlier days</button>' : '');
    el.querySelector('[data-vitals-more]')?.addEventListener('click', () => { listDays += 7; renderList(); });
    el.querySelectorAll('[data-vital-delete]').forEach(btn => btn.addEventListener('click', () => {
      if (!confirm('Delete this reading?')) return;
      save(load().filter(r => r.id !== btn.dataset.vitalDelete));
      render();
    }));
  }

  function render(){ renderLatest(); renderCharts(); renderList(); }

  // ---------- form ----------
  function selectedType(){ return document.querySelector('input[name="vitalType"]:checked')?.value || 'bp'; }
  function localInputValue(d){ const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; }
  function syncFields(){
    const type = selectedType();
    document.querySelectorAll('#vitalsForm .vf').forEach(f => { f.hidden = !f.dataset.for.split(' ').includes(type); });
    const whenInput = document.getElementById('vWhen'); if (whenInput && !whenInput.value) whenInput.value = localInputValue(new Date());
    document.getElementById('vitalsFormError').textContent = '';
  }
  function num(id){ const v = document.getElementById(id)?.value; return v === '' || v == null ? null : Number(v); }
  function submit(e){
    e.preventDefault();
    const type = selectedType(), err = document.getElementById('vitalsFormError');
    const at = document.getElementById('vWhen').value ? new Date(document.getElementById('vWhen').value) : new Date();
    if (Number.isNaN(at.getTime()) || at > new Date(Date.now() + 60000)) { err.textContent = 'Choose a date and time that is not in the future.'; return; }
    const r = { id: `v${Date.now()}${Math.random().toString(36).slice(2, 6)}`, type, at: at.toISOString() };
    const note = document.getElementById('vNote').value.trim(); if (note) r.note = note;
    const inRange = (v, lo, hi) => v !== null && Number.isFinite(v) && v >= lo && v <= hi;
    if (type === 'bp') {
      r.sys = num('vSys'); r.dia = num('vDia');
      if (!inRange(r.sys, 50, 260) || !inRange(r.dia, 30, 160)) { err.textContent = 'Enter systolic (50–260) and diastolic (30–160) values.'; return; }
      if (r.dia >= r.sys) { err.textContent = 'Systolic (the top number) should be higher than diastolic.'; return; }
    } else if (type === 'glucose') {
      r.glucose = num('vGlucose'); r.context = document.getElementById('vGlucoseCtx').value;
      if (!inRange(r.glucose, 20, 700)) { err.textContent = 'Enter a blood sugar value between 20 and 700 mg/dL.'; return; }
    } else if (type === 'weight') {
      r.weight = num('vWeight');
      if (!inRange(r.weight, 2, 350)) { err.textContent = 'Enter a weight between 2 and 350 kg.'; return; }
      r.weight = Math.round(r.weight * 10) / 10;
    } else {
      r.spo2 = num('vSpo2');
      if (!inRange(r.spo2, 50, 100)) { err.textContent = 'Enter an SpO₂ value between 50 and 100%.'; return; }
    }
    const pulse = num('vPulse');
    if ((type === 'bp' || type === 'spo2') && pulse !== null) {
      if (!inRange(pulse, 25, 250)) { err.textContent = 'Enter a pulse between 25 and 250, or leave it empty.'; return; }
      r.pulse = pulse;
    }
    save([...load(), r]);
    if (type === 'weight' && document.getElementById('vWeightProfile')?.checked) {
      const latest = byType('weight').pop();
      if (latest && latest.id === r.id) {
        patientData.vitals = { ...(patientData.vitals || {}), weight: String(r.weight) };
        if (typeof cacheProfileLocally === 'function') cacheProfileLocally();
        if (typeof syncProfileToCloud === 'function') syncProfileToCloud();
        if (typeof renderPersonalizedUI === 'function') renderPersonalizedUI();
      }
    }
    document.querySelectorAll('#vitalsForm input[type="number"], #vNote').forEach(i => { i.value = ''; });
    document.getElementById('vWhen').value = localInputValue(new Date());
    render();
    const a = assess(r);
    showToast('', 'Reading saved', `${TYPES[type].title}: ${valueText(r)} ${TYPES[type].unit}${a.label && a.level !== 'none' ? ` (${a.label})` : ''}.`);
  }

  // Heart Risk: offer the latest blood pressure when the field is empty.
  window.prefillRiskFromVitals = function(){
    const input = document.getElementById('riskSbpInput'); if (!input) return;
    const latest = byType('bp').pop();
    let note = document.getElementById('riskSbpFromVitals');
    if (!latest || input.value) { if (note && !latest) note.remove(); return; }
    input.value = latest.sys;
    if (!note) { note = document.createElement('div'); note.id = 'riskSbpFromVitals'; note.className = 'vital-prefill-note'; input.insertAdjacentElement('afterend', note); }
    note.textContent = `From your blood pressure reading on ${new Date(latest.at).toLocaleDateString([], { day: 'numeric', month: 'short' })}.`;
  };

  window.renderVitals = render;
  window.swasthVitals = { TYPES, GLUCOSE_CONTEXT, byType, assess, valueText };
  document.getElementById('vitalsForm')?.addEventListener('submit', submit);
  document.querySelectorAll('input[name="vitalType"]').forEach(r => r.addEventListener('change', syncFields));
  syncFields(); render();
  let resizeTimer; window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { if (document.getElementById('panel-vitals')?.classList.contains('active')) renderCharts(); }, 200); });
})();
