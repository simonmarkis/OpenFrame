// Layout renderer (SPEC §14): builds the current page (a preset or a custom page) for the orientation,
// mounts widgets, and moves them in place on rotation (the slideshow keeps running).
// Calendar modules (and ical.js) load lazily, only when a calendar is shown.

import {
  pageView, findPage, homePage, layoutPages, arrangementFor, gridBox, anchorBox, validateArrangement, hasWidget,
  customFromPreset, replacePage, DAY_MIN_PX, blankPage, PRESET_NAMES,
} from './lib/layout-core.js';
import { Slideshow } from './slideshow.js';
import { ClockWeather, WeatherData } from './clock.js';
import { WarningsData, WarningPopups, StatusIcons } from './warnings.js';
import { Caption } from './caption.js';
import { Brightness } from './autocolor.js';
import { fontFamily } from './lib/text-style-core.js';
import { applyTheme } from './theme.js';
import { Reminders } from './reminders.js';
import { clockKnown, setClockKnown } from './lib/clock-trust.js';
import {
  photoActionsCard, openPositionEditor, openCommentEditor, undoBar, flushUndo, patchPhoto, libraryAction, sendDelete, openLocationEditor, openPrivateEditor,
} from './photo-menu.js';

// Only the frame's own WebView (user agent marked by the native shell) advances the slideshow.
const isFrame = navigator.userAgent.includes('OpenFrameShell');
// Phones and PCs land on Settings (user decision 2026-10-14); /?view=frame shows the frame's screen.
const leaving = !isFrame && new URLSearchParams(location.search).get('view') !== 'frame';
if (leaving) location.replace('/settings');
const CONFIG_POLL_MS = 30000;

const MENU_HIDE_MS = 10000;
const MENU_SETTLE_MS = 400;
const CALENDAR_PRELOAD_MS = 15000;
const SLEEP_NOTICE_MS = 2500;
const POWER_ASK_MS = 30000;
const ARROW_PX = 76;

const ICONS = {
  calendar: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 4h-1V2h-2v2H8V2H6v2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm0 16H5V9h14v11zM7 11h5v5H7z"/></svg>',
  sleep: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12.34 2.02C6.59 1.82 2 6.42 2 12c0 5.52 4.48 10 10 10 3.71 0 6.93-2.02 8.66-5.02-7.51-.25-12.09-8.43-8.32-14.96z"/></svg>',
  power: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 3h-2v10h2V3zm4.83 2.17l-1.42 1.42A6.92 6.92 0 0 1 19 12c0 3.87-3.13 7-7 7s-7-3.13-7-7c0-2.19 1.01-4.14 2.58-5.42L6.17 5.17A8.93 8.93 0 0 0 3 12c0 4.97 4.03 9 9 9s9-4.03 9-9c0-2.74-1.23-5.18-3.17-6.83z"/></svg>',
  prev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>',
  next: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg>',
  layout: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z"/></svg>',
  settings: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.48.48 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.48.48 0 0 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2z"/></svg>',
};

const pageEl = document.getElementById('page');
const portraitMq = window.matchMedia('(orientation: portrait)');

// Other browsers (phone, PC) show a small copy of the frame's screen, laid out at the frame's CSS
// viewport in the frame's current orientation and scaled to fit (user decision 2026-10-14).
const FRAME_VIEWPORT = { landscape: [1608, 904], portrait: [904, 1608] };
let framePortrait = false;
let editPortrait = null; // phones and PCs: the orientation the layout editor shows (its Landscape/Portrait switch)
const isPortrait = () => (isFrame ? portraitMq.matches : editPortrait !== null ? editPortrait : framePortrait);

function fitMirror() {
  if (isFrame) return;
  const [w, h] = isPortrait() ? FRAME_VIEWPORT.portrait : FRAME_VIEWPORT.landscape;
  const top = layoutEditor ? layoutEditor.barHeight() : 0; // the editor's bar is docked above the copy
  const k = Math.max(0.05, Math.min(window.innerWidth / w, (window.innerHeight - top) / h)); // never zero or flipped (tiny windows)
  const x = (window.innerWidth - w * k) / 2;
  const y = top + (window.innerHeight - top - h * k) / 2;
  Object.assign(pageEl.style, {
    right: 'auto', bottom: 'auto', width: `${w}px`, height: `${h}px`,
    transformOrigin: '0 0', transform: `translate(${x}px, ${y}px) scale(${k})`,
  });
}

/** Other browsers: follow the frame's orientation (reported by the shell). True if it changed. */
async function loadFrameOrientation() {
  if (isFrame) return false;
  const res = await fetch('/api/status', { cache: 'no-store' });
  if (!res.ok) return false;
  const p = !!(await res.json()).portrait;
  if (p === framePortrait) return false;
  framePortrait = p;
  return true;
}

let config = null;
let configKey = '';
const mounted = new Map(); // widget id -> { type, el, inner, widget, spec, dead }
let currentPageId = null; // null = the home page (SPEC §14)
let shownArr = null; // the arrangement on screen
let draftPage = null; // the page being edited (layout editor), shown instead of the stored one
let layoutEditor = null;
let editorSample = { ratio: 4 / 3, label: '4:3' }; // the editor's sample photo (user request: a still test card)
let calendarView = null;
let calendarModules = null;
const weather = new WeatherData();
const warnings = new WarningsData();

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

/** Display time zone: config override if valid, else the frame's own. */
function displayTz() {
  const tz = config.clock.timeZone;
  if (!tz) return undefined;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return tz; } catch (e) { return undefined; }
}

