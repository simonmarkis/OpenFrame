// Calendar data service for the web UI: polls /api/calendars, fetches and parses feeds whose
// revision changed, and expands occurrences for a window around the viewed days.
// Shared by the day panel (Phase 2) and the full-screen calendar (Phase 4).

import {
  parseFeed, expandFeed, occurrencesOnDay, nextEventDay, dayBounds, dayKey, addDays,
} from './calendar-core.js';

const POLL_MS = 60000;
const WINDOW_BEFORE_DAYS = 7;
const WINDOW_AFTER_DAYS = 45;
// Full-screen calendar: extra days expanded around a requested view range.
const RANGE_BEFORE_DAYS = 21;
const RANGE_AFTER_DAYS = 42;
const RANGES_KEPT = 6; // view blocks kept (~3 months each; a few hundred occurrences)
const DAY_MS = 86400000;

export function displayTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** Hidden-event keys: one occurrence (a one-off event, or one repeat by its recurrence id) or a whole series. */
export function occurrenceKey(occ) {
  return `o|${occ.calendar}|${occ.uid}|${occ.recurrenceId || ''}`;
}

export function seriesKey(occ) {
  return `s|${occ.calendar}|${occ.uid}`;
}

/** Whether an occurrence is one repeat of a series ("Hide all repeats" is offered). */
export function isRepeat(occ) {
  return !!occ.recurrenceId;
}

export class CalendarData {
  /** @param {string} [tz] display time zone override (config clock.timeZone); default: the system's */
  constructor(tz) {
    this.tz = tz || displayTimeZone();
    this.calendars = [];       // metadata + status from /api/calendars
    this.online = true;
    this.feeds = new Map();    // id -> { rev, feed, error }
    this.window = null;        // { from, to, occurrences: [{...occ, calendar}] }
    this.listeners = new Set();
    this.loaded = false;
    this.timer = null;
  }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  /** Asks every view to draw again (e.g. dark mode switched: event colors are set by script). */
  redraw() { this.listeners.forEach((fn) => fn()); }

  start() {
    this.refresh();
    this.timer = setInterval(() => this.refresh(), POLL_MS);
  }

