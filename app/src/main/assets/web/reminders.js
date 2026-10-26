// Event reminders on the frame (SPEC §11, user 2026-10-16): a centre card over a dimmed screen with the
// events starting soon and a Dismiss button, a chime on the alarm volume (once, or again every 15/20/30 s),
// closed by Dismiss or after 2 minutes (counted down around Dismiss since 2026-10-26). Frame only. Quiet during sleep hours and with the screen off:
// reminders due then are skipped, never replayed. Fired reminders are remembered across reloads.

import { addDays } from './lib/calendar-core.js';
import { dueReminders, startsIn, pruneFired, meetingPlace } from './lib/reminder-core.js';
import { clockKnown } from './lib/clock-trust.js';
import { countdown } from './warnings.js';

const CHECK_MS = 15000;
const CLOSE_MS = 2 * 60000;
const STORE_KEY = 'of-reminders-fired';

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

export class Reminders {
  /**
   * @param {{ loadData: () => Promise<import('./lib/calendar-data.js').CalendarData>, hold: (on: boolean) => void,
   *           hour12: () => boolean, repeatSec: () => number }} opts
   */
  constructor(opts) {
    this.opts = opts;
    this.fired = new Set(this.loadFired());
    this.open = null; // { veil, list, items, fmt, dismiss, left, stopCountdown, chimeTimer }
  }

  start() {
    setTimeout(() => this.check(), 5000);
    this.timer = setInterval(() => this.check(), CHECK_MS);
  }

  loadFired() {
    try { return pruneFired(JSON.parse(localStorage.getItem(STORE_KEY) || '[]'), Date.now()); } catch (e) { return []; }
  }

  saveFired() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(pruneFired([...this.fired], Date.now()))); } catch (e) { /* no storage: fine */ }
  }

  async check() {
    if (!clockKnown()) return; // the frame's clock is wrong until network time (after a reboot)
    let data;
    try { data = await this.opts.loadData(); } catch (e) { return; }
    if (!data.loaded) return;
    const now = Date.now();
    if (this.open) this.refreshTimes(now);
    const today = data.today();
    const seen = new Set();
    const occurrences = [...data.eventsOn(today), ...data.eventsOn(addDays(today, 1))].filter((o) => {
      const k = `${o.calendar}|${o.uid}|${o.recurrenceId || ''}|${o.start}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    const due = dueReminders(occurrences, (id) => data.calendarById(id), now, this.fired);
    if (!due.length) return;
    for (const d of due) d.keys.forEach((k) => this.fired.add(k));
    this.saveFired();
    if (!(await this.awake())) {
      console.log(`reminders: ${due.length} skipped (sleep hours or screen off)`);
      return;
    }
    console.log(`reminders: showing ${due.length}`);
    this.show(due.map((d) => ({ occ: d.occ, cal: data.calendarById(d.occ.calendar) || {} })), data.tz);
  }

  async awake() {
    try {
      const res = await fetch('/api/power', { cache: 'no-store' });
      const p = await res.json();
      return p.screenOn !== false && !p.inSleepWindow;
    } catch (e) {
      return true; // can't tell: better a reminder than none
    }
  }

  /** Opens the card, or adds to the one already open (one card lists every reminder; user decision). */
  show(entries, tz) {
    if (!this.open) this.build(tz);
    for (const { occ, cal } of entries) this.addItem(occ, cal);
    this.refreshTimes(Date.now());
    this.chime();
    // Closing after 2 minutes counts from the latest reminder, shown as an outline running down around
    // Dismiss with the time left beside it (like the warning popups; user 2026-10-26).
    this.open.stopCountdown();
    this.open.stopCountdown = countdown(this.open.dismiss, this.open.left, CLOSE_MS, () => this.close());
  }

  build(tz) {
    const veil = el('div', 'rm-veil');
    const card = el('div', 'rm-card');
    card.setAttribute('role', 'alertdialog');
    card.setAttribute('aria-label', 'Event reminder');
    const list = el('div', 'rm-list');
    const dismiss = el('button', 'rm-dismiss wn-timed', 'Dismiss');
    dismiss.addEventListener('click', (e) => { e.stopPropagation(); this.close(); });
    const left = el('span', 'wn-countdown rm-left');
    const actions = el('div', 'rm-actions');
    actions.append(left, dismiss);
    card.append(list, actions);
    card.addEventListener('click', (e) => e.stopPropagation());
    veil.addEventListener('click', (e) => e.stopPropagation()); // only Dismiss closes it
    veil.append(card);
    document.body.append(veil);
    const fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: this.opts.hour12() });
    this.open = { veil, list, items: [], fmt, dismiss, left, stopCountdown: () => {}, chimeTimer: null };
    this.opts.hold(true);
    const every = this.opts.repeatSec();
    if (every > 0) this.open.chimeTimer = setInterval(() => this.chime(), every * 1000);
  }

  addItem(occ, cal) {
    const o = this.open;
    const item = el('div', 'rm-event');
    item.style.setProperty('--rm-color', cal.color || '#888888');
    const when = el('div', 'rm-when');
    const title = el('div', 'rm-title', cal.busy ? 'Busy' : (occ.title || '(No title)'));
    const when2 = occ.end > occ.start ? o.fmt.formatRange(occ.start, occ.end) : o.fmt.format(occ.start);
    const where = !cal.busy ? meetingPlace(occ.location) : '';
    const time = el('div', 'rm-time', where ? `${when2} · ${where}` : when2);
    item.append(when, title, time);
    o.list.append(item);
    o.items.push({ occ, cal, when });
  }

  refreshTimes(now) {
    for (const { occ, cal, when } of this.open.items) when.textContent = `${startsIn(occ, now)}${cal.name ? ` · ${cal.name}` : ''}`;
  }

  chime() {
    fetch('/api/sound/reminder', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      .catch(() => {});
  }

  close() {
    const o = this.open;
    if (!o) return;
    o.stopCountdown();
    clearInterval(o.chimeTimer);
    o.veil.remove();
    this.open = null;
    this.opts.hold(false);
  }
}
