// Settings page (SPEC §16): two panes like Frameo's settings, instant save (PATCH /api/config per
// change; the shell coalesces snapshots), on the frame and from any browser on the LAN.

import {
  PALETTE, BACKGROUND_PALETTE, WEEKDAYS, SLIDE_INTERVALS, INACTIVITY_OPTIONS, SYNC_OPTIONS,
  TRANSITION_OPTIONS, sectionNames, formatDuration, withCurrent, agoText, feedStatusText, formatBytes,
  hslToHex, hexToHsl, isHexColor, placeLabel, placeDetail, TEXT_PALETTE,
  WOKEN_OPTIONS, MAX_SCHEDULES, DEFAULT_SCHEDULE, formatHm, toHm, daysSummary, dayTimeText, clipLength,
} from './lib/settings-core.js';
import { ClockWeather, WeatherData } from './clock.js';
import { Caption } from './caption.js';
import { captionCorner } from './lib/caption-core.js';
import { FONTS, AUTO, WHITE, fontFamily, overrideSummary } from './lib/text-style-core.js';
import { Brightness } from './autocolor.js';
import { applyTheme } from './theme.js';
import { CHIMES, REMINDER_MINUTES, chimeFile } from './lib/reminder-core.js';
import { openLocationEditor, openPrivateEditor } from './photo-menu.js';
import {
  layoutPages, homePage, addPage, removePage, movePage, editPage, setHomePage, uniquePageName, PRESET_NAMES, MAX_PAGES, MAX_NAME,
  pageView, arrangementFor, gridBox, anchorBox, layoutChoice, chooseLayout,
} from './lib/layout-core.js';

const isFrame = navigator.userAgent.includes('OpenFrameShell');
document.documentElement.classList.toggle('frame', isFrame);
// On the frame Settings opens over the photo page (SPEC §16, 2026-10-19): going back closes it there, no reload.
const host = (() => {
  try { return window.parent !== window ? window.parent.openframeHost || null : null; } catch (e) { return null; }
})();

// Material Design icons (Apache 2.0), inline so the page works offline.
const ICONS = {
  back: 'M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z',
  photos: 'M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z',
  calendars: 'M19 4h-1V2h-2v2H8V2H6v2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm0 16H5V9h14v11zM7 11h5v5H7z',
  layout: 'M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z',
  clock: 'M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z',
  backup: 'M13 3a9 9 0 0 0-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42A8.954 8.954 0 0 0 13 21a9 9 0 0 0 0-18zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z',
  warnings: 'M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z',
  system: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z',
  display: 'M20 15.31L23.31 12 20 8.69V4h-4.69L12 .69 8.69 4H4v4.69L.69 12 4 15.31V20h4.69L12 23.31 15.31 20H20v-4.69zM12 18V6c3.31 0 6 2.69 6 6s-2.69 6-6 6z',
  sound: 'M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z',
  moon: 'M12.34 2.02C6.59 1.82 2 6.42 2 12c0 5.52 4.48 10 10 10 3.71 0 6.93-2.02 8.66-5.02-7.51-.25-12.09-8.43-8.32-14.96z',
  sun: 'M6.76 4.84l-1.8-1.79-1.41 1.41 1.79 1.79 1.42-1.41zM4 10.5H1v2h3v-2zm9-9.95h-2V3.5h2V.55zm7.45 3.91l-1.41-1.41-1.79 1.79 1.41 1.41 1.79-1.79zm-3.21 13.7l1.79 1.8 1.41-1.41-1.8-1.79-1.4 1.4zM20 10.5v2h3v-2h-3zm-8-5c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6-2.69-6-6-6zm-1 16.95h2V19.5h-2v2.95zm-7.45-3.91l1.41 1.41 1.79-1.8-1.41-1.41-1.79 1.8z',
  delete: 'M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z',
  close: 'M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
  add: 'M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z',
  check: 'M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z',
  chevron: 'M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z',
  appearance: 'M9.93 13.5h4.14L12 7.98zM20 2H4c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-4.05 16.5l-1.14-3H9.17l-1.12 3H5.96l5.11-13h1.88l5.11 13h-2.11z',
  look: 'M12 3a9 9 0 0 0 0 18c.83 0 1.5-.67 1.5-1.5 0-.39-.15-.74-.39-1.01-.23-.26-.38-.61-.38-.99 0-.83.67-1.5 1.5-1.5H16c2.76 0 5-2.24 5-5 0-4.42-4.03-8-9-8zm-5.5 9c-.83 0-1.5-.67-1.5-1.5S5.67 9 6.5 9 8 9.67 8 10.5 7.33 12 6.5 12zm3-4C8.67 8 8 7.33 8 6.5S8.67 5 9.5 5s1.5.67 1.5 1.5S10.33 8 9.5 8zm5 0c-.83 0-1.5-.67-1.5-1.5S13.67 5 14.5 5s1.5.67 1.5 1.5S15.33 8 14.5 8zm3 4c-.83 0-1.5-.67-1.5-1.5S16.67 9 17.5 9s1.5.67 1.5 1.5-.67 1.5-1.5 1.5z',
  more: 'M6 10c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm12 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm-6 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z',
  help: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 17h-2v-2h2v2zm2.07-7.75l-.9.92C13.45 12.9 13 13.5 13 15h-2v-.5c0-1.1.45-2.1 1.17-2.83l1.24-1.26c.37-.36.59-.86.59-1.41 0-1.1-.9-2-2-2s-2 .9-2 2H8c0-2.21 1.79-4 4-4s4 1.79 4 4c0 .88-.36 1.68-.93 2.25z',
  caption: 'M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zM4 12h4v2H4v-2zm10 6H4v-2h10v2zm6 0h-4v-2h4v2zm0-4H10v-2h10v2z',
};
const svg = (name, cls = '') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS[name]}"/></svg>`;

// Five sections (user decision 2026-10-16, SPEC §16): related settings together, rarely used ones under More.
const SECTIONS = [
  { id: 'photos', label: 'Photos and videos', render: renderPhotos },
  { id: 'calendars', label: 'Calendar', render: renderCalendars },
  { id: 'look', label: 'Layout and appearance', render: renderLook },
  { id: 'display', label: 'Sleep, brightness and sound', render: renderDisplayAndSound },
  // "More" is gone (user 2026-10-19, V1.0.0 item 5): its pages are sections again, Help last.
  { id: 'warnings', label: 'Warnings', render: renderWarnings },
  { id: 'backup', label: 'Backup and restore', render: renderBackup },
  { id: 'system', label: 'System', render: renderSystem },
  { id: 'help', label: 'Help', render: renderHelp },
  // Sub-pages (not in the section list; their own back link unless ownBack).
  { id: 'library', label: 'Library', render: renderLibrary, parent: 'photos', ownBack: true },
  { id: 'trash', label: 'Trash', render: renderTrash, parent: 'photos', ownBack: true },
  { id: 'caption', label: 'Photo caption', render: renderCaption, parent: 'photos', ownBack: true },
  { id: 'places', label: 'Places', render: renderPlaces, parent: 'photos', ownBack: true },
  { id: 'layout', label: 'Layout', render: renderLayout, parent: 'look' },
  { id: 'clock', label: 'Clock and weather', render: renderClock, parent: 'look' },
  { id: 'appearance', label: 'Text style', render: renderAppearance, parent: 'look' },
];
/** Old section links (bookmarks, warnings, older pages) and where they lead now. */
const SECTION_ALIASES = { sound: 'display', more: 'warnings' };
const sectionId = (id) => (id && SECTION_ALIASES[id]) || id;

const state = {
  config: null,
  section: null,
  cal: null, // /api/calendars
  media: null, // /api/media
  system: null, // /api/system
  power: null, // /api/power
  sound: null, // /api/sound
};
const weather = new WeatherData();
let syncers = []; // per rendered section: refresh displayed values without rebuilding the DOM
let cleanups = []; // per rendered section: run when it is left (clock preview, listeners)

const pane = document.querySelector('.st-pane');
const nav = document.querySelector('.st-nav');
const titleEl = document.querySelector('.st-title');
const savedEl = document.querySelector('.st-saved');

// ---- small DOM helpers ----

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

function text(tag, cls, s) {
  const e = el(tag, cls);
  e.textContent = s;
  return e;
}

const call = (v) => (typeof v === 'function' ? v() : v);

// ---- API ----

async function api(path, opts = {}) {
  const init = { cache: 'no-store', ...opts };
  if (opts.json !== undefined) {
    init.body = JSON.stringify(opts.json);
    init.headers = { 'Content-Type': 'application/json' };
    delete init.json;
  }
  const res = await fetch(path, init);
  let body = null;
  try { body = await res.json(); } catch (e) { /* not JSON */ }
  if (res.status === 401 && body && body.pinRequired) location.reload(); // signed out: back to the PIN page
  if (!res.ok) throw new Error((body && body.error) || `The frame answered HTTP ${res.status}`);
  return body;
}

function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

function patchFor(path, value) {
  const keys = path.split('.');
  const root = {};
  let o = root;
  keys.slice(0, -1).forEach((k) => { o = o[k] = {}; });
  o[keys[keys.length - 1]] = value;
  return root;
}

function deepAssign(target, patch) {
  for (const [k, v] of Object.entries(patch)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && target[k] && typeof target[k] === 'object') deepAssign(target[k], v);
    else target[k] = v;
  }
}

let savedTimer = null;
function flash(message, error = false) {
  savedEl.textContent = message;
  savedEl.classList.toggle('error', error);
  savedEl.classList.add('show');
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => savedEl.classList.remove('show'), error ? 5000 : 1500);
}

let toastTimer = null;
function toast(message, error = false) {
  document.querySelectorAll('.st-toast').forEach((t) => t.remove());
  const t = text('div', `st-toast${error ? ' error' : ''}`, message);
  document.body.append(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), error ? 6000 : 3500);
}

/** Instant save: applies the change locally, PATCHes it, and re-syncs the rows. */
let saveChain = Promise.resolve();
let saving = 0;
function save(patch) {
  deepAssign(state.config, patch);
  sync();
  saving++;
  saveChain = saveChain.then(async () => {
    try {
      state.config = await api('/api/config', { method: 'PATCH', json: patch });
      flash('Saved');
    } catch (e) {
      flash('Not saved', true);
      toast(e.message, true);
      try { state.config = await api('/api/config'); } catch (e2) { /* keep the local copy */ }
    } finally {
      saving--;
    }
    sync();
  });
  return saveChain;
}

/** Picks up changes made from another device (phone, PC) while this page is open. */
async function pollConfig() {
  const busy = saving > 0 || openSheetRef || (document.activeElement && document.activeElement.type === 'range');
  if (busy) return;
  try {
    const next = await api('/api/config');
    if (saving > 0 || JSON.stringify(next) === JSON.stringify(state.config)) return;
    state.config = next;
    sync();
  } catch (e) { /* offline or restarting: try again next time */ }
}

function sync() {
  if (state.config) applyTheme(state.config, weather.value); // dark mode follows the setting at once
  syncers.forEach((fn) => fn());
}

// Coalesces slider drags into one request per ~300 ms.
function debounced(fn, ms) {
  let t = null;
  let last = null;
  const run = () => { t = null; fn(last); };
  return (v) => { last = v; if (!t) t = setTimeout(run, ms); };
}

// ---- row builders ----

function group(title, ...children) {
  const g = el('section', 'st-group');
  if (title) g.append(text('h2', 'st-group-title', title));
  children.flat().filter(Boolean).forEach((c) => g.append(c));
  return g;
}

function note(html) {
  return el('p', 'st-note', html);
}

/** A row: title, optional sub (string or function), optional element on the right, optional tap. */
function row({ title, sub, right, onTap, cls = '', lead }) {
  const r = el(onTap ? 'button' : 'div', `st-row ${cls}`);
  if (onTap) { r.type = 'button'; r.addEventListener('click', onTap); }
  if (lead) r.append(lead);
  const t = el('div', 'st-row-text');
  const tEl = text('div', 'st-row-title', call(title));
  const subEl = el('div', 'st-row-sub');
  t.append(tEl, subEl);
  r.append(t);
  if (right) r.append(right);
  const update = () => {
    tEl.textContent = call(title);
    const s = call(sub);
    subEl.textContent = s || '';
    subEl.hidden = !s;
  };
  update();
  syncers.push(update);
  return r;
}

function toggleRow(title, sub, get, set) {
  const tg = el('span', 'st-toggle');
  tg.setAttribute('role', 'switch');
  const r = row({ title, sub, right: tg, onTap: () => set(!get()) });
  const update = () => {
    tg.classList.toggle('on', !!get());
    tg.setAttribute('aria-checked', String(!!get()));
  };
  update();
  syncers.push(update);
  return r;
}

/** Toggle bound to a config path. */
const cfgToggle = (title, sub, path, invert = false) =>
  toggleRow(title, sub, () => invert !== !!getPath(state.config, path), (v) => save(patchFor(path, invert ? !v : v)));

function segRow(title, sub, options, get, set) {
  const seg = el('div', 'st-seg');
  const buttons = options.map((o) => {
    const b = text('button', '', o.label);
    b.type = 'button';
    b.addEventListener('click', () => { if (get() !== o.value) set(o.value); });
    seg.append(b);
    return b;
  });
  const r = row({ title, sub, right: seg, cls: 'st-row-seg' });
  const update = () => options.forEach((o, i) => buttons[i].classList.toggle('on', get() === o.value));
  update();
  syncers.push(update);
  return r;
}

const cfgSeg = (title, sub, path, options) =>
  segRow(title, sub, options, () => getPath(state.config, path), (v) => save(patchFor(path, v)));

/** Row showing the current choice; tapping opens a list. options: [{ value, label, detail? }] or a function. */
function pickRow(title, options, get, set, sheetTitle = title) {
  const labelOf = () => {
    const o = call(options).find((x) => x.value === get());
    return o ? o.label : String(get());
  };
  return row({
    title,
    sub: labelOf,
    cls: 'tappable',
    right: el('span', '', svg('chevron', 'st-row-icon')),
    onTap: () => choiceSheet(sheetTitle, call(options), get(), set),
  });
}

const cfgPick = (title, path, options, sheetTitle) =>
  pickRow(title, options, () => getPath(state.config, path), (v) => save(patchFor(path, v)), sheetTitle);

function sliderRow(title, sub, { min, max, step, format }, get, set) {
  const wrap = el('div', 'st-slider');
  const input = el('input');
  Object.assign(input, { type: 'range', min, max, step });
  const out = el('output');
  wrap.append(input, out);
  const send = debounced(set, 300);
  input.addEventListener('input', () => { out.textContent = format(Number(input.value)); send(Number(input.value)); });
  const r = row({ title, sub, right: wrap });
  const update = () => {
    if (document.activeElement !== input) input.value = get();
    out.textContent = format(Number(input.value));
  };
  update();
  syncers.push(update);
  return r;
}

const openFolds = new Set(); // folds opened on this page (they stay open while it's shown)
/** Folds with their own wording (closed, open). */
const FOLD_LABELS = { pages: ['More pages', 'Hide pages'] };

/**
 * Rarely used rows or groups folded under "More options" (user decision 2026-10-16). Returns the toggle
 * row followed by the items; the items hide while it's closed.
 */
function more(key, ...items) {
  const list = items.flat().filter(Boolean);
  const k = `${state.section}:${key}`;
  const toggle = el('button', 'st-row tappable st-more');
  toggle.type = 'button';
  const label = text('div', 'st-row-title', '');
  const t = el('div', 'st-row-text');
  t.append(label);
  toggle.append(t, el('span', 'st-more-icon', svg('chevron', 'st-row-icon')));
  const show = () => {
    const open = openFolds.has(k);
    label.textContent = (FOLD_LABELS[key] || ['More options', 'Fewer options'])[open ? 1 : 0];
    toggle.classList.toggle('open', open);
    toggle.setAttribute('aria-expanded', String(open));
    list.forEach((x) => { x.classList.toggle('st-folded', !open); });
  };
  toggle.addEventListener('click', () => { if (openFolds.has(k)) openFolds.delete(k); else openFolds.add(k); show(); });
  show();
  return [toggle, ...list];
}

/** A fold of whole groups: the toggle in a group of its own, then the groups. */
function moreGroups(key, ...groups) {
  const [toggle, ...items] = more(key, ...groups);
  return [group(null, toggle), ...items];
}

function actionRow(title, sub, onTap, cls = 'accent') {
  return row({ title, sub, onTap, cls });
}

function infoRow(title, value) {
  return row({ title, sub: value });
}

// ---- sheets (popups) ----

let openSheetRef = null;
let lastFieldFocus = 0; // when a text field last got focus (keepFieldsAboveKeyboard)

/** Opens a popup. actions: [{ label, kind: 'primary'|'danger'|'', onClick(close) }] ('spacer' for a gap). */
function sheet({ title, body, actions = [] }) {
  if (openSheetRef) openSheetRef.close();
  const backdrop = el('div', 'st-backdrop');
  const box = el('div', 'st-sheet');
  box.setAttribute('role', 'dialog');
  box.addEventListener('click', (e) => e.stopPropagation());
  if (title) box.append(text('h2', 'st-sheet-title', title));
  const content = el('div', 'st-sheet-body');
  (Array.isArray(body) ? body : [body]).filter(Boolean).forEach((b) => content.append(b));
  box.append(content);
  const ref = {
    close() {
      backdrop.remove();
      if (openSheetRef === ref) openSheetRef = null;
    },
    content,
    box,
  };
  if (actions.length) {
    const bar = el('div', 'st-sheet-actions');
    for (const a of actions) {
      if (a === 'spacer') { bar.append(el('span', 'spacer')); continue; }
      const b = text('button', `st-btn ${a.kind || ''}`, a.label);
      b.type = 'button';
      b.addEventListener('click', () => (a.onClick ? a.onClick(ref) : ref.close()));
      bar.append(b);
    }
    box.append(bar);
  }
  backdrop.append(box);
  // A tap outside closes it, but not one that just focused a field (the sheet moves for the keyboard).
  backdrop.addEventListener('click', () => { if (Date.now() - lastFieldFocus > 700) ref.close(); });
  document.body.append(backdrop);
  openSheetRef = ref;
  return ref;
}

function choiceSheet(title, options, current, set) {
  const list = options.map((o) => {
    const b = el('button', `st-choice${o.value === current ? ' on' : ''}`);
    b.type = 'button';
    b.innerHTML = svg('check', 'check');
    const label = text('span', '', o.label);
    if (o.detail) label.append(text('small', '', o.detail));
    b.append(label);
    b.addEventListener('click', () => { ref.close(); if (o.value !== current) set(o.value); });
    return b;
  });
  const ref = sheet({ title, body: list, actions: [{ label: 'Cancel' }] });
  const on = ref.content.querySelector('.st-choice.on');
  if (on) on.scrollIntoView({ block: 'center' });
}

function confirmSheet(title, message, confirmLabel, onConfirm, kind = 'primary') {
  sheet({
    title,
    body: text('p', '', message),
    actions: ['spacer', { label: 'Cancel' }, { label: confirmLabel, kind, onClick: (s) => { s.close(); onConfirm(); } }],
  });
}

