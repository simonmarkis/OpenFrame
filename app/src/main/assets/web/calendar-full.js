// `calendar_full` (SPEC §11): Day and Week are OpenFrame's own time grid (calendar-timegrid.js), Month
// its own month grid (calendar-month.js, since 2026-10-19; FullCalendar took ~1.3 s per month on the frame).
// Shared toolbar (back, prev/today/next, title, view switch, refresh + "Updated N min ago"),
// legend with per-calendar visibility toggles, swipe, event details sheet, inactivity reset.

import { addDays, dayBounds } from './lib/calendar-core.js';
import { weekStart, rangeDays, wallMinutes } from './lib/timegrid-core.js';
import { monthStart, monthWeeks } from './lib/month-core.js';
import { TimeGrid } from './calendar-timegrid.js';
import { MonthGrid } from './calendar-month.js';
import { EventSheet } from './calendar-sheet.js';

const HIDDEN_KEY = 'openframe.calendar.hidden'; // per-browser legend toggles
const SWIPE_MIN_PX = 80;
const TICK_MS = 30000;

const ICONS = {
  prev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15.4 7.4 14 6l-6 6 6 6 1.4-1.4L10.8 12z"/></svg>',
  next: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.6 16.6 10 18l6-6-6-6-1.4 1.4 4.6 4.6z"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17.65 6.35A7.96 7.96 0 0 0 12 4a8 8 0 1 0 7.74 10h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>',
  photos: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 19V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2zM8.5 13.5l2.5 3 3.5-4.5 4.5 6H5l3.5-4.5z"/></svg>',
  settings: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.48.48 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.48.48 0 0 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2z"/></svg>',
};

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

function readHidden() {
  try { return new Set(JSON.parse(localStorage.getItem(HIDDEN_KEY) || '[]')); } catch (e) { return new Set(); }
}

function saveHidden(set) {
  try { localStorage.setItem(HIDDEN_KEY, JSON.stringify([...set])); } catch (e) { /* private mode etc.: not kept */ }
}

export class CalendarFullView {
  /**
   * @param {HTMLElement} root
   * @param {import('./lib/calendar-data.js').CalendarData} data
   * @param {{ config: () => object, onBack?: () => void, onSettings?: () => void }} opts
   *   onBack: shows a "Photos" button (temporary view); without it this is the home page, which
   *   resets to today and the default view after inactivity (SPEC §14).
   *   onSettings: shows a settings button (the Calendar preset has no photo to tap for the menu).
   */
  constructor(root, data, opts) {
    this.root = root;
    this.data = data;
    this.opts = opts;
    this.tz = data.tz;
    this.hidden = readHidden();
    this.mode = this.cfg().calendar.defaultView;
    this.anchor = data.today(); // a day inside the shown range
    this.sheet = new EventSheet({ tz: this.tz, hour12: () => this.cfg().clock.hour12, data: this.data });
    this.build();
    this.grid = new TimeGrid(this.gridHost, {
      tz: this.tz,
      hour12: () => this.cfg().clock.hour12,
      fadePast: () => this.cfg().calendar.fadePast,
      weekNumbers: () => this.cfg().calendar.weekNumbers,
      calendarById: (id) => this.data.calendarById(id),
      onEventClick: (occ, cal) => this.openSheet(occ, cal),
      isHidden: (occ) => this.data.isHidden(occ),
    });
    this.month = new MonthGrid(this.monthHost, {
      tz: this.tz,
      hour12: () => this.cfg().clock.hour12,
      fadePast: () => this.cfg().calendar.fadePast,
      weekNumbers: () => this.cfg().calendar.weekNumbers,
      calendarById: (id) => this.data.calendarById(id),
      onEventClick: (occ, cal) => this.openSheet(occ, cal),
      isHidden: (occ) => this.data.isHidden(occ),
      // Tapping a day opens it in Day view; "+N more" lists it (user choices 2026-10-19).
      // (Not setMode: leaving Month for the current month lands on today, but a tapped day wins.)
      onDayClick: (day) => { if (!this.suppressClick) { this.mode = 'day'; this.anchor = day; this.show({ scroll: true }); } },
      onMore: (day, occs) => { if (!this.suppressClick) this.sheet.openDay(day, occs, (id) => this.data.calendarById(id)); },
    });
    window.openframeCalendar = this; // debugging/profiling hook (frame-js.mjs)

    this.renderLegend();
    this.show({ scroll: true });
    this.unsubscribe = data.onChange(() => {
      this.renderLegend();
      this.refreshEvents();
    });
    this.tickTimer = setInterval(() => this.tick(), TICK_MS);
    this.root.addEventListener('pointerdown', this.onActivity = () => this.armReset(), true);
    this.armReset();
    // Entering the full-screen calendar triggers a refresh (SPEC §10; the shell debounces 30 s).
    this.sync(false);
  }

