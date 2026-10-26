// Photo actions (SPEC §15, Phase 9), like Frameo's second quick-menu card: show this photo as
// Auto/Fit/Fill, Position, Comment, Hide, Delete. Also the position editor (drag the photo in its
// real place on the screen), the comment editor, and the Undo bar after Hide/Delete.

import {
  fillLayout, cropWith, MAX_ZOOM, viewFor, viewFromLook, viewRect, viewTransform, clampView, dragView, savedView,
  pinchView, pinchRatio, easeView, fitFillOf, zoomToSlider, sliderToZoom,
} from './lib/photo-core.js';

/** Position slider resolution (its value runs 0..SLIDER_STEPS, even steps in the photo's size). */
const SLIDER_STEPS = 400;

const MAX_COMMENT = 500;

const ICONS = {
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>',
  soundOn: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>',
  soundOff: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/></svg>',
  position: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 9h4V6h3l-5-5-5 5h3v3zm-1 1H6V7l-5 5 5 5v-3h3v-4zm14 2l-5-5v3h-3v4h3v3l5-5zm-9 3h-4v3H7l5 5 5-5h-3v-3z"/></svg>',
  comment: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21.99 4c0-1.1-.89-2-1.99-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14l4 4-.01-18zM18 14H6v-2h12v2zm0-3H6V9h12v2zm0-3H6V6h12v2z"/></svg>',
  hide: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z"/></svg>',
  location: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>',
  private: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/></svg>',
  delete: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>',
};

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

function textEl(tag, cls, s) {
  const e = el(tag, cls);
  e.textContent = s;
  return e;
}

async function request(path, method, body) {
  const res = await fetch(path, {
    method, cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
  return res.json();
}

/** Changes one photo's fit / crop / comment; resolves with the photo as saved. */
export function patchPhoto(id, body) {
  return request(`/api/media/${id}`, 'PATCH', body);
}

const PLACE_SIZES = [[60, '60 m (200 ft)'], [150, '150 m (500 ft)'], [300, '300 m (1,000 ft)']];

/** "47.6205, -122.3493" (also "47.6205 -122.3493") → { lat, lon }, or null. */
export function parseCoords(text) {
  const m = String(text || '').trim().match(/^(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const lat = Number(m[1]);
  const lon = Number(m[2]);
  if (!(lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) || (lat === 0 && lon === 0)) return null;
  return { lat, lon };
}

/** A row of quick-select buttons; `items` [{ value, label }]; onPick(value). Returns { el, set(value) }. */
function chips(items, onPick) {
  const row = el('div', 'ce-chips');
  let current = null;
  const buttons = items.map((it) => {
    const b = textEl('button', '', it.label);
    b.type = 'button';
    b.addEventListener('click', () => { set(it.value); onPick(it.value); });
    row.append(b);
    return [it.value, b];
  });
  const set = (v) => { current = v; buttons.forEach(([value, b]) => b.classList.toggle('on', value === current)); };
  return { el: row, set };
}

/** The card, veil, buttons, and inactivity shared by the location editors. */
function editorShell(o, title) {
  const veil = el('div', 'ce-veil');
  const card = el('div', 'ce-card');
  const error = textEl('div', 'ce-error', '');
  error.hidden = true;
  let closed = false;
  let stopTimer = () => {};
  const cleanups = [];
  const close = () => {
    if (closed) return;
    closed = true;
    stopTimer();
    cleanups.forEach((fn) => { try { fn(); } catch (e) { console.error('location editor: cleanup', e.message); } });
    if (document.activeElement) document.activeElement.blur();
    veil.remove();
    o.onClose();
  };
  const onCleanup = (fn) => cleanups.push(fn);
  const fail = (e) => { error.textContent = e.message; error.hidden = false; };
  const post = (path, body) => request(path, 'POST', { mediaId: o.slide.id, ...body });
  const bar = el('div', 'ce-bar');
  const button = (label, cls, onClick) => {
    const b = textEl('button', `pe-btn ${cls}`, label);
    b.type = 'button';
    b.addEventListener('click', onClick);
    bar.append(b);
    return b;
  };
  const head = el('div', 'ce-head');
  head.append(textEl('b', '', title));
  card.append(head);
  const open = (focusEl) => {
    card.append(error, bar);
    card.addEventListener('click', (e) => e.stopPropagation());
    veil.append(card);
    veil.addEventListener('click', close);
    document.body.append(veil);
    stopTimer = inactivity(veil, o.inactivityMs, close);
    if (focusEl) focusEl.focus();
  };
  return { card, bar, button, close, fail, post, open, error, onCleanup };
}

function lineInput(value, placeholder, maxLength = 40) {
  const i = el('input', 'ce-text ce-line');
  i.type = 'text';
  i.maxLength = maxLength;
  i.placeholder = placeholder;
  i.value = value || '';
  return i;
}

/**
 * Where something is: Address (search, sent to OpenStreetMap when Search is tapped) or Coordinates (typed).
 * onPick({lat, lon} | null) whenever the choice changes. Returns the element.
 */
function positionPicker(ui, onPick) {
  const wrap = el('div', 'ce-where');
  const addr = lineInput('', 'Street, town', 120);
  const results = el('div', 'ce-results');
  const search = textEl('button', 'pe-btn', 'Search');
  search.type = 'button';
  const runSearch = async () => {
    onPick(null);
    results.innerHTML = '';
    results.append(textEl('div', 'ce-note', 'Searching…'));
    try {
      const res = await fetch(`/api/places/address?q=${encodeURIComponent(addr.value.trim())}`, { cache: 'no-store' });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      const r = await res.json();
      results.innerHTML = '';
      if (!r.results.length) results.append(textEl('div', 'ce-note', 'Nothing found. Try the street and the town.'));
      const pick = chips(r.results.map((x, i) => ({ value: i, label: x.label })), (i) => onPick(r.results[i]));
      pick.el.classList.add('ce-list');
      results.append(pick.el);
    } catch (e) { results.innerHTML = ''; ui.fail(e); }
  };
  search.addEventListener('click', runSearch);
  addr.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); runSearch(); } });
  const addrRow = el('div', 'ce-inline');
  addrRow.append(addr, search);
  const addrPanel = el('div', 'ce-where');
  addrPanel.append(addrRow, textEl('div', 'ce-note', 'The address is sent to OpenStreetMap once to find it.'), results);

  const coords = lineInput('', 'For example 47.6205, -122.3493', 60);
  coords.addEventListener('input', () => onPick(parseCoords(coords.value)));
  const coordPanel = el('div', 'ce-where');
  coordPanel.append(coords);

  const tabs = chips([{ value: 'address', label: 'Address' }, { value: 'coords', label: 'Coordinates' }], (v) => {
    onPick(v === 'coords' ? parseCoords(coords.value) : null);
    addrPanel.hidden = v !== 'address';
    coordPanel.hidden = v !== 'coords';
  });
  tabs.el.classList.add('pm-seg');
  tabs.set('address');
  coordPanel.hidden = true;
  wrap.append(tabs.el, addrPanel, coordPanel);
  return wrap;
}