function field(label, input) {
  const f = el('label', 'st-field');
  f.append(text('span', 'st-field-label', label), input);
  return f;
}

function input(type, value, attrs = {}) {
  const i = el('input', 'st-input');
  i.type = type;
  i.value = value || '';
  Object.assign(i, attrs);
  i.setAttribute('autocomplete', 'off');
  return i;
}

function errorBox() {
  const e = el('div', 'st-error');
  e.hidden = true;
  e.show = (msg) => { e.textContent = msg; e.hidden = !msg; };
  return e;
}

/**
 * Color picker: palette swatches plus a custom color (hue + shade sliders, or a #hex code).
 * Returns { element, value() }.
 */
function colorPicker(palette, initial) {
  let value = initial;
  const root = el('div');
  const grid = el('div', 'st-swatches');
  const customBtn = el('button', 'st-swatch custom');
  customBtn.type = 'button';
  customBtn.setAttribute('aria-label', 'Custom color');
  const swatches = palette.map((c) => {
    const hex = typeof c === 'string' ? c : c.hex;
    const b = el('button', 'st-swatch');
    b.type = 'button';
    b.style.background = hex;
    b.title = typeof c === 'string' ? hex : c.name;
    b.setAttribute('aria-label', b.title);
    b.addEventListener('click', () => { set(hex); custom.hidden = true; });
    grid.append(b);
    return { b, hex };
  });
  grid.append(customBtn);

  const custom = el('div', 'st-custom');
  const hue = input('range', 0, { min: 0, max: 359, step: 1, className: 'hue' });
  const shade = input('range', 50, { min: 15, max: 85, step: 1 });
  const hex = input('text', value, { maxLength: 7, spellcheck: false });
  const dot = el('span', 'st-dot');
  const lab = (name, i) => { const l = el('label'); l.append(text('span', '', name), i); return l; };
  const pv = el('div', 'st-custom-preview');
  pv.append(dot, hex);
  custom.append(lab('Hue', hue), lab('Shade', shade), pv);
  custom.hidden = true;
  [hue, shade].forEach((i) => i.classList.remove('st-input'));

  const fromSliders = () => set(hslToHex(Number(hue.value), 70, Number(shade.value)), true);
  hue.addEventListener('input', fromSliders);
  shade.addEventListener('input', fromSliders);
  hex.addEventListener('input', () => { if (isHexColor(hex.value)) set(hex.value.toLowerCase(), true); });
  customBtn.addEventListener('click', () => {
    custom.hidden = false;
    const hsl = hexToHsl(value);
    hue.value = hsl.h;
    shade.value = Math.min(85, Math.max(15, hsl.l));
  });

  function set(v, fromCustom = false) {
    value = v;
    swatches.forEach((s) => s.b.classList.toggle('on', s.hex === v));
    const inPalette = swatches.some((s) => s.hex === v);
    customBtn.classList.toggle('on', !inPalette);
    customBtn.style.background = inPalette ? '' : v;
    dot.style.background = v;
    if (!fromCustom || document.activeElement !== hex) hex.value = v;
  }
  set(value);
  if (!swatches.some((s) => s.hex === value)) custom.hidden = false;
  root.append(grid, custom);
  return { element: root, value: () => value };
}

// ---- sections ----

function render() {
  cleanups.forEach((fn) => fn());
  cleanups = [];
  syncers = [];
  pane.innerHTML = '';
  const s = SECTIONS.find((x) => x.id === state.section);
  document.body.classList.toggle('st-in-section', !!s);
  nav.querySelectorAll('.st-nav-item').forEach((b) => b.classList.toggle('on', s && b.dataset.id === (s.parent || s.id)));
  titleEl.textContent = s && window.matchMedia('(max-width: 700px)').matches ? s.label : 'Settings';
  if (!s) return;
  if (s.parent && !s.ownBack) {
    const p = SECTIONS.find((x) => x.id === s.parent);
    pane.append(group(null, backHere(p.id)));
  }
  const content = s.render();
  (Array.isArray(content) ? content : [content]).filter(Boolean).forEach((c) => pane.append(c));
  pane.scrollTop = 0;
}

function rerender() {
  const top = pane.scrollTop;
  render();
  pane.scrollTop = top;
}

// Photos and slideshow

function renderPhotos() {
  const ss = () => state.config.slideshow;
  const out = [];
  out.push(group('Slideshow',
    cfgPick('Timer', 'slideshow.intervalSec',
      () => withCurrent(SLIDE_INTERVALS, ss().intervalSec).map((v) => ({ value: v, label: formatDuration(v) })),
      'Show each photo for'),
    cfgSeg('Order', null, 'slideshow.order', [
      { value: 'shuffle', label: 'Shuffle' }, { value: 'date_taken', label: 'Date taken' }, { value: 'date_added', label: 'Date added' },
    ]),
    cfgToggle('Reverse order', () => {
      if (ss().order === 'shuffle') return 'No effect while shuffling';
      return ss().reverse ? 'Newest photos first' : 'Oldest photos first';
    }, 'slideshow.reverse'),
    toggleRow('Fill frame',
      () => (ss().fit === 'fill' ? 'Photos fill the screen; edges are cropped, faces kept in view' : 'Whole photo shown'),
      () => ss().fit === 'fill', (v) => save({ slideshow: { fit: v ? 'fill' : 'fit' } })),
    segRow('Background', 'Around photos that don\'t fill the screen', [
      { value: 'blur', label: 'Blur' }, { value: 'black', label: 'Black' }, { value: 'color', label: 'Color' },
    ], () => ss().background, (v) => save({ slideshow: { background: v } }).then(rerender)),
    ss().background === 'color' && row({
      title: 'Background color',
      sub: () => ss().backgroundColor,
      cls: 'tappable',
      lead: (() => { const d = el('span', 'st-dot'); syncers.push(() => { d.style.background = ss().backgroundColor; }); return d; })(),
      onTap: () => {
        const picker = colorPicker(BACKGROUND_PALETTE, ss().backgroundColor);
        sheet({
          title: 'Background color',
          body: picker.element,
          actions: ['spacer', { label: 'Cancel' }, { label: 'Save', kind: 'primary', onClick: (s) => { s.close(); save({ slideshow: { backgroundColor: picker.value() } }); } }],
        });
      },
    }),
    cfgPick('Transition', 'slideshow.transitionMs',
      () => withCurrent(TRANSITION_OPTIONS, ss().transitionMs).map((v) => ({ value: v, label: v === 0 ? 'Off (instant)' : `Fade, ${v / 1000} s` }))),
    row({
      title: 'Photo caption',
      sub: () => {
        const c = state.config.caption;
        const parts = [c.showComment && 'comment', c.showLocation && 'location', c.showDate && 'date'].filter(Boolean);
        return parts.length ? `Shows the ${parts.join(', ')} on the photo` : 'Off';
      },
      cls: 'tappable',
      right: el('span', '', svg('chevron', 'st-row-icon')),
      onTap: () => go('caption'),
    }),
  ));

  // Videos (SPEC §6): Frameo's options; the volume itself is the main one in Sound.
  const vid = () => state.config.video;
  out.push(group('Videos',
    cfgToggle('Show videos', () => (vid().include ? 'Videos play in the slideshow' : 'Only photos are shown'), 'video.include'),
    cfgToggle('Autoplay', () => (vid().autoplay ? 'Videos start on their own' : 'The first frame with ▶; tap it to play'), 'video.autoplay'),
    cfgPick('Playback', 'video.playback', [
      { value: 'continue', label: 'Play once and continue', detail: 'The next photo comes a second after the video ends, whatever the timer' },
      { value: 'once', label: 'Play once and wait', detail: 'The last frame stays until the timer ends' },
      { value: 'loop', label: 'Loop', detail: 'Plays again until the timer ends' },
    ]),
    cfgToggle('Start with sound', () => (vid().muted
      ? 'Videos play without sound; tap a video, then Sound'
      : 'At the volume set in Sound'), 'video.muted', true),
    cfgToggle('Auto-mute after 10 minutes', 'Sound goes off when nobody has touched the frame for 10 minutes', 'video.autoMute'),
    row({
      title: 'Volume',
      sub: () => (state.config.sound.volume == null ? 'Set in Sound' : `${state.config.sound.volume}%`),
      cls: 'tappable',
      right: el('span', '', svg('chevron', 'st-row-icon')),
      onTap: () => go('display'),
    }),
    note('A video is never cut off: one longer than the timer plays to the end. The frame plays H.264 and HEVC up to 1080p; the iPhone Shortcut converts other videos.'),
  ));

  out.push(uploadGroup());

  const drives = group('SD card and USB drives',
    cfgToggle('Show photos from SD cards and USB drives', null, 'media.removable.enabled'),
    row({
      title: 'Folder on the drive',
      sub: () => state.config.media.removable.subfolder || 'Whole drive',
      cls: 'tappable',
      onTap: () => {
        const i = input('text', state.config.media.removable.subfolder, { placeholder: 'Photos/Frame', spellcheck: false });
        const err = errorBox();
        sheet({
          title: 'Folder on the drive',
          body: [text('p', '', 'Only this folder (and the folders inside it) is shown. Leave empty for the whole drive.'), field('Folder', i), err],
          actions: ['spacer', { label: 'Cancel' }, {
            label: 'Save', kind: 'primary',
            onClick: async (s) => {
              try {
                state.config = await api('/api/config', { method: 'PATCH', json: { media: { removable: { subfolder: i.value.trim() } } } });
                s.close(); flash('Saved'); sync();
              } catch (e) { err.show(e.message); }
            },
          }],
        });
        setTimeout(() => i.focus(), 50);
      },
    }),
    note('Drives must be FAT32 or NTFS (exFAT isn\'t supported by the frame). A USB drive works only while the PC cable is unplugged.'),
  );

  const lib = group('Library', text('p', 'st-note', 'Loading…'));
  out.push(lib, ...moreGroups('drives', drives));
  loadMedia().then(() => {
    if (state.section !== 'photos') return;
    lib.innerHTML = '';
    lib.append(...libraryRows());
  });
  return out;
}

/** "Add photos from your phone" (SPEC §17): the upload page and the iPhone Shortcut's key. */
function uploadGroup() {
  const ip = () => (state.system && state.system.network.ip) || '<frame address>';
  const pageUrl = () => `http://${ip()}:8080/upload`;
  return group('Add photos from your phone',
    isFrame
      ? row({ title: 'Upload page', sub: () => `On your phone, open ${pageUrl()} (you'll need the web access PIN)` })
      : actionRow('Open the upload page', 'Pick photos and videos on this device and send them to the frame', () => { location.href = '/upload'; }),
    row({
      title: 'iPhone Shortcut',
      sub: 'Send photos and videos from the Share button in Photos. Set-up guide and key',
      cls: 'tappable',
      right: el('span', '', svg('chevron', 'st-row-icon')),
      onTap: shortcutSheet,
    }),
  );
}

function copyText(s) {
  // navigator.clipboard needs HTTPS; the frame is plain HTTP on the LAN.
  const t = el('textarea');
  t.value = s;
  t.style.position = 'fixed';
  t.style.opacity = '0';
  document.body.append(t);
  t.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
  t.remove();
  return ok;
}

/** Why the Shortcut file on the frame is out of date ('' = it isn't). */
function shortcutStale(info) {
  const why = [];
  if (info.keyChanged) why.push('the upload key changed');
  if (info.addressChanged) why.push('the frame\'s address changed');
  return why.join(' and ');
}

/**
 * The ready-made Shortcut file (user request 2026-10-15): the user's own export, kept on the frame so a
 * phone can download it from the guide. Upload from a phone or PC (the frame has no file picker).
 */
function shortcutFileBox(info, reopen) {
  const box = el('div');
  const stale = info.hasFile ? shortcutStale(info) : '';
  const status = !info.hasFile
    ? 'None yet. Export yours from the Shortcuts app (share it → Save to Files) and upload it here; phones can then download it from the set-up guide.'
    : stale
      ? `Out of date: ${stale} since it was uploaded. Export the Shortcut again and upload it.`
      : `Uploaded ${new Date(info.uploadedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}. Phones can download it from the set-up guide.`;
  box.append(text('div', 'st-field-label st-key-label', 'Ready-made Shortcut file'), text('p', '', status));
  const buttons = el('div', 'st-btn-row');
  if (!isFrame) {
    const input = el('input');
    input.type = 'file';
    input.accept = '.shortcut';
    input.hidden = true;
    input.addEventListener('change', async () => {
      const f = input.files && input.files[0];
      if (!f) return;
      try {
        const res = await fetch('/api/shortcut', { method: 'POST', body: f });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || `The frame answered HTTP ${res.status}`);
        toast('Shortcut file saved on the frame');
        reopen();
      } catch (e) { toast(e.message, true); }
    });
    const up = text('button', 'st-btn', info.hasFile ? 'Replace file' : 'Upload file');
    up.type = 'button';
    up.addEventListener('click', () => input.click());
    buttons.append(input, up);
  }
  if (info.hasFile) {
    const dl = text('a', 'st-btn', 'Download');
    dl.href = '/shortcut/download';
    const rm = text('button', 'st-btn danger', 'Remove');
    rm.type = 'button';
    rm.addEventListener('click', async () => {
      try { await api('/api/shortcut', { method: 'DELETE' }); toast('Shortcut file removed'); reopen(); } catch (e) { toast(e.message, true); }
    });
    if (!isFrame) buttons.append(dl);
    buttons.append(rm);
  }
  if (buttons.childElementCount) box.append(buttons);
  return box;
}

async function shortcutSheet() {
  let key;
  let fileInfo = { hasFile: false };
  try {
    [key, fileInfo] = await Promise.all([api('/api/upload/key').then((r) => r.key), api('/api/shortcut')]);
  } catch (e) { toast(e.message, true); return; }
  const ip = (state.system && state.system.network.ip) || '<frame address>';
  const guideUrl = `http://${ip}:8080/shortcut`;
  const keyEl = text('div', 'st-key', key);
  // The step-by-step guide (/shortcut) is made for the iPhone, next to the Shortcuts app.
  const guide = isFrame
    ? note(`On your iPhone, open <b>${guideUrl}</b> in Safari. It walks through the 7 steps with pictures and Copy buttons for the address and this key.`)
    : actionRow('Open the step-by-step guide', 'Best opened on the iPhone itself, next to the Shortcuts app', () => { location.href = '/shortcut'; });
  const actions = [{
    label: 'New key', kind: 'danger',
    onClick: (s) => {
      s.close();
      confirmSheet('Make a new upload key?', 'The old key stops working right away, so the Shortcut needs the new one.', 'New key', async () => {
        try { await api('/api/upload/key/renew', { method: 'POST' }); toast('New upload key made'); shortcutSheet(); } catch (e) { toast(e.message, true); }
      }, 'danger');
    },
  }, 'spacer'];
  if (!isFrame) {
    actions.push({ label: 'Copy key', onClick: () => toast(copyText(key) ? 'Key copied' : 'Select the key and copy it', false) });
  }
  actions.push({ label: 'Close', kind: 'primary' });
  sheet({
    title: 'iPhone Shortcut',
    body: [
      text('p', '', 'The Shortcut uses its own key instead of the PIN. The key can only add photos and videos.'),
      guide,
      text('div', 'st-field-label st-key-label', 'Upload key'), keyEl,
      shortcutFileBox(fileInfo, shortcutSheet),
    ],
    actions,
  });
}