  cfg() { return this.opts.config(); }

  destroy() {
    this.destroyed = true;
    this.unsubscribe();
    clearInterval(this.tickTimer);
    clearTimeout(this.resetTimer);
    clearTimeout(this.prefetchTimer);
    this.root.removeEventListener('pointerdown', this.onActivity, true);
    this.month.destroy();
    this.grid.destroy();
    this.sheet.destroy();
    if (window.openframeCalendar === this) window.openframeCalendar = null;
    this.root.innerHTML = '';
    this.root.classList.remove('fcv');
  }

  /** Layout or settings changed (rotation, 12/24 h, week options). */
  update() {
    this.root.classList.toggle('fade-past', this.cfg().calendar.fadePast);
    this.show();
  }

  // ---- ranges and rendering ----

  /** Days shown by the day/week grid for the current anchor. */
  gridDays() {
    if (this.mode === 'day') return [this.anchor];
    const c = this.cfg().calendar;
    return rangeDays(c.startOnToday ? this.anchor : weekStart(this.anchor, c.firstDay), 7);
  }

  async show({ scroll = false } = {}) {
    this.viewBtns.forEach((b) => b.classList.toggle('active', b.dataset.kind === this.mode));
    if (this.mode === 'month') {
      this.gridHost.hidden = true;
      this.monthHost.hidden = false;
      this.showMonth();
      return;
    }
    this.monthHost.hidden = true;
    const days = this.gridDays();
    this.titleEl.textContent = this.rangeTitle(days);
    const [from] = dayBounds(days[0], this.tz);
    const [, to] = dayBounds(days[days.length - 1], this.tz);
    this.grid.render(days, this.visible(this.data.occurrencesBetween(from, to)), this.data.today());
    if (scroll) this.grid.scrollToHour(this.scrollHour());
  }

  /** The month holding the anchor: 4–6 weeks, events from the first to the last day shown. */
  showMonth() {
    const weeks = monthWeeks(this.anchor, this.cfg().calendar.firstDay);
    const first = monthStart(this.anchor);
    this.titleEl.textContent = new Intl.DateTimeFormat(undefined, { timeZone: 'UTC', year: 'numeric', month: 'long' })
      .format(new Date(`${first}T12:00:00Z`));
    const [from] = dayBounds(weeks[0][0], this.tz);
    const [, to] = dayBounds(weeks[weeks.length - 1][6], this.tz);
    this.month.render(weeks, first.slice(0, 7), this.visible(this.data.occurrencesBetween(from, to)), this.data.today());
    this.prefetchMonths();
  }

  /**
   * After a month is shown, expand the next and the previous month in the background, one at a time
   * (~240 ms each on the frame), so the usual next/previous tap is only a redraw.
   */
  prefetchMonths() {
    clearTimeout(this.prefetchTimer);
    const todo = [1, -1].map((d) => monthWeeks(monthStart(this.anchor, d), this.cfg().calendar.firstDay))
      .map((w) => [dayBounds(w[0][0], this.tz)[0], dayBounds(w[w.length - 1][6], this.tz)[1]])
      .filter(([a, b]) => !this.data.hasRange(a, b));
    const next = () => {
      const r = todo.shift();
      if (!r || this.destroyed || this.mode !== 'month') return;
      this.data.occurrencesBetween(r[0], r[1]);
      if (todo.length) this.prefetchTimer = setTimeout(next, 150);
    };
    if (todo.length) this.prefetchTimer = setTimeout(next, 400);
  }

  /** Without the calendars switched off in the legend, and without hidden events unless "Hidden" is on. */
  visible(occurrences) {
    const hideEvents = !this.showHidden && this.data.hiddenCount() > 0;
    if (!this.hidden.size && !hideEvents) return occurrences;
    return occurrences.filter((o) => !this.hidden.has(o.calendar) && !(hideEvents && this.data.isHidden(o)));
  }

  refreshEvents() {
    this.show();
  }

