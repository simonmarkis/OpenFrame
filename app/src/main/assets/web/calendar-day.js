// `calendar_day` panel (SPEC §11), modeled on Frameo's Hybrid View day column.
// Renders into a container; placement is the layout renderer's job (app.js).

import { addDays, dayBounds, timeKind, nowBadge } from './lib/calendar-core.js';
import { cardTint, cardText, isDarkPanel, nowAccent } from './lib/colors.js';
import { EventSheet } from './calendar-sheet.js';
import { clockKnown, onClockKnown, UNKNOWN } from './lib/clock-trust.js';

const INACTIVITY_RETURN_MS = 120000; // SPEC §14 default (config layout.inactivityReturnSec)
const SWIPE_MIN_PX = 50;

const ICONS = {
  prev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15.4 7.4 14 6l-6 6 6 6 1.4-1.4L10.8 12z"/></svg>',
  next: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.6 16.6 10 18l6-6-6-6-1.4 1.4 4.6 4.6z"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 4h-1V2h-2v2H8V2H6v2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm0 16H5V9h14v11zM10.6 18.4l-3.5-3.5 1.4-1.4 2.1 2.1 4.9-4.9 1.4 1.4z"/></svg>',
  full: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 19H5V5h7V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7h-2v7zM14 3v2h3.6l-9.8 9.8 1.4 1.4L19 6.4V10h2V3h-7z"/></svg>',
};

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

export class CalendarDayPanel {
  /**
   * @param {HTMLElement} root container
   * @param {import('./lib/calendar-data.js').CalendarData} data
   * @param {{ days: () => number, hour12?: boolean, inactivityReturnMs?: number,
   *           nowTimeLeft?: boolean, onOpenFull?: () => void }} opts  read on every render, so getters work;
   *   no onOpenFull = no full-screen button
   */
  constructor(root, data, opts) {
    this.root = root;
    this.data = data;
    this.opts = opts;
    this.tz = data.tz;
    this.day = data.today();
    this.returnTimer = null;
    this.lastToday = this.day;
    this.build();
    this.unsubscribe = data.onChange(() => this.render());
    this.tickTimer = setInterval(() => this.tick(), 30000);
    // Network time arrived after a reboot: jump from the stale date to today at once.
    this.unClock = onClockKnown(() => this.tick());
    this.render();
  }

  /** Layout or settings changed (days per panel, 12/24 h): re-render. */
  update() {
    this.render();
  }

  destroy() {
    this.unsubscribe();
    this.unClock();
    clearInterval(this.tickTimer);
    clearTimeout(this.returnTimer);
    this.sheet.destroy();
    this.root.innerHTML = '';
    this.root.classList.remove('cal-panel');
  }

  // ---- formatting ----

  fmt(options) {
    return new Intl.DateTimeFormat(undefined, { timeZone: this.tz, ...options });
  }

  dayLabel(day, options) {
    const [start] = dayBounds(day, this.tz);
    return this.fmt(options).format(new Date(start + 3600000)); // +1 h: safely inside the day
  }

  timeLabel(occ, day) {
    const t = this.fmt({ hour: 'numeric', minute: '2-digit', hour12: this.opts.hour12 !== false });
    switch (timeKind(occ, day, this.tz)) {
      case 'allDay':
      case 'through': return 'All day';
      case 'starts': return `Starts ${t.format(occ.start)}`;
      case 'until': return `Until ${t.format(occ.end)}`;
      default: return occ.end > occ.start ? t.formatRange(occ.start, occ.end) : t.format(occ.start);
    }
  }

  // ---- DOM ----

  build() {
    this.root.classList.add('cal-panel');
    this.root.innerHTML = '';
    const header = el('div', 'cal-header');
    this.prevBtn = el('button', 'cal-nav', ICONS.prev);
    this.prevBtn.setAttribute('aria-label', 'Previous day');
    this.nextBtn = el('button', 'cal-nav', ICONS.next);
    this.nextBtn.setAttribute('aria-label', 'Next day');
    const heading = el('div', 'cal-heading');
    this.dateEl = el('div', 'cal-date');
    this.countEl = el('div', 'cal-count');
    heading.append(this.dateEl, this.countEl);
    header.append(this.prevBtn, heading, this.nextBtn);

    this.body = el('div', 'cal-body');
    this.root.append(header, this.body);
    if (this.opts.onOpenFull) {
      this.fullBtn = el('button', 'cal-full', ICONS.full);
      this.fullBtn.setAttribute('aria-label', 'Open full calendar');
      this.fullBtn.addEventListener('click', () => this.opts.onOpenFull());
      this.root.append(this.fullBtn);
    } else {
      this.body.classList.add('no-full');
    }

    this.prevBtn.addEventListener('click', () => this.move(-1));
    this.nextBtn.addEventListener('click', () => this.move(1));

    let start = null;
    this.body.addEventListener('pointerdown', (e) => { start = { x: e.clientX, y: e.clientY }; });
    this.body.addEventListener('pointercancel', () => { start = null; });
    this.body.addEventListener('pointerup', (e) => {
      if (!start) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      start = null;
      if (Math.abs(dx) >= SWIPE_MIN_PX && Math.abs(dx) > Math.abs(dy) * 1.5) {
        this.suppressClick = true;
        setTimeout(() => { this.suppressClick = false; }, 0);
        this.move(dx < 0 ? 1 : -1);
      }
    });

    this.sheet = new EventSheet({ tz: this.tz, hour12: () => this.opts.hour12 !== false, data: this.data });
  }

