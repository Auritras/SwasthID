/* Dose reminders.
   1. Notifications while SwasthID is open (also in a background tab). A free
      Render server sleeps, so it cannot push reminders when the app is closed.
   2. A calendar file with a repeating event and alarm per dose, so the phone's
      calendar reminds the user even when SwasthID is closed. */
(function(){
  const PREF_KEY = 'swasth_doseReminders';
  let timers = [];

  function isAsNeeded(m){ return /as needed|prn|sos|when needed/i.test(`${m.frequency||''} ${m.schedule||''}`); }

  // Every scheduled dose: medicine, dose slot, time and repeat pattern.
  function doseSchedule(){
    const out = [];
    getCurrentMedicationList().forEach((m, index) => {
      if (!m?.medicine || isAsNeeded(m)) return;
      const count = medicationSlotCount(m);
      const times = suggestedMedicationTimes(m, count);
      for (let unit = 0; unit < count; unit++) {
        if (!/^\d{1,2}:\d{2}$/.test(times[unit] || '')) continue;
        out.push({ m, index, unit, count, time: times[unit], type: medicationFrequencyType(m) });
      }
    });
    return out;
  }

  function takenToday(index, unit){
    const status = safeJsonParse(localStorage.getItem('swasth_medStatus') || '{}', {});
    const s = status[medicationScheduleKey(index, unit)];
    return !!(s?.taken && s?.date && new Date(s.date).toDateString() === new Date().toDateString());
  }

  function doseLabel(d){ return `${d.m.medicine}${d.m.dose ? ' ' + d.m.dose : ''}`; }

  function supported(){ return 'Notification' in window; }
  function enabled(){ return localStorage.getItem(PREF_KEY) === 'on' && supported() && Notification.permission === 'granted'; }

  async function showDoseNotification(d){
    // Re-read the schedule: the dose may have been marked taken or changed since.
    const current = doseSchedule().find(x => medicationIdentityKey(x.m.medicine) === medicationIdentityKey(d.m.medicine) && x.unit === d.unit);
    if (!current || !enabled() || takenToday(current.index, current.unit)) return;
    const title = `Time for ${doseLabel(current)}`;
    const body = `${current.count > 1 ? `Dose ${current.unit + 1} of ${current.count} · ` : ''}${formatMedicationTime(current.time)}. Open SwasthID to mark it taken.`;
    const options = { body, tag: `swasth-dose-${current.index}-${current.unit}`, renotify: true };
    try {
      const reg = await navigator.serviceWorker?.getRegistration();
      if (reg) return reg.showNotification(title, options);
      new Notification(title, options);
    } catch (e) { console.warn('Dose reminder could not be shown:', e); }
  }

  function schedule(){
    timers.forEach(clearTimeout); timers = [];
    if (!enabled()) return;
    const now = new Date();
    doseSchedule().forEach(d => {
      if (!medicationExpectedOnDate(d.m, now)) return;
      const [h, min] = d.time.split(':').map(Number);
      const at = new Date(now); at.setHours(h, min, 0, 0);
      const ms = at - now;
      if (ms > 0 && !takenToday(d.index, d.unit)) timers.push(setTimeout(() => showDoseNotification(d), ms));
    });
    // Plan the next day's reminders just after midnight.
    const midnight = new Date(now); midnight.setHours(24, 1, 0, 0);
    timers.push(setTimeout(schedule, midnight - now));
  }

  async function turnOn(){
    if (!supported()) { showToast('', 'Notifications not available', 'This browser cannot show notifications here. Add the reminders to your calendar instead.'); return; }
    const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
    if (permission !== 'granted') { showToast('', 'Notifications blocked', 'Allow notifications for this site in your browser settings, or add the reminders to your calendar.'); render(); return; }
    try { await navigator.serviceWorker?.register('/sw.js'); } catch (e) { console.warn('Service worker registration failed:', e); }
    localStorage.setItem(PREF_KEY, 'on');
    schedule(); render();
    showToast('', 'Dose reminders on', 'You will be notified at each dose time while SwasthID is open.');
  }
  function turnOff(){ localStorage.removeItem(PREF_KEY); schedule(); render(); }

  // ---- calendar file ----
  const pad = n => String(n).padStart(2, '0');
  const icsText = t => String(t).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');
  function courseLength(m){
    const match = String(m.instructions || '').match(/for (\d+) (day|week|month)s?/i);
    if (!match) return null;
    const n = Number(match[1]);
    return match[2].toLowerCase() === 'day' ? n : match[2].toLowerCase() === 'week' ? n * 7 : n * 30;
  }
  function buildCalendar(){
    const now = new Date();
    const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
    const days = ['SU','MO','TU','WE','TH','FR','SA'];
    const events = doseSchedule().map(d => {
      const [h, min] = d.time.split(':').map(Number);
      const start = new Date(now); start.setHours(h, min, 0, 0);
      if (d.type !== 'daily') { while (!medicationExpectedOnDate(d.m, start)) start.setDate(start.getDate() + 1); }
      const dt = `${start.getFullYear()}${pad(start.getMonth() + 1)}${pad(start.getDate())}T${pad(h)}${pad(min)}00`;
      let rule = 'FREQ=DAILY';
      if (d.type === 'days') rule = `FREQ=WEEKLY;BYDAY=${medicationDays(d.m).map(n => days[n]).join(',')}`;
      if (d.type === 'weekly') rule = `FREQ=WEEKLY;BYDAY=${days[start.getDay()]}`;
      if (d.type === 'monthly') rule = `FREQ=MONTHLY;BYMONTHDAY=${start.getDate()}`;
      const course = d.type === 'daily' ? courseLength(d.m) : null;
      if (course) rule += `;COUNT=${course}`;
      const summary = `Take ${doseLabel(d)}`;
      const note = [d.count > 1 ? `Dose ${d.unit + 1} of ${d.count}` : '', medicationScheduleText(d.m), d.m.instructions, 'From SwasthID.'].filter(Boolean).join(' · ');
      return ['BEGIN:VEVENT', `UID:swasthid-${ensureMedicationStableId(d.m)}-${d.unit}@swasthid`, `DTSTAMP:${stamp}`, `DTSTART:${dt}`, 'DURATION:PT10M', `RRULE:${rule}`,
        `SUMMARY:${icsText(summary)}`, `DESCRIPTION:${icsText(note)}`,
        'BEGIN:VALARM', 'ACTION:DISPLAY', 'TRIGGER:PT0M', `DESCRIPTION:${icsText(summary)}`, 'END:VALARM', 'END:VEVENT'].join('\r\n');
    });
    // Calendar lines longer than 75 octets must be folded (RFC 5545).
    const fold = line => { const out = []; let cur = ''; for (const ch of line) { if (new TextEncoder().encode(cur + ch).length > (out.length ? 74 : 75)) { out.push(cur); cur = ''; } cur += ch; } out.push(cur); return out.join('\r\n '); };
    return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//SwasthID//Dose reminders//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', ...events, 'END:VCALENDAR'].join('\r\n').split('\r\n').map(fold).join('\r\n') + '\r\n';
  }
  function downloadCalendar(){
    if (!doseSchedule().length) { showToast('', 'No doses to add', 'Add medicines with dose times first.'); return; }
    const blob = new Blob([buildCalendar()], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), { href: url, download: 'SwasthID-dose-reminders.ics' });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    showToast('', 'Calendar file ready', 'Open it to add a repeating reminder for each dose to your calendar.');
  }

  function render(){
    const bar = document.getElementById('doseReminderBar'); if (!bar) return;
    const doses = doseSchedule();
    if (!doses.length) { bar.innerHTML = ''; bar.style.display = 'none'; return; }
    bar.style.display = '';
    const on = enabled();
    const blocked = supported() && Notification.permission === 'denied';
    const status = on ? 'On. You\'ll get a notification at each dose time while SwasthID is open.'
      : blocked ? 'Notifications are blocked for this site in your browser settings.'
      : !supported() ? 'This browser can\'t show notifications here.'
      : 'Get a notification at each dose time while SwasthID is open.';
    bar.innerHTML = `<div class="reminder-bar-text"><b>Dose reminders</b><span>${escapeHtml(status)} To be reminded when it's closed, add your doses to your calendar.</span></div>
      <div class="reminder-bar-actions">${supported() && !blocked ? `<button type="button" class="btn btn-sm${on ? '' : ' btn-primary'}" data-reminder-toggle>${on ? 'Turn off' : 'Turn on'}</button>` : ''}<button type="button" class="btn btn-sm" data-reminder-calendar>Add to calendar</button></div>`;
    bar.querySelector('[data-reminder-toggle]')?.addEventListener('click', () => on ? turnOff() : turnOn());
    bar.querySelector('[data-reminder-calendar]')?.addEventListener('click', downloadCalendar);
  }

  window.refreshDoseReminders = function(){ render(); schedule(); };
  window.buildDoseCalendar = buildCalendar;
  if (localStorage.getItem(PREF_KEY) === 'on' && 'serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
})();