/**
 * A new private place's fields: name, size, and (for a photo without GPS) where it is. value() → the request
 * body for `POST /api/places/private {create}`; throws when the position is still missing.
 */
function newPlaceForm(ui, needsPosition) {
  const wrap = el('div', 'ce-where');
  const name = lineInput('', 'Name, for example Home');
  let size = PLACE_SIZES[0][0];
  const sizes = chips(PLACE_SIZES.map(([m, label]) => ({ value: m, label })), (m) => { size = m; });
  sizes.el.classList.add('pm-seg');
  sizes.set(size);
  let pos = null;
  if (needsPosition) wrap.append(textEl('div', 'ce-note', 'Where is it?'), positionPicker(ui, (p) => { pos = p; }));
  wrap.append(name, textEl('div', 'ce-note', 'Photos taken within'), sizes.el,
    textEl('div', 'ce-note', 'show this name (empty: just the town) and are never looked up online.'));
  return {
    el: wrap,
    value() {
      if (needsPosition && !pos) throw new Error('Pick where the place is: search an address, or type its coordinates.');
      const body = { create: true, name: name.value.trim(), radiusM: size };
      if (pos) { body.lat = pos.lat; body.lon = pos.lon; }
      return body;
    },
  };
}

/** Leaflet (vendored, SPEC §8), loaded the first time a map opens. Resolves with window.L. */
let leafletLoading = null;
function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  if (!leafletLoading) {
    leafletLoading = new Promise((resolve, reject) => {
      const css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = '/lib/leaflet/leaflet.css';
      document.head.append(css);
      const js = document.createElement('script');
      js.src = '/lib/leaflet/leaflet.js';
      js.onload = () => { window.L.Icon.Default.imagePath = '/lib/leaflet/images/'; resolve(window.L); };
      js.onerror = () => { leafletLoading = null; reject(new Error('The map could not be loaded')); };
      document.head.append(js);
    });
  }
  return leafletLoading;
}