function loadCalendar() {
  if (!calendarModules) {
    calendarModules = Promise.all([import('./lib/calendar-data.js'), import('./calendar-day.js')])
      .then(([dataMod, panelMod]) => {
        const data = new dataMod.CalendarData(displayTz());
        data.setHidden(config.hiddenEvents); // hidden events (SPEC §11)
        data.start();
        return { data, CalendarDayPanel: panelMod.CalendarDayPanel };
      });
  }
  return calendarModules;
}

let calendarViewModules = null;

/** Full-screen calendar view (Day, Week, Month; loaded the first time it is shown). */
function loadCalendarView() {
  if (!calendarViewModules) {
    calendarViewModules = Promise.all([loadCalendar(), import('./calendar-full.js')])
      .then(([{ data }, mod]) => ({ data, View: mod.CalendarFullView }))
      .catch((e) => { calendarViewModules = null; throw e; });
  }
  return calendarViewModules;
}

function panelOptions(m, onOpenFull) {
  return {
    // The chosen number of days, as many as fit at DAY_MIN_PX each (a narrow box shows fewer).
    days: () => Math.max(1, Math.min(m.spec.days || 1, Math.floor(m.el.offsetWidth / DAY_MIN_PX))),
    get hour12() { return config.clock.hour12; },
    get inactivityReturnMs() { return config.layout.inactivityReturnSec * 1000; },
    get nowTimeLeft() { return config.calendar.nowTimeLeft; },
    onOpenFull,
  };
}

// ---- widgets ----

class CalendarIcon {
  constructor(root) {
    const btn = el('button', 'cal-icon', ICONS.calendar);
    btn.setAttribute('aria-label', 'Open calendar');
    btn.addEventListener('click', openCalendar);
    root.append(btn);
    this.root = root;
  }

  destroy() { this.root.innerHTML = ''; }
}

/** Creates the widget for `m` (async for calendar types). Returns the widget or null if unmounted meanwhile. */
async function createWidget(m) {
  switch (m.type) {
    case 'photo': return new Slideshow(m.inner, {
      isFrame, onTap: toggleMenu, onSlide: showCaption, onVideo: videoChanged, quiet: autoMuted, portrait: isPortrait,
      sample: () => (layoutEditor ? editorSample : null), // the layout editor's test card
    });
    case 'caption': {
      const w = new Caption(m.inner, { config: () => config, tz: displayTz() });
      const photo = photoWidget();
      if (photo) w.setSlide(photo.widget.current);
      return w;
    }
    case 'clock_weather': return new ClockWeather(m.inner, { config: () => config, weather, tz: displayTz() });
    case 'calendar_icon': return new CalendarIcon(m.inner);
    case 'status': return new StatusIcons(m.inner, warnings, { onSettings: () => openSettings('warnings') });
    case 'calendar_day': {
      const { data, CalendarDayPanel } = await loadCalendar();
      if (m.dead) return null;
      return new CalendarDayPanel(m.inner, data, panelOptions(m, openCalendar));
    }
    case 'calendar_full': {
      const { data, View } = await loadCalendarView();
      if (m.dead) return null;
      return new View(m.inner, data, { config: () => config, onSettings: openSettings });
    }
    default:
      throw new Error(`unknown widget type ${m.type}`);
  }
}

function mount(spec) {
  const m = { id: spec.id, type: spec.type, el: el('div', 'w'), inner: el('div', 'w-inner'), widget: null, spec, dead: false };
  m.el.append(m.inner);
  pageEl.append(m.el);
  mounted.set(spec.id, m);
  createWidget(m)
    .then((w) => {
      if (!w) return;
      if (m.dead) { if (w.destroy) w.destroy(); return; }
      m.widget = w;
      if (w.update) w.update(m.spec);
    })
    .catch((e) => console.error(`layout: widget ${m.id} (${m.type}) failed:`, e && e.stack ? e.stack : e));
  return m;
}

function unmount(id) {
  const m = mounted.get(id);
  if (!m) return;
  m.dead = true;
  if (m.widget && m.widget.destroy) m.widget.destroy();
  m.el.remove();
  mounted.delete(id);
}

function setBox(node, box) {
  node.style.left = `${box.left * 100}%`;
  node.style.top = `${box.top * 100}%`;
  node.style.width = `${box.width * 100}%`;
  node.style.height = `${box.height * 100}%`;
}

function place(m, spec, arr, index) {
  m.el.style.zIndex = String(index + 1);
  if (spec.anchor) {
    const a = spec.anchor;
    m.el.className = `w w-anchor w-${spec.type} corner-${a.corner}${a.lift ? ' lift' : ''}${a.beside ? ' beside' : ''}${a.statusLift ? ' status-lift' : ''}`;
    setBox(m.el, anchorBox(spec, arr));
  } else {
    m.el.className = `w w-grid w-${spec.type}`; // the type lets CSS size a widget by its box (clock panel)
    setBox(m.el, gridBox(spec, arr));
  }
}