  move(delta) {
    this.day = addDays(this.day, delta);
    this.armReturn();
    this.render();
  }

  armReturn() {
    clearTimeout(this.returnTimer);
    this.returnTimer = setTimeout(() => {
      this.sheet.close();
      this.day = this.data.today();
      this.render();
    }, this.opts.inactivityReturnMs || INACTIVITY_RETURN_MS);
  }

  tick() {
    const today = this.data.today();
    if (today !== this.lastToday) {
      // Midnight: follow "today" if we were showing it.
      if (this.day === this.lastToday) this.day = today;
      this.lastToday = today;
    }
    this.render(); // also refreshes "past" dimming
  }

  render() {
    if (!clockKnown()) {
      // Before network time (after a reboot) the date is wrong: no information beats wrong information.
      this.dateEl.textContent = UNKNOWN;
      this.countEl.textContent = '';
      this.body.innerHTML = '';
      this.body.append(el('div', 'cal-none', UNKNOWN));
      return;
    }
    if (!this.data.loaded) return;
    const n = Math.max(1, this.opts.days());
    const days = Array.from({ length: n }, (_, i) => addDays(this.day, i));
    const today = this.data.today();

    this.dateEl.textContent = n === 1
      ? this.dayLabel(days[0], { weekday: 'short', month: 'long', day: 'numeric' })
      : this.fmt({ weekday: 'short', month: 'short', day: 'numeric' })
        .formatRange(dayBounds(days[0], this.tz)[0] + 3600000, dayBounds(days[n - 1], this.tz)[0] + 3600000);

    const perDay = days.map((d) => this.data.eventsOn(d));
    const unique = new Set(perDay.flat().map((o) => `${o.calendar}|${o.uid}|${o.recurrenceId}`));
    this.countEl.textContent = `${unique.size} ${unique.size === 1 ? 'event' : 'events'}`;

    this.body.innerHTML = '';
    this.body.classList.toggle('multi', n > 1);

    if (this.data.calendars.length === 0) {
      this.body.append(this.emptyState('No calendars yet', 'Add calendars in Settings'));
      return;
    }
    if (unique.size === 0) {
      const last = days[n - 1];
      if (last < today) {
        this.body.append(this.emptyState('No events', ''));
      } else {
        const next = this.data.nextEventDay(last);
        this.body.append(this.emptyState('No upcoming events',
          next ? `Next event is on ${this.dayLabel(next, { weekday: 'short', month: 'long', day: 'numeric' })}` : 'Nothing in the next year'));
      }
      return;
    }

    days.forEach((day, i) => {
      const col = el('div', 'cal-col');
      if (n > 1) {
        const head = el('div', 'cal-col-head');
        // "Tue 13" (Intl's en-US order would be "13 Tue").
        head.textContent = `${this.dayLabel(day, { weekday: 'short' })} ${Number(day.slice(8))}`;
        col.append(head);
      }
      const list = el('div', 'cal-list');
      if (perDay[i].length === 0) list.append(el('div', 'cal-none', 'No events'));
      for (const occ of perDay[i]) list.append(this.card(occ, day, day === today));
      col.append(list);
      this.body.append(col);
    });
  }

  card(occ, day, isToday) {
    const cal = this.data.calendarById(occ.calendar) || { color: '#888888', name: '', busy: false };
    const card = el('button', 'cal-event');
    // The panel can be dark in a light theme or the other way round (theme.panel).
    const dark = isDarkPanel();
    card.style.background = cardTint(cal.color, 0.2, dark);
    card.style.color = cardText(cal.color, dark);
    card.style.setProperty('--accent', cal.color);
    if (occ.declined) card.classList.add('declined');
    // Today's events that have already ended are dimmed (SPEC §11).
    if (isToday && !occ.allDay && occ.end < Date.now()) card.classList.add('past');
    const title = el('div', 'cal-event-title');
    title.textContent = cal.busy ? 'Busy' : (occ.title || '(No title)');
    const time = el('div', 'cal-event-time');
    time.textContent = this.timeLabel(occ, day);
    // The event happening now: a "Now" badge in its own column (never over the text, always red) and an
    // outline in the calendar's color, on both panels (user 2026-10-19: the blinking badge is the red; SPEC §11).
    const badge = isToday ? nowBadge(occ, Date.now(), this.opts.nowTimeLeft) : null;
    if (badge) {
      card.classList.add('now');
      card.style.setProperty('--now', nowAccent(cal.color));
      const main = el('div', 'cal-event-main');
      main.append(title, time);
      const b = el('span', 'cal-now-badge');
      b.textContent = badge;
      card.append(main, b);
    } else {
      card.append(title, time);
    }
    card.addEventListener('click', (e) => {
      if (this.suppressClick) return;
      e.stopPropagation();
      this.armReturn();
      this.sheet.open(occ, cal);
    });
    return card;
  }

  emptyState(title, line) {
    const box = el('div', 'cal-empty');
    box.append(el('div', 'cal-empty-icon', ICONS.check));
    const t = el('div', 'cal-empty-title');
    t.textContent = title;
    box.append(t);
    if (line) {
      const l = el('div', 'cal-empty-line');
      l.textContent = line;
      box.append(l);
    }
    return box;
  }

}
