/* Dose reminders.
   1. Notifications at each dose time. When the server has push reminders set
      up (a Cloudflare Worker, see SwasthID-Push-Worker/) and the user is
      logged in, they arrive even when SwasthID is closed. Otherwise they come
      from timers here, while SwasthID is open (also in a background tab).
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
    const options = { body, icon: '/assets/icon-192.png', badge: '/assets/badge-96.png', tag: `swasth-dose-${current.index}-${current.unit}`, renotify: true };
    try {
      const reg = await navigator.serviceWorker?.getRegistration();
      if (reg) return reg.showNotification(title, options);
      new Notification(title, options);
    } catch (e) { console.warn('Dose reminder could not be shown:', e); }
  }

  // ---- reminders when SwasthID is closed (Web Push) ----
  // The server hands this browser's dose times (never medicine names) to a
  // small always-on service that sends a push at each one. The service
  // worker then reads which medicines are due from the copy saved here.
  const PUSH_KEY = 'swasth_pushReminders';
  const PUSH_SYNC_KEY = 'swasth_pushSynced';
  const TAKEN_SENT_KEY = 'swasth_pushTakenSent';
  const STATE_CACHE = 'swasth-state';
  const DOSES_URL = '/__swasth/doses.json';
  const QUEUE_URL = '/__swasth/taken-queue.json';
  let pushConfigPromise = null;
  let pushSyncTimer = null;
  let pushUpgradeTried = false;

  const apiBase = () => (window.SWASTH_API_BASE || location.origin).replace(/\/$/, '');
  const signedInUser = () => (typeof firebaseUser !== 'undefined' && firebaseUser) || null;
  const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window;
  const pushOn = () => localStorage.getItem(PUSH_KEY) === 'on' && enabled();
  function pushConfig(){
    return pushConfigPromise ||= fetch(apiBase() + '/api/push/config', { cache: 'no-store' })
      .then(r => r.ok ? r.json() : { enabled: false }).catch(() => ({ enabled: false }));
  }
  function keyBytes(b64){
    const s = b64.replace(/-/g, '+').replace(/_/g, '/');
    return Uint8Array.from(atob(s + '='.repeat((4 - s.length % 4) % 4)), c => c.charCodeAt(0));
  }
  function localDateKey(date){ return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`; }

  // When a dose repeats: weekday bits (bit 0 = Sunday) and, for monthly
  // medicines, the day of the month.
  function doseRule(d){
    if (d.type === 'days') return { days: medicationDays(d.m).reduce((mask, n) => mask | (1 << n), 0), monthDay: null };
    if (d.type === 'weekly' || d.type === 'monthly') {
      const date = new Date();
      for (let i = 0; i < 31; i++, date.setDate(date.getDate() + 1)) {
        if (medicationExpectedOnDate(d.m, date)) return d.type === 'weekly' ? { days: 1 << date.getDay(), monthDay: null } : { days: 127, monthDay: date.getDate() };
      }
      return null;
    }
    return { days: 127, monthDay: null };
  }

  // The schedule for the service worker, with what is already taken today,
  // how much is left in each pack, and where to send Taken and Snooze.
  async function saveDoseSnapshot(){
    if (!('caches' in window)) return;
    const today = localDateKey(new Date());
    const cfg = localStorage.getItem(PUSH_KEY) === 'on' ? await pushConfig() : {};
    try {
      const cache = await caches.open(STATE_CACHE);
      // Marked Taken on a notification but not recorded yet (see applyNotificationTaken).
      const queued = await cache.match(QUEUE_URL).then(r => r ? r.json() : []).catch(() => []);
      const queuedToday = new Set((Array.isArray(queued) ? queued : []).filter(q => q.day === today).flatMap(q => q.times || []));
      const doses = doseSchedule().map(d => {
        const rule = doseRule(d);
        return rule && {
          time: d.time, ...rule, label: doseLabel(d), detail: d.count > 1 ? `Dose ${d.unit + 1} of ${d.count}` : '',
          takenOn: takenToday(d.index, d.unit) || queuedToday.has(d.time) ? today : null,
          refill: medicationIdentityKey(d.m.medicine), units: parseMedicationDoseCount(d.m)
        };
      }).filter(Boolean);
      const refills = window.medicationRefillSnapshot?.() || [];
      await cache.put(DOSES_URL, new Response(JSON.stringify({ doses, refills, workerUrl: cfg.workerUrl || '' }), { headers: { 'Content-Type': 'application/json' } }));
    } catch (e) { console.warn('Could not save the dose schedule for reminders:', e); }
  }

  // Doses marked Taken on a notification while SwasthID was closed: the
  // service worker queues them, and they are recorded here (at the time the
  // button was tapped) once this account's records have loaded.
  let applying = null;
  function takenOnDay(id, day){
    const history = safeJsonParse(localStorage.getItem('swasth_medStatus') || '{}', {}).history || [];
    return history.some(e => e?.taken && e.id === id && localDateKey(new Date(e.date)) === day);
  }
  function applyNotificationTaken(){
    return applying ||= (async () => {
      if (!('caches' in window) || typeof window.recordMedicationTaken !== 'function') return 0;
      if (signedInUser() && typeof cloudSyncReady !== 'undefined' && !cloudSyncReady) return 0;
      const schedule = doseSchedule();
      if (!schedule.length) return 0;
      const cache = await caches.open(STATE_CACHE);
      const queue = await cache.match(QUEUE_URL).then(r => r ? r.json() : null).catch(() => null);
      if (!Array.isArray(queue) || !queue.length) return 0;
      await cache.delete(QUEUE_URL);
      let added = 0;
      for (const entry of queue) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(entry?.day || '') || !Array.isArray(entry.times)) continue;
        const [y, mo, da] = entry.day.split('-').map(Number);
        const date = new Date(y, mo - 1, da);
        schedule.forEach(d => {
          if (!entry.times.includes(d.time) || !medicationExpectedOnDate(d.m, date)) return;
          const id = medicationScheduleKey(d.index, d.unit);
          if (takenOnDay(id, entry.day)) return;
          // Tapped after midnight for yesterday's dose: file it under that day.
          let at = new Date(Number(entry.at) || Date.now());
          if (localDateKey(at) !== entry.day) { const [h, mi] = d.time.split(':').map(Number); at = new Date(y, mo - 1, da, h, mi); }
          window.recordMedicationTaken(id, d.m.medicine, at);
          added++;
        });
      }
      if (added) {
        ['renderTodayMedications', 'renderMedicationInsights', 'renderTodayStats', 'renderRecordMedicationActivity', 'renderRecordTimeline', 'renderCareJourney']
          .forEach(name => { try { window[name]?.(); } catch (e) { console.warn(e); } });
        showToast('', 'Doses recorded', `${added} dose${added === 1 ? '' : 's'} marked Taken from a reminder.`);
      }
      return added;
    })().finally(() => { applying = null; });
  }

  // Tell the reminder service which of today's dose times are fully taken, so
  // it doesn't nudge about them (on any of this account's devices).
  async function reportTaken(){
    const cfg = await pushConfig();
    if (!pushOn() || !cfg.workerUrl) return;
    const now = new Date(), day = localDateKey(now);
    const allTaken = new Map();
    doseSchedule().forEach(d => {
      if (medicationExpectedOnDate(d.m, now)) allTaken.set(d.time, (allTaken.get(d.time) ?? true) && takenToday(d.index, d.unit));
    });
    const times = [...allTaken].filter(([, taken]) => taken).map(([time]) => time).sort();
    const signature = `${day}|${times.join(',')}`;
    if (!times.length || localStorage.getItem(TAKEN_SENT_KEY) === signature) return;
    const sub = await pushSubscription(cfg.publicKey, { create: false });
    if (!sub) return;
    const res = await fetch(cfg.workerUrl + '/taken', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: sub.endpoint, day, times }) });
    if (res.ok) localStorage.setItem(TAKEN_SENT_KEY, signature);
  }

  async function pushCall(path, body){
    const user = signedInUser();
    if (!user) throw new Error('Log in to get reminders when SwasthID is closed.');
    const res = await fetch(apiBase() + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await user.getIdToken()}` },
      body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'The reminder service did not answer.');
    return data;
  }

  // This browser's push subscription, made with the server's current key.
  async function pushSubscription(publicKey, { create = true } = {}){
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    const key = keyBytes(publicKey);
    const current = sub?.options?.applicationServerKey && new Uint8Array(sub.options.applicationServerKey);
    if (sub && current && (current.length !== key.length || current.some((b, i) => b !== key[i]))) { await sub.unsubscribe(); sub = null; }
    if (!sub && create) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    return sub;
  }

  // Send the dose times to the server, if they changed since last time.
  async function syncPush(){
    const cfg = await pushConfig();
    const user = signedInUser();
    if (!pushOn() || !cfg.enabled || !user) return;
    const sub = await pushSubscription(cfg.publicKey);
    const doses = [];
    doseSchedule().forEach(d => {
      const rule = doseRule(d);
      if (rule && !doses.some(x => x.time === d.time && x.days === rule.days && x.monthDay === rule.monthDay)) doses.push({ time: d.time, ...rule });
    });
    // keys: so the reminder service can say which dose a push is about, in a
    // message only this browser can read.
    const keys = sub.toJSON?.().keys;
    const payload = { endpoint: sub.endpoint, tz: Intl.DateTimeFormat().resolvedOptions().timeZone, doses: doses.slice(0, 48), ...(keys ? { keys } : {}) };
    const signature = JSON.stringify([user.uid, payload]);
    if (localStorage.getItem(PUSH_SYNC_KEY) === signature) return;
    await pushCall('/api/push/subscribe', payload);
    localStorage.setItem(PUSH_SYNC_KEY, signature);
  }
  function queuePushSync(){
    clearTimeout(pushSyncTimer);
    pushSyncTimer = setTimeout(() => syncPush().catch(e => console.warn('Dose reminder sync failed:', e.message)), 1500);
  }

  // Turn on reminders-when-closed if this browser, account and server can.
  // Returns true when they are on. Needs notification permission already.
  async function startPush(){
    const cfg = await pushConfig();
    if (!cfg.enabled || !pushSupported() || !signedInUser()) return false;
    try {
      localStorage.setItem(PUSH_KEY, 'on');
      localStorage.removeItem(PUSH_SYNC_KEY);
      await saveDoseSnapshot();
      await syncPush();
      return true;
    } catch (e) {
      console.warn('Reminders when closed could not be turned on:', e);
      localStorage.removeItem(PUSH_KEY);
      return false;
    }
  }

  async function stopPush(){
    const wasOn = localStorage.getItem(PUSH_KEY) === 'on';
    localStorage.removeItem(PUSH_KEY);
    localStorage.removeItem(PUSH_SYNC_KEY);
    localStorage.removeItem(TAKEN_SENT_KEY);
    try { await caches?.delete(STATE_CACHE); } catch (_) {}
    if (!wasOn || !pushSupported()) return;
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (!sub) return;
      await pushCall('/api/push/unsubscribe', { endpoint: sub.endpoint }).catch(e => console.warn('Could not remove reminders from the server:', e.message));
      await sub.unsubscribe();
    } catch (e) { console.warn('Could not turn off reminders when closed:', e); }
  }

  async function sendTestPush(){
    try {
      const cfg = await pushConfig();
      const sub = await pushSubscription(cfg.publicKey, { create: false });
      if (!sub) throw new Error('Reminders are not set up in this browser. Turn them off and on again.');
      await (await caches.open(STATE_CACHE)).put('/__swasth/push-test', new Response(String(Date.now())));
      await syncPush();
      await pushCall('/api/push/test', { endpoint: sub.endpoint });
      showToast('', 'Test sent', 'A notification should arrive in a few seconds. Try it again with SwasthID closed.');
    } catch (e) {
      showToast('', 'Test failed', e.message);
    }
  }

  function schedule(){
    timers.forEach(clearTimeout); timers = [];
    if (!enabled()) return;
    applyNotificationTaken().catch(e => console.warn('Could not record doses taken from a reminder:', e)).then(() => {
      saveDoseSnapshot();
      if (pushOn()) reportTaken().catch(e => console.warn('Could not tell the reminder service a dose was taken:', e.message));
    });
    // The push service reminds at dose times, open or closed; timers here
    // would only repeat them.
    if (localStorage.getItem(PUSH_KEY) === 'on') { queuePushSync(); return; }
    // Upgrade: reminders were turned on before this browser could get pushes
    // (or before logging in). Permission is already granted, so no prompt.
    if (!pushUpgradeTried && signedInUser() && pushSupported()) {
      pushUpgradeTried = true;
      startPush().then(on => { if (on) { schedule(); render(); } });
    }
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
    // Keeps the setting across reloads of this account (see cloud-sync.js).
    if (signedInUser()) localStorage.setItem('swasth_remindersOwner', signedInUser().uid);
    pushUpgradeTried = true;
    const closedToo = await startPush();
    schedule(); render();
    showToast('', 'Dose reminders on', closedToo
      ? 'You will be notified at each dose time, even when SwasthID is closed.'
      : 'You will be notified at each dose time while SwasthID is open.');
  }
  async function turnOff(){ localStorage.removeItem(PREF_KEY); await stopPush(); schedule(); render(); }

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

  // ---- "Reminders on" chip next to Today's medicines ----
  // While reminders are off, the bar under the list invites turning them on.
  // Once on, the bar goes away and this chip holds status and options.
  function setReminderMenu(open){
    const chip = document.getElementById('reminderChip'), menu = document.getElementById('reminderMenu');
    if (!chip || !menu) return;
    chip.setAttribute('aria-expanded', String(open));
    menu.classList.toggle('open', open);
    if (open) menu.querySelector('[role="menuitem"]:not([hidden])')?.focus();
  }
  function bindReminderMenu(){
    const chip = document.getElementById('reminderChip'), menu = document.getElementById('reminderMenu');
    if (!chip || !menu || chip.dataset.bound) return;
    chip.dataset.bound = '1';
    chip.addEventListener('click', e => { e.stopPropagation(); setReminderMenu(chip.getAttribute('aria-expanded') !== 'true'); });
    document.addEventListener('click', e => { if (!e.target.closest('#reminderStatus')) setReminderMenu(false); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && chip.getAttribute('aria-expanded') === 'true') { setReminderMenu(false); chip.focus(); } });
    menu.querySelector('[data-reminder-test]').addEventListener('click', () => { setReminderMenu(false); sendTestPush(); });
    menu.querySelector('[data-reminder-calendar]').addEventListener('click', () => { setReminderMenu(false); downloadCalendar(); });
    menu.querySelector('[data-reminder-off]').addEventListener('click', () => { setReminderMenu(false); turnOff(); });
  }

  function render(){
    const bar = document.getElementById('doseReminderBar'); if (!bar) return;
    const statusEl = document.getElementById('reminderStatus');
    const doses = doseSchedule();
    const on = enabled();
    if (statusEl) statusEl.hidden = !(on && doses.length);
    if (!doses.length || on) {
      bar.innerHTML = ''; bar.style.display = 'none';
      if (on && doses.length) renderReminderChip();
      return;
    }
    bar.style.display = '';
    const closedToo = pushOn();
    const blocked = supported() && Notification.permission === 'denied';
    // iPhones and iPads get pushes only in the Home Screen app.
    const iOSTab = !pushSupported() && (/iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent)));
    const status = closedToo ? 'On. You\'ll get a notification at each dose time, even when SwasthID is closed.'
      : on ? 'On. You\'ll get a notification at each dose time while SwasthID is open.'
      : blocked ? 'Notifications are blocked for this site in your browser settings.'
      : !supported() ? 'This browser can\'t show notifications here.'
      : 'Get a notification at each dose time.';
    const hint = closedToo ? ''
      : iOSTab ? ' To be reminded when it\'s closed, add SwasthID to your Home Screen (Share, then Add to Home Screen) and turn reminders on there, or add your doses to your calendar.'
      : ' To be reminded when it\'s closed, add your doses to your calendar.';
    bar.innerHTML = `<div class="reminder-bar-text"><b>Dose reminders</b><span>${escapeHtml(status + hint)}</span></div>
      <div class="reminder-bar-actions">${supported() && !blocked ? `<button type="button" class="btn btn-sm${on ? '' : ' btn-primary'}" data-reminder-toggle>${on ? 'Turn off' : 'Turn on'}</button>` : ''}${closedToo ? '<button type="button" class="btn btn-sm" data-reminder-test>Send a test</button>' : ''}<button type="button" class="btn btn-sm" data-reminder-calendar>Add to calendar</button></div>`;
    bar.querySelector('[data-reminder-toggle]')?.addEventListener('click', () => on ? turnOff() : turnOn());
    bar.querySelector('[data-reminder-test]')?.addEventListener('click', sendTestPush);
    bar.querySelector('[data-reminder-calendar]')?.addEventListener('click', downloadCalendar);
  }

  function renderReminderChip(){
    bindReminderMenu();
    const closedToo = pushOn();
    const iOSTab = !pushSupported() && (/iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent)));
    const chip = document.getElementById('reminderChip');
    chip.classList.toggle('is-open-only', !closedToo);
    chip.title = closedToo ? 'Reminders arrive even when SwasthID is closed' : 'Reminders arrive only while SwasthID is open';
    document.getElementById('reminderMenuStatus').textContent = closedToo
      ? 'On. You\'ll get a notification at each dose time, even when SwasthID is closed.'
      : 'On while SwasthID is open.' + (iOSTab
        ? ' To be reminded when it\'s closed, add SwasthID to your Home Screen (Share, then Add to Home Screen) and turn reminders on there, or add your doses to your calendar.'
        : ' To be reminded when it\'s closed, add your doses to your calendar.');
    document.querySelector('#reminderMenu [data-reminder-test]').hidden = !closedToo;
  }

  window.refreshDoseReminders = function(){ render(); schedule(); };
  window.buildDoseCalendar = buildCalendar;
  // On log out: this browser must stop getting this account's reminders.
  window.stopPushReminders = stopPush;
  if (localStorage.getItem(PREF_KEY) === 'on' && 'serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  // Taken tapped on a notification while SwasthID is open, or returning to it.
  navigator.serviceWorker?.addEventListener('message', e => { if (e.data?.type === 'swasth-taken') schedule(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && enabled()) schedule(); });
})();