function render() {
  const c = config.clock;
  const weatherOn = c.showWeather && config.weather.latitude !== null;
  const cap = config.caption;
  const page = pageView(draftPage || findPage(config.layout, currentPageId), {
    corner: c.corner,
    size: c.size,
    hybridCalendar: config.layout.hybridCalendar,
    clockVisible: c.showClock || c.showDate || weatherOn,
    caption: { visible: cap.showComment || cap.showLocation || cap.showDate, corner: cap.corner },
  });
  currentPageId = page.id;
  fitMirror();
  const arr = arrangementFor(page, isPortrait());
  shownArr = arr;
  const problems = validateArrangement(arr);
  if (problems.length) console.error('layout: invalid arrangement:', problems.join('; '));

  const seen = new Set();
  arr.widgets.forEach((spec, i) => {
    if (spec.type === 'photo' && !mounted.has(spec.id)) {
      const photo = [...mounted.values()].find((x) => x.type === 'photo');
      if (photo) { mounted.delete(photo.id); photo.id = spec.id; mounted.set(spec.id, photo); }
    }
    let m = mounted.get(spec.id);
    if (m && m.type !== spec.type) { unmount(spec.id); m = null; }
    if (!m) m = mount(spec);
    m.spec = spec;
    place(m, spec, arr, i);
    if (m.widget && m.widget.update) m.widget.update(spec);
    seen.add(spec.id);
  });
  for (const id of [...mounted.keys()]) if (!seen.has(id)) unmount(id);
  document.body.dataset.preset = page.preset; // 'custom' for custom pages
  drawPageDots();
  armPageReturn();
  if (layoutEditor) layoutEditor.refresh();
  applyCalendarText();
  requestAnimationFrame(() => updateAutoColors()); // boxes moved or text style changed
}

// ---- pages (SPEC §14): dots at the bottom edge, the menu's Pages row, back home after no touch ----

let dotsEl = null;
let pageReturnTimer = null;

function showPage(id) {
  if (id === currentPageId) return;
  closeMenu();
  closeCalendar();
  if (editor) editor.close();
  currentPageId = id;
  render();
}

/** Small page dots at the bottom center when there is more than one page; a tap switches. */
function drawPageDots() {
  const pages = layoutPages(config.layout);
  if (pages.length < 2 || layoutEditor) { if (dotsEl) { dotsEl.remove(); dotsEl = null; } return; }
  if (!dotsEl) {
    dotsEl = el('div', 'page-dots');
    document.body.append(dotsEl);
  }
  dotsEl.innerHTML = '';
  for (const p of pages) {
    const b = el('button', `page-dot${p.id === currentPageId ? ' on' : ''}`, '<span></span>');
    b.setAttribute('aria-label', `Page: ${p.name}`);
    b.addEventListener('click', (e) => { e.stopPropagation(); showPage(p.id); });
    dotsEl.append(b);
  }
}

/** Away from the home page: back to it after the inactivity time without a touch. */
function armPageReturn() {
  clearTimeout(pageReturnTimer);
  const home = homePage(config.layout).id;
  if (currentPageId === home || layoutEditor) return;
  pageReturnTimer = setTimeout(() => showPage(home), config.layout.inactivityReturnSec * 1000);
}
document.addEventListener('pointerdown', () => { if (pageReturnTimer) armPageReturn(); }, true);

// ---- layout editor (SPEC §14, Phase 13c): edits the page on screen, over the real widgets ----

/** Opens the editor for page `pageId` (a built-in page is copied into a custom one; saving replaces it). */
async function editLayout(pageId, { blank = false } = {}) {
  if (layoutEditor) return;
  closeMenu();
  closeCalendar();
  if (editor) editor.close();
  const page = findPage(config.layout, pageId);
  // A built-in layout turns into "Custom" when saved (its preset name would no longer be true).
  const name = page.preset && Object.values(PRESET_NAMES).includes(page.name) ? 'Custom' : page.name;
  const draft = blank ? blankPage(page.id, name)
    : page.preset
      ? customFromPreset(page.preset, {
        corner: config.clock.corner, caption: { corner: config.caption.corner },
        size: config.clock.size, hybridCalendar: config.layout.hybridCalendar, // as it's shown now
      }, page.id, name)
      : JSON.parse(JSON.stringify(page));
  let LayoutEditor;
  try {
    ({ LayoutEditor } = await import('./layout-editor.js'));
  } catch (e) {
    notice("Couldn't open the layout editor", e.message, 6000);
    return;
  }
  if (layoutEditor) return;
  currentPageId = page.id;
  draftPage = draft;
  if (!isFrame) editPortrait = framePortrait;
  hold('layout', true);
  layoutEditor = new LayoutEditor({
    pageEl,
    page: draft,
    portrait: isPortrait,
    inactivityMs: config.layout.inactivityReturnSec * 1000,
    setPortrait: isFrame ? null : (p) => { editPortrait = p; render(); },
    onBarResize: isFrame ? null : fitMirror,
    sample: () => editorSample,
    onSample: (s) => { editorSample = s; render(); },
    onDraft: (p) => { draftPage = p; render(); },
    onSave: async (p) => {
      const change = replacePage(config.layout, p);
      if (!change) throw new Error('The page was deleted meanwhile');
      const res = await fetch('/api/config', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ layout: change }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      config = body;
    },
    onClose: () => {
      layoutEditor = null;
      draftPage = null;
      editPortrait = null;
      hold('layout', false);
      render();
    },
  });
  render();
}

// ---- full-screen calendar, opened over the page (calendar icon, day panel's full-screen button) ----

// The slideshow stands still while anything covers or edits the photo (reasons: menu, editor, calendar).
const holds = new Set();

function hold(reason, on) {
  if (on) holds.add(reason); else holds.delete(reason);
  for (const m of mounted.values()) {
    if (m.type === 'photo' && m.widget) {
      // A video pauses too: a tap on it opens the menu (user request: tap to pause, then position it).
      if (holds.size) m.widget.pause({ video: true }); else m.widget.resume();
    }
  }
}

/** The page on screen has the full calendar on it (the Calendar preset): no full-screen calendar over it. */
function pageHasCalendar() {
  return !!shownArr && hasWidget(shownArr, 'calendar_full');
}

