// Calendar data core (SPEC §10): parse ICS feeds with ical.js and expand occurrences for a
// time window. Pure logic, no DOM, so the same file runs on the frame and in the Node test
// suite (tests/calendar). Times are epoch ms; days are 'YYYY-MM-DD' strings in a display zone.

import ICAL from './ical.js';

const MAX_OCCURRENCES_PER_EVENT = 20000;
const DAY_MS = 86400000;

// ---- Time zone helpers (Intl-based; Chromium 106 and Node both have full ICU) ----

const partFormatters = new Map();

function partsFormatter(tz) {
  let f = partFormatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    partFormatters.set(tz, f);
  }
  return f;
}

function wallParts(ms, tz) {
  const out = {};
  for (const p of partsFormatter(tz).formatToParts(new Date(ms))) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  return out;
}

// Intl is slow on the frame's CPU (~0.16 ms per formatToParts), so offsets are cached:
// per 6-hour bucket when the offset is the same at both ends, otherwise (a DST change inside)
// per 15-minute bucket — every real-world UTC offset change happens on a 15-minute boundary.
const COARSE_MS = 6 * 3600000;
const FINE_MS = 15 * 60000;
const offsetCaches = new Map();

function rawOffset(at, tz) {
  const p = wallParts(at, tz);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - at;
}

/** Offset (ms) of `tz` from UTC at instant `ms`. */
function tzOffset(ms, tz) {
  let cache = offsetCaches.get(tz);
  if (!cache) { cache = { coarse: new Map(), fine: new Map() }; offsetCaches.set(tz, cache); }
  const key = Math.floor(ms / COARSE_MS);
  let off = cache.coarse.get(key);
  if (off === undefined) {
    const a = rawOffset(key * COARSE_MS, tz);
    const b = rawOffset((key + 1) * COARSE_MS - FINE_MS, tz);
    off = a === b ? a : null;
    if (cache.coarse.size > 20000) cache.coarse.clear();
    cache.coarse.set(key, off);
  }
  if (off !== null) return off;
  const fineKey = Math.floor(ms / FINE_MS);
  off = cache.fine.get(fineKey);
  if (off === undefined) {
    off = rawOffset(fineKey * FINE_MS, tz);
    if (cache.fine.size > 20000) cache.fine.clear();
    cache.fine.set(fineKey, off);
  }
  return off;
}

const validZones = new Map();

export function isValidTimeZone(tz) {
  if (!tz) return false;
  if (!validZones.has(tz)) {
    let ok = true;
    try { partsFormatter(tz); } catch (e) { ok = false; }
    validZones.set(tz, ok);
  }
  return validZones.get(tz);
}

/** Epoch ms for a wall-clock time in `tz` (DST-aware; nonexistent times shift forward). */
export function wallclockToEpoch(y, mo, d, h, mi, s, tz) {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  const off1 = tzOffset(guess, tz);
  let t = guess - off1;
  const off2 = tzOffset(t, tz);
  if (off2 !== off1) t = guess - off2;
  return t;
}

/** 'YYYY-MM-DD' of instant `ms` in `tz`. */
export function dayKey(ms, tz) {
  return new Date(ms + tzOffset(ms, tz)).toISOString().slice(0, 10);
}

/** Wall-clock time of instant `ms` in `tz` as 'YYYY-MM-DDTHH:mm:ss' (no offset). */
export function wallclockISO(ms, tz) {
  return new Date(ms + tzOffset(ms, tz)).toISOString().slice(0, 19);
}