  /** Re-reads metadata; refetches only feeds whose revision changed. */
  async refresh() {
    let meta;
    try {
      const res = await fetch('/api/calendars', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      meta = await res.json();
    } catch (e) {
      console.error('calendars: metadata fetch failed', e.message);
      return;
    }
    this.online = meta.online;
    this.syncing = meta.syncing;
    this.calendars = meta.calendars.filter((c) => c.enabled);
    let changed = !this.loaded;

    const ids = new Set(this.calendars.map((c) => c.id));
    for (const id of [...this.feeds.keys()]) {
      if (!ids.has(id)) { this.feeds.delete(id); changed = true; }
    }
    for (const c of this.calendars) {
      const have = this.feeds.get(c.id);
      if (c.rev === 0 || (have && have.rev === c.rev)) continue;
      try {
        const res = await fetch(`/api/calendars/${c.id}.ics`, { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const started = performance.now();
        const feed = parseFeed(await res.text());
        console.log(`calendars: parsed ${c.id} rev ${c.rev} (${feed.events.length} events) in ${Math.round(performance.now() - started)} ms`);
        this.feeds.set(c.id, { rev: c.rev, feed, error: null });
      } catch (e) {
        // Keep the previous parse if there was one; the warning system (Phase 6) reports it.
        console.error(`calendars: ${c.id} could not be parsed:`, e.message);
        this.feeds.set(c.id, { rev: c.rev, feed: have ? have.feed : null, error: e.message });
      }
      changed = true;
    }

    // A calendar's color/name/busy/email can change without a new revision.
    const metaKey = JSON.stringify(this.calendars.map((c) => [c.id, c.name, c.color, c.busy, c.email]));
    if (metaKey !== this.metaKey) { this.metaKey = metaKey; changed = true; }

    this.loaded = true;
    if (changed) {
      this.window = null;
      this.ranges = [];
      this.listeners.forEach((fn) => fn());
    }
  }

  /**
   * Asks the shell to download the feeds now (SPEC §10), then re-reads them as they arrive.
   * @param {boolean} force manual refresh button (5 s debounce); else entering the calendar (30 s)
   */
  async requestSync(force) {
    try {
      await fetch(`/api/calendars/refresh${force ? '?force=1' : ''}`, { method: 'POST', cache: 'no-store' });
    } catch (e) {
      console.error('calendars: refresh request failed', e.message);
      return;
    }
    // Downloads take a few seconds; poll briefly instead of waiting for the next minute's poll.
    // Done once the shell isn't syncing (it may also have skipped feeds synced moments ago).
    for (let i = 0; i < 15; i++) {
      await new Promise((r) => setTimeout(r, i === 0 ? 1500 : 2000));
      await this.refresh();
      if (!this.syncing) break;
    }
  }

  /** Oldest successful sync among the enabled calendars (0 = never): what "Updated N min ago" shows. */
  lastSyncAt() {
    const times = this.calendars.map((c) => c.lastSuccessAt || 0);
    return times.length ? Math.min(...times) : 0;
  }

  /**
   * Occurrences overlapping [fromMs, toMs) — e.g. a week or month view — tagged with their calendar.
   * Expands a block of several weeks around the request (one ical.js pass costs ~70–90 ms on the
   * frame), so moving week to week only filters it.
   */
  occurrencesBetween(fromMs, toMs) {
    const overlapping = (list) => list.filter((o) => o.start < toMs && (o.end > fromMs || o.start >= fromMs));
    // The last few blocks are kept (month to month and back stays a filter, 2026-10-19: one block made
    // every return to a month expand again, ~240 ms on the frame).
    this.ranges = this.ranges || [];
    for (const w of [this.window, ...this.ranges]) {
      if (w && fromMs >= w.from && toMs <= w.to) return overlapping(w.occurrences);
    }
    const from = fromMs - RANGE_BEFORE_DAYS * DAY_MS;
    const to = toMs + RANGE_AFTER_DAYS * DAY_MS;
    const started = performance.now();
    const occurrences = [];
    for (const c of this.calendars) {
      const entry = this.feeds.get(c.id);
      if (!entry || !entry.feed) continue;
      for (const occ of expandFeed(entry.feed, from, to, this.tz, { selfEmail: c.email || '' })) {
        occ.calendar = c.id;
        occurrences.push(occ);
      }
    }
    console.log(`calendars: expanded ${occurrences.length} occurrences for a view block in ${Math.round(performance.now() - started)} ms`);
    this.ranges.unshift({ from, to, occurrences });
    if (this.ranges.length > RANGES_KEPT) this.ranges.length = RANGES_KEPT;
    return overlapping(occurrences);
  }

  /** Whether [fromMs, toMs) is already expanded (a view of it is only a filter). */
  hasRange(fromMs, toMs) {
    return [this.window, ...(this.ranges || [])].some((w) => w && fromMs >= w.from && toMs <= w.to);
  }

  calendarById(id) { return this.calendars.find((c) => c.id === id); }

  /** Expand all feeds for a window covering `day` (re-expands when `day` leaves it). */
  ensureWindow(day) {
    const [dayStart] = dayBounds(day, this.tz);
    if (this.window && dayStart >= this.window.from && dayStart < this.window.to - 2 * 86400000) return;
    const from = dayBounds(addDays(day, -WINDOW_BEFORE_DAYS), this.tz)[0];
    const to = dayBounds(addDays(day, WINDOW_AFTER_DAYS), this.tz)[0];
    const started = performance.now();
    const occurrences = [];
    for (const c of this.calendars) {
      const entry = this.feeds.get(c.id);
      if (!entry || !entry.feed) continue;
      for (const occ of expandFeed(entry.feed, from, to, this.tz, { selfEmail: c.email || '' })) {
        occ.calendar = c.id;
        occurrences.push(occ);
      }
    }
    console.log(`calendars: expanded ${occurrences.length} occurrences in ${Math.round(performance.now() - started)} ms`);
    this.window = { from, to, occurrences };
  }

  /** The day's events, without hidden ones (day panel, reminders). */
  eventsOn(day) {
    this.ensureWindow(day);
    const list = occurrencesOnDay(this.window.occurrences, day, this.tz);
    return this.hiddenSet && this.hiddenSet.size ? list.filter((o) => !this.isHidden(o)) : list;
  }

  // ---- hidden events (user 2026-10-19; config `hiddenEvents`: [{ key, title }]) ----

  /** The hidden list from the config; views draw again when it changes. */
  setHidden(list) {
    const items = Array.isArray(list) ? list : [];
    const key = JSON.stringify(items);
    if (key === this.hiddenJson) return;
    this.hiddenJson = key;
    this.hiddenList = items;
    this.hiddenSet = new Set(items.map((h) => h.key));
    if (this.loaded) this.redraw();
  }

  hiddenCount() { return this.hiddenList ? this.hiddenList.length : 0; }

  isHidden(occ) {
    return !!this.hiddenSet && (this.hiddenSet.has(seriesKey(occ)) || this.hiddenSet.has(occurrenceKey(occ)));
  }

  /**
   * Hides (`hide`) or shows again one occurrence (`scope` 'one') or every repeat ('all'); saved in the
   * frame's settings (PATCH /api/config), so the frame and every phone agree.
   */
  async setEventHidden(occ, scope, hide) {
    const list = (this.hiddenList || []).filter((h) => h.key !== occurrenceKey(occ) && h.key !== seriesKey(occ));
    if (hide) list.push({ key: scope === 'all' ? seriesKey(occ) : occurrenceKey(occ), title: (occ.title || '').slice(0, 200) });
    const res = await fetch('/api/config', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hiddenEvents: list }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    this.setHidden(body.hiddenEvents);
  }

  nextEventDay(day) {
    const feeds = this.calendars.map((c) => this.feeds.get(c.id)).filter((e) => e && e.feed).map((e) => e.feed);
    return nextEventDay(feeds, day, this.tz);
  }

  today() { return dayKey(Date.now(), this.tz); }
}