function photoWidget() {
  return [...mounted.values()].find((m) => m.type === 'photo' && m.widget) || null;
}

// ---- videos: menu updates, main volume, auto-mute (SPEC §6) ----

const videoListeners = new Set(); // the quick menu's video row while it is open
function videoChanged() { videoListeners.forEach((fn) => fn()); }

/** The main volume (Settings → Sound); never set yet: the clicks' current level, as Settings shows it. */
async function mainVolume() {
  if (config.sound && config.sound.volume != null) return config.sound.volume;
  try {
    const s = await (await fetch('/api/sound', { cache: 'no-store' })).json();
    return Math.round((s.system.level * 100) / s.system.max / 5) * 5;
  } catch (e) { return 50; }
}

async function setMainVolume(pct) {
  try {
    const res = await fetch('/api/config', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sound: { volume: pct } }),
    });
    if (res.ok) config.sound = (await res.json()).sound;
  } catch (e) { console.error('volume:', e.message); }
}

// Auto-mute (Frameo's option): no touch for 10 minutes → videos without sound until someone touches.
const AUTO_MUTE_MS = 10 * 60000;
let lastTouch = Date.now();
document.addEventListener('pointerdown', () => { lastTouch = Date.now(); }, true);
function autoMuted() {
  return !!(config && config.video && config.video.autoMute) && Date.now() - lastTouch > AUTO_MUTE_MS;
}
if (isFrame) {
  setInterval(() => {
    const p = photoWidget();
    const s = p && autoMuted() && p.widget.videoState();
    if (s && !s.muted) p.widget.setVideoMuted(true);
  }, 30000);
}

/** The slideshow shows a new photo (or the photo menu changed this one): update the caption. */
function showCaption(slide) {
  for (const m of mounted.values()) if (m.type === 'caption' && m.widget) m.widget.setSlide(slide);
  updateAutoColors();
}

// ---- automatic text color (SPEC §9): how bright the photo is under the clock and caption ----

const brightness = new Brightness();
let autoSeq = 0;

async function updateAutoColors() {
  const photo = photoWidget();
  const slide = photo && photo.widget.current;
  if (!slide) return;
  const seq = ++autoSeq;
  const box = photo.el.getBoundingClientRect();
  for (const m of mounted.values()) {
    if (!m.widget || !m.widget.wantsBackground || !m.widget.wantsBackground()) continue;
    const lum = await brightness.under(slide, photo.widget.settings, photo.widget.effectiveFit(slide), box,
      m.inner.getBoundingClientRect(), photo.widget.view(slide));
    if (seq !== autoSeq) return; // a newer photo or layout is being measured
    m.widget.setBackground(lum);
  }
}

const CALENDAR_SCALE = { small: 0.9, medium: 1, large: 1.15 };

/** Dark mode (SPEC §9): CSS does most; event cards are colored by script, so the calendars redraw. */
function updateTheme() {
  const changed = applyTheme(config, weather.value);
  reportTheme();
  if (!changed) return;
  if (calendarModules) calendarModules.then(({ data }) => data.redraw()).catch(() => {});
}

/** The frame tells the shell its look, so phones' PIN page can match it (SPEC §16a). */
let reportedTheme = null;
function reportTheme() {
  const theme = document.documentElement.dataset.theme;
  if (!isFrame || theme === reportedTheme) return;
  reportedTheme = theme;
  fetch('/api/ui/theme', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ theme }) })
    .catch((e) => { reportedTheme = null; console.error('theme: report failed', e.message); });
}

/** Calendar font and text size (text style) as CSS variables for the day panel and full calendar. */
function applyCalendarText() {
  const t = config.text;
  document.body.style.setProperty('--of-cal-font', fontFamily(t.calendar.font || t.font));
  document.body.style.setProperty('--of-cal-scale', String(CALENDAR_SCALE[t.calendar.size] || 1));
}

// ---- quick menu (tap the photo; SPEC §15), like Frameo's: Wi-Fi status and Sleep on top, then
// Calendar and Settings; below it the photo actions (Phase 9); previous/next arrows at the photo's
// edges on the frame. The slideshow pauses while it is open. ----

let menu = null;

// Wi-Fi icon with 0–4 bars (Material Design signal_wifi_*), or crossed out without internet.
const WIFI_FAN = 'M12.01 21.49L23.64 7c-.45-.34-4.93-4-11.64-4C5.28 3 .81 6.66.36 7l11.63 14.49.01.01.01-.01z';
const WIFI_BARS = [
  '',
  'M6.67 14.86L12 21.49v.01l.01-.01 5.33-6.63C17.06 14.65 15.03 13 12 13s-5.06 1.65-5.33 1.86z',
  'M4.79 12.52l7.2 8.98H12l.01-.01 7.2-8.98C18.85 12.24 16.1 10 12 10s-6.85 2.24-7.21 2.52z',
  'M3.53 10.95l8.46 10.54.01.01.01-.01 8.46-10.54C20.04 10.62 16.81 8 12 8c-4.81 0-8.04 2.62-8.47 2.95z',
  WIFI_FAN,
];
const WIFI_OFF = 'M23.64 7c-.45-.34-4.93-4-11.64-4-1.5 0-2.89.19-4.15.48L18.18 13.8 23.64 7zm-6.6 8.22L3.27 1.44 2 2.72l2.05 2.06C1.91 5.76.59 6.82.36 7l11.63 14.49.01.01.01-.01 3.9-4.86 3.32 3.32 1.27-1.27-3.46-3.46z';

