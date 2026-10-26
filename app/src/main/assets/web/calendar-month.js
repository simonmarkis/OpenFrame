// Month grid for the full-screen calendar (SPEC §11; OpenFrame's own since 2026-10-19, replacing
// FullCalendar's ~1.3 s month changes). Layout math in lib/month-core.js. Each day shows its all-day and
// multi-day events as bars across the days and its timed events as lines (dot, start time, title), as many
// as fit; the rest as "+N more", which lists the day. Tapping a day opens it in Day view.

import { dayBounds } from './lib/calendar-core.js';
import { cardTint, cardText, cardEdge } from './lib/colors.js';
import { isoWeek } from './lib/timegrid-core.js';
import { weekLayout, fitWeek, dayItems } from './lib/month-core.js';

const DATE_PX = 34; // the date number's row at the top of each day
const LINE_PX = 24; // one event line or bar (times the calendar text scale)
const WEEK_COL_PX = 40;

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export class MonthGrid {
  /**
   * @param {HTMLElement} root
   * @param {{ tz: string, hour12: () => boolean, fadePast: () => boolean, weekNumbers: () => boolean,
   *           calendarById: (id) => object, onEventClick: (occ, cal) => void, onDayClick: (day) => void,
   *           onMore: (day, occurrences) => void }} opts
   */
  constructor(root, opts) {
    this.root = root;
    this.opts = opts;
    this.fmtKey = '';
    root.classList.add('mg');
  }

  destroy() {
    this.root.innerHTML = '';
    this.root.classList.remove('mg');
  }

  formatters() {
    const h12 = this.opts.hour12();
    if (this.fmtKey !== String(h12)) {
      this.fmtKey = String(h12);
      const tz = this.opts.tz;
      this.timeFmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: h12 });
      this.dowFmt = new Intl.DateTimeFormat(undefined, { timeZone: tz, weekday: 'short' });
    }
    return this;
  }

  /** "9a", "11:30a", "6p" (12 h) or "9:00", "18:30" (24 h): short, like Google's month view. */
  shortTime(ms) {
    const t = this.timeFmt.format(ms);
    if (!this.opts.hour12()) return t;
    return t.replace(':00', '').replace(/\s?([AP])M$/i, (m, ap) => ap.toLowerCase());
  }

  calendar(occ) {
    return this.opts.calendarById(occ.calendar) || { color: '#888888', name: '', busy: false };
  }

  title(occ, cal) {
    return cal.busy ? 'Busy' : (occ.title || '(No title)');
  }

  /**
   * @param {string[][]} weeks from monthWeeks
   * @param {string} month 'YYYY-MM' (days of other months are dimmed)
   * @param {object[]} occurrences overlapping those weeks (hidden calendars filtered by the caller)
   * @param {string} today
   */
  render(weeks, month, occurrences, today) {
    this.formatters();
    const tz = this.opts.tz;
    const fade = this.opts.fadePast();
    const now = Date.now();
    const wk = this.opts.weekNumbers();
    const scale = parseFloat(getComputedStyle(this.root).getPropertyValue('--of-cal-scale')) || 1;
    const linePx = Math.round(LINE_PX * scale);
    this.root.style.setProperty('--mg-wk', wk ? `${WEEK_COL_PX}px` : '0px');
    this.root.style.setProperty('--mg-line', `${linePx}px`);
    this.root.style.setProperty('--mg-date', `${DATE_PX}px`);
    this.root.innerHTML = '';

    // ---- weekday names ----
    // The week-number column is always there (0 px wide when off), so the days keep their columns.
    const head = el('div', 'mg-head');
    head.append(el('div', 'mg-wk'));
    for (const day of weeks[0]) head.append(el('div', 'mg-dow', this.dowFmt.format(dayBounds(day, tz)[0] + 43200000)));
    const body = el('div', 'mg-body');
    this.root.append(head, body);

    // ---- week rows with their days (the overlays come once the rows have their height) ----
    const rowsEls = weeks.map((week) => {
      const row = el('div', 'mg-week');
      row.append(el('div', 'mg-wk', wk ? String(isoWeek(week[0])) : ''));
      for (const day of week) {
        const cell = el('div', `mg-day${day === today ? ' today' : ''}${day.slice(0, 7) !== month ? ' other' : ''}${day < today ? ' before' : ''}`);
        cell.append(el('span', 'mg-num', String(Number(day.slice(8)))));
        cell.addEventListener('click', () => this.opts.onDayClick(day));
        row.append(cell);
      }
      body.append(row);
      return row;
    });
    const rowH = rowsEls[0].getBoundingClientRect().height;
    const fit = Math.max(1, Math.floor((rowH - DATE_PX - 4) / linePx));

    // ---- bars, lines, and "+N more" per week ----
    const colLeft = (col) => `calc(var(--mg-wk) + (100% - var(--mg-wk)) * ${col / 7})`;
    const colWidth = (span) => `calc((100% - var(--mg-wk)) * ${span / 7})`;
    weeks.forEach((week, wi) => {
      const row = rowsEls[wi];
      const layout = weekLayout(week, occurrences, tz, [dayBounds(week[0], tz)[0], dayBounds(week[6], tz)[1]]);
      const { bars, cells } = fitWeek(layout, fit);
      for (const bar of bars) {
        if (!bar.visible) continue;
        const cal = this.calendar(bar.occ);
        const b = this.eventEl(bar.occ, cal, 'mg-bar');
        b.style.background = cardTint(cal.color, 0.25);
        b.style.borderLeftColor = cardEdge(cal.color);
        b.style.color = cardText(cal.color);
        b.style.left = `calc(${colLeft(bar.col)} + 3px)`;
        b.style.width = `calc(${colWidth(bar.span)} - 6px)`;
        b.style.top = `${DATE_PX + bar.lane * linePx}px`;
        if (bar.fromPrev) b.classList.add('from-prev');
        if (bar.toNext) b.classList.add('to-next');
        if (fade && bar.occ.end <= now) b.classList.add('past');
        const t = bar.occ.allDay || bar.fromPrev ? '' : `${this.shortTime(bar.occ.start)} `;
        b.append(el('span', 'mg-title', t + this.title(bar.occ, cal)));
        row.append(b);
      }
      cells.forEach((cell, col) => {
        for (const { occ, row: r } of cell.lines) {
          const cal = this.calendar(occ);
          const line = this.eventEl(occ, cal, 'mg-line');
          line.style.left = `calc(${colLeft(col)} + 3px)`;
          line.style.width = `calc(${colWidth(1)} - 6px)`;
          line.style.top = `${DATE_PX + r * linePx}px`;
          if (fade && occ.end <= now && !(occ.end === occ.start && occ.start > now)) line.classList.add('past');
          const dot = el('span', 'mg-dot');
          dot.style.background = cardEdge(cal.color);
          line.append(dot, el('span', 'mg-time', this.shortTime(occ.start)), el('span', 'mg-title', this.title(occ, cal)));
          row.append(line);
        }
        if (cell.more) {
          const more = el('button', 'mg-more', `+${cell.more.count} more`);
          more.style.left = `calc(${colLeft(col)} + 3px)`;
          more.style.width = `calc(${colWidth(1)} - 6px)`;
          more.style.top = `${DATE_PX + cell.more.row * linePx}px`;
          more.addEventListener('click', (ev) => {
            ev.stopPropagation();
            this.opts.onMore(week[col], dayItems(layout, col));
          });
          row.append(more);
        }
      });
    });
  }

  eventEl(occ, cal, cls) {
    const e = el('button', cls);
    if (occ.declined) e.classList.add('declined');
    if (this.opts.isHidden && this.opts.isHidden(occ)) e.classList.add('is-hidden'); // shown via the "Hidden" chip
    e.addEventListener('click', (ev) => {
      ev.stopPropagation();
      this.opts.onEventClick(occ, cal);
    });
    return e;
  }
}