export function addDays(day, n) {
  const [y, m, d] = day.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

function dayStart(day, tz) {
  const [y, m, d] = day.split('-').map(Number);
  return wallclockToEpoch(y, m, d, 0, 0, 0, tz);
}

/** [start, end) epoch ms of a calendar day in `tz` (23 or 25 hours on DST days). */
export function dayBounds(day, tz) {
  return [dayStart(day, tz), dayStart(addDays(day, 1), tz)];
}

function icalDay(t) {
  return `${t.year}-${String(t.month).padStart(2, '0')}-${String(t.day).padStart(2, '0')}`;
}

/**
 * Epoch ms for an ICAL.Time.
 * - UTC or a zone defined by a VTIMEZONE in the feed: ical.js converts (DST-aware).
 * - TZID with no VTIMEZONE (ical.js marks it floating but keeps the name): use Intl with that IANA zone.
 * - Floating (no TZID): wall-clock time in the display zone.
 */
export function timeToEpoch(t, displayTz) {
  const zid = t.zone && t.zone.tzid;
  if (zid && zid !== 'floating') return t.toUnixTime() * 1000;
  const tz = isValidTimeZone(t.timezone) ? t.timezone : displayTz;
  return wallclockToEpoch(t.year, t.month, t.day, t.hour, t.minute, t.second, tz);
}

// ---- Parsing ----

/**
 * Parses ICS text into a feed: ical.js Event objects with RECURRENCE-ID overrides attached.
 * Throws on unparseable input (the caller reports it through the warning system).
 */
export function parseFeed(text) {
  const root = new ICAL.Component(ICAL.parse(text));
  const byUid = new Map();
  const loose = [];
  let n = 0;
  for (const comp of root.getAllSubcomponents('vevent')) {
    const uid = comp.getFirstPropertyValue('uid') || `__no-uid-${n++}`;
    let entry = byUid.get(uid);
    if (!entry) { entry = { master: null, exceptions: [] }; byUid.set(uid, entry); }
    if (comp.hasProperty('recurrence-id')) entry.exceptions.push(comp);
    else if (!entry.master) entry.master = comp;
    else loose.push(comp); // duplicate UID without RECURRENCE-ID: show it as its own event
  }

  const events = [];
  for (const { master, exceptions } of byUid.values()) {
    if (master) {
      const ev = new ICAL.Event(master);
      for (const ex of exceptions) ev.relateException(ex);
      events.push(ev);
    } else {
      // Overrides whose series isn't in this feed (e.g. a single invited instance): standalone events.
      for (const ex of exceptions) events.push(new ICAL.Event(ex));
    }
  }
  for (const comp of loose) events.push(new ICAL.Event(comp));
  return { events, name: root.getFirstPropertyValue('x-wr-calname') || null };
}

// ---- Expansion ----

function isCancelled(component) {
  return String(component.getFirstPropertyValue('status') || '').toUpperCase() === 'CANCELLED';
}

/** The guest `email` (lowercase) answered No: ATTENDEE;PARTSTAT=DECLINED:mailto:<email> in this instance. */
export function declinedBy(component, email) {
  if (!email) return false;
  for (const p of component.getAllProperties('attendee')) {
    const addr = String(p.getFirstValue() || '').replace(/^mailto:/i, '').trim().toLowerCase();
    if (addr === email) return String(p.getParameter('partstat') || '').toUpperCase() === 'DECLINED';
  }
  return false;
}

function makeOccurrence(item, start, end, recurrenceId, displayTz, selfEmail) {
  const allDay = start.isDate;
  const occ = {
    uid: item.uid,
    recurrenceId: recurrenceId ? recurrenceId.toString() : null,
    title: item.summary || '',
    location: item.location || '',
    description: item.description || '',
    allDay,
    declined: declinedBy(item.component, selfEmail),
  };
  if (allDay) {
    occ.startDay = icalDay(start);
    occ.endDay = end && end.compare(start) > 0 ? icalDay(end) : addDays(occ.startDay, 1); // exclusive
    occ.start = dayStart(occ.startDay, displayTz);
    occ.end = dayStart(occ.endDay, displayTz);
  } else {
    occ.start = timeToEpoch(start, displayTz);
    occ.end = end ? Math.max(timeToEpoch(end, displayTz), occ.start) : occ.start;
  }
  return occ;
}

/**
 * Iterator for a recurring event, fast-forwarded close to `fromMs` when that is safe.
 *
 * ical.js always iterates from DTSTART, so a weekly series begun years ago costs hundreds of
 * steps (1–5 ms each on the frame) before reaching today. For a single RRULE without COUNT
 * or RDATE, starting the iteration a whole number of intervals later yields the same
 * occurrences (EXDATE, UNTIL and RECURRENCE-ID overrides still apply). The new start lands
 * before the window by a margin covering the event's duration, so even a DTSTART that does
 * not itself match the rule (RFC 5545 still counts it) can only add an instance before the window.
 */
function iteratorFrom(ev, fromMs, displayTz) {
  const comp = ev.component;
  const rules = comp.getAllProperties('rrule');
  if (rules.length !== 1 || comp.hasProperty('rdate')) return ev.iterator();
  const rule = rules[0].getFirstValue();
  if (rule.count) return ev.iterator();

  const start = ev.startDate;
  const startMs = timeToEpoch(start, displayTz);
  const durMs = ev.endDate ? Math.max(0, timeToEpoch(ev.endDate, displayTz) - startMs) : 0;
  const target = fromMs - 8 * DAY_MS - durMs;
  if (startMs >= target) return ev.iterator();

  const interval = rule.interval || 1;
  const shifted = start.clone();
  const span = target - startMs;
  switch (rule.freq) {
    case 'DAILY':
      shifted.adjust(Math.floor(span / DAY_MS / interval) * interval, 0, 0, 0);
      break;
    case 'WEEKLY':
      shifted.adjust(Math.floor(span / (7 * DAY_MS) / interval) * interval * 7, 0, 0, 0);
      break;
    case 'MONTHLY': {
      if (start.day > 28) return ev.iterator(); // day 29–31 doesn't exist in every month
      const months = Math.floor(span / (31 * DAY_MS) / interval) * interval;
      shifted.month += months;
      shifted.adjust(0, 0, 0, 0);
      break;
    }
    case 'YEARLY': {
      if (start.month === 2 && start.day === 29) return ev.iterator();
      shifted.year += Math.floor(span / (366 * DAY_MS) / interval) * interval;
      break;
    }
    default:
      return ev.iterator(); // HOURLY/MINUTELY/SECONDLY: rare in calendars; iterate normally
  }
  return ev.iterator(shifted);
}

function overlaps(occ, from, to) {
  if (occ.end === occ.start) return occ.start >= from && occ.start < to;
  return occ.start < to && occ.end > from;
}

/**
 * All occurrences of `feed` overlapping [fromMs, toMs), with EXDATE/RDATE, RECURRENCE-ID
 * overrides, and cancellations applied. With `selfEmail` (the user's guest address, lowercase), an
 * occurrence that guest declined has `declined: true`.
 */
export function expandFeed(feed, fromMs, toMs, displayTz, { fastForward = true, selfEmail = '' } = {}) {
  const out = [];
  // Overrides can move an instance by days; look a little past the window for their originals.
  const iterateUntil = toMs + 31 * DAY_MS;
  // All-day events far outside the window are skipped by date string, without zone math.
  const firstDay = addDays(dayKey(fromMs, 'UTC'), -2);
  const lastDay = addDays(dayKey(toMs, 'UTC'), 2);
  for (const ev of feed.events) {
    if (isCancelled(ev.component)) continue;
    if (!ev.isRecurring()) {
      const s = ev.startDate;
      if (s.isDate) {
        const e = ev.endDate;
        if (icalDay(s) > lastDay || (e && e.compare(s) > 0 ? icalDay(e) : icalDay(s)) < firstDay) continue;
      }
      const occ = makeOccurrence(ev, ev.startDate, ev.endDate, ev.recurrenceId, displayTz, selfEmail);
      if (overlaps(occ, fromMs, toMs)) out.push(occ);
      continue;
    }
    const it = fastForward ? iteratorFrom(ev, fromMs, displayTz) : ev.iterator();
    let next;
    let count = 0;
    while ((next = it.next()) && count++ < MAX_OCCURRENCES_PER_EVENT) {
      if (timeToEpoch(next, displayTz) >= iterateUntil) break;
      const d = ev.getOccurrenceDetails(next);
      if (isCancelled(d.item.component)) continue;
      const occ = makeOccurrence(d.item, d.startDate, d.endDate, d.recurrenceId, displayTz, selfEmail);
      if (overlaps(occ, fromMs, toMs)) out.push(occ);
    }
  }
  return out;
}

// ---- Day views ----

/** Sort: all-day first (by title), then by start, then by end, then title. */
export function compareOccurrences(a, b) {
  if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
  if (a.allDay) return a.startDay.localeCompare(b.startDay) || a.title.localeCompare(b.title);
  return a.start - b.start || a.end - b.end || a.title.localeCompare(b.title);
}

/** Occurrences shown on `day` (in `tz`), sorted for display. */
export function occurrencesOnDay(occurrences, day, tz) {
  const [from, to] = dayBounds(day, tz);
  return occurrences
    .filter((o) => (o.allDay ? o.startDay <= day && day < o.endDay : overlaps(o, from, to)))
    .sort(compareOccurrences);
}

/** An event without an end time counts as happening now for this long after it starts. */
export const NOW_NO_END_MS = 15 * 60000;

/**
 * The day panel's badge for an event happening at `nowMs` (SPEC §11, user 2026-10-16), or null:
 * "Now", or with `showLeft` "Now · 12 min left" / "Now · 1 h 5 min left" / "Now · ending" (under a
 * minute). All-day events never count; one without an end time counts for NOW_NO_END_MS and shows "Now".
 */
export function nowBadge(occ, nowMs, showLeft) {
  if (occ.allDay || occ.start > nowMs) return null;
  const noEnd = occ.end <= occ.start;
  if (noEnd ? nowMs >= occ.start + NOW_NO_END_MS : nowMs >= occ.end) return null;
  if (!showLeft || noEnd) return 'Now';
  const left = occ.end - nowMs;
  if (left < 60000) return 'Now · ending';
  const min = Math.ceil(left / 60000);
  if (min < 60) return `Now · ${min} min left`;
  const h = Math.floor(min / 60), m = min % 60;
  return `Now · ${h} h${m ? ` ${m} min` : ''} left`;
}

/**
 * How an occurrence's time reads on a given day:
 *   allDay | range (start–end same day) | starts (continues past midnight)
 *   | until (began earlier, ends today) | through (spans the whole day)
 */
export function timeKind(occ, day, tz) {
  if (occ.allDay) return 'allDay';
  const [from, to] = dayBounds(day, tz);
  const startsToday = occ.start >= from;
  const endsToday = occ.end <= to;
  if (startsToday && endsToday) return 'range';
  if (startsToday) return 'starts';
  if (endsToday) return 'until';
  return 'through';
}

/** First occurrence starting on or after `day` + 1, searching up to `horizonDays` ahead. */
export function nextEventDay(feeds, day, tz, horizonDays = 366) {
  const from = dayBounds(addDays(day, 1), tz)[0];
  const to = from + horizonDays * DAY_MS;
  let best = null;
  for (const feed of feeds) {
    for (const occ of expandFeed(feed, from, to, tz)) {
      if (occ.start >= from && (best === null || occ.start < best)) best = occ.start;
    }
  }
  return best === null ? null : dayKey(best, tz);
}