function wifiIcon(net) {
  if (!net.online) return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${WIFI_OFF}"/></svg>`;
  const bars = net.wifiSignal == null ? 4 : Math.max(0, Math.min(4, net.wifiSignal));
  const fill = bars ? `<path d="${WIFI_BARS[bars]}"/>` : '';
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill-opacity=".3" d="${WIFI_FAN}"/>${fill}</svg>`;
}

function toggleMenu() {
  if (menu) closeMenu(); else openMenu();
}

function openMenu() {
  const backdrop = el('div', 'qm-backdrop'); // catches the tap outside the card
  const card = el('div', 'qm-card');
  const button = (cls, html, label, onClick, keepOpen = false) => {
    const b = el('button', cls, html);
    b.setAttribute('aria-label', label);
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      if (keepOpen) armMenuTimer(); else closeMenu();
      onClick();
    });
    return b;
  };

  // Top row: Wi-Fi status (opens Android's Wi-Fi screen on the frame), Sleep, and Power (frame only).
  const top = el('div', 'qm-top');
  const wifi = button('qm-chip', '', 'Wi-Fi', openWifi);
  wifi.hidden = true; // shown once the status is known
  top.append(wifi, el('span', 'qm-spacer'), button('qm-chip', `${ICONS.sleep}<span>Sleep</span>`, 'Sleep', sleepNow));
  if (isFrame) top.append(button('qm-chip', `${ICONS.power}<span>Power</span>`, 'Shut down or restart', askPowerOff));

  const items = el('div', 'qm-items');
  if (!pageHasCalendar()) items.append(button('qm-item', `${ICONS.calendar}<span>Calendar</span>`, 'Calendar', openCalendar));
  items.append(button('qm-item', `${ICONS.layout}<span>Layout</span>`, 'Edit this page\'s layout', () => editLayout(currentPageId)));
  items.append(button('qm-item', `${ICONS.settings}<span>Settings</span>`, 'Settings', openSettings));
  card.append(top, items);
  const pages = layoutPages(config.layout);
  if (pages.length > 1) {
    const row = el('div', 'qm-pages');
    for (const p of pages) {
      const b = button(`qm-page${p.id === currentPageId ? ' on' : ''}`, '', `Page: ${p.name}`, () => showPage(p.id));
      b.textContent = p.name;
      row.append(b);
    }
    card.append(row);
  }
  card.addEventListener('click', (e) => e.stopPropagation()); // its padding isn't "outside"
  const stack = el('div', 'qm-stack');
  stack.append(card);
  backdrop.append(stack);

  // Actions for the photo on screen now (the slideshow is paused, so it stays the same photo).
  const photo = photoWidget();
  // On the frame the cards sit over the middle of the photo (Hybrid: not the whole screen).
  if (isFrame && photo && !calendarView) {
    const r = photo.el.getBoundingClientRect();
    Object.assign(stack.style, {
      position: 'absolute', left: `${r.left + r.width / 2}px`, top: `${r.top + r.height * 0.07}px`,
      transform: 'translateX(-50%)', maxWidth: `${r.width - 32}px`,
    });
  }
  const slide = photo && !calendarView ? photo.widget.current : null;
  if (slide) {
    stack.append(photoActionsCard({
      slide,
      defaultFit: photo.widget.settings.fit,
      canPosition: isFrame,
      onTouch: armMenuTimer,
      // The frame's own video: Play/Pause, Sound, and the main volume (SPEC §6).
      video: isFrame && slide.type === 'video' ? {
        state: () => photo.widget.videoState(),
        toggle: () => { armMenuTimer(); photo.widget.toggleVideo(); },
        sound: async (on) => {
          armMenuTimer();
          if (on) {
            const v = config.sound.volume;
            if (v == null || v === 0) await setMainVolume(v === 0 ? 50 : await mainVolume()); // otherwise nothing to hear
          }
          photo.widget.setVideoMuted(!on);
        },
        volume: mainVolume,
        setVolume: (pct) => { armMenuTimer(); setMainVolume(pct); },
        poll: () => photo.widget.requestVideoPosition(),
        seek: (ms) => { armMenuTimer(); photo.widget.seekVideo(ms); },
        strip: () => photo.widget.loadStrip(),
        preview: (ms) => { armMenuTimer(); return photo.widget.scrubPreview(ms); },
        previewEnd: (ms) => photo.widget.scrubEnd(ms),
        subscribe: (fn) => { videoListeners.add(fn); return () => videoListeners.delete(fn); },
      } : null,
      onFit: async (fit) => {
        armMenuTimer();
        try {
          photo.widget.updateCurrent(await patchPhoto(slide.id, { fit }));
        } catch (e) { closeMenu(); notice("Couldn't change the photo", e.message, 6000); throw e; }
      },
      // The editor's hold comes first, so a paused video doesn't run on between menu and editor.
      onPosition: () => { hold('editor', true); closeMenu(); positionPhoto(photo, slide); },
      onComment: () => { hold('editor', true); closeMenu(); editComment(photo, slide); },
      onLocation: () => { hold('editor', true); closeMenu(); editLocation(photo, slide, 'name'); },
      onPrivate: () => { hold('editor', true); closeMenu(); editLocation(photo, slide, 'private'); },
      onHide: () => { closeMenu(); removePhoto(photo, slide, false); },
      onDelete: () => { closeMenu(); removePhoto(photo, slide, true); },
    }));
  }

  // Previous / next at the photo's edges (only the frame's own screen moves the slideshow).
  if (isFrame && photo && !calendarView) {
    const r = photo.el.getBoundingClientRect();
    for (const [dir, x, label] of [['prev', r.left + 24, 'Previous photo'], ['next', r.right - 24 - ARROW_PX, 'Next photo']]) {
      const b = button(`qm-arrow ${dir}`, ICONS[dir], label, () => photo.widget[dir](), true);
      b.style.left = `${x}px`;
      b.style.top = `${r.top + r.height / 2 - ARROW_PX / 2}px`;
      backdrop.append(b);
    }
  }

  // A touch tap's click is hit-tested after pointerup, so the tap that opened the menu would land on
  // it: close it, or press whichever button now sits there. The menu ignores touches at first.
  backdrop.style.pointerEvents = 'none';
  setTimeout(() => { backdrop.style.pointerEvents = ''; }, MENU_SETTLE_MS);
  backdrop.addEventListener('click', closeMenu);
  document.body.append(backdrop);
  const m = { backdrop, timer: null };
  menu = m;
  hold('menu', true);
  armMenuTimer();

  fetch('/api/network', { cache: 'no-store' }).then((res) => (res.ok ? res.json() : null)).then((net) => {
    if (menu !== m || !net) return;
    wifi.innerHTML = `${wifiIcon(net)}<span></span>`;
    wifi.lastChild.textContent = net.online ? (net.wifiName || 'Wi-Fi') : 'No internet';
    const signal = net.online && net.wifiSignal != null ? `, signal ${net.wifiSignal + 1} of 5` : '';
    wifi.setAttribute('aria-label', `Wi-Fi: ${net.online ? 'connected' : 'no internet'}${signal}`);
    wifi.hidden = false;
  }).catch(() => {});
}

function armMenuTimer() {
  if (!menu) return;
  clearTimeout(menu.timer);
  menu.timer = setTimeout(closeMenu, MENU_HIDE_MS);
}

function closeMenu() {
  if (!menu) return;
  clearTimeout(menu.timer);
  menu.backdrop.remove();
  menu = null;
  hold('menu', false);
}

// ---- photo actions (SPEC §15) ----

let editor = null; // open position or comment editor

function editorClosed() {
  editor = null;
  hold('editor', false);
}

/**
 * Position editor over the photo's own box: zoom and move, starting from how it looks now (SPEC §15;
 * before 2026-10-26 a fitted photo switched to Fill first).
 */
function positionPhoto(photo, slide) {
  hold('editor', true);
  const s = photo.widget.current && photo.widget.current.id === slide.id ? photo.widget.current : slide;
  if (photo.dead) { hold('editor', false); return; }
  editor = openPositionEditor({
    slide: s,
    fit: photo.widget.effectiveFit(s),
    portrait: isPortrait(),
    settings: photo.widget.settings,
    rect: photo.el.getBoundingClientRect(),
    inactivityMs: config.layout.inactivityReturnSec * 1000,
    onSaved: (saved) => photo.widget.updateCurrent(saved),
    onClose: editorClosed,
  });
}

function editComment(photo, slide) {
  hold('editor', true);
  editor = openCommentEditor({
    slide: photo.widget.current && photo.widget.current.id === slide.id ? photo.widget.current : slide,
    inactivityMs: config.layout.inactivityReturnSec * 1000,
    note: 'Shown in the caption on the photo (Settings → Photo caption).',
    onSaved: (saved) => photo.widget.updateCurrent(saved),
    onClose: editorClosed,
  });
}

function editLocation(photo, slide, mode) {
  hold('editor', true);
  const w = config.weather || {};
  editor = (mode === 'private' ? openPrivateEditor : openLocationEditor)({
    // A photo without a position: the map starts at the weather location.
    center: w.latitude != null && w.longitude != null ? { lat: w.latitude, lon: w.longitude } : null,
    slide: photo.widget.current && photo.widget.current.id === slide.id ? photo.widget.current : slide,
    inactivityMs: config.layout.inactivityReturnSec * 1000,
    onSaved: (saved) => photo.widget.updateCurrent(saved),
    onClose: editorClosed,
  });
}

/**
 * Hide, or Delete (user decision: no question, an Undo bar instead). Both hide the photo at once; a
 * delete moves it to the Trash when the Undo bar goes away. Undo brings it back on screen.
 */
async function removePhoto(photo, slide, del) {
  try {
    await libraryAction('hide', slide.id);
  } catch (e) {
    notice(del ? "Couldn't delete the photo" : "Couldn't hide the photo", e.message, 6000);
    return;
  }
  if (!photo.dead) photo.widget.next();
  undoBar(del ? 'Photo deleted' : 'Photo hidden', {
    over: isFrame && !photo.dead ? photo.el.getBoundingClientRect() : null,
    onUndo: async () => {
      try {
        await libraryAction('unhide', slide.id);
        if (!photo.dead) photo.widget.prev();
      } catch (e) { notice("Couldn't undo", e.message, 6000); }
    },
    onExpire: del ? () => sendDelete(slide.id) : null,
  });
}

/** A message in the middle of the screen. Resolves true if tapped away, false when it times out. */
function notice(title, message, ms) {
  const veil = el('div', 'notice-veil');
  const box = el('div', 'notice-box');
  const t = el('b');
  const m = el('span');
  t.textContent = title;
  m.textContent = message;
  box.append(t, m);
  veil.append(box);
  document.body.append(veil);
  return new Promise((resolve) => {
    let done = false;
    const close = (tapped) => { if (done) return; done = true; veil.remove(); resolve(tapped); };
    veil.addEventListener('click', () => close(true));
    setTimeout(() => close(false), ms);
  });
}

async function postJson(path, body) {
  const res = await fetch(path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
  return res.json();
}

/** Android's Wi-Fi screen under the "Back to OpenFrame" button (frame only; SPEC §19); elsewhere Settings → System. */
async function openWifi() {
  if (!isFrame) { location.href = '/settings#system'; return; }
  try { await postJson('/api/system/open', { screen: 'wifi' }); } catch (e) { notice('Wi-Fi settings', e.message, 6000); }
}

/** Sleep (SPEC §18): a short notice (tap to cancel), then the screen goes off until a swipe or the wake-up time. */
async function sleepNow() {
  const cancelled = await notice('Going to sleep…', isFrame
    ? 'Swipe across the screen to wake the frame. Tap to cancel.'
    : "The frame's screen turns off. Swipe across it to wake it.", isFrame ? SLEEP_NOTICE_MS : 1500);
  if (cancelled && isFrame) return;
  try { await postJson('/api/power/sleep'); } catch (e) { notice('Sleep', e.message, 6000); }
}

/**
 * Power (SPEC §18, frame only): "Shut down the frame?" with Shut down / Restart / Cancel. A tap outside,
 * or no answer within 30 s, cancels. The slideshow waits while the question is open.
 */
function askPowerOff() {
  const veil = el('div', 'notice-veil');
  const box = el('div', 'notice-box power-box');
  const t = el('b');
  const m = el('span');
  t.textContent = 'Shut down the frame?';
  // Tested 2026-10-16: after a shutdown, plugging it in again doesn't start it; the button on the back does.
  m.textContent = 'Restart turns it off and on again (about a minute). After Shut down, turn it on with the power button on its back.';
  const row = el('div', 'power-actions');
  let timer = null;
  const close = () => { clearTimeout(timer); veil.remove(); hold('power', false); };
  const action = (label, cls, fn) => {
    const b = el('button', `power-btn ${cls}`);
    b.textContent = label;
    b.addEventListener('click', (e) => { e.stopPropagation(); close(); if (fn) fn(); });
    return b;
  };
  row.append(action('Cancel', 'cancel', null),
    action('Restart', 'restart', () => powerOff('restart')),
    action('Shut down', 'shutdown', () => powerOff('shutdown')));
  box.append(t, m, row);
  box.addEventListener('click', (e) => e.stopPropagation());
  veil.append(box);
  veil.addEventListener('click', close);
  document.body.append(veil);
  hold('power', true);
  timer = setTimeout(close, POWER_ASK_MS);
}

async function powerOff(action) {
  const shutdown = action === 'shutdown';
  // Stays up until Android takes the screen away; an error replaces it.
  const veil = el('div', 'notice-veil');
  const box = el('div', 'notice-box');
  const t = el('b');
  t.textContent = shutdown ? 'Shutting down…' : 'Restarting…';
  box.append(t);
  veil.append(box);
  document.body.append(veil);
  hold('power', true);
  try {
    await postJson('/api/power/off', { action });
  } catch (e) {
    veil.remove();
    hold('power', false);
    notice(shutdown ? "Couldn't shut down" : "Couldn't restart", e.message, 8000);
  }
}

// ---- Settings (SPEC §16) ----
// On the frame it opens over this page (2026-10-19, TODO item 6): going back was a full reload (photo at
// 1.4–2.4 s, events at 3.2 s, the calendars parsed again); now it only removes the frame (~30 ms). Tested
// first as a page-only overlay: no measurable memory cost. The slideshow waits, a video stops.

const SETTINGS_SHOW_MAX_MS = 3000;
let settingsFrame = null;
let settingsShowTimer = null;

function openSettings(section) {
  const url = `/settings${typeof section === 'string' ? `#${section}` : ''}`;
  if (!isFrame) { location.href = url; return; }
  if (settingsFrame) return;
  closeMenu();
  hold('settings', true);
  const photo = photoWidget();
  if (photo) photo.widget.coverVideo();
  // Loaded hidden and shown once it has drawn (settings.js calls ready()): shown at once, the WebView held
  // the screen for ~1 s and flashed white (measured 2026-10-19).
  const f = el('iframe', 'settings-frame loading');
  settingsFrame = f;
  settingsShowTimer = setTimeout(showSettings, SETTINGS_SHOW_MAX_MS);
  // After the closed menu is on screen, so the tap shows at once.
  requestAnimationFrame(() => setTimeout(() => {
    if (settingsFrame !== f) return;
    f.src = url;
    document.body.append(f);
  }, 0));
}

function showSettings() {
  clearTimeout(settingsShowTimer);
  if (settingsFrame) settingsFrame.classList.remove('loading');
}

/** Back from Settings: the page under it takes what changed there at once (not at the next poll). */
async function closeSettings() {
  if (!settingsFrame) return;
  clearTimeout(settingsShowTimer);
  settingsFrame.remove();
  settingsFrame = null;
  lastTouch = Date.now(); // the touches in Settings didn't reach this page (auto-mute)
  hold('settings', false);
  armPageReturn();
  if (calendarModules) calendarModules.then(({ data }) => data.refresh()).catch(() => {});
  try {
    if (await loadConfig()) {
      updateTheme();
      render();
    }
  } catch (e) {
    console.error('layout: config after Settings failed', e.message);
  }
}

if (isFrame) {
  // Called by settings.js inside the frame (same origin).
  window.openframeHost = {
    close: closeSettings,
    ready: showSettings,
    edit: async (pageId, blank) => { await closeSettings(); editLayout(pageId, { blank: !!blank }); },
  };
}

function openCalendar() {
  if (calendarView || pageHasCalendar()) return;
  const view = el('div', 'cal-view');
  const host = el('div', 'cal-view-host');
  view.append(host);
  document.body.append(view);

  const v = { view, panel: null, timer: null, dead: false };
  calendarView = v;
  const arm = () => {
    clearTimeout(v.timer);
    v.timer = setTimeout(closeCalendar, config.layout.inactivityReturnSec * 1000); // SPEC §14
  };
  view.addEventListener('pointerdown', arm, true);
  arm();
  hold('calendar', true);

  loadCalendarView().then(({ data, View }) => {
    if (v.dead) return;
    v.panel = new View(host, data, { config: () => config, onBack: closeCalendar });
  }).catch((e) => {
    console.error('calendar view failed:', e && e.stack ? e.stack : e);
    closeCalendar();
  });
}

function closeCalendar() {
  const v = calendarView;
  if (!v) return;
  calendarView = null;
  v.dead = true;
  clearTimeout(v.timer);
  if (v.panel) v.panel.destroy();
  v.view.remove();
  hold('calendar', false);
}

// ---- config ----

async function loadConfig() {
  const res = await fetch('/api/config', { cache: 'no-store' });
  if (res.status === 401) location.reload(); // another device whose sign-in expired: show the PIN page
  if (!res.ok) throw new Error(`config: HTTP ${res.status}`);
  const next = await res.json();
  // Hidden events (hidden from a phone, say) go straight to the calendar data: no page redraw needed.
  if (calendarModules) calendarModules.then(({ data }) => data.setHidden(next.hiddenEvents)).catch(() => {});
  // theme and the sleep schedules (Automatic "around sleep hours") too: changed from a phone, dark mode
  // and the panel's own look apply within a poll (before 2026-10-16 only after a reload).
  const key = JSON.stringify([next.layout, next.clock, next.weather, next.calendar, next.caption, next.text, next.video,
    next.sound, next.theme, next.sleep.schedules]);
  if (key === configKey) return false;
  if (config && next.clock.timeZone !== config.clock.timeZone) {
    location.reload(); // the display zone is baked into the calendar data and formatters
    return false;
  }
  const first = !config;
  config = next;
  configKey = key;
  if (!first) weather.refresh(); // units or location may have changed
  return true;
}

/**
 * The frame: is its clock right yet? After a reboot it isn't until network time arrives (SPEC §18);
 * checked every 5 s until it is (a later reboot reloads this page anyway).
 */
async function checkClock() {
  if (!isFrame) return;
  try {
    const res = await fetch('/api/status', { cache: 'no-store' });
    if (res.ok) setClockKnown((await res.json()).clockOk !== false);
  } catch (e) { /* keep the last answer */ }
  if (!clockKnown()) setTimeout(checkClock, 5000);
}

async function start() {
  await checkClock(); // before the first draw, so a wrong date never flashes
  for (;;) {
    try {
      await loadConfig();
      break;
    } catch (e) {
      console.error('layout: could not load config, retrying', e.message);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  try { await loadFrameOrientation(); } catch (e) { /* landscape until the next poll */ }
  if (!isFrame) document.documentElement.classList.add('mirror');
  updateTheme();
  render();
  // Settings → Layout → a page → Edit layout opens /?edit=<page id> (phones: /?view=frame&edit=<id>).
  const editId = new URLSearchParams(location.search).get('edit');
  const editBlank = new URLSearchParams(location.search).get('blank') === '1';
  if (editId) {
    history.replaceState(null, '', isFrame ? '/' : '/?view=frame');
    editLayout(editId, { blank: editBlank });
  }
  warnings.start();
  weather.start();
  weather.onChange(updateTheme); // sunset/sunrise come with the weather
  setInterval(updateTheme, 60000);
  new WarningPopups(warnings); // calendar problems pop up (SPEC §13)
  // Event reminders pop up on the frame only (SPEC §11); the calendars load for them even in Pictures only.
  if (isFrame) {
    const reminders = new Reminders({
      loadData: () => loadCalendar().then(({ data }) => data),
      hold: (on) => { if (on) closeMenu(); hold('reminder', on); },
      hour12: () => config.clock.hour12,
      repeatSec: () => config.sound.reminders.repeatSec,
    });
    reminders.start();
    window.__ofReminders = reminders; // for checks with scripts/frame-js.mjs
  }
  // Load and expand the calendars in the background, so the first full-screen calendar opens fast
  // even in Pictures only (no calendar on the page) after a restart.
  // The events around today are expanded ahead too (~0.8 s on the frame), and again when a feed changes.
  if (isFrame) {
    setTimeout(() => {
      loadCalendarView().then(({ data }) => {
        const warm = () => { if (data.loaded && !data.window) data.ensureWindow(data.today()); };
        data.onChange(warm);
        warm();
      }).catch((e) => console.error('calendar preload failed:', e && e.message));
    }, CALENDAR_PRELOAD_MS);
  }
  window.addEventListener('pagehide', flushUndo); // a pending delete still happens (Settings, reload)
  const rotated = () => {
    closeMenu(); // its arrows sit at the old photo edges
    if (editor && editor.isPosition) editor.close(); // it was laid out for the old photo box
    render();
    if (calendarView && calendarView.panel) calendarView.panel.update();
  };
  if (isFrame) portraitMq.addEventListener('change', rotated);
  else window.addEventListener('resize', fitMirror);
  setInterval(async () => {
    try {
      if (await loadFrameOrientation().catch(() => false)) rotated();
      if (await loadConfig()) {
        updateTheme();
        render();
        if (calendarView && pageHasCalendar()) closeCalendar();
        if (calendarView && calendarView.panel) calendarView.panel.update();
      }
    } catch (e) {
      console.error('layout: config poll failed', e.message);
    }
  }, CONFIG_POLL_MS);
}

if (!leaving) start();