const fmtCoords = (p) => `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}`;
const fmtDistance = (m) => (m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`);

async function getJson(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
  return res.json();
}

/**
 * Location editor (SPEC §8): the name shown for this photo only (with the town; never looked up online), and
 * where it was taken: drag a pin on a map, find a place nearby (a business, a park), search an address, or type
 * coordinates; a photo without its own position can also join a private place. Opening the map or searching
 * sends that area to OpenStreetMap; nothing goes online by itself.
 * @param {object} o slide, inactivityMs, center ({lat, lon} when the photo has no position: the weather
 *   location), onSaved(slide), onClose()
 */
export function openLocationEditor(o) {
  const s = o.slide;
  const ui = editorShell(o, 'Location');
  ui.card.classList.add('ce-wide');
  const prefill = s.placeLabel || s.placeTitle || (s.myPlace && s.myPlace.name) || '';
  const name = lineInput(prefill, 'Name (optional), for example Grandma\x27s 80th');
  ui.card.append(name);

  const own = s.lat != null && s.lon != null ? { lat: s.lat, lon: s.lon } : null;
  let pos = null; // a new position chosen in this editor
  let pendingPrivate = null; // { assign: key } | { create: form }
  const here = () => pos || own || o.center || null;
  const posNote = textEl('div', 'ce-note', '');
  const showPos = () => {
    const p = pos || own;
    posNote.textContent = pos ? `New position: ${fmtCoords(pos)}` : p ? `Position: ${fmtCoords(p)}` : 'No position yet: drag the pin to where it was taken, or search.';
  };

  // Map: a pin to drag (or tap the map to move it there).
  const mapBox = el('div', 'ce-map');
  let map = null;
  let marker = null;
  const placePin = (p) => {
    if (!map || !p) return;
    const ll = [p.lat, p.lon];
    if (marker) marker.setLatLng(ll); else {
      marker = window.L.marker(ll, { draggable: true }).addTo(map);
      marker.on('dragend', () => { const q = marker.getLatLng(); setPos({ lat: q.lat, lon: q.lng }, 'map'); });
    }
  };
  const setPos = (p, from) => {
    pos = p ? { lat: Math.round(p.lat * 1e5) / 1e5, lon: Math.round(p.lon * 1e5) / 1e5 } : null;
    pendingPrivate = null;
    if (from !== 'map' && pos) { placePin(pos); if (map) map.setView([pos.lat, pos.lon], Math.max(map.getZoom(), 16)); }
    if (from !== 'coords') coords.value = pos ? fmtCoords(pos) : '';
    showPos();
  };
  const openMap = async () => {
    if (map) { map.invalidateSize(); return; }
    const c = here();
    if (!c) { mapBox.replaceChildren(textEl('div', 'ce-note', 'Search an address first, then fine-tune the spot here.')); return; }
    try {
      const L = await loadLeaflet();
      mapBox.replaceChildren();
      map = L.map(mapBox, { zoomControl: true, attributionControl: true }).setView([c.lat, c.lon], 17);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19, attribution: '© OpenStreetMap contributors',
      }).addTo(map);
      placePin(c);
      map.on('click', (e) => { setPos({ lat: e.latlng.lat, lon: e.latlng.lng }, 'map'); placePin(pos); });
    } catch (e) { ui.fail(e); }
  };
  const mapPanel = el('div', 'ce-where');
  mapPanel.append(mapBox, textEl('div', 'ce-note', 'Drag the pin, or tap the map. The map pictures come from OpenStreetMap.'));

  // Nearby: businesses and places around the pin.
  const nearQ = lineInput('', 'For example Starbucks, Central Park', 100);
  const nearResults = el('div', 'ce-results');
  const nearSearch = textEl('button', 'pe-btn', 'Search');
  nearSearch.type = 'button';
  const runNear = async () => {
    const c = here();
    if (!c) { ui.fail(new Error('Search an address first: nearby needs a position.')); return; }
    nearResults.replaceChildren(textEl('div', 'ce-note', 'Searching…'));
    try {
      const r = await getJson(`/api/places/nearby?q=${encodeURIComponent(nearQ.value.trim())}&lat=${c.lat}&lon=${c.lon}`);
      nearResults.replaceChildren();
      if (!r.results.length) nearResults.append(textEl('div', 'ce-note', 'Nothing by that name within about 1 km.'));
      const pick = chips(r.results.map((x, i) => ({ value: i, label: `${x.name || x.label} · ${fmtDistance(x.distanceM)}` })), (i) => {
        const x = r.results[i];
        if (x.name) name.value = x.name; // the place's name and its position (user decision 2026-10-19)
        setPos(x, 'nearby');
      });
      pick.el.classList.add('ce-list');
      nearResults.append(pick.el);
    } catch (e) { nearResults.replaceChildren(); ui.fail(e); }
  };
  nearSearch.addEventListener('click', runNear);
  nearQ.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); runNear(); } });
  const nearRow = el('div', 'ce-inline');
  nearRow.append(nearQ, nearSearch);
  const nearPanel = el('div', 'ce-where');
  nearPanel.append(nearRow, textEl('div', 'ce-note', 'Searches OpenStreetMap within about 1 km of the pin.'), nearResults);

  // Address.
  const addr = lineInput('', 'Street, town', 120);
  const addrResults = el('div', 'ce-results');
  const addrSearch = textEl('button', 'pe-btn', 'Search');
  addrSearch.type = 'button';
  const runAddr = async () => {
    addrResults.replaceChildren(textEl('div', 'ce-note', 'Searching…'));
    try {
      const r = await getJson(`/api/places/address?q=${encodeURIComponent(addr.value.trim())}`);
      addrResults.replaceChildren();
      if (!r.results.length) addrResults.append(textEl('div', 'ce-note', 'Nothing found. Try the street and the town.'));
      const pick = chips(r.results.map((x, i) => ({ value: i, label: x.label })), (i) => setPos(r.results[i], 'address'));
      pick.el.classList.add('ce-list');
      addrResults.append(pick.el);
    } catch (e) { addrResults.replaceChildren(); ui.fail(e); }
  };
  addrSearch.addEventListener('click', runAddr);
  addr.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); runAddr(); } });
  const addrRow = el('div', 'ce-inline');
  addrRow.append(addr, addrSearch);
  const addrPanel = el('div', 'ce-where');
  addrPanel.append(addrRow, textEl('div', 'ce-note', 'The address is sent to OpenStreetMap once to find it.'), addrResults);

  // Coordinates.
  const coords = lineInput(own ? fmtCoords(own) : '', 'For example 47.6205, -122.3493', 60);
  coords.addEventListener('input', () => {
    const c = parseCoords(coords.value);
    if (c) setPos(c, 'coords');
  });
  const coordPanel = el('div', 'ce-where');
  coordPanel.append(coords);

  // A private place, for a photo without its own position.
  const panels = { map: mapPanel, nearby: nearPanel, address: addrPanel, coords: coordPanel };
  const tabs = [{ value: 'map', label: 'Map' }, { value: 'nearby', label: 'Nearby' }, { value: 'address', label: 'Address' },
    { value: 'coords', label: 'Coordinates' }];
  let privPick = null;
  if (!s.hasGps || s.userCoords) {
    const places = s.privatePlaces || [];
    const NEW = '+new';
    const form = newPlaceForm(ui, true);
    form.el.hidden = true;
    privPick = chips([...places.map((p) => ({ value: p.key, label: p.name || 'No name' })), { value: NEW, label: '+ New place' }], (v) => {
      pendingPrivate = v === NEW ? { create: form } : { assign: v };
      form.el.hidden = v !== NEW;
    });
    if (s.myPlace && s.myPlace.added) privPick.set(s.myPlace.key);
    const privPanel = el('div', 'ce-where');
    privPanel.append(privPick.el, form.el, textEl('div', 'ce-note', 'The photo shows the place\x27s name and is never looked up online.'));
    panels.private = privPanel;
    tabs.push({ value: 'private', label: 'Private' });
  }
  const showTab = (v) => {
    Object.entries(panels).forEach(([k, p]) => { p.hidden = k !== v; });
    if (v === 'map') openMap();
  };
  const tabRow = chips(tabs, showTab);
  tabRow.el.classList.add('pm-seg');
  const first = s.myPlace && s.myPlace.added ? 'private' : own ? 'coords' : 'address';
  tabRow.set(first);
  const where = el('div', 'ce-where');
  where.append(textEl('div', 'ce-note', 'Where it was taken:'), tabRow.el, ...Object.values(panels), posNote);
  ui.card.append(where);
  showTab(first);
  showPos();

  const save = async () => {
    try {
      let saved = null;
      if (pos) saved = (await ui.post('/api/places/coords', { lat: pos.lat, lon: pos.lon })).slide;
      if (pendingPrivate && pendingPrivate.assign && !(s.myPlace && s.myPlace.added && pendingPrivate.assign === s.myPlace.key)) {
        saved = (await ui.post('/api/places/private', { assign: pendingPrivate.assign })).slide;
      }
      if (pendingPrivate && pendingPrivate.create) saved = (await ui.post('/api/places/private', pendingPrivate.create.value())).slide;
      const typed = name.value.trim();
      // Only a name the user typed or changed: an unchanged looked-up name stays automatic.
      if (typed !== prefill || s.placeLabel) saved = (await ui.post('/api/places/label', { name: typed })).slide;
      if (saved) o.onSaved(saved);
      ui.close();
    } catch (e) { ui.fail(e); }
  };
  const act = (path, body) => async () => {
    try { const r = await ui.post(path, body); if (r.slide) o.onSaved(r.slide); ui.close(); } catch (e) { ui.fail(e); }
  };
  if (s.placeLabel) ui.button('Remove name', 'danger', act('/api/places/label', { name: '' }));
  if (s.userCoords) {
    ui.button(s.hasOwnPosition ? 'Back to the photo\x27s own position' : 'Remove position', 'danger', act('/api/places/coords', { clear: true }));
  }
  ui.bar.append(el('span', 'ce-spacer'));
  ui.button('Cancel', '', ui.close);
  ui.button('Save', 'primary', save);
  name.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } });
  ui.onCleanup(() => { if (map) map.remove(); });
  ui.open(null);
  return { close: ui.close };
}

/**
 * Mark private (SPEC §8): add the photo to one of your private places (quick select) or a new one (around where
 * it was taken; without GPS: at an address or coordinates). The place the photo was taken in can be renamed,
 * resized, or deleted. @param {object} o slide, inactivityMs, onSaved(slide), onClose()
 */
export function openPrivateEditor(o) {
  const s = o.slide;
  const ui = editorShell(o, 'Private place');
  const places = s.privatePlaces || [];
  const area = s.myPlace && !s.myPlace.added ? s.myPlace : null; // the place the photo was taken in
  const NEW = '+new';
  let choice = s.myPlace ? s.myPlace.key : (places.length ? null : NEW);

  // Editing the place the photo was taken in: its name and size.
  const name = lineInput(area ? area.name : '', 'Name, for example Home');
  let size = area ? area.radiusM : PLACE_SIZES[0][0];
  const sizes = chips(PLACE_SIZES.map(([m, label]) => ({ value: m, label })), (m) => { size = m; });
  sizes.el.classList.add('pm-seg');
  sizes.set(size);
  const edit = el('div', 'ce-where');
  edit.append(name, textEl('div', 'ce-note', 'Photos taken within'), sizes.el,
    textEl('div', 'ce-note', 'show this name (empty: just the town) and are never looked up online.'));
  const form = newPlaceForm(ui, !s.hasGps);
  const showFields = () => {
    edit.hidden = !(area && choice === area.key);
    form.el.hidden = choice !== NEW;
  };

  const items = [...places.map((p) => ({ value: p.key, label: p.name || 'No name' })), { value: NEW, label: '+ New place' }];
  const pick = chips(items, (v) => { choice = v; showFields(); });
  pick.set(choice);
  ui.card.append(textEl('div', 'ce-note', 'Add to:'), pick.el, edit, form.el);
  showFields();

  const save = async () => {
    try {
      let r = null;
      if (choice === NEW) {
        r = await ui.post('/api/places/private', form.value());
      } else if (area && choice === area.key) {
        r = await ui.post('/api/places/private', { name: name.value.trim(), radiusM: size, update: true });
      } else if (choice && !(s.myPlace && s.myPlace.added && choice === s.myPlace.key)) {
        r = await ui.post('/api/places/private', { assign: choice });
      }
      if (r && r.slide) o.onSaved(r.slide);
      ui.close();
    } catch (e) { ui.fail(e); }
  };
  if (s.myPlace) {
    ui.button(s.myPlace.added ? 'Take out' : 'Delete place', 'danger', async () => {
      try { const r = await ui.post('/api/places/private/remove', {}); if (r.slide) o.onSaved(r.slide); ui.close(); } catch (e) { ui.fail(e); }
    });
  }
  ui.bar.append(el('span', 'ce-spacer'));
  ui.button('Cancel', '', ui.close);
  ui.button('Save', 'primary', save);
  ui.open(null);
  return { close: ui.close };
}

export function libraryAction(action, id) {
  return request(`/api/library/${action}`, 'POST', { ids: [id] });
}

/** Moves a hidden photo to the Trash; survives the page going away (Undo bar still open). */
export function sendDelete(id) {
  return fetch('/api/library/delete', {
    method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: [id] }),
  }).catch((e) => console.error('photo menu: delete failed', e.message));
}

const FIT_LABEL = { fit: 'Fit', fill: 'Fill' };

/**
 * The photo-actions card for `slide`.
 * @param {object} o
 *   slide, defaultFit ('fit' | 'fill', the slideshow setting), canPosition (frame only),
 *   onTouch() (re-arm the menu timer), onFit(value) → Promise, onPosition(), onComment(), onLocation(), onPrivate(),
 *   onHide(), onDelete()
 */
export function photoActionsCard(o) {
  const card = el('div', 'qm-card pm-card');
  card.addEventListener('click', (e) => { e.stopPropagation(); o.onTouch(); });

  // Show this photo as: Auto (follows the slideshow) / Fit / Fill.
  const fitRow = el('div', 'pm-fit');
  fitRow.append(textEl('span', 'pm-fit-label', 'Show as'));
  const seg = el('div', 'pm-seg');
  const options = [[null, `Auto (${FIT_LABEL[o.defaultFit] || 'Fit'})`], ['fit', 'Fit'], ['fill', 'Fill']];
  let current = o.slide.fit || null;
  const segButtons = options.map(([value, label]) => {
    const b = textEl('button', '', label);
    b.type = 'button';
    b.addEventListener('click', async () => {
      if (value === current) return;
      const before = current;
      current = value;
      paint();
      try { await o.onFit(value); } catch (e) { current = before; paint(); }
    });
    seg.append(b);
    return { value, b };
  });
  const paint = () => segButtons.forEach(({ value, b }) => b.classList.toggle('on', value === current));
  paint();
  fitRow.append(seg);

  const items = el('div', 'pm-items');
  const action = (icon, label, onClick, cls = '') => {
    const b = el('button', `pm-item ${cls}`, `${ICONS[icon]}<span></span>`);
    b.type = 'button';
    b.lastChild.textContent = label;
    b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
    items.append(b);
  };
  if (o.canPosition) action('position', 'Position', o.onPosition);
  action('comment', o.slide.comment ? 'Edit comment' : 'Comment', o.onComment);
  // The location shown for this photo, typed (SPEC §8); and, with GPS, a private place around where it was taken.
  if (o.onLocation) action('location', o.slide.placeLabel || o.slide.placeName ? 'Change location' : 'Add location', o.onLocation);
  if (o.onPrivate) action('private', o.slide.myPlace ? 'Private place' : 'Mark private', o.onPrivate);
  action('hide', 'Hide', o.onHide);
  // The frame can't delete on a USB drive or SD card (SPEC §5): Hide only there.
  if (o.slide.source === 'internal') action('delete', 'Delete', o.onDelete, 'danger');

  if (o.video) card.append(videoRow(o.video));
  card.append(fitRow, items);
  if (o.slide.comment) card.append(textEl('div', 'pm-comment', o.slide.comment));
  return card;
}

/** 83400 → "1:23" */
function clock(ms) {
  const s = Math.max(0, Math.round((ms || 0) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Play/Pause, Sound, the main volume, and a seek bar for the video on screen (SPEC §6).
 * @param {object} v state() → { playing, ended, muted, pos, dur, canSeek } | null, toggle(), sound(on),
 *   volume() → Promise<number>, setVolume(pct), poll() (asks for the position), seek(ms), subscribe(fn) → unsubscribe,
 *   and for smoother scrubbing (optional): strip() → Promise (loads the preview strip), preview(ms) → true if
 *   the strip shows that spot, previewEnd(ms) (released: seek done, preview goes)
 */
function videoRow(v) {
  const box = el('div', 'pm-videobox');
  box.append(controlsRow(v), seekRow(v));
  return box;
}

/**
 * Drag to scrub (user request 2026-10-14); follows the video while it plays. With the video's preview strip
 * (2026-10-15) the picture follows the finger from the strip and the player seeks once, on release; without
 * one, every move seeks (slower: Rockchip's player plays up to each spot).
 */
function seekRow(v) {
  const row = el('div', 'pm-seek');
  const cur = textEl('span', 'pm-time', '0:00');
  const total = textEl('span', 'pm-time', '');
  const bar = el('input', 'pm-seekbar');
  Object.assign(bar, { type: 'range', min: 0, max: 1000, step: 10, value: 0 });
  bar.setAttribute('aria-label', 'Position in the video');
  let dragging = false;
  let previewing = false; // this drag shows the strip; the seek waits for the release
  if (v.strip) v.strip(); // usually made already: fetch it now, so the first drag can use it
  bar.addEventListener('pointerdown', () => { dragging = true; });
  const done = () => {
    if (previewing) {
      previewing = false;
      v.seek(Number(bar.value));
      v.previewEnd(Number(bar.value));
    }
    dragging = false;
  };
  bar.addEventListener('pointerup', done);
  bar.addEventListener('pointercancel', done);
  bar.addEventListener('change', done);
  bar.addEventListener('input', () => {
    const ms = Number(bar.value);
    cur.textContent = clock(ms);
    if (v.preview && v.preview(ms)) { previewing = true; return; }
    v.seek(ms);
  });
  const paint = () => {
    const s = v.state();
    bar.disabled = !s || !s.canSeek;
    if (!s) return;
    if (s.dur > 0) bar.max = s.dur;
    total.textContent = s.dur > 0 ? clock(s.dur) : '';
    if (!dragging) {
      bar.value = s.pos || 0;
      cur.textContent = clock(s.pos);
    }
  };
  const poll = setInterval(() => { if (!row.isConnected) { clearInterval(poll); return; } v.poll(); }, 250);
  const unsubscribe = v.subscribe(paint);
  const watch = new MutationObserver(() => { if (!row.isConnected) { unsubscribe(); clearInterval(poll); watch.disconnect(); } });
  watch.observe(document.body, { childList: true });
  paint();
  v.poll();
  row.append(cur, bar, total);
  return row;
}

function controlsRow(v) {
  const row = el('div', 'pm-video');
  const play = el('button', 'pm-vbtn');
  play.type = 'button';
  const sound = el('button', 'pm-vbtn');
  sound.type = 'button';
  const vol = el('input', 'pm-volume');
  Object.assign(vol, { type: 'range', min: 0, max: 100, step: 5 });
  vol.setAttribute('aria-label', 'Volume');
  vol.disabled = true;
  v.volume().then((pct) => { vol.value = pct; vol.disabled = false; });
  const paint = () => {
    const s = v.state() || { playing: false, muted: true };
    play.innerHTML = `${s.playing ? ICONS.pause : ICONS.play}<span></span>`;
    play.lastChild.textContent = s.playing ? 'Pause' : 'Play';
    sound.innerHTML = `${s.muted ? ICONS.soundOff : ICONS.soundOn}<span></span>`;
    sound.lastChild.textContent = s.muted ? 'Sound off' : 'Sound on';
    sound.classList.toggle('on', !s.muted);
  };
  play.addEventListener('click', (e) => { e.stopPropagation(); v.toggle(); });
  sound.addEventListener('click', (e) => { e.stopPropagation(); const s = v.state(); v.sound(!s || s.muted); });
  let t = null;
  vol.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => v.setVolume(Number(vol.value)), 250); });
  const unsubscribe = v.subscribe(paint);
  // Gone with the menu: stop listening once the row leaves the page.
  const watch = new MutationObserver(() => { if (!row.isConnected) { unsubscribe(); watch.disconnect(); } });
  watch.observe(document.body, { childList: true });
  paint();
  row.append(play, sound, vol);
  return row;
}

/** Closes after `ms` without a touch inside `node`; returns a function that re-arms it. */
function inactivity(node, ms, onTimeout) {
  let timer = null;
  const arm = () => { clearTimeout(timer); timer = setTimeout(onTimeout, ms); };
  node.addEventListener('pointerdown', arm, true);
  node.addEventListener('input', arm, true);
  arm();
  return () => clearTimeout(timer);
}

/**
 * Position editor (SPEC §15): the photo in `rect` (the photo widget's box) as the slideshow shows it; pinch or
 * the slider zooms from the whole photo to twice Fill, one finger moves it. Saves this direction's view.
 * @param {object} o slide, fit (its look now: 'fit' | 'fill'), portrait, settings (the slideshow's: background),
 *   rect (DOMRect), inactivityMs, onSaved(slide), onClose()
 * @returns {{ close(): void }}
 */
export function openPositionEditor(o) {
  const slide = o.slide;
  const rect = o.rect;
  const W = rect.width;
  const H = rect.height;
  const key = o.portrait ? 'portrait' : 'landscape';

  const veil = el('div', 'pe-veil');
  const box = el('div', 'pe-box');
  Object.assign(box.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${W}px`, height: `${H}px` });
  const bgSetting = (o.settings && o.settings.background) || 'blur';
  if (bgSetting === 'color') box.style.background = o.settings.backgroundColor;
  if (bgSetting === 'blur' && slide.bg) {
    const bg = el('img', 'pe-bg');
    bg.alt = '';
    bg.src = slide.bg;
    box.append(bg);
  }
  const img = el('img', 'pe-img');
  img.alt = '';
  img.src = slide.url;
  box.append(img);
  veil.append(box);

  let closed = false;
  let stopTimer = () => {};
  const close = () => {
    if (closed) return;
    closed = true;
    stopTimer();
    veil.remove();
    o.onClose();
  };

  // The automatic look: the slideshow's Fit/Fill with faces, without this photo's manual position for that axis.
  const axis = fillLayout(slide, W, H).axis;
  const autoSlide = axis ? { ...slide, crop: cropWith(slide.crop, axis, null) } : slide;
  const autoView = () => viewFromLook(autoSlide, o.fit, W, H);
  let auto = !viewFor(slide, o.portrait) && !(axis && slide.crop && slide.crop[axis] != null);
  let view = viewFor(slide, o.portrait) || viewFromLook(slide, o.fit, W, H);

  const scales = fitFillOf(slide, W, H);
  const slider = el('input', 'pe-zoom');
  slider.type = 'range';
  slider.min = '0';
  slider.max = String(SLIDER_STEPS);
  slider.step = '1';
  slider.setAttribute('aria-label', 'Zoom');

  // `view` is where the fingers, slider, or buttons put the photo; `shown` glides to it every frame, since
  // the touch screen reports each finger only ~15–25 times a second (measured 2026-10-26).
  let shown = view;
  let frame = 0;
  const paint = () => {
    img.style.transform = viewTransform(slide, viewRect(slide, shown, W, H), W, H);
  };
  // While a finger is down the photo is its own GPU layer: every frame on time (57 a second instead of ~40),
  // a little soft when zoomed in; dropping the layer afterwards draws it sharp again (measured 2026-10-26).
  let held = false;
  const settle = () => {
    if (!held && !frame) img.style.willChange = '';
  };
  const animate = () => {
    frame = 0;
    if (closed) return;
    shown = easeView(shown, view, scales);
    paint();
    if (shown.zoom !== view.zoom || shown.x !== view.x || shown.y !== view.y) frame = requestAnimationFrame(animate);
    else settle();
  };
  const hold = (on) => {
    held = on;
    if (on) img.style.willChange = 'transform';
    else settle();
  };
  const draw = (now = false) => {
    slider.value = String(Math.round(zoomToSlider(view.zoom, scales.fit, scales.fill) * SLIDER_STEPS));
    if (now) {
      shown = view;
      paint();
    } else if (!frame) {
      frame = requestAnimationFrame(animate);
    }
  };
  const setZoom = (zoom, now = false) => {
    view = clampView(slide, { ...view, zoom: Math.min(Math.max(zoom, 0), MAX_ZOOM) }, W, H);
    auto = false;
    draw(now);
  };
  draw(true);

  // One finger moves the photo; two fingers pinch around the spot between them, and move it too.
  const fingers = new Map();
  let gesture = null;
  const spread = () => {
    const [a, b] = [...fingers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };
  const middle = () => {
    const [a, b] = [...fingers.values()];
    return { x: (a.x + b.x) / 2 - rect.left, y: (a.y + b.y) / 2 - rect.top };
  };
  const begin = () => {
    if (fingers.size === 1) {
      const [p] = fingers.values();
      gesture = { kind: 'move', x: p.x, y: p.y, view };
    } else if (fingers.size === 2) {
      gesture = { kind: 'pinch', d: spread() || 1, mid: middle(), view };
    } else {
      gesture = null;
    }
  };
  box.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.pe-bar')) return;
    box.setPointerCapture(e.pointerId);
    fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    hold(true);
    begin();
  });
  box.addEventListener('pointermove', (e) => {
    if (!fingers.has(e.pointerId) || !gesture) return;
    fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (gesture.kind === 'move') {
      const [p] = fingers.values();
      view = dragView(slide, gesture.view, p.x - gesture.x, p.y - gesture.y, W, H);
      auto = false;
      draw();
    } else if (gesture.kind === 'pinch' && fingers.size === 2) {
      view = pinchView(slide, gesture.view, gesture.mid, middle(), pinchRatio(gesture.d, spread()), W, H);
      auto = false;
      draw();
    }
  });
  const lift = (e) => {
    if (!fingers.delete(e.pointerId)) return;
    if (!fingers.size) hold(false);
    begin(); // one finger left after a pinch: it moves from here
  };
  box.addEventListener('pointerup', lift);
  box.addEventListener('pointercancel', lift);

  box.append(textEl('div', 'pe-hint', 'Drag to move. Pinch or use the slider to zoom.'));

  const bar = el('div', 'pe-bar');
  const button = (label, cls, onClick, parent = bar) => {
    const b = textEl('button', `pe-btn ${cls}`, label);
    b.type = 'button';
    b.addEventListener('click', onClick);
    parent.append(b);
    return b;
  };

  // Zoom row: − slider +, with where Whole photo and Fill are.
  const zoomRow = el('div', 'pe-zoom-row');
  const track = el('div', 'pe-zoom-track');
  const marks = el('div', 'pe-zoom-marks');
  const mark = (text, at) => {
    const m = textEl('span', '', text);
    m.style.left = `${at * 100}%`;
    marks.append(m);
  };
  // The slider goes in even steps of size, so Fill sits where the photo really fills its box; when that is
  // (almost) the whole photo already, the two marks are one.
  const fillAt = zoomToSlider(1, scales.fit, scales.fill);
  if (fillAt < 0.25) {
    mark(fillAt < 0.01 ? 'Whole photo = Fill' : 'Whole photo, Fill', 0);
  } else {
    mark('Whole photo', 0);
    mark('Fill', fillAt);
  }
  mark('2× Fill', 1);
  track.append(slider, marks);
  const sliderAt = () => zoomToSlider(view.zoom, scales.fit, scales.fill);
  const slideTo = (p, now) => setZoom(sliderToZoom(p, scales.fit, scales.fill), now);
  slider.addEventListener('input', () => slideTo(Number(slider.value) / SLIDER_STEPS, true));
  slider.addEventListener('pointerdown', () => hold(true));
  slider.addEventListener('change', () => hold(false));
  slider.addEventListener('pointercancel', () => hold(false));
  button('−', 'pe-step', () => slideTo(Math.ceil(sliderAt() * 10 - 1.001) / 10), zoomRow);
  zoomRow.append(track);
  button('+', 'pe-step', () => slideTo(Math.floor(sliderAt() * 10 + 1.001) / 10), zoomRow);

  const actions = el('div', 'pe-actions');
  button('Cancel', '', close, actions);
  button('Automatic', '', () => {
    auto = true;
    view = autoView();
    draw();
  }, actions);
  const save = button('Save', 'primary', async () => {
    save.disabled = true;
    try {
      const body = { view: { [key]: auto ? null : savedView(view) } };
      if (auto && axis) body.crop = cropWith(slide.crop, axis, null);
      const saved = await patchPhoto(slide.id, body);
      o.onSaved(saved);
      close();
    } catch (e) {
      save.disabled = false;
      save.textContent = 'Try again';
      console.error('position editor:', e.message);
    }
  }, actions);
  bar.append(zoomRow, actions);
  box.append(bar);
  document.body.append(veil);
  stopTimer = inactivity(veil, o.inactivityMs, close);
  return { close, isPosition: true };
}

