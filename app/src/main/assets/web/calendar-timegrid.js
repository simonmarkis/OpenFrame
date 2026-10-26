// Day/week time grid for the full-screen calendar (SPEC §11). Layout comes from
// lib/timegrid-core.js arithmetic; hour lines are a CSS background, so a week is a few dozen
// elements and re-rendering it is cheap on the frame's CPU.

import { dayBounds } from './lib/calendar-core.js';
import { cardTint, cardText, cardEdge } from './lib/colors.js';
import {
  MIN_VISUAL_MIN, timedSegments, layoutCascade, allDayLanes, wallMinutes, isoWeek,
} from './lib/timegrid-core.js';

export const HOUR_PX = 72;
const LANE_PX = 30;
const MAX_ALLDAY_LANES = 3; // more scroll inside the all-day row
const INDENT_PX = 14; // one nesting level of overlapping events (Google-style, layoutCascade)

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export class TimeGrid {
  /**
   * @param {HTMLElement} root
   * @param {{ tz: string, hour12: () => boolean, fadePast: () => boolean, weekNumbers: () => boolean,
   *           calendarById: (id) => object, onEventClick: (occ, cal) => void, isHidden?: (occ) => boolean }} opts
   */
  constructor(root, opts) {
    this.root = root;
    this.opts = opts;
    this.fmtKey = '';
    root.classList.add('tg');
    this.head = el('div', 'tg-row tg-head');
    this.allDay = el('div', 'tg-row tg-allday');
    this.body = el('div', 'tg-body');
    this.grid = el('div', 'tg-row tg-grid');
    this.grid.style.height = `${24 * HOUR_PX}px`;
    this.body.append(this.grid);
    root.append(this.head, this.allDay, this.body);
    this.days = [];
    this.scrolled = false;
  }

  destroy() {
    this.root.innerHTML = '';
    this.root.classList.remove('tg');
  }

  formatters() {
    const h12 = this.opts.hour12();
    if (this.fmtKey !== String(h12)) {
      this.fmtKey = String(h12);
      const tz = this.opts.tz;
      // Hour labels are wall-clock hours: format fixed UTC times, independent of DST.
      this.hourFmt = new Intl.DateTimeFormat(undefined, { timeZone: 'UTC', hour: 'numeric', hour12: h12 });
      this.timeFmt = new Intl.DateTimeFormat(undefined, { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: h12 });
      this.dowFmt = new Intl.DateTimeFormat(undefined, { timeZone: tz, weekday: 'short' });
    }
    return this;
  }

  /** Scroll so `hour` is at the top (first render and inactivity reset); after layout. */
  scrollToHour(hour) {
    requestAnimationFrame(() => { this.body.scrollTop = Math.max(0, hour) * HOUR_PX; });
  }

  /**
   * @param {string[]} days 'YYYY-MM-DD', 1 (day view) or 7 (week view)
   * @param {object[]} occurrences overlapping those days (any calendars; hidden ones filtered by the caller)
   * @param {string} today
   */
  render(days, occurrences, today) {
    this.formatters();
    this.days = days;
    this.today = today;
    const n = days.length;
    this.root.style.setProperty('--tg-days', String(n));
    this.root.classList.toggle('tg-single', n === 1);
    const fade = this.opts.fadePast();
    const now = Date.now();

    // ---- header: weekday + date number (today highlighted), optional week number in the corner ----
    this.head.innerHTML = '';
    const corner = el('div', 'tg-corner', this.opts.weekNumbers() ? `W${isoWeek(days[0])}` : '');
    this.head.append(corner);
    for (const day of days) {
      const cell = el('div', `tg-dayhead${day === today ? ' today' : ''}`);
      const noon = dayBounds(day, this.opts.tz)[0] + 12 * 3600000;
      cell.append(el('span', 'tg-dow', this.dowFmt.format(noon)), el('span', 'tg-dnum', String(Number(day.slice(8)))));
      this.head.append(cell);
    }

    // ---- all-day row: bars spanning columns, packed into lanes ----
    const { bars, lanes } = allDayLanes(occurrences, days, this.opts.tz);
    this.allDay.innerHTML = '';
    this.allDay.append(el('div', 'tg-axis-label', 'all-day'));
    const lanesEl = el('div', 'tg-lanes');
    lanesEl.style.height = `${Math.max(1, Math.min(lanes, MAX_ALLDAY_LANES)) * LANE_PX + 6}px`;
    const lanesInner = el('div', 'tg-lanes-inner');
    lanesInner.style.height = `${Math.max(1, lanes) * LANE_PX}px`;
    for (const bar of bars) {
      const cal = this.calendar(bar.occ);
      const b = this.eventEl(bar.occ, cal, 'tg-bar');
      b.style.left = `calc(${(bar.col / n) * 100}% + 2px)`;
      b.style.width = `calc(${(bar.span / n) * 100}% - 4px)`;
      b.style.top = `${bar.lane * LANE_PX + 2}px`;
      if (bar.fromPrev) b.classList.add('from-prev');
      if (bar.toNext) b.classList.add('to-next');
      if (fade && bar.occ.end <= now) b.classList.add('past');
      // A timed event of a day or more starts with its time ("5:00 PM Weekend getaway").
      const at = bar.occ.allDay || bar.fromPrev ? '' : `${this.timeFmt.format(bar.occ.start)} `;
      b.append(el('span', 'tg-title', at + this.title(bar.occ, cal)));
      lanesInner.append(b);
    }
    lanesEl.append(lanesInner);
    this.allDay.append(lanesEl);

    // ---- time grid: hour labels + one column per day with positioned events ----
    this.grid.innerHTML = '';
    const axis = el('div', 'tg-axis');
    for (let h = 1; h < 24; h++) {
      const label = el('div', 'tg-hour', this.hourFmt.format(Date.UTC(2026, 0, 1, h)));
      label.style.top = `${h * HOUR_PX}px`;
      axis.append(label);
    }
    this.grid.append(axis);

    const perDay = timedSegments(occurrences, days, this.opts.tz);
    days.forEach((day, i) => {
      const col = el('div', `tg-col${day === today ? ' today' : ''}`);
      for (const seg of layoutCascade(perDay[i])) {
        const cal = this.calendar(seg.occ);
        const e = this.eventEl(seg.occ, cal, 'tg-event');
        const top = (seg.startMin / 60) * HOUR_PX;
        const minutes = Math.max(seg.endMin - seg.startMin, MIN_VISUAL_MIN);
        const height = Math.min((minutes / 60) * HOUR_PX, 24 * HOUR_PX - top) - 2;
        e.style.top = `${top + 1}px`;
        e.style.height = `${height}px`;
        // Google-style: indented per level; siblings start k/n across and partly overlap (layoutCascade).
        const room = `(100% - ${seg.level * INDENT_PX}px)`;
        const share = seg.k === seg.n - 1 ? 1 - seg.k / seg.n : Math.min(1 - seg.k / seg.n, 1.7 / seg.n);
        e.style.left = `calc(${seg.level * INDENT_PX}px + ${room} * ${seg.k / seg.n} + 1px)`;
        e.style.width = `calc(${room} * ${share} - 3px)`;
        e.style.zIndex = String(seg.z);
        if (height < 40) e.classList.add('short');
        if (fade && seg.occ.end <= now && !(seg.occ.end === seg.occ.start && seg.occ.start > now)) e.classList.add('past');
        // The name sticks to the top of the view while a tall event scrolls (user 2026-10-19).
        const label = el('div', 'tg-label');
        label.append(el('div', 'tg-title', this.title(seg.occ, cal)), el('div', 'tg-time', this.timeText(seg)));
        e.append(label);
        col.append(e);
      }
      if (day === today) {
        const line = el('div', 'tg-now');
        line.style.top = `${(wallMinutes(now, this.opts.tz) / 60) * HOUR_PX}px`;
        col.append(line);
      }
      this.grid.append(col);
    });
  }

  calendar(occ) {
    return this.opts.calendarById(occ.calendar) || { color: '#888888', name: '', busy: false };
  }

  title(occ, cal) {
    return cal.busy ? 'Busy' : (occ.title || '(No title)');
  }

  timeText(seg) {
    const { occ } = seg;
    if (seg.fromPrev && seg.toNext) return 'All day';
    if (seg.fromPrev) return `Until ${this.timeFmt.format(occ.end)}`;
    if (seg.toNext) return `From ${this.timeFmt.format(occ.start)}`;
    if (occ.end <= occ.start) return this.timeFmt.format(occ.start);
    return this.timeFmt.formatRange(occ.start, occ.end);
  }

  eventEl(occ, cal, cls) {
    const e = el('button', cls);
    e.style.background = cardTint(cal.color, 0.25);
    e.style.borderLeftColor = cardEdge(cal.color);
    e.style.color = cardText(cal.color);
    if (occ.declined) e.classList.add('declined');
    if (this.opts.isHidden && this.opts.isHidden(occ)) e.classList.add('is-hidden'); // shown via the "Hidden" chip
    e.addEventListener('click', (ev) => {
      ev.stopPropagation();
      this.opts.onEventClick(occ, cal);
    });
    return e;
  }
}