async function loadMedia() {
  try {
    const [media, lib, trash] = await Promise.all([api('/api/media'), api('/api/library?limit=1'), api('/api/trash')]);
    state.media = media;
    state.libCounts = lib.counts;
    state.trashCount = trash.items.length;
  } catch (e) { toast(e.message, true); }
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function libraryRows() {
  const m = state.media;
  if (!m || !state.libCounts) return [text('h2', 'st-group-title', 'Library'), note('Couldn\x27t load the library.')];
  const c = state.libCounts;
  const rows = [text('h2', 'st-group-title', 'Library')];
  const parts = [plural(c.all, 'photo or video', 'photos and videos')];
  if (c.problems) parts.push(`${c.problems} can't be shown`);
  if (c.hidden) parts.push(`${c.hidden} hidden`);
  const chevron = () => el('span', '', svg('chevron', 'st-row-icon'));
  rows.push(row({ title: m.indexing ? 'Library (scanning for photos…)' : 'Library',     sub: `${parts.join(' · ')}. Comments, hide, delete.`,
    cls: 'tappable', right: chevron(), onTap: () => go('library') }));
  rows.push(row({ title: 'Trash',
    sub: state.trashCount ? `${plural(state.trashCount, 'item', 'items')} · deleted for good after 30 days` : 'Empty',
    cls: 'tappable', right: chevron(), onTap: () => go('trash') }));
  for (const v of m.volumes) {
    rows.push(infoRow(v.label || v.id, v.mounted ? plural(v.items, 'item', 'items') : `Not connected · ${plural(v.items, 'item', 'items')} remembered`));
  }
  rows.push(actionRow('Scan for new photos now', `Last scan ${agoText(m.lastScanAt)}`, async () => {
    try {
      await api('/api/media/rescan', { method: 'POST' });
      toast('Scanning. New photos appear in the slideshow within a few slides.');
    } catch (e) { toast(e.message, true); }
  }));
  return rows;
}

// Library and Trash (sub-pages of Photos): tap a photo to change it (comment, fit, hide, delete;
// SPEC §15), or Select several, then delete (internal storage: to the trash for 30 days) or hide
// (USB drive / SD card: the frame can't delete there).

const LIB_FILTERS = [
  { value: 'all', label: 'All' }, { value: 'problems', label: 'Can\'t be shown' }, { value: 'hidden', label: 'Hidden' },
];
const LIB_PAGE = 60;
let libFilter = 'all';

/** Pages opened from other pages, so Back returns to the one you came from (not always the section). */
let navStack = [];

/** The back link for the page shown now: to the previous page, or (opened directly) to `fallback`. */
function backHere(fallback) {
  const id = navStack.length ? navStack[navStack.length - 1] : fallback;
  const target = SECTIONS.find((x) => x.id === id);
  const b = el('button', 'st-backlink', svg('back'));
  b.type = 'button';
  b.append(text('span', '', target ? target.label : 'Back'));
  b.addEventListener('click', () => goBack(fallback));
  return b;
}

/** Back one page: the previous one if there is one, else `fallback`. */
function goBack(fallback) {
  const id = navStack.length ? navStack.pop() : fallback;
  go(id, { push: false });
}


/** Sticky bar at the bottom of the pane while something is selected. */
function selectionBar() {
  const bar = el('div', 'st-selbar');
  bar.hidden = true;
  const count = el('span', 'st-selbar-count');
  const buttons = el('div', 'st-selbar-buttons');
  bar.append(count, buttons);
  return {
    el: bar,
    show(n, actions) {
      bar.hidden = n === 0;
      count.textContent = `${n} selected`;
      buttons.innerHTML = '';
      for (const a of actions) {
        const b = text('button', `st-btn ${a.kind || ''}`, a.label);
        b.type = 'button';
        b.addEventListener('click', a.onClick);
        buttons.append(b);
      }
    },
  };
}

function renderLibrary() {
  const seg = el('div', 'st-seg st-lib-seg');
  const grid = el('div', 'st-grid');
  const status = note('Loading…');
  const more = text('button', 'st-btn st-more', 'Show more');
  more.type = 'button';
  more.hidden = true;
  const bar = selectionBar();
  let items = [];
  let total = 0;
  const selected = new Map(); // id -> item
  let selecting = false;
  const selectBtn = text('button', 'st-btn st-lib-select', 'Select');
  selectBtn.type = 'button';
  const tools = el('div', 'st-lib-tools');
  tools.append(seg, selectBtn);
  const hint = () => (selecting ? 'Tap photos to select them.' : 'Tap a photo to add a comment, hide it or delete it. Select several with Select.');
  const setSelecting = (on) => {
    selecting = on;
    selectBtn.textContent = on ? 'Done' : 'Select';
    selectBtn.classList.toggle('primary', on);
    if (!on) { selected.clear(); grid.querySelectorAll('.st-tile.on').forEach((t) => t.classList.remove('on')); updateBar(); }
    if (total) status.textContent = hint();
  };
  selectBtn.addEventListener('click', () => setSelecting(!selecting));

  const segButtons = LIB_FILTERS.map((f) => {
    const b = text('button', '', f.label);
    b.type = 'button';
    b.addEventListener('click', () => { if (libFilter !== f.value) { libFilter = f.value; load(true); } });
    seg.append(b);
    return { f, b };
  });

  const updateBar = () => {
    const sel = [...selected.values()];
    const actions = [{ label: 'Clear', onClick: () => { selected.clear(); grid.querySelectorAll('.st-tile.on').forEach((t) => t.classList.remove('on')); updateBar(); } }];
    if (libFilter === 'hidden') {
      actions.push({ label: 'Unhide', kind: 'primary', onClick: () => act('unhide', sel) });
    } else {
      const allRemovable = sel.every((it) => it.source !== 'internal');
      actions.push({ label: allRemovable ? 'Hide' : 'Delete', kind: 'danger', onClick: () => confirmDelete(sel) });
    }
    bar.show(sel.length, actions);
  };

  const tile = (it) => {
    const t = el('button', 'st-tile');
    t.type = 'button';
    t.title = it.detail ? `${it.name}: ${it.detail}` : it.name;
    if (it.thumb) {
      const img = el('img');
      img.loading = 'lazy';
      img.alt = '';
      img.src = it.thumb;
      t.append(img);
      if (it.type === 'video') t.append(text('span', 'st-tile-video', `▶ ${clipLength(it.durationMs)}`.trim()));
    } else {
      const ph = el('div', 'st-tile-ph');
      ph.append(text('div', 'st-tile-name', it.name),
        text('div', 'st-tile-why', it.status === 'ok' || it.status === 'pending' ? 'Preparing…' : (it.detail || 'Can\'t be shown')));
      t.append(ph);
    }
    const badges = el('div', 'st-tile-badges');
    if (it.source !== 'internal') badges.append(text('span', '', it.volume));
    if (it.hidden) badges.append(text('span', '', 'Hidden'));
    if (it.status !== 'ok' && it.status !== 'pending') badges.append(text('span', 'warn', 'Can\'t be shown'));
    t.append(badges, el('span', 'st-tile-check', svg('check')));
    if (selected.has(it.id)) t.classList.add('on');
    t.addEventListener('click', () => {
      if (!selecting) { photoSheet(it); return; }
      if (selected.has(it.id)) selected.delete(it.id); else selected.set(it.id, it);
      t.classList.toggle('on', selected.has(it.id));
      updateBar();
    });
    return t;
  };

  async function load(reset) {
    if (reset) { items = []; selected.clear(); grid.innerHTML = ''; updateBar(); }
    segButtons.forEach(({ f, b }) => b.classList.toggle('on', f.value === libFilter));
    try {
      const r = await api(`/api/library?filter=${libFilter}&offset=${items.length}&limit=${LIB_PAGE}`);
      if (state.section !== 'library') return;
      total = r.total;
      segButtons.forEach(({ f, b }) => { b.textContent = `${f.label} (${r.counts[f.value]})`; });
      items = items.concat(r.items);
      r.items.forEach((it) => grid.append(tile(it)));
      const empty = { all: 'No photos yet.', problems: 'Every file can be shown.', hidden: 'Nothing is hidden.' }[libFilter];
      status.textContent = total === 0 ? empty : hint();
      more.hidden = items.length >= total;
    } catch (e) { status.textContent = e.message; }
  }
  more.addEventListener('click', () => load(false));

  function confirmDelete(sel) {
    const internal = sel.filter((it) => it.source === 'internal').length;
    const removable = sel.length - internal;
    const parts = [];
    if (internal) parts.push(`${plural(internal, 'file goes', 'files go')} to the Trash. You can restore ${internal === 1 ? 'it' : 'them'} for 30 days.`);
    if (removable) parts.push(`${plural(removable, 'file is', 'files are')} on a USB drive or SD card, which the frame can't change, so ${removable === 1 ? 'it is' : 'they are'} hidden instead. Delete ${removable === 1 ? 'it' : 'them'} on a computer to remove ${removable === 1 ? 'it' : 'them'} for good.`);
    const title = internal ? `Delete ${plural(sel.length, 'file', 'files')}?` : `Hide ${plural(sel.length, 'file', 'files')}?`;
    confirmSheet(title, parts.join(' '), internal ? 'Delete' : 'Hide', () => act('delete', sel), 'danger');
  }

  /** One photo: comment, Show as (Auto/Fit/Fill), Hide/Unhide, Delete (SPEC §15). */
  async function photoSheet(it) {
    let p;
    try { p = await api(`/api/media/${it.id}`); } catch (e) { toast(e.message, true); load(true); return; }
    const body = [];
    if (p.url) {
      const preview = el('div', 'st-photo-preview');
      if (p.type === 'video' && !isFrame) {
        // Phones and PCs play the original; the frame shows the poster (it plays videos natively, SPEC §6).
        const video = el('video');
        Object.assign(video, { controls: true, playsInline: true, preload: 'metadata', poster: p.url, src: `/media/video/${p.id}` });
        preview.append(video);
      } else {
        const img = el('img');
        img.alt = '';
        img.src = p.url;
        preview.append(img);
      }
      body.push(preview);
    }
    const facts = [it.name, it.volume];
    if (p.takenAt) facts.push(`taken ${new Date(p.takenAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`);
    if (p.placeName) facts.push(p.place ? p.placeName : `${p.placeName} (left out of the caption)`);
    if (p.privatePlace) facts.push('private spot');
    if (p.hidden) facts.push('hidden');
    if (it.status !== 'ok' && it.status !== 'pending') facts.push(it.detail || "can't be shown");
    body.push(text('p', 'st-photo-facts', facts.join(' · ')));

    if (p.url) {
      const auto = state.config.slideshow.fit === 'fill' ? 'Fill' : 'Fit';
      const options = [{ value: null, label: `Auto (${auto})` }, { value: 'fit', label: 'Fit' }, { value: 'fill', label: 'Fill' }];
      const segEl = el('div', 'st-seg');
      let fit = p.fit || null;
      const buttons = options.map((o) => {
        const b = text('button', '', o.label);
        b.type = 'button';
        b.addEventListener('click', async () => {
          if (fit === o.value) return;
          const before = fit;
          fit = o.value;
          paint();
          try { await api(`/api/media/${p.id}`, { method: 'PATCH', json: { fit } }); flash('Saved'); } catch (e) { fit = before; paint(); toast(e.message, true); }
        });
        segEl.append(b);
        return b;
      });
      const paint = () => options.forEach((o, i) => buttons[i].classList.toggle('on', fit === o.value));
      paint();
      body.push(field('Show as', segEl));
      body.push(text('p', 'st-photo-note', 'Fill crops the photo to fill the screen. To choose what stays in view, tap the photo on the frame, then Position.'));
    }

    const area = el('textarea', 'st-input st-comment');
    area.maxLength = 500;
    area.rows = 3;
    area.placeholder = 'Add a comment';
    area.value = p.comment || '';
    const count = text('span', 'st-comment-count', '');
    const updateCount = () => { count.textContent = `${area.value.length} / 500`; };
    area.addEventListener('input', updateCount);
    updateCount();
    const commentField = field('Comment', area);
    commentField.append(count);
    body.push(commentField, text('p', 'st-photo-note', 'Shown in the caption on the photo (Settings → Photo caption).'));
    {
      const row2 = el('div', 'st-btn-row');
      const add = (label, mode) => {
        const b = text('button', 'st-btn', label);
        b.type = 'button';
        b.addEventListener('click', () => photoLocationSheet(p, mode, () => load(true)));
        row2.append(b);
      };
      add(p.placeLabel || p.placeName ? 'Change location' : 'Add location', 'name');
      add(p.myPlace ? 'Private place' : 'Mark private', 'private');
      body.push(row2);
    }

    const saveComment = async (s) => {
      const value = area.value.trim();
      if (value === (p.comment || '')) { s.close(); return; }
      try {
        await api(`/api/media/${p.id}`, { method: 'PATCH', json: { comment: value || null } });
        toast(value ? 'Comment saved' : 'Comment removed');
        s.close();
        load(true);
      } catch (e) { toast(e.message, true); }
    };
    const actions = [];
    if (p.hidden) actions.push({ label: 'Unhide', onClick: (s) => { s.close(); act('unhide', [it]); } });
    else actions.push({ label: 'Hide', onClick: (s) => { s.close(); act('hide', [it]); } });
    if (it.source === 'internal') actions.push({ label: 'Delete', kind: 'danger', onClick: (s) => { s.close(); confirmDelete([it]); } });
    actions.push('spacer', { label: 'Cancel' }, { label: 'Save', kind: 'primary', onClick: saveComment });
    sheet({ title: 'Photo', body, actions });
  }

  async function act(what, sel) {
    try {
      const r = await api(`/api/library/${what}`, { method: 'POST', json: { ids: sel.map((it) => it.id) } });
      const msg = what === 'unhide' ? `${plural(r.unhidden, 'file', 'files')} shown again`
        : what === 'hide' ? `${plural(r.hidden, 'file', 'files')} hidden`
        : [r.trashed && `${r.trashed} moved to the Trash`, r.hidden && `${r.hidden} hidden`, r.failed.length && `${r.failed.length} couldn't be deleted`].filter(Boolean).join(', ');
      toast(msg || 'Done', r.failed && r.failed.length > 0);
      load(true);
    } catch (e) { toast(e.message, true); }
  }

  load(true);
  return [group(null, backHere('photos'), tools, status, grid, more), bar.el];
}

function renderTrash() {
  const list = el('div');
  const status = note('Loading…');
  const bar = selectionBar();
  const selected = new Set();
  let items = [];
  const empty = actionRow('Empty the Trash', 'Deletes everything here for good', () =>
    confirmSheet('Empty the Trash?', `${plural(items.length, 'file is', 'files are')} deleted for good. This can't be undone.`, 'Empty', () => purge(null), 'danger'), 'danger');
  empty.hidden = true;

  const updateBar = () => bar.show(selected.size, [
    { label: 'Delete for good', kind: 'danger', onClick: () => confirmSheet(`Delete ${plural(selected.size, 'file', 'files')} for good?`, 'This can\'t be undone.', 'Delete', () => purge([...selected]), 'danger') },
    { label: 'Restore', kind: 'primary', onClick: restore },
  ]);

  async function load() {
    selected.clear();
    updateBar();
    try {
      const r = await api('/api/trash');
      if (state.section !== 'trash') return;
      items = r.items;
      list.innerHTML = '';
      status.textContent = items.length ? `Deleted photos stay here for ${r.days} days, then they're deleted for good. Tap to select.` : 'The Trash is empty.';
      empty.hidden = !items.length;
      for (const t of items) {
        const lead = el('span', 'st-trash-thumb');
        if (t.thumb) lead.style.backgroundImage = `url("${t.thumb}")`;
        const daysLeft = Math.max(0, Math.ceil((t.expiresAt - Date.now()) / 86400000));
        const r2 = row({ title: t.name, sub: `Deleted ${agoText(t.deletedAt)} · ${plural(daysLeft, 'day', 'days')} left`, lead, cls: 'tappable st-trash-row',
          right: el('span', 'st-tile-check', svg('check')),
          onTap: () => { if (selected.has(t.id)) selected.delete(t.id); else selected.add(t.id); r2.classList.toggle('on', selected.has(t.id)); updateBar(); } });
        list.append(r2);
      }
    } catch (e) { status.textContent = e.message; }
  }

  async function restore() {
    try {
      const r = await api('/api/trash/restore', { method: 'POST', json: { ids: [...selected] } });
      toast(`${plural(r.restored, 'file', 'files')} restored. ${r.restored === 1 ? 'It shows' : 'They show'} again within a minute.`);
      load();
    } catch (e) { toast(e.message, true); }
  }

  async function purge(ids) {
    try {
      const r = await api('/api/trash/delete', { method: 'POST', json: ids ? { ids } : { all: true } });
      toast(`${plural(r.deleted, 'file', 'files')} deleted for good`);
      load();
    } catch (e) { toast(e.message, true); }
  }

  load();
  return [group(null, backHere('photos'), status, list, empty), bar.el];
}

// Calendars

function renderCalendars() {
  const c = () => state.config.calendar;
  const list = group('Your calendars', note('Loading…'));
  const fill = () => {
    if (state.section !== 'calendars') return;
    list.innerHTML = '';
    list.append(...calendarListRows());
  };
  loadCalendars().then(fill);

  const firstDayName = () => WEEKDAYS[c().firstDay];
  return [
    list,
    group('Calendar view',
      cfgSeg('Calendar view', 'The full-screen calendar opens in this view', 'calendar.defaultView', [
        { value: 'day', label: 'Day' }, { value: 'week', label: 'Week' }, { value: 'month', label: 'Month' },
      ]),
      cfgPick('First day of week', 'calendar.firstDay', WEEKDAYS.map((d, i) => ({ value: i, label: `The week starts on ${d}` }))),
      cfgToggle('Start calendar on current day',
        () => (c().startOnToday ? 'Week view starts today' : `Week view starts on ${firstDayName()}`), 'calendar.startOnToday'),
      cfgToggle('Fade past events', null, 'calendar.fadePast'),
      ...more('view',
        cfgToggle('Show week numbers', null, 'calendar.weekNumbers'),
        cfgToggle('Show time left on the event happening now', 'In the day panel: "Now · 12 min left" instead of "Now"',
          'calendar.nowTimeLeft')),
    ),
    group('Sync',
      cfgPick('Check for changes every', 'calendar.syncIntervalMin',
        () => withCurrent(SYNC_OPTIONS, c().syncIntervalMin).map((v) => ({ value: v, label: formatDuration(v * 60) }))),
      actionRow('Sync now', null, async () => {
        try {
          await api('/api/calendars/refresh?force=1', { method: 'POST' });
          toast('Syncing calendars…');
          setTimeout(() => loadCalendars().then(fill), 4000);
        } catch (e) { toast(e.message, true); }
      }),
    ),
  ];
}

async function loadCalendars() {
  try { state.cal = await api('/api/calendars'); } catch (e) { toast(e.message, true); }
}

function calendarListRows() {
  const rows = [text('h2', 'st-group-title', 'Your calendars')];
  const cals = state.cal ? state.cal.calendars : [];
  for (const cal of cals) {
    const dot = el('span', 'st-dot');
    dot.style.background = cal.color;
    const tg = el('span', `st-toggle${cal.enabled ? ' on' : ''}`);
    tg.setAttribute('role', 'switch');
    tg.setAttribute('aria-checked', String(cal.enabled));
    tg.setAttribute('aria-label', `Show ${cal.name}`);
    tg.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        await api(`/api/calendars/${cal.id}`, { method: 'PATCH', json: { enabled: !cal.enabled } });
        flash('Saved');
        await loadCalendars();
        rerender();
      } catch (err) { toast(err.message, true); }
    });
    const r = row({ title: cal.name, sub: feedStatusText(cal), lead: dot, right: tg, onTap: () => calendarSheet(cal) });
    if (cal.status === 'error' && cal.enabled) r.querySelector('.st-row-sub').classList.add('error');
    rows.push(r);
  }
  if (!cals.length) rows.push(note('No calendars yet. Add one with its secret iCal link from Google Calendar.'));
  rows.push(row({
    title: 'Add calendar',
    sub: 'Name, secret iCal link, and color',
    cls: 'accent',
    lead: el('span', '', svg('add', 'st-row-icon')),
    onTap: () => calendarSheet(null),
  }));
  if (isFrame) {
    rows.push(note(`Pasting a link is easier from a phone or computer: open ${lanAddress()} in its browser.`));
  }
  return rows;
}

function lanAddress() {
  const ip = state.system && state.system.network.ip;
  return ip ? `<b>http://${ip}:8080/settings</b>` : 'this frame\'s address (port 8080, /settings)';
}

const LINK_HELP = 'In Google Calendar on a computer: Settings → your calendar → Integrate calendar → ' +
  '"Secret address in iCal format". Anyone with this link can see the calendar, so it is never shown again.';