/**
 * Comment editor: a card near the top (the on-screen keyboard comes up from the bottom).
 * @param {object} o slide, inactivityMs, note (shown under the box), onSaved(slide), onClose()
 */
export function openCommentEditor(o) {
  const veil = el('div', 'ce-veil');
  const card = el('div', 'ce-card');
  const area = el('textarea', 'ce-text');
  area.maxLength = MAX_COMMENT;
  area.rows = 3;
  area.placeholder = 'Add a comment';
  area.value = o.slide.comment || '';
  const count = el('span', 'ce-count');
  const error = textEl('div', 'ce-error', '');
  error.hidden = true;
  const updateCount = () => { count.textContent = `${area.value.length} / ${MAX_COMMENT}`; };
  area.addEventListener('input', updateCount);
  updateCount();

  let closed = false;
  let stopTimer = () => {};
  const close = () => {
    if (closed) return;
    closed = true;
    stopTimer();
    area.blur();
    veil.remove();
    o.onClose();
  };
  const save = async (value) => {
    try {
      const saved = await patchPhoto(o.slide.id, { comment: value });
      o.onSaved(saved);
      close();
    } catch (e) {
      error.textContent = e.message;
      error.hidden = false;
    }
  };

  const bar = el('div', 'ce-bar');
  const button = (label, cls, onClick) => {
    const b = textEl('button', `pe-btn ${cls}`, label);
    b.type = 'button';
    b.addEventListener('click', onClick);
    bar.append(b);
  };
  if (o.slide.comment) button('Remove', 'danger', () => save(null));
  bar.append(el('span', 'ce-spacer'));
  button('Cancel', '', close);
  button('Save', 'primary', () => save(area.value));

  const head = el('div', 'ce-head');
  head.append(textEl('b', '', 'Comment'), count);
  card.append(head, area, error);
  if (o.note) card.append(textEl('div', 'ce-note', o.note));
  card.append(bar);
  card.addEventListener('click', (e) => e.stopPropagation());
  veil.append(card);
  veil.addEventListener('click', close);
  document.body.append(veil);
  stopTimer = inactivity(veil, o.inactivityMs, close);
  area.focus();
  area.setSelectionRange(area.value.length, area.value.length);
  return { close };
}

