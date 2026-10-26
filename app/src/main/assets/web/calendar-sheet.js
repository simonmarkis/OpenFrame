// Event details sheet (SPEC §11): title, time, location, description, calendar name.
// Shared by the day panel and the full-screen calendar. Busy calendars hide the details.

import { addDays, dayBounds } from './lib/calendar-core.js';
import { isRepeat } from './lib/calendar-data.js';

const PLACE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a7 7 0 0 0-7 7c0 5.3 7 13 7 13s7-7.7 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z"/></svg>';

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

/** Plain text from an event DESCRIPTION, which Google often fills with HTML. */
export function plainText(s) {
  if (!/[<&]/.test(s)) return s;
  const html = s.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li)>/gi, '\n');
  const doc = new DOMParser().parseFromString(html, 'text/html'); // inert: no scripts run
  return (doc.body.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
}

export class EventSheet {
  /** @param {{ tz: string, hour12: () => boolean, data?: import('./lib/calendar-data.js').CalendarData }} opts
   *   data: offers Hide / Unhide for the event shown */
  constructor(opts) {
    this.opts = opts;
    this.backdrop = el('div', 'cal-sheet-backdrop');
    this.backdrop.hidden = true;
    this.backdrop.addEventListener('click', () => this.close());
    document.body.append(this.backdrop);
  }

  get isOpen() { return !this.backdrop.hidden; }

  fmt(options) {
    return new Intl.DateTimeFormat(undefined, { timeZone: this.opts.tz, ...options });
  }

  dayLabel(day, options) {
    const [start] = dayBounds(day, this.opts.tz);
    return this.fmt(options).format(new Date(start + 3600000)); // +1 h: safely inside the day
  }

  whenText(occ) {
    const dateOpts = { weekday: 'short', month: 'long', day: 'numeric' };
    if (occ.allDay) {
      const lastDay = addDays(occ.endDay, -1);
      return lastDay === occ.startDay
        ? `${this.dayLabel(occ.startDay, dateOpts)} · All day`
        : `${this.dayLabel(occ.startDay, dateOpts)} – ${this.dayLabel(lastDay, dateOpts)}`;
    }
    const f = this.fmt({ ...dateOpts, hour: 'numeric', minute: '2-digit', hour12: this.opts.hour12() });
    return occ.end > occ.start ? f.formatRange(occ.start, occ.end) : f.format(occ.start);
  }

  open(occ, cal) {
    const sheet = el('div', 'cal-sheet');
    sheet.style.setProperty('--accent', cal.color);
    sheet.addEventListener('click', (e) => e.stopPropagation());

    const title = el('div', 'cal-sheet-title');
    title.textContent = cal.busy ? 'Busy' : (occ.title || '(No title)');
    const when = el('div', 'cal-sheet-when');
    when.textContent = this.whenText(occ);
    sheet.append(title, when);

    if (!cal.busy && occ.location) {
      const loc = el('div', 'cal-sheet-location', PLACE_ICON);
      loc.append(document.createTextNode(occ.location));
      sheet.append(loc);
    }
    if (!cal.busy && occ.description) {
      const desc = el('div', 'cal-sheet-desc');
      desc.textContent = plainText(occ.description);
      sheet.append(desc);
    }
    const calLine = el('div', 'cal-sheet-calendar');
    calLine.append(el('span', 'cal-dot'));
    calLine.append(document.createTextNode(cal.name));
    sheet.append(calLine);

    // Hide / show again (SPEC §11, user 2026-10-19): a repeating event asks "this one" or "all repeats".
    const bar = el('div', 'cal-sheet-actions');
    const data = this.opts.data;
    if (data) {
      const act = (label, cls, fn) => {
        const b = el('button', `cal-sheet-btn ${cls}`);
        b.textContent = label;
        b.addEventListener('click', async () => {
          b.disabled = true;
          try { await fn(); this.close(); } catch (e) { b.disabled = false; b.textContent = `Not saved: ${e.message}`; }
        });
        bar.append(b);
      };
      if (data.isHidden(occ)) {
        act('Unhide', '', () => data.setEventHidden(occ, 'one', false));
      } else if (isRepeat(occ)) {
        act('Hide this one', 'quiet', () => data.setEventHidden(occ, 'one', true));
        act('Hide all repeats', 'quiet', () => data.setEventHidden(occ, 'all', true));
      } else {
        act('Hide', 'quiet', () => data.setEventHidden(occ, 'one', true));
      }
    }
    bar.append(el('span', 'cal-sheet-spacer'));
    const close = el('button', 'cal-sheet-close');
    close.textContent = 'Close';
    close.addEventListener('click', () => this.close());
    bar.append(close);
    sheet.append(bar);

    this.backdrop.innerHTML = '';
    this.backdrop.append(sheet);
    this.backdrop.hidden = false;
  }

  /**
   * A day's list (the month grid's "+N more", SPEC §11): every event of `day` with its time; tapping one
   * opens its details. `calendarById` gives each event's calendar.
   */
  openDay(day, occurrences, calendarById) {
    const sheet = el('div', 'cal-sheet');
    sheet.addEventListener('click', (e) => e.stopPropagation());
    const title = el('div', 'cal-sheet-title');
    title.textContent = this.dayLabel(day, { weekday: 'long', month: 'long', day: 'numeric' });
    sheet.append(title);
    const list = el('div', 'cal-sheet-list');
    const time = this.fmt({ hour: 'numeric', minute: '2-digit', hour12: this.opts.hour12() });
    for (const occ of occurrences) {
      const cal = calendarById(occ.calendar) || { color: '#888888', name: '', busy: false };
      const item = el('button', `cal-sheet-item${occ.declined ? ' declined' : ''}`);
      const dot = el('span', 'cal-dot');
      dot.style.background = cal.color;
      const when = el('span', 'cal-sheet-item-time');
      when.textContent = occ.allDay || occ.start < dayBounds(day, this.opts.tz)[0] ? 'All day' : time.format(occ.start);
      const name = el('span', 'cal-sheet-item-title');
      name.textContent = cal.busy ? 'Busy' : (occ.title || '(No title)');
      item.append(dot, when, name);
      item.addEventListener('click', () => this.open(occ, cal));
      list.append(item);
    }
    sheet.append(list);
    const close = el('button', 'cal-sheet-close');
    close.textContent = 'Close';
    close.addEventListener('click', () => this.close());
    sheet.append(close);
    this.backdrop.innerHTML = '';
    this.backdrop.append(sheet);
    this.backdrop.hidden = false;
  }

  close() {
    this.backdrop.hidden = true;
    this.backdrop.innerHTML = '';
  }

  destroy() {
    this.backdrop.remove();
  }
}