/** Add (cal = null) or edit a calendar. The link is write-only: never shown, only replaced. */
function calendarSheet(cal) {
  const adding = !cal;
  const name = input('text', cal ? cal.name : '', { maxLength: 60, placeholder: 'Family' });
  const link = input('password', '', { placeholder: 'https://calendar.google.com/calendar/ical/…/basic.ics', spellcheck: false });
  const linkField = field(adding ? 'Secret iCal link' : 'New secret iCal link', link);
  const err = errorBox();
  const usedColors = state.cal ? state.cal.calendars.map((c) => c.color) : [];
  const freeColor = (PALETTE.find((p) => !usedColors.includes(p.hex)) || PALETTE[6]).hex;
  const picker = colorPicker(PALETTE, cal ? cal.color : freeColor);
  let busy = cal ? cal.busy : false;
  const body = [field('Name', name)];

  if (adding) {
    body.push(linkField, note(LINK_HELP));
  } else {
    linkField.hidden = true;
    const status = row({
      title: cal.hasUrl ? `Link: ${cal.host || 'set'}` : 'No link saved',
      sub: `${feedStatusText(cal)}${cal.status === 'ok' && cal.events != null ? ` · ${cal.events} events` : ''}`,
    });
    const replace = actionRow('Replace link', 'For example after resetting the secret address in Google Calendar', () => {
      replace.hidden = true;
      linkField.hidden = false;
      link.focus();
    });
    body.push(status, replace, linkField);
  }
  const colorLabel = text('div', 'st-field-label', 'Color');
  colorLabel.style.padding = '0.4rem 1.4rem 0';
  body.push(colorLabel, picker.element);
  body.push(toggleRow('Show as "Busy"', 'Hide event titles and details on the frame', () => busy, (v) => { busy = v; sync(); }));
  // Event reminders on the frame (SPEC §11): a switch and one or more times; 10 min to start with.
  const rem = cal && cal.reminders ? cal.reminders : { enabled: false, minutes: [10] };
  let remOn = !!rem.enabled;
  let remMinutes = rem.minutes && rem.minutes.length ? [...rem.minutes] : [10];
  const chips = el('div', 'st-chips');
  const chipsLabel = text('div', 'st-field-label', 'Remind me before (pick one or more)');
  chipsLabel.style.padding = '0.2rem 1.4rem 0';
  const chipButtons = REMINDER_MINUTES.map((m) => {
    const b = text('button', 'st-chip', m === 60 ? '1 hour' : `${m} min`);
    b.type = 'button';
    b.addEventListener('click', () => {
      remMinutes = remMinutes.includes(m) ? remMinutes.filter((x) => x !== m) : [...remMinutes, m].sort((a, c) => a - c);
      showChips();
    });
    chips.append(b);
    return b;
  });
  function showChips() {
    REMINDER_MINUTES.forEach((m, i) => {
      chipButtons[i].classList.toggle('on', remMinutes.includes(m));
      chipButtons[i].setAttribute('aria-pressed', String(remMinutes.includes(m)));
    });
    chips.hidden = !remOn;
    chipsLabel.hidden = !remOn;
  }
  showChips();
  body.push(toggleRow('Reminders on the frame', 'A popup and a chime before each event; not for all-day events, quiet during sleep hours',
    () => remOn, (v) => { remOn = v; showChips(); sync(); }), chipsLabel, chips);
  const email = input('email', cal ? cal.email || '' : '', { maxLength: 254, placeholder: 'you@example.com', spellcheck: false });
  body.push(field('Your email in this calendar (optional)', email),
    note('Events you declined are crossed out. Use the address you\'re invited with; it stays on the frame.'));
  body.push(err);

  const submit = async (s) => {
    err.show('');
    const payload = { name: name.value.trim(), color: picker.value(), busy, email: email.value.trim(),
      reminders: { enabled: remOn, minutes: remMinutes } };
    if (remOn && !remMinutes.length) { err.show('Pick at least one reminder time, or switch reminders off.'); return; }
    if (payload.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) { err.show('That email address doesn\'t look right.'); return; }
    if (adding || link.value.trim()) payload.url = link.value.trim();
    if (!payload.name) { err.show('Enter a name.'); return; }
    if (adding && !payload.url) { err.show('Paste the secret iCal link.'); return; }
    try {
      if (adding) await api('/api/calendars', { method: 'POST', json: payload });
      else await api(`/api/calendars/${cal.id}`, { method: 'PATCH', json: payload });
      s.close();
      flash('Saved');
      toast(adding ? `${payload.name} added. The first sync takes a few seconds.` : `${payload.name} saved`);
      await loadCalendars();
      rerender();
      if (payload.url) setTimeout(async () => { await loadCalendars(); if (state.section === 'calendars') rerender(); }, 5000);
    } catch (e) { err.show(e.message); }
  };

  const actions = [];
  if (!adding) {
    actions.push({
      label: 'Delete', kind: 'danger',
      onClick: (s) => {
        s.close();
        confirmSheet(`Delete ${cal.name}?`, 'It disappears from the frame. To get it back you need its secret link again.', 'Delete', async () => {
          try {
            await api(`/api/calendars/${cal.id}`, { method: 'DELETE' });
            flash('Deleted');
            await loadCalendars();
            rerender();
          } catch (e) { toast(e.message, true); }
        }, 'danger');
      },
    });
  }
  actions.push('spacer', { label: 'Cancel' }, { label: adding ? 'Add' : 'Save', kind: 'primary', onClick: submit });
  sheet({ title: adding ? 'Add calendar' : `Edit ${cal.name}`, body, actions });
  if (adding) setTimeout(() => name.focus(), 50);
}

// Layout

const PRESETS = [
  { value: 'hybrid', label: 'Hybrid', sub: 'Photo with the clock and today\'s events beside it (two days in portrait)', pic: '<span class="ph"></span><span class="cal"></span>' },
  { value: 'pictures', label: 'Pictures only', sub: 'Full-screen photos with the clock overlay and a calendar button', pic: '<span class="ph"></span>' },
  { value: 'calendar', label: 'Calendar', sub: 'The full-screen calendar, no photos', pic: '<span class="full"></span>' },
];

const BLANK = { value: 'blank', label: 'Blank', sub: 'Nothing on it yet: opens the layout editor', pic: '' };
const CUSTOM = { value: 'custom', label: 'Custom', sub: 'Your own layout from the editor', pic: '<span class="custom"></span>' };

function presetCards(current, onPick, withBlank = false, extra = []) {
  const cards = el('div', 'st-presets');
  const choices = [...PRESETS, ...extra, ...(withBlank ? [BLANK] : [])];
  const buttons = choices.map((p) => {
    const b = el('button', 'st-preset');
    b.type = 'button';
    b.innerHTML = `<div class="st-preset-pic">${p.pic}</div>`;
    b.append(text('div', 'st-preset-name', p.label), text('div', 'st-preset-sub', p.sub));
    b.addEventListener('click', () => { mark(p.value); onPick(p.value); });
    cards.append(b);
    return b;
  });
  const mark = (v) => choices.forEach((p, i) => buttons[i].classList.toggle('on', p.value === v));
  mark(current);
  return cards;
}

/** Saves a page list change ({ pages, home } from layout-core), or says why it can't be done. */
function savePages(change, why) {
  if (!change) { toast(why, true); return; }
  save({ layout: { pages: change.pages, home: change.home } });
}

const pageKind = (p) => (p.preset ? PRESET_NAMES[p.preset] : 'Custom layout');

/** The layout editor for a page: on the frame's own screen, or on the copy of the frame elsewhere. */
const editUrl = (id) => (isFrame ? `/?edit=${encodeURIComponent(id)}` : `/?view=frame&edit=${encodeURIComponent(id)}`);

/** The layout editor for page `id`: over the photo page this Settings covers, else a new page. */
function editLayoutPage(id, blank = false) {
  if (host) host.edit(id, blank);
  else location.href = `${editUrl(id)}${blank ? '&blank=1' : ''}`;
}

/**
 * Settings → Layout (user decision 2026-10-16): one layout, no pages by default. Your layout is a choice of
 * cards (Custom once you have one; it's remembered while another is shown), Customize edits it in place,
 * Start from blank replaces it from the editor; more pages are a hidden extra at the bottom.
 */
function renderLayout() {
  const layout = () => state.config.layout;
  const homeId = () => homePage(layout()).id;
  const cardsBox = el('div');
  let cardsKey = '';
  const drawCards = () => {
    const hasCustom = layoutChoice(layout()) === 'custom' || !!layout().custom;
    const key = JSON.stringify([layoutChoice(layout()), hasCustom]);
    if (key === cardsKey) return;
    cardsKey = key;
    cardsBox.innerHTML = '';
    cardsBox.append(presetCards(layoutChoice(layout()), (v) => {
      if (v === layoutChoice(layout())) return;
      const change = chooseLayout(layout(), v);
      if (!change) { toast('There is no custom layout yet: use Customize', true); return; }
      save({ layout: change });
    }, false, hasCustom ? [CUSTOM] : []));
  };
  drawCards();
  syncers.push(drawCards);
  const customize = actionRow('Customize', 'Move, resize, add, or remove what\'s on your layout, in the layout editor',
    () => editLayoutPage(homeId()));
  const blank = actionRow('Start from blank', 'An empty layout in the editor; yours stays until you save the new one',
    () => confirmSheet('Start from blank?', 'The layout editor opens with nothing on it. Your layout stays as it is until you save there.',
      'Start', () => editLayoutPage(homeId(), true)));
  const hybridGroup = group('Hybrid',
    cfgSeg('Calendar in landscape', 'Beside the photo', 'layout.hybridCalendar.landscape', [
      { value: 'left', label: 'Left' }, { value: 'right', label: 'Right' },
    ]),
    cfgSeg('Calendar in portrait', 'Above or below the photo', 'layout.hybridCalendar.portrait', [
      { value: 'top', label: 'Top' }, { value: 'bottom', label: 'Bottom' },
    ]));
  syncers.push(() => { hybridGroup.hidden = layoutChoice(layout()) !== 'hybrid'; });
  hybridGroup.hidden = layoutChoice(layout()) !== 'hybrid';
  const list = el('div');
  const draw = () => {
    list.innerHTML = '';
    const pages = layoutPages(layout());
    const home = homePage(layout()).id;
    pages.forEach((p) => {
      const sub = p.id === home ? `Home page · ${pageKind(p)}` : pageKind(p);
      list.append(row({ title: p.name, sub, cls: 'tappable', right: el('span', '', svg('chevron', 'st-row-icon')), onTap: () => pageSheet(p.id) }));
    });
  };
  draw();
  let last = '';
  syncers.push(() => {
    const key = JSON.stringify([layout().pages, layout().home, layout().preset]);
    if (key !== last) { last = key; draw(); }
  });
  const add = actionRow('Add a page', () => (layoutPages(layout()).length >= MAX_PAGES ? `The frame holds up to ${MAX_PAGES} pages` : null), addPageSheet);
  return [
    group('Your layout', cardsBox, customize, blank),
    // Hybrid's calendar column (user request 2026-10-16): left or right in landscape, above or below in portrait.
    hybridGroup,
    group('Touch',
      cfgPick('Return to your layout after', 'layout.inactivityReturnSec',
        () => withCurrent(INACTIVITY_OPTIONS, layout().inactivityReturnSec).map((v) => ({ value: v, label: formatDuration(v) })),
        'Return after no touch for'),
      note('Applies to other pages, the full-screen calendar, days swiped away from today, this settings page, and Android\'s Wi-Fi screen on the frame.'),
    ),
    // More pages: a hidden extra (e.g. a Home Assistant page someday); dots and the Pages row appear with a second page.
    ...moreGroups('pages', group('More pages', list, add,
      note('Your layout is the home page. Extra pages are switched with the dots at the bottom of the frame or Pages in the menu (tap the photo).'))),
  ];
}

function addPageSheet() {
  const pages = layoutPages(state.config.layout);
  if (pages.length >= MAX_PAGES) { toast(`The frame holds up to ${MAX_PAGES} pages`, true); return; }
  let preset = 'pictures';
  let named = false; // the name follows the chosen layout until it is typed in
  const name = input('text', uniquePageName(pages, PRESET_NAMES[preset]), { maxLength: MAX_NAME });
  name.addEventListener('input', () => { named = true; });
  const cards = presetCards(preset, (v) => {
    preset = v;
    if (!named) name.value = uniquePageName(pages, PRESET_NAMES[v] || 'New page');
  }, true);
  sheet({
    title: 'Add a page',
    body: [field('Name', name), text('p', '', 'Starts as'), cards],
    actions: ['spacer', { label: 'Cancel' }, {
      label: 'Add', kind: 'primary',
      onClick: async (s) => {
        s.close();
        const change = addPage(state.config.layout, preset, name.value);
        if (!change) { toast('The page could not be added', true); return; }
        await save({ layout: { pages: change.pages, home: change.home } });
        // A blank page goes straight to the layout editor (if it was saved).
        const added = change.pages[change.pages.length - 1];
        if (preset === 'blank' && layoutPages(state.config.layout).some((p) => p.id === added.id)) editLayoutPage(added.id);
      },
    }],
  });
}

function pageSheet(id) {
  const l = state.config.layout;
  const pages = layoutPages(l);
  const i = pages.findIndex((p) => p.id === id);
  const page = pages[i];
  if (!page) return;
  const isHome = homePage(l).id === id;
  let preset = page.preset;
  const name = input('text', page.name, { maxLength: MAX_NAME });
  const body = [field('Name', name)];
  if (page.preset) body.push(text('p', '', 'Layout'), presetCards(preset, (v) => { preset = v; }));
  else body.push(text('p', '', 'A custom layout.'));
  if (page.preset) body.push(text('p', '', 'Edit layout turns it into a custom layout, starting from this one.'));
  // Quick actions apply at once and close the sheet.
  const quick = (label, change, why) => ({ label, onClick: (s) => { s.close(); savePages(change(), why); } });
  const actions = [];
  if (pages.length > 1) {
    actions.push({
      label: 'Delete', kind: 'danger',
      onClick: (s) => {
        s.close();
        confirmSheet(`Delete ${page.name}?`, isHome ? 'The first page left becomes the home page.' : 'The other pages stay as they are.',
          'Delete', () => savePages(removePage(state.config.layout, id), 'The last page can\'t be deleted'), 'danger');
      },
    });
  }
  actions.push({ label: 'Edit layout', onClick: (s) => { s.close(); editLayoutPage(id); } });
  if (!isHome) actions.push(quick('Make home page', () => setHomePage(state.config.layout, id), 'Page not found'));
  if (i > 0) actions.push(quick('Move up', () => movePage(state.config.layout, id, -1), 'Already first'));
  if (i < pages.length - 1) actions.push(quick('Move down', () => movePage(state.config.layout, id, 1), 'Already last'));
  actions.push('spacer', { label: 'Cancel' }, {
    label: 'Save', kind: 'primary',
    onClick: (s) => { s.close(); savePages(editPage(state.config.layout, id, { name: name.value, preset }), 'Page not found'); },
  });
  sheet({ title: page.name, body, actions });
}

// Display and sleep (SPEC §18)

async function loadPower() {
  try { state.power = await api('/api/power'); } catch (e) { /* keep the last state */ }
  sync();
}

function renderDisplay() {
  loadPower();
  const timer = setInterval(loadPower, 15000);
  cleanups.push(() => clearInterval(timer));
  const hour12 = () => state.config.clock.hour12;
  const power = () => state.power;
  const when = (ms) => dayTimeText(ms, Date.now(), (state.system && state.system.timeZone) || undefined, hour12());

  const brightness = sliderRow('Brightness',
    () => (power() && !power().brightness.canWrite ? 'Needs a one-time set-up from a computer before it changes the screen' : null),
    { min: 5, max: 100, step: 1, format: (v) => `${v}%` },
    () => state.config.display.brightness ?? (power() && power().brightness.systemPercent) ?? 40,
    (v) => save({ display: { brightness: v } }));

  // Schedule cards, like Frameo's: sleep time, wake-up time, on/off, weekdays, delete.
  const edit = (fn) => {
    const next = JSON.parse(JSON.stringify(state.config.sleep.schedules));
    fn(next);
    save({ sleep: { schedules: next } });
  };
  const list = el('div', 'st-scheds');
  const addRow = actionRow('Add a sleep schedule', null, () => edit((l) => l.push({ ...DEFAULT_SCHEDULE, days: DEFAULT_SCHEDULE.days.slice() })));
  let drawn = '';
  const draw = () => {
    const key = JSON.stringify([state.config.sleep.schedules, hour12(), state.config.calendar.firstDay]);
    if (key === drawn) return;
    drawn = key;
    list.innerHTML = '';
    const scheds = state.config.sleep.schedules;
    scheds.forEach((s, i) => list.append(scheduleCard(s, i, edit, hour12())));
    if (!scheds.length) list.append(note('No sleep schedule: the frame stays on day and night.'));
    addRow.hidden = scheds.length >= MAX_SCHEDULES;
  };
  draw();
  syncers.push(draw);

  const next = infoRow('Next', () => {
    const p = power();
    if (!p) return 'Loading…';
    if (!p.adminActive) return 'Sleep isn\'t set up yet, so the frame stays on.';
    if (p.inSleepWindow) return `Sleep hours now. Wakes up ${when(p.nextWakeAt)}.`;
    if (p.nextSleepAt) return `Goes to sleep ${when(p.nextSleepAt)}, wakes up ${when(p.nextWakeAt)}.`;
    return 'No sleep schedule is on.';
  });

  const adminRow = row({
    title: () => (power() && power().adminActive ? 'Sleep is set up' : 'Sleep isn\'t set up'),
    sub: () => (!power() ? 'Loading…' : power().adminActive
      ? 'OpenFrame may turn the screen off (an Android "device admin" permission that allows only that).'
      : 'It needs a one-time set-up from a computer. Until then the frame stays on.'),
  });
  const removeRow = actionRow('Turn off sleep', 'Takes back the permission; setting it up again needs a computer', () =>
    confirmSheet('Turn off sleep?', 'The frame won\'t be able to turn its screen off, by schedule or from the menu, until sleep is set up again from a computer.',
      'Turn off', async () => {
        try {
          await api('/api/power/admin/remove', { method: 'POST' });
          toast('Sleep turned off');
          setTimeout(loadPower, 1000);
        } catch (e) { toast(e.message, true); }
      }, 'danger'), 'danger');
  syncers.push(() => { removeRow.hidden = !(power() && power().adminActive); });
  removeRow.hidden = true;

  return [
    group('Screen', brightness),
    group('Sleep mode', list, addRow, next,
      actionRow('Sleep now', 'Until the next wake-up time, or until someone swipes the screen', async () => {
        try { await api('/api/power/sleep', { method: 'POST' }); toast('Going to sleep'); } catch (e) { toast(e.message, true); }
      }),
      note('A swipe across the screen wakes the frame; a tap doesn\'t. Someone using the frame at sleep time keeps it on until they stop.'),
      ...more('sleep',
        cfgPick('Woken during sleep hours, sleep again after', 'sleep.wokenTimeoutMin',
          () => withCurrent(WOKEN_OPTIONS, state.config.sleep.wokenTimeoutMin)
            .map((v) => ({ value: v, label: `${formatDuration(v * 60)} without a touch` })),
          'Sleep again after'),
        adminRow, removeRow),
    ),
  ];
}

/** Sleep, brightness and sound (one section since 2026-10-16; old #sound links lead here). */
function renderDisplayAndSound() {
  return [...renderDisplay(), ...renderSound()];
}

/** Layout and appearance: dark mode first, then the layout, clock and weather, and text style pages. */
function renderLook() {
  const link = (title, sub, id) => row({ title, sub, cls: 'tappable', right: el('span', '', svg('chevron', 'st-row-icon')), onTap: () => go(id) });
  const homeName = () => {
    const l = state.config.layout;
    const c = layoutChoice(l);
    const extra = layoutPages(l).length - 1;
    return `Your layout: ${c === 'custom' ? 'Custom' : PRESET_NAMES[c]}${extra > 0 ? ` (+${extra} more ${extra === 1 ? 'page' : 'pages'})` : ''}`;
  };
  return [
    darkModeGroup(),
    group('On the screen',
      link('Layout', homeName, 'layout'),
      link('Clock and weather', 'What the clock shows, its corner and size, the weather location', 'clock'),
      link('Text style', 'Font, color, and shadow of the text over photos', 'appearance')),
  ];
}

/** More: the rarely used pages. */
// ---- Help (SPEC §16; text approved by the user 2026-10-19): a short guide for the family ----

/** "9:30 PM" / "21:30" for a schedule's "HH:MM". */
function clockText(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', hour: 'numeric', minute: '2-digit', hour12: state.config.clock.hour12 })
    .format(Date.UTC(2026, 0, 1, h, m));
}

