/* =========================================================
 REAL GEOLOCATION-BASED NEARBY HOSPITAL FINDER
========================================================= */
function haversineKm(lat1, lon1, lat2, lon2) {
 const R = 6371;
 const dLat = (lat2 - lat1) * Math.PI / 180;
 const dLon = (lon2 - lon1) * Math.PI / 180;
 const a = Math.sin(dLat / 2) ** 2 +
 Math.cos(lat1 * Math.PI / 180) *
 Math.cos(lat2 * Math.PI / 180) *
 Math.sin(dLon / 2) ** 2;
 return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function overpassBbox(lat, lon, km) {
 const dLat = km / 111.32, dLon = km / (111.32 * Math.max(0.1, Math.cos(lat * Math.PI / 180)));
 return [lat - dLat, lon - dLon, lat + dLat, lon + dLon].map(v => v.toFixed(5)).join(',');
}

async function fetchNearbyHospitals(lat, lon) {
 const safeLat = Number(lat);
 const safeLon = Number(lon);
 if(!Number.isFinite(safeLat) || !Number.isFinite(safeLon)) throw new Error('Invalid location coordinates.');

 // Keep the query intentionally small. Public Overpass servers can be busy, and
 // a broad unbounded healthcare query is much more likely to time out.
 // The bounding box lets the map servers use their spatial index, so the
 // name and brand patterns only run over places within ~10 km.
 const query = `[out:json][timeout:25][bbox:${overpassBbox(safeLat, safeLon, 10)}];
 (
   nwr["amenity"="hospital"](around:10000,${safeLat},${safeLon});
   nwr["amenity"~"^(clinic|doctors)$"](around:5000,${safeLat},${safeLon});
   nwr["healthcare"~"^(hospital|clinic|doctor|centre|center|polyclinic)$"](around:5000,${safeLat},${safeLon});
   nwr["amenity"="pharmacy"](around:3000,${safeLat},${safeLon});
   nwr["healthcare"="pharmacy"](around:3000,${safeLat},${safeLon});
   nwr["amenity"="pharmacy"]["name"~"aushadh|generic|amrit",i];
   nwr["amenity"="pharmacy"]["brand"~"aushadh|generic|amrit",i];
 );
 out center tags qt;`;

 // Ask our own server first (it identifies itself to the map servers and
 // caches answers); if that fails, ask the public servers straight from here.
 let data;
 const reasons = [];
 try {
   data = await fetchNearbyViaServer(safeLat, safeLon);
 } catch(serverErr) {
   reasons.push(...(serverErr.reasons || [`SwasthID server: ${serverErr.message}`]));
   try {
     data = await queryOverpass(query);
   } catch(directErr) {
     reasons.push(...(directErr.reasons || [directErr.message]));
     const e = new Error('All nearby healthcare services failed');
     e.reasons = reasons;
     throw e;
   }
 }
 const seen = new Set();
 const results = (data.elements || [])
   .map(el => {
     const elLat = el.lat ?? el.center?.lat;
     const elLon = el.lon ?? el.center?.lon;
     const tags = el.tags || {};
     if(elLat == null || elLon == null || !tags.name) return null;
     const latNum = Number(elLat), lonNum = Number(elLon);
     if(!Number.isFinite(latNum) || !Number.isFinite(lonNum)) return null;
     const key = `${String(tags.name).toLowerCase()}|${latNum.toFixed(5)}|${lonNum.toFixed(5)}`;
     if(seen.has(key)) return null;
     seen.add(key);
     const amenity = String(tags.amenity || '').toLowerCase();
     const healthcare = String(tags.healthcare || '').toLowerCase();
     const pharmacy = amenity === 'pharmacy' || healthcare === 'pharmacy';
     const storeText = `${tags.name} ${tags.brand || ''} ${tags.operator || ''}`;
     const janAushadhi = pharmacy && /jan\s*-?\s*aushadh|janaushadh|\bpmbj[kp]\b|\bbppi\b/i.test(storeText);
     return {
       id: el.id,
       name: tags.name,
       lat: latNum,
       lon: lonNum,
       dist: haversineKm(safeLat, safeLon, latNum, lonNum),
       type: pharmacy ? 'Pharmacy' :
             amenity === 'hospital' || healthcare === 'hospital' ? 'Hospital' :
             amenity === 'clinic' || healthcare === 'clinic' || healthcare === 'polyclinic' ? 'Clinic' :
             amenity === 'doctors' || healthcare === 'doctor' ? 'Doctor' : 'Healthcare centre',
       emergency: !pharmacy && (tags.emergency === 'yes' || tags.emergency === '24/7'),
       // Generic-medicine stores: Jan Aushadhi Kendras (PMBJP), AMRIT pharmacies (not
       // every "Amrit Medical"), and stores that say "generic" in their name or brand.
       generic: pharmacy && (janAushadhi || /\bgeneric\b|\bamrit\s+(?:pharmacy|deendayal)\b/i.test(storeText)),
       janAushadhi,
       open24: String(tags.opening_hours || '').trim() === '24/7',
       govt: !pharmacy && /^(government|public)$/i.test(tags['operator:type'] || tags.operator_type || '') ||
             /\b(government|govt|district hospital|state general hospital|sub[- ]?divisional hospital|primary health cent(?:re|er)|community health cent(?:re|er)|phc|chc|esi|esic)\b/i.test(`${tags.operator || ''} ${tags.name}`),
       phone: tags.phone || tags['contact:phone'] || null,
       address: tags['addr:full'] || [[tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' '), tags['addr:suburb'] || tags['addr:city']].filter(Boolean).join(', ')
     };
   })
   .filter(Boolean)
   .sort((a,b) => a.dist - b.dist);
 // Clinics and doctors' chambers are dense in cities; never let them push
 // every hospital off the list. Keep the 3 nearest hospitals, then fill up.
 // Pharmacies are chosen separately so they don't crowd out care either:
 // the 3 nearest generic-medicine stores (searched up to 10 km) and the 8
 // nearest other pharmacies.
 const care = results.filter(p => p.type !== 'Pharmacy');
 const nearestHospitals = care.filter(p => p.type === 'Hospital').slice(0, 3);
 const others = care.filter(p => !nearestHospitals.includes(p)).slice(0, 12 - nearestHospitals.length);
 const generics = results.filter(p => p.generic).slice(0, 3);
 const pharmacies = results.filter(p => p.type === 'Pharmacy' && !p.generic).slice(0, 8);
 return [...nearestHospitals, ...others, ...generics, ...pharmacies].sort((a,b) => a.dist - b.dist);
}

async function fetchNearbyViaServer(lat, lon) {
 const controller = new AbortController();
 const timer = setTimeout(() => controller.abort(), 40000);
 try {
   const res = await fetch(`/api/nearby?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`, { signal:controller.signal });
   const body = await res.json().catch(() => ({}));
   if(!res.ok || !Array.isArray(body.elements)) {
     const e = new Error(res.status === 404 ? 'this server build has no nearby search yet (redeploy it)' : body.error || `HTTP ${res.status}`);
     if(Array.isArray(body.reasons)) e.reasons = body.reasons.map(r => `via server, ${r}`);
     throw e;
   }
   return body;
 } catch(err) {
   if(err.name === 'AbortError') throw new Error('SwasthID server: no answer in 40 s');
   throw err;
 } finally {
   clearTimeout(timer);
 }
}

// Public Overpass mirrors. Each is free but can be busy or rate-limit a shared
// mobile IP, so ask the first and bring in the next one if it fails or has not
// answered within a few seconds. The first good answer wins; the rest are cancelled.
const OVERPASS_ENDPOINTS = [
 'https://overpass-api.de/api/interpreter',
 'https://overpass.private.coffee/api/interpreter',
 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'
];
function queryOverpass(query, {hedgeMs=4000, timeoutMs=28000}={}) {
 return new Promise((resolve, reject) => {
   const controllers = [], errors = [];
   let next = 0, running = 0, done = false, hedgeTimer = null;
   const finish = () => { done = true; clearTimeout(hedgeTimer); controllers.forEach(c => c.abort()); };
   const start = () => {
     if(done || next >= OVERPASS_ENDPOINTS.length) return;
     const endpoint = OVERPASS_ENDPOINTS[next++];
     const controller = new AbortController(); controllers.push(controller);
     const timer = setTimeout(() => controller.abort(), timeoutMs);
     running++;
     clearTimeout(hedgeTimer); hedgeTimer = setTimeout(start, hedgeMs);
     fetch(`${endpoint}?data=${encodeURIComponent(query)}`, { signal:controller.signal, headers:{'Accept':'application/json'} })
       .then(async res => {
         if(!res.ok) throw new Error(`HTTP ${res.status}`);
         const data = await res.json();
         // A server that runs out of time still answers 200, with a "remark"
         // and a partial or empty list. Treat that as a failure, not "nothing nearby".
         if(data.remark && /error|timed out|out of memory/i.test(data.remark)) throw new Error(String(data.remark).slice(0, 120));
         if(!done) { finish(); resolve(data); }
       })
       .catch(err => {
         if(done) return;
         errors.push(`direct, ${new URL(endpoint).host}: ${err.name === 'AbortError' ? `no answer in ${timeoutMs / 1000} s` : err.message}`);
         console.warn(`Nearby healthcare endpoint failed: ${endpoint}`, err);
         if(next < OVERPASS_ENDPOINTS.length) start();
         else if(running === errors.length) {
           finish();
           const e = new Error('All map servers failed');
           e.reasons = errors;
           reject(e);
         }
       })
       .finally(() => clearTimeout(timer));
   };
   start();
 });
}

function requestNearbyPosition(highAccuracy=false) {
 return new Promise((resolve, reject) => {
   navigator.geolocation.getCurrentPosition(resolve, reject, {
     enableHighAccuracy: highAccuracy,
     timeout: highAccuracy ? 10000 : 8000,
     maximumAge: 60000
   });
 });
}

async function requestApproximateNetworkPosition() {
 const controller = new AbortController();
 const timer = setTimeout(() => controller.abort(), 6000);
 try {
   const res = await fetch('https://ipwho.is/', { signal:controller.signal, cache:'no-store' });
   if(!res.ok) throw new Error(`Network location HTTP ${res.status}`);
   const data = await res.json();
   const lat = Number(data.latitude), lon = Number(data.longitude);
   if(!data.success || !Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error('Network location was not available.');
   return { coords:{ latitude:lat, longitude:lon, accuracy:5000 }, approximate:true };
 } finally {
   clearTimeout(timer);
 }
}

function setNearbyLoading(isLoading) {
 const loading = document.getElementById('nearbyLoadingState');
 const fallback = document.getElementById('nearbyFallback');
 const list = document.getElementById('nearbyItemsList');
 if (loading) loading.style.display = isLoading ? 'block' : 'none';
 if (isLoading) {
   const note = document.getElementById('nearbyNote'); if (note) note.hidden = true;
   if (fallback) fallback.style.display = 'none';
   if (list) list.innerHTML = '';
 }
}

function showNearbyError(message, { title = 'Location unavailable', detail = '' } = {}) {
 setNearbyLoading(false);
 const note = document.getElementById('nearbyNote'); if (note) note.hidden = true;
 const titleEl = document.getElementById('nearbyFallbackTitle');
 if (titleEl) titleEl.textContent = title;
 const detailEl = document.getElementById('nearbyFallbackDetail');
 if (detailEl) { detailEl.textContent = detail; detailEl.hidden = !detail; }
 const fallback = document.getElementById('nearbyFallback');
 const list = document.getElementById('nearbyItemsList');
 if (list) list.innerHTML = '';
 if (fallback) {
   fallback.style.display = 'block';
   const msgEl = document.getElementById('nearbyFallbackMessage') || fallback.querySelector('div[style*="font-size:12px"]');
   if (msgEl) msgEl.textContent = message;
 }
}

let nearbyPlaces = [];
let nearbyFilter = 'all';
let nearbyShowAll = false;
const NEARBY_FILTERS = [
  ['all', 'All', () => true],
  ['hospital', 'Hospitals', p => p.type === 'Hospital'],
  ['clinic', 'Clinics & doctors', p => p.type !== 'Hospital' && p.type !== 'Pharmacy'],
  ['pharmacy', 'Pharmacies', p => p.type === 'Pharmacy'],
  ['generic', 'Generic medicines', p => p.generic],
  ['emergency', '24×7 emergency', p => p.emergency]
];

function renderNearbyList(hospitals, lat, lon) {
 setNearbyLoading(false);
 const fallback = document.getElementById('nearbyFallback');
 if (fallback) fallback.style.display = 'none';
 nearbyPlaces = Array.isArray(hospitals) ? hospitals : [];
 nearbyFilter = 'all'; nearbyShowAll = false;
 const subtitle = document.getElementById('nearbySubtitle');
 if (subtitle && nearbyPlaces.length) {
   const farthest = Math.max(...nearbyPlaces.map(p => Number(p.dist) || 0));
   subtitle.textContent = `${nearbyPlaces.length} ${nearbyPlaces.length === 1 ? 'place' : 'places'} within ${Math.max(1, Math.ceil(farthest))} km (straight-line distance), closest first.`;
 }
 renderNearbyPlaces();
}

function renderNearbyPlaces() {
 const list = document.getElementById('nearbyItemsList');
 if (!list) return;
 if (!nearbyPlaces.length) {
   list.innerHTML = '<div class="places-empty">No hospitals, clinics or pharmacies were found nearby. Try again from a different location.</div>';
   return;
 }
 const filters = NEARBY_FILTERS.filter(([key,,test]) => key === 'all' || nearbyPlaces.some(test));
 const test = (NEARBY_FILTERS.find(([key]) => key === nearbyFilter) || NEARBY_FILTERS[0])[2];
 const matches = nearbyPlaces.filter(test);
 const shown = nearbyShowAll ? matches : matches.slice(0, 6);
 const chips = filters.length > 2 ? `<div class="places-filters" role="group" aria-label="Filter places">${filters.map(([key, label, t]) =>
   `<button type="button" class="places-filter${key === nearbyFilter ? ' active' : ''}" data-nearby-filter="${key}" aria-pressed="${key === nearbyFilter}">${label} <span>${nearbyPlaces.filter(t).length}</span></button>`).join('')}</div>` : '';
 list.innerHTML = chips + '<div class="places-list">' + shown.map(h => {
   const km = Number(h.dist);
   const distance = km < 1 ? `${Math.round(km * 1000 / 10) * 10}<small>m</small>` : `${km.toFixed(1)}<small>km</small>`;
   const phone = h.phone ? String(h.phone).split(/[;,]/)[0].trim() : '';
   const tags = [h.emergency ? '<span class="place-tag er">24×7 emergency</span>' : '', h.govt ? '<span class="place-tag">Government</span>' : '',
     h.janAushadhi ? '<span class="place-tag generic">Jan Aushadhi · generic medicines</span>' : h.generic ? '<span class="place-tag generic">Generic medicines</span>' : '',
     h.open24 ? '<span class="place-tag">Open 24 hours</span>' : ''].join('');
   return `<div class="place-row">
     <div class="place-dist">${distance}</div>
     <div class="place-main">
       <div class="place-name">${escapeHtml(h.name)}</div>
       <div class="place-meta">${escapeHtml(h.type)}${h.address ? ' · ' + escapeHtml(h.address) : ''}</div>
       ${tags ? `<div class="place-tags">${tags}</div>` : ''}
     </div>
     <div class="place-actions">
       ${phone ? `<a class="btn" href="tel:${phone.replace(/[^+0-9]/g,'')}" aria-label="Call ${escapeHtml(h.name)}">Call</a>` : '<span class="place-action-gap" aria-hidden="true"></span>'}
       <a class="btn btn-primary" href="https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${h.lat},${h.lon}`)}" target="_blank" rel="noopener" aria-label="Directions to ${escapeHtml(h.name)}">Directions</a>
     </div>
   </div>`;
 }).join('') + '</div>' + (!nearbyShowAll && matches.length > shown.length ? `<button type="button" class="record-more-btn" data-nearby-more>Show all ${matches.length}</button>` : '');
 list.querySelectorAll('[data-nearby-filter]').forEach(btn => btn.addEventListener('click', () => { nearbyFilter = btn.dataset.nearbyFilter; nearbyShowAll = false; renderNearbyPlaces(); }));
 list.querySelector('[data-nearby-more]')?.addEventListener('click', () => { nearbyShowAll = true; renderNearbyPlaces(); });
}

// Last successful search, so a busy map server still leaves something useful.
// Stored on this device only and cleared on sign-out like other swasth_ keys.
const NEARBY_CACHE_KEY = 'swasth_nearbyCache';
function saveNearbyCache(lat, lon, places) {
 try { localStorage.setItem(NEARBY_CACHE_KEY, JSON.stringify({ lat, lon, at: Date.now(), places })); } catch(e) {}
}
function readNearbyCache(lat, lon) {
 try {
   const c = JSON.parse(localStorage.getItem(NEARBY_CACHE_KEY) || 'null');
   if(!c || !Array.isArray(c.places) || !c.places.length) return null;
   if(Date.now() - c.at > 30 * 864e5 || haversineKm(lat, lon, c.lat, c.lon) > 2) return null;
   const places = c.places.map(p => ({ ...p, dist: haversineKm(lat, lon, p.lat, p.lon) })).sort((x, y) => x.dist - y.dist);
   return { at: c.at, places };
 } catch(e) { return null; }
}

function setNearbyStatus(text) {
 const el = document.getElementById('nearbyLoadingText');
 if(el) el.textContent = text;
}

function formatAccuracy(m) {
 return m < 1000 ? `${Math.max(10, Math.round(m / 10) * 10)} m` : `${(m / 1000).toFixed(1)} km`;
}

// Watch the position for a few seconds and keep the most accurate fix. The
// first answer is usually a coarse Wi-Fi or cell-tower estimate; GPS comes a
// few seconds later. Stops as soon as a fix is within goodEnough metres.
function requestPrecisePosition({ goodEnough = 50, maxWait = 12000 } = {}) {
 return new Promise((resolve, reject) => {
   let best = null, done = false, id = null, timer = null;
   const finish = (fn, value) => {
     if(done) return; done = true;
     if(id != null) navigator.geolocation.clearWatch(id);
     clearTimeout(timer); fn(value);
   };
   id = navigator.geolocation.watchPosition(p => {
     if(!best || p.coords.accuracy < best.coords.accuracy) best = p;
     setNearbyStatus(`Finding your exact location… (within about ${formatAccuracy(best.coords.accuracy)} so far)`);
     if(p.coords.accuracy <= goodEnough) finish(resolve, best);
   }, err => {
     // Keep a fix we already have; only give up if there is nothing yet.
     if(err.code === 1 || !best) finish(reject, err);
   }, { enableHighAccuracy: true, maximumAge: 0, timeout: maxWait });
   timer = setTimeout(() => best ? finish(resolve, best) : finish(reject, { code: 3 }), maxWait);
 });
}

async function getNearbyPosition() {
 if(!navigator.geolocation) return requestApproximateNetworkPosition();
 try {
   return await requestPrecisePosition();
 } catch(firstErr) {
   if(firstErr?.code === 1) throw firstErr;
 }
 try {
   return await requestNearbyPosition(false);
 } catch(secondErr) {
   if(secondErr?.code === 1) throw secondErr;
   // If GPS/network browser positioning fails, use an approximate IP location
   // rather than leaving the feature completely unusable.
   try { return await requestApproximateNetworkPosition(); } catch(e) { throw secondErr; }
 }
}

async function loadNearbyHospitals() {
 const btn = document.getElementById('findNearbyBtn');
 if(btn?.getAttribute('aria-busy') === 'true') return;
 btn?.setAttribute('aria-busy', 'true'); btn?.classList.add('is-loading');
 setNearbyLoading(true);
 setNearbyStatus('Finding your location…');
 try {
   let pos;
   // Browsers don't start the location timeout until the permission prompt is
   // answered, and phones often show that prompt only as a small address-bar
   // icon. Say so after a few seconds, and fall back to an approximate network
   // location instead of waiting forever.
   const hintTimer = setTimeout(() => setNearbyStatus('Still finding your location. If your browser is asking for location access, allow it (look for a location icon in the address bar).'), 6000);
   let giveUpTimer;
   const waitTooLong = new Promise((resolve, reject) => { giveUpTimer = setTimeout(() => requestApproximateNetworkPosition().then(resolve, () => reject({ code: 3 })), 30000); });
   try {
     pos = await Promise.race([getNearbyPosition(), waitTooLong]);
   } catch(err) {
     console.error('Nearby location:', err);
     const messages = {
       1: 'Location permission was denied. Allow location access for SwasthID in your browser settings and try again.',
       2: 'Your location could not be determined, and an approximate network location was not available either.',
       3: 'Finding your location took too long, and an approximate network location was not available either. Try again.'
     };
     showNearbyError(messages[err?.code] || (navigator.geolocation ? 'Unable to determine your location. Please try again.' : 'This browser has no location service and approximate network location was unavailable.'));
     return;
   } finally {
     clearTimeout(hintTimer); clearTimeout(giveUpTimer);
   }

   const { latitude, longitude, accuracy } = pos.coords;
   const subtitle = document.getElementById('nearbySubtitle');
   // Say plainly when the position is coarse, since every distance depends on
   // it. Phones that were given "approximate" location blur it by 1–3 km;
   // computers without GPS estimate it from Wi-Fi.
   const onPhone = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
   const approxNote = pos.approximate
     ? 'This is based on your internet connection, which only gives your city, so distances may be off. Allow location access for an exact position.'
     : accuracy > 500
       ? `Your location is only accurate to about ${formatAccuracy(accuracy)}, so distances may be off. ` + (onPhone
         ? "For exact results, turn on precise location for your browser in your phone's settings, then try again."
         : 'Computers usually estimate location from Wi-Fi. For exact results, open SwasthID on your phone with location turned on.')
       : '';
   setNearbyStatus('Searching OpenStreetMap for places near you…');
   let places, cachedAt = null;
   try {
     places = await fetchNearbyHospitals(latitude, longitude);
     saveNearbyCache(latitude, longitude, places);
   } catch(err) {
     console.error('Nearby healthcare search:', err);
     const cached = readNearbyCache(latitude, longitude);
     if(!cached) {
       showNearbyError('The free OpenStreetMap map servers did not answer. Try again in a minute.', {
         title: 'Could not load nearby places',
         detail: err.reasons?.length ? `Details: ${err.reasons.join(' · ')}` : ''
       });
       return;
     }
     places = cached.places; cachedAt = cached.at;
   }
   renderNearbyList(places, latitude, longitude);
   if(subtitle && places.length) {
     subtitle.title = `Location accuracy: about ${formatAccuracy(accuracy || 5000)}${pos.approximate ? ' (network estimate)' : ''}`;
   }
   const cachedNote = cachedAt ? `Map servers are busy, so these are the places found on ${new Date(cachedAt).toLocaleDateString(undefined, { day:'numeric', month:'short' })}.` : '';
   const note = document.getElementById('nearbyNote');
   if(note && places.length) {
     note.textContent = [cachedNote, approxNote].filter(Boolean).join(' ');
     note.hidden = !note.textContent;
   }
 } finally {
   btn?.removeAttribute('aria-busy'); btn?.classList.remove('is-loading');
 }
}

document.getElementById('findNearbyBtn')?.addEventListener('click', loadNearbyHospitals);
document.getElementById('retryLocationBtn')?.addEventListener('click', loadNearbyHospitals);