  rangeTitle(days) {
    const [a] = dayBounds(days[0], this.tz);
    const [b] = dayBounds(days[days.length - 1], this.tz);
    const opts = { timeZone: this.tz, year: 'numeric', month: 'long', day: 'numeric' };
    if (days.length === 1) return new Intl.DateTimeFormat(undefined, { ...opts, weekday: 'long' }).format(a + 43200000);
    return new Intl.DateTimeFormat(undefined, opts).formatRange(a + 43200000, b + 43200000); // "October 11 – 17, 2026"
  }

  /** An hour before now (6 AM–5 PM), so the current time is in view. */
  scrollHour() {
    return Math.max(6, Math.min(Math.floor(wallMinutes(Date.now(), this.tz) / 60) - 1, 17));
  }

  // ---- navigation ----

  setMode(mode) {
    if (mode === this.mode) return;
    if (this.mode === 'month' && this.data.today().slice(0, 7) === this.anchor.slice(0, 7)) {
      this.anchor = this.data.today(); // leaving the current month: land on today's week
    }
    this.mode = mode;
    this.show({ scroll: true });
  }

  step(dir) {
    if (this.mode === 'month') {
      // The 1st of the next or previous month (this month: today, so leaving Month lands on today's week).
      const m = monthStart(this.anchor, dir);
      this.anchor = this.data.today().slice(0, 7) === m.slice(0, 7) ? this.data.today() : m;
      this.show();
      return;
    }
    this.anchor = addDays(this.anchor, dir * (this.mode === 'day' ? 1 : 7));
    this.show();
  }

  goToday() {
    this.anchor = this.data.today();
    this.show({ scroll: true });
  }

  tick() {
    this.renderUpdated();
    if (!this.sheet.isOpen) this.show(); // now line, past fading, midnight
  }

  openSheet(occ, cal) {
    if (this.suppressClick) return;
    this.sheet.open(occ, cal || { color: '#888888', name: '', busy: false });
  }

  // ---- toolbar and legend ----

  build() {
    this.root.classList.add('fcv');
    this.root.classList.toggle('fade-past', this.cfg().calendar.fadePast);
    this.root.innerHTML = '';
    const bar = el('div', 'fcv-bar');

    if (this.opts.onBack) {
      const back = el('button', 'fcv-btn fcv-back', `${ICONS.photos}<span>Photos</span>`);
      back.addEventListener('click', () => this.opts.onBack());
      bar.append(back);
    }

    const nav = el('div', 'fcv-nav');
    const prev = el('button', 'fcv-btn fcv-icon', ICONS.prev);
    prev.setAttribute('aria-label', 'Previous');
    const today = el('button', 'fcv-btn', 'Today');
    const next = el('button', 'fcv-btn fcv-icon', ICONS.next);
    next.setAttribute('aria-label', 'Next');
    prev.addEventListener('click', () => this.step(-1));
    next.addEventListener('click', () => this.step(1));
    today.addEventListener('click', () => this.goToday());
    nav.append(prev, today, next);

    this.titleEl = el('div', 'fcv-title');

    const views = el('div', 'fcv-views');
    this.viewBtns = ['day', 'week', 'month'].map((kind) => {
      const b = el('button', 'fcv-seg', kind[0].toUpperCase() + kind.slice(1));
      b.dataset.kind = kind;
      b.addEventListener('click', () => this.setMode(kind));
      views.append(b);
      return b;
    });

    const refresh = el('div', 'fcv-refresh');
    this.refreshBtn = el('button', 'fcv-btn fcv-icon', ICONS.refresh);
    this.refreshBtn.setAttribute('aria-label', 'Refresh calendars');
    this.refreshBtn.addEventListener('click', () => this.sync(true));
    this.updatedEl = el('div', 'fcv-updated');
    refresh.append(this.updatedEl, this.refreshBtn);
    if (this.opts.onSettings) {
      const settings = el('button', 'fcv-btn fcv-icon', ICONS.settings);
      settings.setAttribute('aria-label', 'Settings');
      settings.addEventListener('click', () => this.opts.onSettings());
      refresh.append(settings);
    }

    bar.append(nav, this.titleEl, views, refresh);
    this.legendEl = el('div', 'fcv-legend');
    this.content = el('div', 'fcv-cal');
    this.gridHost = el('div', 'fcv-host');
    this.monthHost = el('div', 'fcv-host');
    this.monthHost.hidden = true;
    this.content.append(this.gridHost, this.monthHost);
    this.root.append(bar, this.legendEl, this.content);
    this.bindSwipes();
  }