function renderHelp() {
  const list = (...items) => {
    const ul = el('ul', 'st-help');
    for (const it of items) ul.append(text('li', '', it));
    return ul;
  };
  // Live facts: this frame's sleep hours and address (the address can change: it comes from the router).
  const sl = state.config.sleep;
  const on = (sl.schedules || []).filter((s) => s.enabled);
  const hours = on.length === 1 && on[0].days.length === 7
    ? `The frame sleeps from ${clockText(on[0].sleep)} to ${clockText(on[0].wake)}`
    : on.length ? 'The frame sleeps at the times set' : 'The frame has no sleep hours set';
  const ip = state.system && state.system.network && state.system.network.ip;
  if (!ip && !state.helpWaiting) { // the address arrives with /api/system: draw again then
    state.helpWaiting = true;
    loadSystem().then(() => { state.helpWaiting = false; if (state.section === 'help' && state.system && state.system.network && state.system.network.ip) rerender(); });
  }
  const at = (path) => (ip ? `http://${ip}:8080${path}` : `the frame\x27s address with ${path} at the end (Settings → System shows it)`);
  return [
    group('Waking and sleeping', list(
      `${hours} (Settings → Sleep, brightness and sound).`,
      'To wake it, swipe across the screen. A tap doesn\x27t wake it.',
      `Woken at night, it sleeps again after ${sl.wokenTimeoutMin || 5} minutes without a touch.`,
      'To sleep now: tap the photo, then Sleep.')),
    group('Turning it off and on', list(
      'Tap the photo, then Power: Restart or Shut down.',
      'After Shut down, only the power button on the back of the frame turns it on again.',
      'After a restart the clock shows "--" until it has the time from the internet.')),
    group('Adding photos and videos', list(
      'iPhone: in Photos, select photos or videos, tap Share, then Send to Frame. (Set it up once: Photos and videos → iPhone Shortcut.)',
      `Any phone or computer at home: open ${at('/upload')} in the browser.`,
      'New photos show up within a few slides.')),
    group('The photo on screen', list(
      'Swipe left or right for the next or previous photo.',
      'Tap it for the menu: Fit or Fill, Position, Comment, Location, Mark private, Hide, Delete (Undo for 10 seconds; deleted photos stay in the Trash for 30 days).')),
    group('Calendar and reminders', list(
      'The side panel shows today; ‹ › for other days, the corner button for the full calendar (Day, Week, Month).',
      'Reminders pop up before events with a chime; tap Dismiss. They stay quiet during sleep hours.')),
    group('Settings', list(
      'On the frame: tap the photo, then Settings.',
      `Phone or computer at home: open ${at('/settings')} and enter the web access PIN.`)),
  ];
}

// ---- Sound (SPEC §6): one main volume for videos and clicks ----

async function loadSound() {
  try { state.sound = await api('/api/sound'); } catch (e) { /* keep the last state */ }
  sync();
}

/** The volume shown: the setting, or (never set) the frame's click level as Android has it now. */
function shownVolume() {
  const v = state.config.sound.volume;
  if (v != null) return v;
  const s = state.sound && state.sound.system;
  return s && s.max ? Math.round((s.level * 100) / s.max) : 50;
}

function renderSound() {
  loadSound();
  const volume = sliderRow('Volume', 'Videos and click sounds on this frame',
    { min: 0, max: 100, step: 5, format: (v) => (v ? `${v}%` : 'Off') },
    shownVolume,
    (v) => save({ sound: { volume: v } }));
  // Letting go plays a short beep on the frame at the new level.
  volume.querySelector('input').addEventListener('change', () => {
    setTimeout(() => saveChain.then(() => api('/api/sound/test', { method: 'POST' })).catch(() => {}), 350);
  });
  const clicks = toggleRow('Click sounds', 'The keyboard\'s clicks and Android\'s screen clicks. Off keeps them silent at any volume.',
    () => state.config.sound.clicks,
    (v) => save({ sound: { clicks: v, volume: shownVolume() } }));
  const rem = () => state.config.sound.reminders;
  const shownAlarm = () => {
    if (rem().volume != null) return rem().volume;
    const a = state.sound && state.sound.alarm;
    return a && a.max ? Math.round((a.level * 100) / a.max) : 70;
  };
  const rVolume = sliderRow('Reminders volume', 'Its own volume, separate from videos and clicks',
    { min: 0, max: 100, step: 5, format: (v) => (v ? `${v}%` : 'Off') },
    shownAlarm,
    (v) => save({ sound: { reminders: { volume: v } } }));
  // Letting go plays the chosen chime on the frame at the new level.
  rVolume.querySelector('input').addEventListener('change', () => {
    setTimeout(() => saveChain.then(() => playChimeOnFrame()).catch(() => {}), 350);
  });
  const chimeLabel = () => (CHIMES.find((c) => c.id === rem().chime) || { label: rem().chime }).label;
  const chimeRow = row({ title: 'Chime', sub: chimeLabel, cls: 'tappable', right: el('span', '', svg('chevron', 'st-row-icon')),
    onTap: () => chimeSheet(rem().chime, (id) => save({ sound: { reminders: { chime: id } } })) });
  const repeat = cfgPick('Play', 'sound.reminders.repeatSec', [
    { value: 0, label: 'Once' },
    { value: 15, label: 'Every 15 s until dismissed' },
    { value: 20, label: 'Every 20 s until dismissed' },
    { value: 30, label: 'Every 30 s until dismissed' },
  ]);
  const test = actionRow('Play on the frame', 'The chosen chime at the reminders volume', () => playChimeOnFrame());
  return [
    group('Speaker', volume, clicks),
    note('Android has 8 levels for clicks and 16 for videos, so clicks change in bigger steps.'),
    group('Reminders', chimeRow, repeat, rVolume, test),
    note('Reminders are switched on per calendar in Settings → Calendar. They close by themselves after 2 minutes and stay quiet during sleep hours.'),
  ];
}

/** The chosen (or given) reminder chime, played by the frame on its alarm volume. */
async function playChimeOnFrame(chime) {
  try {
    const r = await api('/api/sound/reminder', { method: 'POST', json: chime ? { chime } : {} });
    if (!r.played) toast('The frame is asleep, so it stays quiet.');
  } catch (e) { toast(e.message, true); }
}

let previewAudio = null;

/**
 * A chime on this device: the frame plays it itself; a phone or computer decodes it with Web Audio
 * (Safari plays no <audio> without byte ranges, which the frame's server doesn't do for these files).
 */
async function previewChime(id) {
  if (isFrame) { playChimeOnFrame(id); return; }
  try {
    // Created and resumed inside the tap, as iOS requires.
    previewAudio = previewAudio || new (window.AudioContext || window.webkitAudioContext)();
    const resumed = previewAudio.state === 'suspended' ? previewAudio.resume() : Promise.resolve();
    const data = await (await fetch(`/sounds/${chimeFile(id)}`)).arrayBuffer();
    await resumed;
    const buf = await new Promise((res, rej) => previewAudio.decodeAudioData(data, res, rej));
    const src = previewAudio.createBufferSource();
    src.buffer = buf;
    src.connect(previewAudio.destination);
    src.start();
  } catch (e) {
    toast('This device couldn\x27t play the chime. Try "Play on the frame".', true);
  }
}

/** Chime list: tap a name to choose it (and hear it), the play button to hear it again. */
function chimeSheet(current, set) {
  let chosen = current;
  const rows = CHIMES.map((c) => {
    const r = el('div', `st-chime${c.id === chosen ? ' on' : ''}`);
    r.dataset.id = c.id;
    const pick = el('button', 'st-choice');
    pick.type = 'button';
    pick.innerHTML = svg('check', 'check');
    pick.append(text('span', '', c.label));
    pick.addEventListener('click', () => {
      chosen = c.id;
      rows.forEach((x) => x.classList.toggle('on', x.dataset.id === chosen));
      previewChime(c.id);
    });
    const play = text('button', 'st-chime-play', '▶');
    play.type = 'button';
    play.setAttribute('aria-label', `Play ${c.label}`);
    play.addEventListener('click', () => previewChime(c.id));
    r.append(pick, play);
    return r;
  });
  sheet({
    title: 'Reminder chime',
    body: [note(isFrame ? 'Plays on this frame at the reminders volume.' : 'Plays on this device. "Play on the frame" plays it there.'), ...rows],
    actions: ['spacer', { label: 'Cancel' }, { label: 'Use', kind: 'primary', onClick: (s) => { s.close(); if (chosen !== current) set(chosen); } }],
  });
}

function scheduleCard(s, i, edit, hour12) {
  const card = el('div', `st-sched${s.enabled ? '' : ' off'}`);
  const time = (icon, label, key) => {
    const b = el('button', 'st-sched-time', svg(icon, 'st-sched-icon'));
    b.type = 'button';
    const t = el('span', 'st-sched-text');
    t.append(text('span', 'st-sched-label', label), text('span', 'st-sched-value', formatHm(s[key], hour12)));
    b.append(t);
    b.addEventListener('click', () => timeSheet(label, s[key], hour12, (hm) => edit((l) => { l[i][key] = hm; })));
    return b;
  };
  const sw = el('button', 'st-sched-switch');
  sw.type = 'button';
  sw.setAttribute('role', 'switch');
  sw.setAttribute('aria-checked', String(s.enabled));
  sw.setAttribute('aria-label', 'Schedule on');
  sw.append(el('span', `st-toggle${s.enabled ? ' on' : ''}`));
  sw.addEventListener('click', () => edit((l) => { l[i].enabled = !l[i].enabled; }));
  const top = el('div', 'st-sched-top');
  top.append(time('moon', 'Goes to sleep at', 'sleep'), time('sun', 'Wakes up at', 'wake'), sw);

  const days = el('div', 'st-sched-days');
  for (let k = 0; k < 7; k++) {
    const d = (k + state.config.calendar.firstDay) % 7;
    const on = s.days.includes(d);
    const b = text('button', `st-day${on ? ' on' : ''}`, 'SMTWTFS'[d]);
    b.type = 'button';
    b.setAttribute('aria-label', WEEKDAYS[d]);
    b.setAttribute('aria-pressed', String(on));
    b.addEventListener('click', () => edit((l) => {
      const ds = l[i].days;
      const j = ds.indexOf(d);
      if (j >= 0) ds.splice(j, 1); else ds.push(d);
      ds.sort((a, c) => a - c);
    }));
    days.append(b);
  }
  const del = el('button', 'st-sched-delete', svg('delete'));
  del.type = 'button';
  del.setAttribute('aria-label', 'Delete schedule');
  del.addEventListener('click', () => confirmSheet('Delete this schedule?',
    `${formatHm(s.sleep, hour12)} to ${formatHm(s.wake, hour12)}, ${daysSummary(s.days, state.config.calendar.firstDay).toLowerCase()}.`,
    'Delete', () => edit((l) => { l.splice(i, 1); }), 'danger'));
  const bottom = el('div', 'st-sched-bottom');
  bottom.append(days, del);
  card.append(top, bottom);
  return card;
}

/** Touch-friendly time picker: hour and minute buttons (and AM/PM on a 12-hour clock). */
function timeSheet(title, hm, hour12, onSave) {
  let [h, m] = hm.split(':').map(Number);
  const now = el('div', 'st-tp-now');
  const grid = (values, label, pick, isOn) => {
    const g = el('div', 'st-tp-grid');
    const buttons = values.map((v) => {
      const b = text('button', '', label(v));
      b.type = 'button';
      b.addEventListener('click', () => { pick(v); update(); });
      g.append(b);
      return { b, v };
    });
    return { g, refresh: () => buttons.forEach(({ b, v }) => b.classList.toggle('on', isOn(v))) };
  };
  const hours = hour12
    ? grid([12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], String, (v) => { h = (v % 12) + (h >= 12 ? 12 : 0); }, (v) => (h % 12 || 12) === v)
    : grid([...Array(24).keys()], (v) => String(v).padStart(2, '0'), (v) => { h = v; }, (v) => h === v);
  const mins = grid([0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55], (v) => `:${String(v).padStart(2, '0')}`, (v) => { m = v; }, (v) => m === v);
  const ampm = hour12 ? grid(['AM', 'PM'], String, (v) => { h = (h % 12) + (v === 'PM' ? 12 : 0); }, (v) => (h >= 12) === (v === 'PM')) : null;
  if (ampm) ampm.g.classList.add('st-tp-ampm');
  function update() {
    now.textContent = formatHm(toHm(h, m), hour12);
    [hours, mins, ampm].forEach((x) => x && x.refresh());
  }
  update();
  sheet({
    title,
    body: [now, text('div', 'st-tp-label', 'Hour'), hours.g, text('div', 'st-tp-label', 'Minutes'), mins.g, ampm && ampm.g],
    actions: ['spacer', { label: 'Cancel' }, { label: 'Save', kind: 'primary', onClick: (ref) => { ref.close(); onSave(toHm(h, m)); } }],
  });
}

// Clock and weather

function tzValid(tz) {
  if (!tz) return undefined;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return tz; } catch (e) { return undefined; }
}

// Shown in the caption preview where the current photo has no comment, place, or date of its own.
const SAMPLE_CAPTION = { comment: 'Picnic in the park', place: 'Springfield, IL', takenAt: Date.UTC(2026, 5, 14, 19) };

const previewBrightness = new Brightness();

/**
 * The home page as the frame lays it out now (user request 2026-10-16: not always a full-screen photo):
 * the photo on the frame now in the photo's box, the real clock (overlay or panel) and, with `caption`,
 * the photo caption where they sit; a calendar box is a plain stand-in. With `next`, a "Next photo"
 * button tries the style on other photos (the frame's slideshow stays put).
 */
function clockPreview({ caption = false, next = false } = {}) {
  const box = el('div', 'st-preview');
  const stage = el('div', 'st-preview-stage');
  const photoBox = el('div', 'st-pv-box');
  const bg = el('img', 'st-preview-bg');
  const img = el('img', 'st-preview-img');
  photoBox.append(bg, img);
  const anchor = el('div', 'st-preview-anchor');
  const inner = el('div');
  anchor.append(inner);
  const calBoxes = el('div');
  stage.append(photoBox, calBoxes, anchor);
  let cap = null;
  const capAnchor = el('div', 'st-preview-anchor');
  if (caption) {
    const capInner = el('div');
    capAnchor.append(capInner);
    stage.append(capAnchor);
    cap = new Caption(capInner, { config: () => state.config, get tz() { return tzValid(state.config.clock.timeZone); } });
  }
  box.append(stage);
  bg.alt = '';
  img.alt = '';

  const cw = new ClockWeather(inner, {
    config: () => state.config,
    weather,
    get tz() { return tzValid(state.config.clock.timeZone); },
  });
  let slide = null;

  const layout = () => {
    // The frame's current orientation (CSS viewport 1608×904 or 904×1608); other screens: landscape.
    const portrait = isFrame && window.matchMedia('(orientation: portrait)').matches;
    const w = portrait ? 904 : 1608;
    const h = portrait ? 1608 : 904;
    const maxW = box.parentElement ? box.parentElement.clientWidth - 2 * 28 : 600;
    const k = Math.min(maxW / w, (portrait ? 520 : 400) / h);
    stage.style.width = `${w}px`;
    stage.style.height = `${h}px`;
    stage.style.transform = `scale(${k})`;
    box.style.width = `${Math.round(w * k)}px`;
    box.style.height = `${Math.round(h * k)}px`;
  };
  // Automatic text color: measure the preview photo under the clock and caption.
  let autoSeq = 0;
  const measure = async () => {
    if (!slide) return;
    const seq = ++autoSeq;
    const s = state.config.slideshow;
    const fit = slide.fit || s.fit;
    for (const [w, node] of [[cw, inner], [cap, cap && capAnchor.firstChild]]) {
      if (!w || !w.wantsBackground()) continue;
      const lum = await previewBrightness.under(slide, s, fit, stage.getBoundingClientRect(), node.getBoundingClientRect());
      if (seq !== autoSeq) return;
      w.setBackground(lum);
    }
  };
  // The home page's arrangement, worked out like the frame does (app.js render()).
  const arrangement = () => {
    const c = state.config.clock;
    const capCfg = state.config.caption;
    const page = pageView(homePage(state.config.layout), {
      corner: c.corner,
      size: c.size,
      hybridCalendar: state.config.layout.hybridCalendar,
      clockVisible: c.showClock || c.showDate || (c.showWeather && state.config.weather.latitude !== null),
      caption: { visible: capCfg.showComment || capCfg.showLocation || capCfg.showDate, corner: capCfg.corner },
    });
    return arrangementFor(page, isFrame && window.matchMedia('(orientation: portrait)').matches);
  };
  const setBox = (node, b) => Object.assign(node.style, {
    left: `${b.left * 100}%`, top: `${b.top * 100}%`, width: `${b.width * 100}%`, height: `${b.height * 100}%`,
  });
  const update = () => {
    const s = state.config.slideshow;
    const arr = arrangement();
    const of = (type) => arr.widgets.find((w) => w.type === type);
    const photo = arr.widgets.find((w) => w.type === 'photo' && !w.anchor);
    photoBox.hidden = !photo;
    if (photo) setBox(photoBox, gridBox(photo, arr));
    // Calendars: a plain box in the panel's colors (the real ones would load the feeds here).
    calBoxes.innerHTML = '';
    for (const w of arr.widgets.filter((x) => (x.type === 'calendar_day' || x.type === 'calendar_full') && !x.anchor)) {
      const b = el('div', 'st-pv-box st-pv-cal');
      b.append(text('div', 'st-pv-cal-title', w.type === 'calendar_day' ? 'Calendar' : 'Full calendar'));
      for (let i = 0; i < 3; i++) b.append(el('div', 'st-pv-cal-event'));
      setBox(b, gridBox(w, arr));
      calBoxes.append(b);
    }
    const clock = of('clock_weather');
    anchor.hidden = !clock;
    if (clock && clock.anchor) {
      anchor.className = `st-preview-anchor corner-${clock.anchor.corner}`;
      setBox(anchor, anchorBox(clock, arr));
      cw.update({ style: 'overlay', anchor: clock.anchor });
    } else if (clock) {
      // A clock panel (Hybrid landscape): its box, sized by container units like on the frame.
      anchor.className = 'st-preview-anchor st-pv-box w-grid w-clock_weather';
      setBox(anchor, gridBox(clock, arr));
      cw.update(clock);
    }
    if (cap) {
      const capSpec = of('caption');
      capAnchor.hidden = !capSpec;
      const corner = capSpec ? capSpec.anchor.corner : 'bottom-left';
      capAnchor.className = `st-preview-anchor w-caption corner-${corner}`;
      if (capSpec) setBox(capAnchor, anchorBox(capSpec, arr));
      cap.update({ anchor: { corner } });
      const sl = slide || {};
      cap.setSlide({ id: sl.id, comment: sl.comment || SAMPLE_CAPTION.comment, place: sl.place || SAMPLE_CAPTION.place,
        takenAt: sl.takenAt != null ? sl.takenAt : SAMPLE_CAPTION.takenAt });
    }
    img.style.objectFit = ((slide && slide.fit) || s.fit) === 'fill' ? 'cover' : 'contain';
    bg.hidden = s.background !== 'blur' || !slide;
    stage.style.background = s.background === 'color' ? s.backgroundColor : '#000';
    requestAnimationFrame(measure);
  };
  const showSlide = (sl) => {
    slide = sl;
    img.src = slide.url;
    bg.src = slide.bg;
    update();
  };
  api('/api/slideshow/current').then((d) => { if (d && d.slide) showSlide(d.slide); }).catch(() => {});

  let nextBtn = null;
  if (next) {
    let ids = null;
    let at = -1;
    nextBtn = text('button', 'st-btn st-preview-next', 'Next photo');
    nextBtn.type = 'button';
    nextBtn.addEventListener('click', async () => {
      try {
        if (!ids) {
          const r = await api('/api/library?filter=all&limit=200');
          ids = r.items.filter((it) => it.thumb).map((it) => it.id);
          at = Math.max(-1, ids.indexOf(slide && slide.id));
        }
        if (!ids.length) return;
        at = (at + 1) % ids.length;
        showSlide(await api(`/api/media/${ids[at]}`));
      } catch (e) { toast(e.message, true); }
    });
  }
  const onResize = () => layout();
  window.addEventListener('resize', onResize);
  setTimeout(layout, 0); // once the box is in the page
  update();
  syncers.push(update);
  cleanups.push(() => { window.removeEventListener('resize', onResize); cw.destroy(); if (cap) cap.destroy(); });
  return nextBtn ? [box, nextBtn] : box;
}