let openUndo = null;

/**
 * "Photo deleted · Undo" at the bottom for `ms`. Undo calls onUndo; otherwise onExpire runs when
 * it times out, when another Undo bar replaces it, or via flushUndo() (page going away).
 */
export function undoBar(message, { onUndo, onExpire, ms = 10000, over = null }) {
  flushUndo();
  const bar = el('div', 'ub');
  bar.append(textEl('span', 'ub-text', message));
  const undo = textEl('button', 'ub-undo', 'Undo');
  undo.type = 'button';
  // × closes the bubble early (the hide or delete stays).
  const close = el('button', 'ub-close', '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>');
  close.type = 'button';
  close.setAttribute('aria-label', 'Close');
  bar.append(undo, close);
  if (over) { // under the middle of the photo (Hybrid: not the whole screen)
    bar.style.left = `${over.left + over.width / 2}px`;
    bar.style.bottom = `${window.innerHeight - over.bottom + 28}px`;
  }
  document.body.append(bar);
  const entry = {
    done: false,
    finish(undone) {
      if (entry.done) return;
      entry.done = true;
      clearTimeout(entry.timer);
      bar.remove();
      if (openUndo === entry) openUndo = null;
      if (undone) onUndo(); else if (onExpire) onExpire();
    },
    timer: null,
  };
  entry.timer = setTimeout(() => entry.finish(false), ms);
  undo.addEventListener('click', (e) => { e.stopPropagation(); entry.finish(true); });
  close.addEventListener('click', (e) => { e.stopPropagation(); entry.finish(false); });
  openUndo = entry;
}

/** Runs the pending Undo bar's expiry now (e.g. the page is being left). */
export function flushUndo() {
  if (openUndo) openUndo.finish(false);
}