  async sync(force) {
    if (this.syncing) return;
    this.syncing = true;
    this.refreshBtn.classList.add('spinning');
    this.renderUpdated();
    try {
      await this.data.requestSync(force);
    } finally {
      this.syncing = false;
      if (!this.destroyed) {
        this.refreshBtn.classList.remove('spinning');
        this.renderUpdated();
      }
    }
  }

  renderUpdated() {
    if (this.syncing) { this.updatedEl.textContent = 'Updating…'; return; }
    const at = this.data.lastSyncAt();
    if (!at) { this.updatedEl.textContent = this.data.calendars.length ? 'Not updated yet' : ''; return; }
    const min = Math.floor((Date.now() - at) / 60000);
    let text;
    if (min < 1) text = 'just now';
    else if (min < 60) text = `${min} min ago`;
    else if (min < 48 * 60) text = `${Math.floor(min / 60)} h ago`;
    else text = `${Math.floor(min / 1440)} days ago`;
    this.updatedEl.textContent = `Updated ${text}`;
  }

  renderLegend() {
    this.legendEl.innerHTML = '';
    for (const c of this.data.calendars) {
      const chip = el('button', 'fcv-chip');
      chip.classList.toggle('off', this.hidden.has(c.id));
      chip.style.setProperty('--accent', c.color);
      chip.append(el('span', 'fcv-chip-dot'));
      chip.append(document.createTextNode(c.name));
      chip.addEventListener('click', () => {
        if (this.hidden.has(c.id)) this.hidden.delete(c.id); else this.hidden.add(c.id);
        saveHidden(this.hidden);
        chip.classList.toggle('off', this.hidden.has(c.id));
        this.refreshEvents();
      });
      this.legendEl.append(chip);
    }
    // "Hidden (N)": shows hidden events again, faded (only while something is hidden).
    const n = this.data.hiddenCount();
    if (!n) this.showHidden = false;
    if (n) {
      const chip = el('button', 'fcv-chip hidden-chip');
      chip.classList.toggle('off', !this.showHidden);
      chip.append(el('span', 'fcv-chip-dot'));
      chip.append(document.createTextNode(`Hidden (${n})`));
      chip.addEventListener('click', () => {
        this.showHidden = !this.showHidden;
        chip.classList.toggle('off', !this.showHidden);
        this.refreshEvents();
      });
      this.legendEl.append(chip);
    }
    this.renderUpdated();
  }

  // ---- interaction ----

  /** Home-page calendar: back to today and the default view after inactivity (SPEC §14). */
  armReset() {
    clearTimeout(this.resetTimer);
    if (this.opts.onBack) return; // the temporary view is closed by the renderer instead
    this.resetTimer = setTimeout(() => {
      this.sheet.close();
      this.anchor = this.data.today();
      const mode = this.cfg().calendar.defaultView;
      if (mode !== this.mode) this.setMode(mode);
      else this.show({ scroll: true });
    }, this.cfg().layout.inactivityReturnSec * 1000);
  }

  /**
   * Swipe left/right = next/previous range. Touch events, not pointer events: Chromium cancels
   * pointer events once a finger moves inside a scroll area (our hour grid), while touchend still arrives. Mouse drags (LAN browser) use pointer events.
   */
  bindSwipes() {
    let start = null;
    const begin = (x, y) => { start = { x, y }; };
    const end = (x, y) => {
      if (!start) return;
      const dx = x - start.x;
      const dy = y - start.y;
      start = null;
      if (Math.abs(dx) >= SWIPE_MIN_PX && Math.abs(dx) > Math.abs(dy) * 1.5) {
        this.suppressClick = true;
        setTimeout(() => { this.suppressClick = false; }, 0);
        this.step(dx < 0 ? 1 : -1);
      }
    };
    this.content.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) begin(e.touches[0].clientX, e.touches[0].clientY); else start = null;
    }, { passive: true });
    this.content.addEventListener('touchend', (e) => end(e.changedTouches[0].clientX, e.changedTouches[0].clientY));
    this.content.addEventListener('touchcancel', () => { start = null; });
    this.content.addEventListener('pointerdown', (e) => { if (e.pointerType === 'mouse') begin(e.clientX, e.clientY); });
    this.content.addEventListener('pointerup', (e) => { if (e.pointerType === 'mouse') end(e.clientX, e.clientY); });
  }
}