const CORNERS = [
  { value: 'top-left', label: 'Top left' }, { value: 'top-right', label: 'Top right' },
  { value: 'bottom-left', label: 'Bottom left' }, { value: 'bottom-right', label: 'Bottom right' },
];

function renderClock() {
  const c = () => state.config.clock;
  const now = new Date();
  const fmtDate = (opts) => new Intl.DateTimeFormat(undefined, { ...opts, timeZone: tzValid(c().timeZone) }).format(now);
  const frameZone = () => (state.system ? state.system.timeZone : 'the frame\'s zone');
  weather.start();

  const previewNote = () => (homePage(state.config.layout).preset === 'hybrid'
    ? 'Your home page as the frame shows it. In Hybrid landscape the clock is the panel above the calendar; corner and size apply to the clock over the photo (Pictures only, Hybrid portrait).'
    : 'Your home page as the frame shows it.');
  const pNote = note('');
  syncers.push(() => { pNote.textContent = previewNote(); pNote.hidden = !previewNote(); });

  // Wide screens (frame in landscape, PC): the preview stays beside the controls while they scroll.
  // Narrow ones (portrait, phones): the preview sits above them.
  const split = el('div', 'st-split');
  const side = el('div', 'st-split-side');
  const main = el('div', 'st-split-main');
  side.append(group('Preview', clockPreview(), pNote));
  split.append(main, side);
  [
    group('Show',
      cfgToggle('Clock', null, 'clock.showClock'),
      cfgToggle('Date', null, 'clock.showDate'),
      cfgToggle('Weather', () => (state.config.weather.latitude === null ? 'Set a location below first' : null), 'clock.showWeather'),
    ),
    group('Style',
      cfgPick('Corner', 'clock.corner', CORNERS, 'Clock corner'),
      cfgSeg('Size', () => (homePage(state.config.layout).preset === 'hybrid'
        ? 'Hybrid: also the height of the clock panel above the calendar' : null), 'clock.size', [
        { value: 'small', label: 'Small' }, { value: 'medium', label: 'Medium' }, { value: 'large', label: 'Large' },
      ]),
      actionRow('Font, color and shadow', 'In Text style (for all text)', () => go('appearance')),
    ),
    group('Date and time',
      cfgToggle('Use 24-hour format', null, 'clock.hour12', true),
      cfgToggle('Show AM/PM', () => (state.config.clock.hour12 ? null : 'Only with the 12-hour format'), 'clock.showAmPm'),
      ...more('time',
        cfgSeg('Date format', null, 'clock.dateFormat', [
          { value: 'long', label: fmtDate({ weekday: 'long', month: 'long', day: 'numeric' }) },
          { value: 'short', label: fmtDate({ weekday: 'short', month: 'short', day: 'numeric' }) },
        ]),
        row({
          title: 'Time zone',
          sub: () => (c().timeZone ? c().timeZone.replace(/_/g, ' ') : `Same as the frame (${frameZone().replace(/_/g, ' ')})`),
          cls: 'tappable',
          right: el('span', '', svg('chevron', 'st-row-icon')),
          onTap: timeZoneSheet,
        })),
    ),
    group('Weather',
      row({
        title: 'Weather location',
        sub: () => state.config.weather.place || (state.config.weather.latitude === null ? 'Not set (no weather shown)' : `${state.config.weather.latitude}, ${state.config.weather.longitude}`),
        cls: 'tappable',
        right: el('span', '', svg('chevron', 'st-row-icon')),
        onTap: locationSheet,
      }),
      cfgSeg('Temperature unit', null, 'weather.units', [
        { value: 'fahrenheit', label: '°F' }, { value: 'celsius', label: '°C' },
      ]),
      weatherStatusRow(),
    ),
    group('Weather display',
      cfgSeg('Layout', () => (c().weatherLayout === 'line'
        ? 'Date and weather on one line under the time, like Frameo' : 'Time, date, and weather each on their own line'), 'clock.weatherLayout', [
        { value: 'stacked', label: 'Stacked' }, { value: 'line', label: 'One line' },
      ]),
      cfgToggle('Icon', null, 'clock.weatherShow.icon'),
      cfgToggle('Current temperature', null, 'clock.weatherShow.current'),
      cfgToggle('High and low', 'Today\'s; also shown when there is no current reading', 'clock.weatherShow.highLow'),
      ...more('weather',
        cfgToggle('Condition', 'For example "Partly cloudy"', 'clock.weatherShow.condition'),
        cfgToggle('Feels like', null, 'clock.weatherShow.feelsLike'),
        cfgToggle('Chance of rain', 'Today\'s highest', 'clock.weatherShow.rain'),
        cfgPick('Next days', 'clock.forecastDays', [
          { value: 0, label: 'Off' }, { value: 3, label: '3 days' }, { value: 5, label: '5 days' },
        ], 'Show the next days'),
        cfgSeg('Icons', null, 'clock.iconStyle', [
          { value: 'color', label: 'In color' }, { value: 'text', label: 'Text color' },
        ]),
        note('Condition, feels like, rain, next days, and the one-line layout show on the clock over the photo (Pictures only, Hybrid portrait), not in the Hybrid landscape panel.')),
    ),
  ].forEach((g) => main.append(g));
  return split;
}

// Appearance (SPEC §9): text style for the clock, date, weather, caption, and calendar; dark mode (11c).

const TEXT_ITEMS = [
  { id: 'clock', label: 'Clock', sub: 'The time' },
  { id: 'date', label: 'Date' },
  { id: 'weather', label: 'Weather' },
  { id: 'caption', label: 'Photo caption' },
  { id: 'calendar', label: 'Calendar', sub: 'Day panel and full calendar: font and text size' },
];
const fontLabel = (id) => (FONTS.find((f) => f.id === id) || FONTS[0]).label;
const colorLabel = (c) => (c === AUTO ? 'Automatic' : c === WHITE ? 'White' : c.toUpperCase());

/** Font list with each name drawn in its own font. `withSame`: first choice "Same as all text" (null). */
function fontSheet(title, current, withSame, set) {
  const options = [...(withSame ? [{ id: null, label: 'Same as all text', note: fontLabel(state.config.text.font) }] : []), ...FONTS];
  const list = options.map((f) => {
    const b = el('button', `st-choice${f.id === current ? ' on' : ''}`);
    b.type = 'button';
    b.innerHTML = svg('check', 'check');
    const l = text('span', 'st-font-name', f.label);
    if (f.id) l.style.fontFamily = fontFamily(f.id);
    l.append(text('small', '', f.note));
    b.append(l);
    b.addEventListener('click', () => { ref.close(); if (f.id !== current) set(f.id); });
    return b;
  });
  const ref = sheet({ title, body: list, actions: [{ label: 'Cancel' }] });
}

/** Text color: Automatic, a palette color, or a custom one. `withSame`: "Same as all text" (null). */
function textColorSheet(title, current, withSame, set) {
  const picker = colorPicker(TEXT_PALETTE, current && current !== AUTO ? current : WHITE);
  const choice = (label, sub, value) => {
    const b = el('button', `st-choice${value === current ? ' on' : ''}`);
    b.type = 'button';
    b.innerHTML = svg('check', 'check');
    const l = text('span', '', label);
    l.append(text('small', '', sub));
    b.append(l);
    b.addEventListener('click', () => { ref.close(); if (value !== current) set(value); });
    return b;
  };
  const body = [];
  if (withSame) body.push(choice('Same as all text', colorLabel(state.config.text.color), null));
  body.push(choice('Automatic', 'White on dark photos, dark on bright ones', AUTO), picker.element);
  const ref = sheet({
    title,
    body,
    actions: ['spacer', { label: 'Cancel' }, { label: 'Use this color', kind: 'primary', onClick: (s) => { s.close(); set(picker.value()); } }],
  });
}

function itemSheet(item) {
  const t = () => state.config.text;
  const o = () => t()[item.id];
  const saveItem = (patch) => save({ text: { [item.id]: patch } });
  const rows = [
    row({ title: 'Font', sub: () => (o().font ? fontLabel(o().font) : `Same as all text (${fontLabel(t().font)})`), cls: 'tappable',
      right: el('span', '', svg('chevron', 'st-row-icon')),
      onTap: () => fontSheet(`${item.label}: font`, o().font, true, (v) => saveItem({ font: v }).then(() => itemSheet(item))) }),
  ];
  if (item.id === 'calendar') {
    rows.push(segRow('Text size', null, [
      { value: 'small', label: 'Small' }, { value: 'medium', label: 'Medium' }, { value: 'large', label: 'Large' },
    ], () => o().size, (v) => saveItem({ size: v })));
  } else {
    rows.push(row({ title: 'Color', sub: () => (o().color ? colorLabel(o().color) : `Same as all text (${colorLabel(t().color)})`), cls: 'tappable',
      right: el('span', '', svg('chevron', 'st-row-icon')),
      onTap: () => textColorSheet(`${item.label}: color`, o().color, true, (v) => saveItem({ color: v }).then(() => itemSheet(item))) }));
    rows.push(segRow('Bold', null, [
      { value: null, label: 'Same' }, { value: true, label: 'Bold' }, { value: false, label: 'Regular' },
    ], () => o().bold, (v) => saveItem({ bold: v })));
  }
  sheet({
    title: item.label,
    body: rows,
    actions: [
      { label: 'Same as all text', onClick: (s) => { s.close(); saveItem(item.id === 'calendar' ? { font: null, size: 'medium' } : { font: null, color: null, bold: null }); } },
      'spacer', { label: 'Done', kind: 'primary' },
    ],
  });
}

function renderAppearance() {
  const t = () => state.config.text;
  weather.start();
  const split = el('div', 'st-split');
  const side = el('div', 'st-split-side');
  const main = el('div', 'st-split-main');
  side.append(group('Preview', clockPreview({ caption: true, next: true }),
    note('The clock and caption over a photo from the frame. Calendar text shows in the calendar.')));
  split.append(main, side);

  const itemRows = TEXT_ITEMS.map((item) => row({
    title: item.label,
    sub: () => overrideSummary(t()[item.id], fontLabel),
    cls: 'tappable',
    right: el('span', '', svg('chevron', 'st-row-icon')),
    onTap: () => itemSheet(item),
  }));

  [
    group('All text',
      row({ title: 'Font', sub: () => fontLabel(t().font), cls: 'tappable', right: el('span', '', svg('chevron', 'st-row-icon')),
        onTap: () => fontSheet('Font for all text', t().font, false, (v) => save({ text: { font: v } })) }),
      cfgToggle('Bold', null, 'text.bold'),
      row({ title: 'Color', sub: () => `${colorLabel(t().color)} (over photos)`, cls: 'tappable', right: el('span', '', svg('chevron', 'st-row-icon')),
        onTap: () => textColorSheet('Text color', t().color, false, (v) => save({ text: { color: v } })) }),
      sliderRow('Shadow', 'Stronger helps on bright photos',
        { min: 0, max: 1, step: 0.05, format: (v) => `${Math.round(v * 100)}%` },
        () => t().shadow, (v) => save({ text: { shadow: Math.round(v * 100) / 100 } })),
      ...more('text',
        cfgToggle('Outline', 'A thin edge around each letter', 'text.outline'),
        sliderRow('Opacity', 'Lower lets the photo show through the text',
          { min: 0.3, max: 1, step: 0.05, format: (v) => `${Math.round(v * 100)}%` },
          () => t().opacity, (v) => save({ text: { opacity: Math.round(v * 100) / 100 } }))),
    ),
    group('Each item', note('Change one item without changing the rest.'), ...itemRows),
  ].forEach((g) => main.append(g));
  return split;
}

const THEME_AUTO = [
  { value: 'sun', label: 'Sunset to sunrise', detail: 'Uses the weather location; 7 PM to 7 AM without one' },
  { value: 'sleep', label: 'Around sleep hours', detail: '2 hours before the sleep time until wake-up' },
  { value: 'hours', label: 'Between two times', detail: 'Pick the times below' },
];

/** Dark mode (SPEC §9): settings, menus, calendar panels, and the full calendar. Photos stay as they are. */
function darkModeGroup() {
  const th = () => state.config.theme;
  const hour12 = () => state.config.clock.hour12;
  const autoRows = [
    pickRow('Dark when', THEME_AUTO, () => th().auto, (v) => save({ theme: { auto: v } }), 'Turn dark'),
    row({ title: 'Dark from', sub: () => formatHm(th().from, hour12()), cls: 'tappable', right: el('span', '', svg('chevron', 'st-row-icon')),
      onTap: () => timeSheet('Dark from', th().from, hour12(), (v) => save({ theme: { from: v } })) }),
    row({ title: 'Light from', sub: () => formatHm(th().to, hour12()), cls: 'tappable', right: el('span', '', svg('chevron', 'st-row-icon')),
      onTap: () => timeSheet('Light from', th().to, hour12(), (v) => save({ theme: { to: v } })) }),
  ];
  const show = () => {
    const auto = th().mode === 'auto';
    autoRows[0].hidden = !auto;
    autoRows[1].hidden = !auto || th().auto !== 'hours';
    autoRows[2].hidden = !auto || th().auto !== 'hours';
  };
  show();
  syncers.push(show);
  return group('Dark mode',
    cfgSeg('Theme', () => (th().mode === 'auto'
      ? (document.documentElement.dataset.theme === 'dark' ? 'Dark right now' : 'Light right now')
      : 'Settings, menus, and calendars; photos are not changed'), 'theme.mode', [
      { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }, { value: 'auto', label: 'Automatic' },
    ]),
    ...autoRows,
    // Hybrid's right-hand column (the day panel and clock panel) can keep its own look (2026-10-16).
    cfgSeg('Calendar and clock panel', 'The day panel and the clock above it, e.g. Hybrid\'s right side', 'theme.panel', [
      { value: 'follow', label: 'Follow theme' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' },
    ]),
  );
}

// Photo caption (SPEC §8): Frameo-style bubble with the comment, place, and date taken.

const CAPTION_RADII = [1, 2, 3, 5, 8, 10, 15, 20, 30, 50];
const radiusOptions = (current) => withCurrent(CAPTION_RADII, current).map((v) => ({ value: v, label: `${v} ${v === 1 ? 'mile' : 'miles'}` }));

function renderCaption() {
  const c = () => state.config.caption;
  const split = el('div', 'st-split');
  const side = el('div', 'st-split-side');
  const main = el('div', 'st-split-main');
  side.append(group('Preview', clockPreview({ caption: true }),
    note('Sample text fills in what the photo on the frame doesn\x27t have.')));
  split.append(main, side);
  main.append(group(null, backHere('photos')));

  const cornerSub = () => {
    const ck = state.config.clock;
    const clockOn = ck.showClock || ck.showDate || ck.showWeather;
    return clockOn && c().corner === ck.corner ? 'The clock is in this corner, so the caption uses the other side.' : '';
  };
  const cornerNote = note('');
  const syncCornerNote = () => { cornerNote.textContent = cornerSub(); cornerNote.hidden = !cornerSub(); };
  syncCornerNote();
  syncers.push(syncCornerNote);


  [
    group('Show',
      cfgToggle('Comment', 'Added on the frame (tap the photo) or in Photos → Library', 'caption.showComment'),
      cfgToggle('Location', 'Where the photo was taken, from its GPS', 'caption.showLocation'),
      cfgToggle('Detailed location', () => (c().detailedPlace
        ? 'The place and the town, for example "Space Needle, Seattle, WA"'
        : 'Only the town, for example "Seattle, WA"'), 'caption.detailedPlace'),
      cfgToggle('Date taken', null, 'caption.showDate'),
    ),
    group('Places',
      row({
        title: 'Places',
        sub: () => {
          const n = c().privatePlaces.length;
          return `Your places (${n ? n : 'none yet'}), looking up place names, places left out`;
        },
        cls: 'tappable',
        right: el('span', '', svg('chevron', 'st-row-icon')),
        onTap: () => go('places'),
      }),
    ),
    group('Style',
      cfgSeg('Lines', () => (c().lines === 'two' ? 'Comment on top, place and date below' : 'Everything on one line'), 'caption.lines', [
        { value: 'two', label: 'Two lines' }, { value: 'one', label: 'One line' },
      ]),
      pickRow('Corner', CORNERS, () => c().corner, (v) => save({ caption: { corner: v } }), 'Caption corner'),
      cornerNote,
      cfgSeg('Text size', null, 'caption.size', [
        { value: 'small', label: 'Small' }, { value: 'medium', label: 'Medium' }, { value: 'large', label: 'Large' },
      ]),
      sliderRow('Background', 'Darker is easier to read on bright photos',
        { min: 0, max: 0.9, step: 0.05, format: (v) => `${Math.round(v * 100)}%` },
        () => c().background, (v) => save({ caption: { background: Math.round(v * 100) / 100 } })),
    ),
  ].forEach((g) => main.append(g));
  return split;
}

/** Settings → Photo caption → Places (SPEC §8): your places, the online lookup, places left out. */
function renderPlaces() {
  const c = () => state.config.caption;
  const placesList = el('div');
  const drawPlaces = () => {
    placesList.innerHTML = '';
    const list = c().ignoredPlaces;
    if (!list.length) placesList.append(note('None yet. Add your home town so everyday photos don\x27t all say where they were taken.'));
    list.forEach((p, i) => {
      const remove = el('button', 'st-icon-btn', svg('delete'));
      remove.type = 'button';
      remove.setAttribute('aria-label', `Remove ${p.name}`);
      remove.addEventListener('click', () => {
        save({ caption: { ignoredPlaces: c().ignoredPlaces.filter((_, k) => k !== i) } });
      });
      const r = el('div', 'st-row');
      const t = el('div', 'st-row-text');
      t.append(text('div', 'st-row-title', p.name));
      r.append(t, remove);
      placesList.append(r);
    });
  };
  drawPlaces();
  syncers.push(drawPlaces);

  return [
    group(null, backHere('caption')),
    privatePlacesGroup(),
    placeNamesGroup(),
    group('Places left out',
      note('Photos taken near these towns show no location at all.'),
      placesList,
      actionRow('Add a place', 'Search the frame\x27s list of towns and cities', addCaptionPlaceSheet),
      pickRow('Distance', () => radiusOptions(c().ignoreRadiusMi), () => c().ignoreRadiusMi,
        (v) => save({ caption: { ignoreRadiusMi: v } }), 'Leave out photos within'),
    ),
  ];
}

/**
 * Precise place names (SPEC §8): the iPhone Shortcut sends the place's name; photos without one are looked up
 * on OpenStreetMap in the background. Progress and the two re-runs.
 */
function placeNamesGroup() {
  let st = null;
  const detailed = () => state.config.caption.detailedPlace;
  const statusText = () => {
    if (!detailed()) return 'Detailed location is off: captions show only the town, and nothing is looked up online.';
    if (!st) return 'Checking…';
    if (st.running && st.total) return `Looking up… ${Math.min(st.done, st.total)} of ${st.total}`;
    if (st.problem) return `${st.problem}${st.waiting ? ` ${st.waiting} waiting.` : ''}`;
    if (st.waiting) return `${st.waiting} waiting to be looked up`;
    if (!st.located) return 'No photos with a location yet';
    return `${st.named} of ${st.located} photos with a location have a place\x27s name`;
  };
  const status = row({ title: 'Place names', sub: statusText });
  const load = async () => {
    try { st = await api('/api/places/names'); } catch (e) { return; }
    sync();
    clearTimeout(timer);
    timer = setTimeout(load, st.running || st.waiting ? 2000 : 15000);
  };
  let timer = null;
  cleanups.push(() => clearTimeout(timer));
  load();
  const rerun = (mode) => async () => {
    try { st = await api('/api/places/names', { method: 'POST', json: { mode } }); sync(); load(); } catch (e) { toast(e.message, true); }
  };
  const explain = note('Photos are looked up on OpenStreetMap a few seconds after they arrive: only their GPS position is sent. The frame shows the church, park, school, or building the photo was taken in, shortened ("St. Mark\x27s Cathedral" → "St. Mark\x27s"); nothing named there: just the town.');
  const missing = actionRow('Look up missing names', 'Tries again for photos where no place was found', rerun('missing'));
  const all = actionRow('Look up all again', 'Sends the position of every photo without a name from the iPhone', () =>
    confirmSheet('Look up all place names again?', 'The frame sends the GPS position of every photo that has no name from the iPhone to OpenStreetMap, a few seconds apart. Names from the iPhone stay.', 'Look up', rerun('all')));
  const showRows = () => { [explain, missing, all].forEach((x) => { x.hidden = !detailed(); }); };
  showRows();
  syncers.push(showRows);
  return group('Place names', explain, status, missing, all);
}

// ---- Your places (SPEC §8): spots the user names, like home; never looked up online ----

const PRIVATE_SIZES = [{ value: 60, label: '60 m (200 ft)' }, { value: 150, label: '150 m (500 ft)' }, { value: 300, label: '300 m (1,000 ft)' }];
const privateSizeText = (m) => (PRIVATE_SIZES.find((s) => s.value === m) || { label: `${m} m` }).label;

async function reloadConfig() {
  try { state.config = await api('/api/config'); sync(); } catch (e) { /* the next poll catches up */ }
}

function privatePlacesGroup() {
  const c = () => state.config.caption;
  const list = el('div');
  const draw = () => {
    list.innerHTML = '';
    const places = c().privatePlaces;
    if (!places.length) list.append(note('None yet. Add home, so photos taken there say "Home" and are never sent to OpenStreetMap.'));
    places.forEach((p, i) => {
      list.append(row({
        title: p.name || 'No name (shows the town)',
        sub: `Within ${privateSizeText(p.radiusM)}`,
        right: el('span', '', svg('chevron', 'st-row-icon')),
        onTap: () => editPrivatePlaceSheet(i),
        cls: 'tappable',
      }));
    });
  };
  draw();
  syncers.push(draw);
  return group('Your places',
    note('Spots you name, like home. Photos taken there show that name (no name: just the town) and are never sent to OpenStreetMap. Kept on the frame only.'),
    list,
    actionRow('Add from a photo', 'Pick a photo taken there; its GPS position is used', addPrivateFromPhotoSheet),
    actionRow('Search an address', 'The address you type is sent to OpenStreetMap once to find it', addPrivateFromAddressSheet),
  );
}

/**
 * Add / Change location and Mark private for one photo (Library sheet): the frame's own editors
 * (photo-menu.js), so phones and the frame work the same.
 */
function photoLocationSheet(p, mode, done) {
  if (openSheetRef) openSheetRef.close();
  const open = mode === 'private' ? openPrivateEditor : openLocationEditor;
  const w = state.config.weather || {};
  open({
    center: w.latitude != null && w.longitude != null ? { lat: w.latitude, lon: w.longitude } : null,
    slide: p,
    inactivityMs: 10 * 60000,
    onSaved: () => toast('Location saved'),
    onClose: async () => { await reloadConfig(); if (done) done(); },
  });
}

function savePrivatePlaces(places) {
  return save({ caption: { privatePlaces: places } });
}

function editPrivatePlaceSheet(index) {
  const places = state.config.caption.privatePlaces;
  const p = places[index];
  if (!p) return;
  const name = input('text', p.name, { placeholder: 'For example Home', maxLength: 40 });
  let size = p.radiusM;
  const segEl = el('div', 'st-seg');
  const buttons = PRIVATE_SIZES.map((s) => {
    const b = text('button', '', s.label);
    b.type = 'button';
    b.addEventListener('click', () => { size = s.value; paint(); });
    segEl.append(b);
    return b;
  });
  const paint = () => PRIVATE_SIZES.forEach((s, i) => buttons[i].classList.toggle('on', size === s.value));
  paint();
  sheet({
    title: 'Your place',
    body: [
      field('Name', name),
      text('p', 'st-photo-note', 'Empty: the caption shows just the town.'),
      field('Size', segEl),
      text('p', 'st-photo-note', 'Photos taken within this distance count as this spot.'),
    ],
    actions: [
      { label: 'Delete', kind: 'danger', onClick: (s) => {
        s.close();
        confirmSheet('Delete this place?', 'Photos taken there go back to the town or a name from OpenStreetMap (they may be looked up online).', 'Delete',
          () => savePrivatePlaces(state.config.caption.privatePlaces.filter((_, k) => k !== index)), 'danger');
      } },
      'spacer', { label: 'Cancel' },
      { label: 'Save', kind: 'primary', onClick: (s) => {
        s.close();
        const next = state.config.caption.privatePlaces.map((q, k) => (k === index ? { ...q, name: name.value.trim(), radiusM: size } : q));
        savePrivatePlaces(next);
      } },
    ],
  });
  setTimeout(() => name.focus(), 50);
}

async function addPrivateFromPhotoSheet() {
  const grid = el('div', 'st-grid');
  const err = errorBox();
  const ref = sheet({
    title: 'Which photo was taken there?',
    body: [text('p', '', 'Photos with a location, newest first.'), err, grid],
    actions: ['spacer', { label: 'Cancel' }],
  });
  try {
    const res = await api('/api/library?filter=all&limit=200');
    const items = res.items.filter((it) => it.hasGps && it.thumb);
    if (!items.length) err.show('No photos with a location on the frame yet.');
    for (const it of items) {
      const t = el('button', 'st-tile');
      t.type = 'button';
      const img = el('img');
      img.alt = it.name;
      img.loading = 'lazy';
      img.src = it.thumb;
      t.append(img);
      // Already inside a private place: marked, so another spot is easy to pick.
      if (it.privatePlace) t.append(text('span', 'st-tile-video', `🔒 ${it.privatePlace}`));
      t.addEventListener('click', async () => {
        try {
          const r = await api('/api/places/private', { method: 'POST', json: { mediaId: it.id } });
          if (r.already) { err.show(`That photo was taken inside ${r.name ? `"${r.name}"` : 'a private place'} already. Pick a photo from the other spot, or use Search an address.`); return; }
          ref.close();
          await reloadConfig();
          toast('Spot kept private');
          editPrivatePlaceSheet(state.config.caption.privatePlaces.length - 1); // give it a name
        } catch (e) { err.show(e.message); }
      });
      grid.append(t);
    }
  } catch (e) { err.show(e.message); }
}

function addPrivateFromAddressSheet() {
  const q = input('search', '', { placeholder: 'Street, town' });
  const f = el('div', 'st-field');
  f.append(q);
  const list = el('div');
  const err = errorBox();
  const run = async () => {
    const query = q.value.trim();
    err.show('');
    list.innerHTML = '';
    if (query.length < 3) { err.show('Type at least 3 letters.'); return; }
    list.append(note('Searching…'));
    try {
      const res = await api(`/api/places/address?q=${encodeURIComponent(query)}`);
      list.innerHTML = '';
      if (!res.results.length) err.show('Nothing found. Try the street and the town.');
      for (const r of res.results) {
        const b = el('button', 'st-choice');
        b.type = 'button';
        b.innerHTML = svg('check', 'check');
        b.append(text('span', '', r.label));
        b.addEventListener('click', async () => {
          ref.close();
          await savePrivatePlaces([...state.config.caption.privatePlaces,
            { name: '', lat: Math.round(r.lat * 1e5) / 1e5, lon: Math.round(r.lon * 1e5) / 1e5, radiusM: PRIVATE_SIZES[0].value }]);
          editPrivatePlaceSheet(state.config.caption.privatePlaces.length - 1);
        });
        list.append(b);
      }
    } catch (e) { list.innerHTML = ''; err.show(e.message); }
  };
  q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); run(); } });
  const ref = sheet({
    title: 'Search an address',
    body: [text('p', '', 'Sent to OpenStreetMap once, only when you tap Search. Only the position is kept on the frame.'), f, err, list],
    actions: ['spacer', { label: 'Cancel' }, { label: 'Search', kind: 'primary', onClick: run }],
  });
  setTimeout(() => q.focus(), 50);
}

function addCaptionPlaceSheet() {
  api('/api/places/search?q=aa').catch(() => {}); // loads the frame's place list (a few seconds) while you type
  const q = input('search', '', { placeholder: 'Town or city, for example Portland' });
  const f = el('div', 'st-field');
  f.append(q);
  const list = el('div');
  const err = errorBox();
  let timer = null;
  let seq = 0;

  const run = async () => {
    const query = q.value.trim();
    err.show('');
    if (query.length < 2) { list.innerHTML = ''; return; }
    const mine = ++seq;
    if (!list.childElementCount) list.append(note('Searching…'));
    try {
      const res = await api(`/api/places/search?q=${encodeURIComponent(query)}`);
      if (mine !== seq) return;
      list.innerHTML = '';
      if (!res.places.length) err.show('No town by that name in the frame\x27s list (it has places with more than 5,000 people).');
      for (const p of res.places) {
        const b = el('button', 'st-choice');
        b.type = 'button';
        b.innerHTML = svg('check', 'check');
        const l = text('span', '', `${p.name}, ${p.region}`);
        l.append(text('small', '', `${p.population.toLocaleString('en-US')} people`));
        b.append(l);
        b.addEventListener('click', () => {
          ref.close();
          const entry = { name: `${p.name}, ${p.region}`, lat: p.lat, lon: p.lon };
          save({ caption: { ignoredPlaces: [...state.config.caption.ignoredPlaces, entry] } });
        });
        list.append(b);
      }
    } catch (e) { if (mine === seq) err.show(e.message); }
  };
  q.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 350); });
  q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); clearTimeout(timer); run(); } });

  const ref = sheet({
    title: 'Leave out a place',
    body: [text('p', '', `Photos taken within ${state.config.caption.ignoreRadiusMi} miles of it show no location.`), f, err, list],
    actions: ['spacer', { label: 'Cancel' }],
  });
  setTimeout(() => q.focus(), 50);
}

function weatherStatusRow() {
  const r = row({
    title: 'Weather data',
    sub: () => {
      const w = weather.value;
      if (!w || !w.configured) return 'No location set';
      const updated = w.lastSuccessAt ? `Updated ${agoText(w.lastSuccessAt)}` : 'Not downloaded yet';
      return w.status === 'error' ? `${updated} · last try failed: ${w.error}` : updated;
    },
  });
  cleanups.push(weather.onChange(sync));
  return r;
}

function timeZoneSheet() {
  const search = input('search', '', { placeholder: 'Search, for example Chicago or Europe/Paris' });
  const list = el('div');
  const zones = (Intl.supportedValuesOf ? Intl.supportedValuesOf('timeZone') : []);
  const current = state.config.clock.timeZone;
  const choose = (v) => { ref.close(); if (v !== current) save({ clock: { timeZone: v } }); };
  const draw = () => {
    const q = search.value.trim().toLowerCase().replace(/\s+/g, '_');
    list.innerHTML = '';
    const opts = [{ value: '', label: 'Same as the frame', detail: state.system ? state.system.timeZone : '' }];
    for (const z of zones) if (!q || z.toLowerCase().includes(q)) opts.push({ value: z, label: z.replace(/_/g, ' ') });
    for (const o of opts.slice(0, 80)) {
      const b = el('button', `st-choice${o.value === current ? ' on' : ''}`);
      b.type = 'button';
      b.innerHTML = svg('check', 'check');
      const l = text('span', '', o.label);
      if (o.detail) l.append(text('small', '', o.detail));
      b.append(l);
      b.addEventListener('click', () => choose(o.value));
      list.append(b);
    }
  };
  search.addEventListener('input', draw);
  draw();
  const ref = sheet({
    title: 'Time zone',
    body: [text('p', '', 'Only changes what the clock and calendar show. The frame\'s own clock stays on network time.'), field('Search', search), list],
    actions: ['spacer', { label: 'Cancel' }],
  });
}

function locationSheet() {
  const q = input('search', '', { placeholder: 'City or town, for example Seattle' });
  const go = text('button', 'st-btn primary', 'Search');
  go.type = 'button';
  const fr = el('div', 'st-field-row');
  fr.append(q, go);
  const f = el('div', 'st-field');
  f.append(fr);
  const list = el('div');
  const err = errorBox();

  const choose = (r) => {
    ref.close();
    save({ weather: { latitude: Math.round(r.latitude * 1e5) / 1e5, longitude: Math.round(r.longitude * 1e5) / 1e5, place: placeLabel(r) } })
      .then(() => setTimeout(() => weather.refresh(), 4000));
  };
  const run = async () => {
    err.show('');
    list.innerHTML = '';
    if (q.value.trim().length < 2) { err.show('Type at least 2 letters.'); return; }
    go.disabled = true;
    go.textContent = 'Searching…';
    list.append(note('Searching for places… this takes a few seconds.'));
    try {
      const res = await api(`/api/weather/geocode?q=${encodeURIComponent(q.value.trim())}`);
      list.innerHTML = '';
      if (!res.results.length) err.show('No places found. Try another spelling or a nearby larger town.');
      for (const r of res.results) {
        const b = el('button', 'st-choice');
        b.type = 'button';
        b.innerHTML = svg('check', 'check');
        const l = text('span', '', placeLabel(r));
        l.append(text('small', '', placeDetail(r)));
        b.append(l);
        b.addEventListener('click', () => choose(r));
        list.append(b);
      }
    } catch (e) { list.innerHTML = ''; err.show(e.message); } finally { go.disabled = false; go.textContent = 'Search'; }
  };
  go.addEventListener('click', run);
  q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); run(); } });

  const actions = [];
  if (state.config.weather.latitude !== null) {
    actions.push({ label: 'Remove location', kind: 'danger', onClick: (s) => { s.close(); save({ weather: { latitude: null, longitude: null, place: '' } }); } });
  }
  actions.push('spacer', { label: 'Cancel' });
  const ref = sheet({
    title: 'Weather location',
    body: [text('p', '', `Now: ${state.config.weather.place || 'not set'}. Weather data by Open-Meteo.com.`), f, err, list],
    actions,
  });
  setTimeout(() => q.focus(), 50);
}

// Warnings (SPEC §13): everything currently wrong, refreshed while the tab is open.

const WARNING_TABS = {
  calendar: 'calendars', media: 'photos', upload: 'photos', weather: 'clock', storage: 'system', sleep: 'display', home: 'system', restarts: 'system',
};

function renderWarnings() {
  const list = group('Right now', note('Loading…'));
  const load = () => api('/api/warnings').then((v) => {
    if (state.section !== 'warnings') return;
    list.innerHTML = '';
    list.append(text('h2', 'st-group-title', 'Right now'));
    if (!v.online) {
      list.append(infoRow('No internet connection',
        'Photos and calendars keep working from what the frame has saved. Calendars and weather update when the connection is back.'));
    }
    for (const w of v.warnings) {
      let when = '';
      if (w.kind === 'calendar') when = w.lastSuccessAt ? ` Last updated ${agoText(w.lastSuccessAt)}.` : ' Never updated.';
      list.append(row({
        title: w.title,
        sub: `${w.detail}${when}`,
        cls: 'tappable',
        lead: el('span', '', svg('warnings', 'st-row-icon st-warn-icon')),
        right: el('span', '', svg('chevron', 'st-row-icon')),
        onTap: () => go(WARNING_TABS[w.kind] || 'system'),
      }));
    }
    if (v.online && !v.warnings.length) list.append(note('Nothing is wrong right now.'));
  }).catch((e) => { list.innerHTML = ''; list.append(text('h2', 'st-group-title', 'Right now'), note(e.message)); });
  load();
  const timer = setInterval(load, 15000);
  cleanups.push(() => clearInterval(timer));
  return [list, group('How warnings work',
    note('A calendar that stops updating pops up on the frame once; after OK, a warning icon stays in the bottom-left corner until it is fixed. Other problems show only the icon. Without internet the frame shows a small offline icon and nothing else.'))];
}

// Backup and restore

function renderBackup() {
  const snaps = group('Snapshots', note('Loading…'));
  api('/api/config/history').then((h) => {
    if (state.section !== 'backup') return;
    snaps.innerHTML = '';
    snaps.append(text('h2', 'st-group-title', 'Snapshots'),
      note('Settings are saved automatically before each change (changes made within a minute count as one). The last 20 are kept.'));
    if (!h.snapshots.length) snaps.append(note('No snapshots yet.'));
    const SHOWN = 5;
    const rows = [];
    for (const s of h.snapshots) {
      const when = snapshotTime(s.savedAt);
      const changed = sectionNames(s.changed);
      rows.push(row({
        title: when,
        sub: changed.length ? `Before changes to ${changed.join(', ')}` : 'Same as now',
        cls: 'tappable',
        onTap: () => confirmSheet(`Restore settings from ${when}?`,
          'Your current settings are saved as a snapshot first, so you can undo this. Calendars added since then are kept, and calendar links don\'t change.',
          'Restore', () => restore(s.id)),
      }));
    }
    snaps.append(...rows.slice(0, SHOWN));
    if (rows.length > SHOWN) {
      const rest = rows.slice(SHOWN);
      rest.forEach((r) => { r.hidden = true; });
      const all = actionRow(`Show all ${rows.length}`, null, () => { rest.forEach((r) => { r.hidden = false; }); all.remove(); });
      snaps.append(all, ...rest);
    }
  }).catch((e) => { snaps.innerHTML = ''; snaps.append(text('h2', 'st-group-title', 'Snapshots'), note(e.message)); });

  let transfer;
  if (isFrame) {
    transfer = group('Export and import', note(`Export and import from a phone or computer: open ${lanAddress()} in its browser.`));
  } else {
    const file = el('input');
    file.type = 'file';
    file.accept = '.json,application/json';
    file.hidden = true;
    file.addEventListener('change', () => { if (file.files[0]) importFile(file.files[0]); file.value = ''; });
    transfer = group('Export and import',
      actionRow('Export settings', 'Download a file with all settings', exportSheet),
      actionRow('Import settings', 'Load settings from an exported file', () => file.click()),
      file,
    );
  }
  return [snaps, transfer];
}

function snapshotTime(ms) {
  const d = new Date(ms);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86400000);
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: state.config.clock.hour12 });
  if (d.toDateString() === today.toDateString()) return `Today, ${time}`;
  if (d.toDateString() === yesterday.toDateString()) return `Yesterday, ${time}`;
  return `${d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}, ${time}`;
}

async function restore(id) {
  try {
    const r = await api(`/api/config/history/${id}/restore`, { method: 'POST' });
    state.config = await api('/api/config');
    toast(restoreSummary('Settings restored', r));
    rerender();
  } catch (e) { toast(e.message, true); }
}

function restoreSummary(head, r) {
  const parts = [head];
  if (r.calendarsAdded) parts.push(`${r.calendarsAdded} calendar${r.calendarsAdded === 1 ? '' : 's'} added`);
  if (r.calendarsSkipped && r.calendarsSkipped.length) {
    parts.push(`skipped (no link): ${r.calendarsSkipped.join(', ')}`);
  }
  return parts.join('. ') + '.';
}

function exportSheet() {
  let secrets = false;
  const a = text('a', 'st-btn primary', 'Download');
  const updateLink = () => { a.href = `/api/config/export${secrets ? '?secrets=1' : ''}`; };
  a.setAttribute('download', '');
  a.addEventListener('click', () => setTimeout(() => ref.close(), 100));
  updateLink();
  const warn = note('Anyone with the calendar links can see those calendars. Keep this file private.');
  warn.hidden = true;
  const toggle = toggleRow('Include calendar links', 'Needed to restore calendars on a new or reset frame',
    () => secrets, (v) => { secrets = v; warn.hidden = !v; updateLink(); sync(); });
  const ref = sheet({
    title: 'Export settings',
    body: [text('p', '', 'All settings and the calendar list (names and colors). Calendar links are left out unless you include them.'), toggle, warn],
    actions: ['spacer', { label: 'Cancel' }],
  });
  ref.box.querySelector('.st-sheet-actions').append(a);
}

async function importFile(file) {
  let data;
  try {
    data = JSON.parse(await file.text());
    if (!data || data.format !== 'openframe-config') throw new Error();
  } catch (e) {
    toast('That isn\'t an OpenFrame settings file.', true);
    return;
  }
  const links = data.secrets && data.secrets.calendarUrls ? Object.keys(data.secrets.calendarUrls).length : 0;
  const when = data.exportedAt ? new Date(data.exportedAt).toLocaleString() : 'an unknown date';
  confirmSheet('Import settings?',
    `From ${file.name}, exported ${when}. ${links ? `Includes ${links} calendar link${links === 1 ? '' : 's'}.` : 'No calendar links in the file, so only calendars already on this frame are updated.'} Your current settings are saved as a snapshot first.`,
    'Import', async () => {
      try {
        const r = await api('/api/config/import', { method: 'POST', json: data });
        state.config = await api('/api/config');
        toast(restoreSummary('Settings imported', r));
        rerender();
      } catch (e) { toast(e.message, true); }
    });
}

// System

let systemLoading = false;

function renderSystem() {
  // Show what we have, fetch fresh numbers once, then redraw with them.
  if (!systemLoading) {
    systemLoading = true;
    loadSystem().then(() => {
      if (state.section === 'system') rerender();
      systemLoading = false;
    });
  }
  const s = state.system;
  if (!s) return group('Frame', note('Loading…'));
  const n = s.network;
  // Android 8.1 hides the network name from apps without location access; the signal is still known.
  const signal = n.wifiSignal != null ? ` · signal ${n.wifiSignal + 1} of 5` : '';
  const wifi = `${n.wifiName || (n.online ? 'Connected' : 'No internet connection')}${signal}`;
  return [
    webAccessGroup(),
    group('Frame',
      infoRow('OpenFrame version', `${s.version}${s.uiSource === 'dev' ? ' · development UI (DEV UI)' : ''}`),
      infoRow('Device', `${s.device} · Android ${s.android}`),
      infoRow('Time since the frame restarted', formatDuration(Math.round(s.uptimeMs / 1000))),
      infoRow('Restarts after a problem', restartsText(s)),
      infoRow('Shut down or restarted from the menu', powerText(s)),
    ),
    group('Network',
      infoRow('Wi-Fi', wifi),
      isFrame && actionRow('Wi-Fi settings', s.checks.returnButton
        ? 'Opens Android\'s Wi-Fi screen, with a button back to OpenFrame'
        : 'Needs a one-time set-up from a computer first (the "Back to OpenFrame" button)', async () => {
        try { await api('/api/system/open', { method: 'POST', json: { screen: 'wifi' } }); } catch (e) { toast(e.message, true); }
      }),
      infoRow('IP address', n.ip || 'Unknown'),
      n.ip && note(`Settings from a phone or computer: <b>http://${n.ip}:8080/settings</b>`),
    ),
    frameSetupGroup(s),
    usbDebuggingGroup(s),
    group('Memory and storage',
      infoRow('OpenFrame memory', formatBytes(s.memory.appPssKb * 1024)),
      infoRow('Free memory', `${formatBytes(s.memory.availableBytes)} of ${formatBytes(s.memory.totalBytes)}`),
      infoRow('Free storage', `${formatBytes(s.storage.internal.freeBytes)} of ${formatBytes(s.storage.internal.totalBytes)}`),
    ),
    group('Display',
      actionRow('Restart the display', 'Reloads the frame\'s screen (and closes these settings on the frame)', () =>
        confirmSheet('Restart the display?', 'The frame reloads its screen. Settings are kept.', 'Restart', async () => {
          try { await api('/api/ui/reload', { method: 'POST' }); toast('Display restarted'); } catch (e) { toast(e.message, true); }
        })),
    ),
    group('About',
      infoRow('NanoHTTPD 2.3.1', 'BSD-3-Clause license'),
      infoRow('ical.js 2.2.1', 'Mozilla Public License 2.0'),
      infoRow('Leaflet 1.9.4 (map)', 'BSD-2-Clause license; map © OpenStreetMap contributors'),
      infoRow('Place names: GeoNames (geonames.org)', 'CC BY 4.0 license'),
      infoRow('Precise place names: © OpenStreetMap contributors (Postpass by Geofabrik, Overpass API, Nominatim)', 'Data under the Open Database License (ODbL)'),
      infoRow('Fonts: Roboto, Roboto Condensed, Coming Soon', 'Apache License 2.0'),
      infoRow('Fonts: Noto Serif, Dancing Script, Cutive Mono', 'SIL Open Font License 1.1'),
      infoRow('Weather data by Open-Meteo.com', 'CC BY 4.0'),
      infoRow('Place search by Open-Meteo.com', 'Based on GeoNames, CC BY 4.0'),
      infoRow('Reminder chimes: Kenney (kenney.nl), Spring Spring, PWL (opengameart.org)', 'CC0 (public domain)'),
      infoRow('Music box chime: Joseph Sardin (bigsoundbank.com)', 'CC0 (public domain)'),
    ),
  ];
}

/** Crash recovery (SPEC §18): how often OpenFrame had to restart itself this week. */
function restartsText(s) {
  const r = s.restarts;
  if (!r || !r.lastWeek || !r.last) return 'None in the last 7 days';
  const at = new Intl.DateTimeFormat('en-US', {
    timeZone: s.timeZone, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: state.config.clock.hour12,
  }).format(r.last.at);
  return `${r.lastWeek} in the last 7 days. Last: ${at}, ${r.last.detail}`;
}

/** The latest Power chip press (SPEC §18), and whether the frame's current start came right after it. */
function powerText(s) {
  const last = s.power && s.power.last;
  if (!last) return 'Never';
  const at = new Intl.DateTimeFormat('en-US', {
    timeZone: s.timeZone, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: state.config.clock.hour12,
  }).format(last.at);
  const what = last.action === 'shutdown' ? 'Shut down' : 'Restart';
  if (last.result !== 'requested' && !s.power.startedAfter) return `${what} on ${at} didn't work`;
  return `${what} on ${at}${s.power.startedAfter ? ' (this start came right after it)' : ''}`;
}

/** What should be in place before Frameo is turned off (SPEC §18). Turning Frameo off stays the user's step. */
function frameSetupGroup(s) {
  const c = s.checks;
  const HOME = { openframe: 'OpenFrame', frameo: 'Frameo (still)', chooser: 'None: Android will ask at the next start', none: 'None' };
  const check = (ok, title, sub) => row({
    title, sub, lead: el('span', '', svg(ok ? 'check' : 'close', `st-row-icon ${ok ? 'st-ok-icon' : 'st-bad-icon'}`)),
  });
  const setUp = (ok) => (ok ? 'Set up' : 'Needs a one-time set-up from a computer');
  return group('Frame set-up',
    check(c.home === 'openframe', 'Home app', HOME[c.home] || c.home),
    check(c.sleepAdmin, 'Sleep', setUp(c.sleepAdmin)),
    check(c.brightnessPermission, 'Brightness', setUp(c.brightnessPermission)),
    check(c.returnButton, '"Back to OpenFrame" button for Wi-Fi settings', setUp(c.returnButton)),
    check(c.autoRotate, 'Auto-rotate', c.autoRotate ? 'On' : 'Off: the picture won\'t turn with the frame'),
    check(c.autoTime, 'Automatic time', c.autoTime ? 'On' : 'Off: the clock may drift'),
    infoRow('Time zone', s.timeZone),
    infoRow('Frameo', c.frameoEnabled ? 'Still installed and on' : 'Turned off'),
    note(c.frameoEnabled
      ? 'Frameo can be turned off from a computer once every line above has a check mark. A restart test also checks that Wi-Fi reconnects without it.'
      : 'Frameo is off (not uninstalled). Bringing it back is done from a computer: see "Return Frameo" (docs/return-frameo.md).'),
  );
}

/** USB debugging, like Frameo's switch: changed on the frame only (someone must be there). */
function usbDebuggingGroup(s) {
  const c = s.checks;
  const on = () => c.usbDebugging;
  const sub = () => {
    if (!isFrame) return `${on() ? 'On' : 'Off'}. It can be changed on the frame itself.`;
    if (!c.usbDebuggingCanChange) return `${on() ? 'On' : 'Off'}. This switch needs a one-time set-up from a computer.`;
    return on() ? 'On: a computer connected by USB can control the frame (needed for OpenFrame updates)' : 'Off';
  };
  const set = async (v) => {
    try {
      const r = await api('/api/system/usb-debugging', { method: 'POST', json: { enabled: v } });
      c.usbDebugging = r.enabled;
      sync();
      toast(`USB debugging ${r.enabled ? 'on' : 'off'}`);
    } catch (e) { toast(e.message, true); }
  };
  const canChange = isFrame && c.usbDebuggingCanChange;
  return group('Developer',
    canChange
      ? toggleRow('USB debugging', sub, on, (v) => (v ? set(true)
        : confirmSheet('Turn off USB debugging?', 'A computer can\'t control or update the frame until you turn this back on here.', 'Turn off', () => set(false), 'danger')))
      : infoRow('USB debugging', sub),
  );
}

/** Web access PIN (SPEC §16a): shown and changed here; the frame's own screen never needs it. */
function webAccessGroup() {
  const g = group('Web access PIN', note('Loading…'));
  api('/api/auth/pin').then((a) => {
    if (state.section !== 'system') return;
    g.innerHTML = '';
    g.append(text('h2', 'st-group-title', 'Web access PIN'),
      row({
        title: 'PIN for phones and computers',
        sub: a.pin || 'Not set: phones and computers can\'t open the frame until you set one',
        cls: a.pin ? 'tappable' : 'tappable accent',
        right: el('span', '', svg('chevron', 'st-row-icon')),
        onTap: () => pinSheet(a.pin),
      }),
      note('Phones and computers must enter it before they can see or change anything. A browser stays signed in for one day. The frame itself never asks for it.'));
    if (!a.local) {
      g.append(actionRow('Sign out this browser', null, async () => {
        try { await api('/api/auth/logout', { method: 'POST' }); location.reload(); } catch (e) { toast(e.message, true); }
      }));
    }
  }).catch((e) => { g.innerHTML = ''; g.append(text('h2', 'st-group-title', 'Web access PIN'), note(e.message)); });
  return g;
}

function pinSheet(current) {
  const i = input('text', '', { inputMode: 'numeric', maxLength: 8, placeholder: '4 to 8 digits', pattern: '[0-9]*' });
  i.style.letterSpacing = '0.3em';
  const err = errorBox();
  const ref = sheet({
    title: current ? 'Change the PIN' : 'Set a PIN',
    body: [
      text('p', '', current ? `The PIN is now ${current}. Changing it signs out every other phone and computer.` : 'Phones and computers will need this PIN to open the frame.'),
      field('New PIN', i), err,
    ],
    actions: ['spacer', { label: 'Cancel' }, {
      label: 'Save', kind: 'primary',
      onClick: async (s) => {
        const pin = i.value.trim();
        if (!/^\d{4,8}$/.test(pin)) { err.show('Use 4 to 8 digits.'); return; }
        try {
          await api('/api/auth/pin', { method: 'POST', json: { pin } });
          s.close();
          flash('Saved');
          toast(`PIN set to ${pin}`);
          rerender();
        } catch (e) { err.show(e.message); }
      },
    }],
  });
  setTimeout(() => i.focus(), 50);
  return ref;
}

async function loadSystem() {
  try {
    state.system = await api('/api/system');
  } catch (e) { toast(e.message, true); }
}

// ---- navigation, inactivity, start ----

function buildNav() {
  for (const s of SECTIONS) {
    if (s.parent) continue;
    const b = el('button', 'st-nav-item', svg(s.id));
    b.type = 'button';
    b.dataset.id = s.id;
    b.append(text('span', '', s.label));
    b.insertAdjacentHTML('beforeend', svg('chevron', 'st-nav-chevron'));
    b.addEventListener('click', () => { navStack = []; go(s.id, { push: false }); });
    nav.append(b);
  }
}

function go(id, { push = true } = {}) {
  if (openSheetRef) openSheetRef.close();
  id = sectionId(id);
  if (push && state.section && id && id !== state.section) navStack.push(state.section);
  if (!id || !SECTIONS.find((x) => x.id === id && x.parent)) navStack = []; // a section starts afresh
  state.section = id;
  history.replaceState(null, '', id ? `#${id}` : location.pathname);
  render();
}

const narrow = () => window.matchMedia('(max-width: 700px)').matches;

function back() {
  if (openSheetRef) { openSheetRef.close(); return; }
  const sub = SECTIONS.find((x) => x.id === state.section && x.parent);
  if (sub) { goBack(sub.parent); return; }
  if (narrow() && state.section) { go(null); return; }
  if (host) host.close();
  else location.href = isFrame ? '/' : '/?view=frame'; // phones and PCs: the copy of the frame's screen
}

/**
 * On the frame the keyboard covers the lower part of the screen and the page doesn't shrink (no system
 * bars): while a text field has focus, sheets fit above it and the field scrolls into view (user report
 * 2026-10-16: the email field was hidden).
 */
function keepFieldsAboveKeyboard() {
  if (!isFrame) return;
  const typing = (t) => t && (t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && !['range', 'checkbox', 'radio', 'file', 'button'].includes(t.type)));
  document.addEventListener('focusin', (e) => {
    if (!typing(e.target)) return;
    // Not at once: the tap that focused the field ends after focus, and a sheet that shrank under the
    // finger made that tap land on the backdrop and close the sheet (user report 2026-10-16).
    lastFieldFocus = Date.now();
    setTimeout(() => {
      if (document.activeElement !== e.target) return;
      document.body.classList.add('st-keyboard');
      e.target.scrollIntoView({ block: 'center' });
    }, 400);
  });
  document.addEventListener('focusout', (e) => {
    if (typing(e.target)) setTimeout(() => { if (!typing(document.activeElement)) document.body.classList.remove('st-keyboard'); }, 100);
  });
}

/** On the frame: back to the photos after the inactivity timeout (SPEC §14). */
function armInactivity() {
  if (!isFrame) return;
  let t = null;
  const arm = () => {
    clearTimeout(t);
    t = setTimeout(() => { if (host) host.close(); else location.href = '/'; }, state.config.layout.inactivityReturnSec * 1000);
  };
  ['pointerdown', 'keydown', 'input'].forEach((ev) => window.addEventListener(ev, arm, true));
  arm();
}

async function start() {
  document.querySelector('.st-back').innerHTML = svg('back');
  document.querySelector('.st-back').addEventListener('click', back);
  buildNav();
  keepFieldsAboveKeyboard();
  for (;;) {
    try { state.config = await api('/api/config'); break; } catch (e) {
      pane.innerHTML = '';
      pane.append(note(`Can't reach the frame (${e.message}). Retrying…`));
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  applyTheme(state.config, weather.value);
  weather.start(); // sunset and sunrise for automatic dark mode
  weather.onChange(() => applyTheme(state.config, weather.value));
  setInterval(() => applyTheme(state.config, weather.value), 60000);
  loadSystem().then(sync); // frame time zone and address shown in several rows
  const fromHash = sectionId(location.hash.slice(1));
  state.section = SECTIONS.some((s) => s.id === fromHash) ? fromHash : (narrow() ? null : SECTIONS[0].id);
  if (fromHash !== location.hash.slice(1)) history.replaceState(null, '', `#${fromHash}`);
  render();
  if (host) requestAnimationFrame(() => host.ready()); // over the photo page: shown once drawn
  armInactivity();
  // Changes made from another device: check every 10 s and when this page comes back to the front.
  setInterval(pollConfig, 10000);
  window.addEventListener('hashchange', () => {
    const id = sectionId(location.hash.slice(1));
    if (id !== state.section && SECTIONS.some((s) => s.id === id)) go(id);
  });
  window.addEventListener('focus', pollConfig);
}

start();
