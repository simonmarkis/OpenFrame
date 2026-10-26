// Day/week time grid layout (SPEC §11 calendar_full). Pure: positions come from arithmetic, never
// from measuring the DOM (FullCalendar's measuring cost ~half of its ~250 ms per week on the frame).
// Shared by calendar-timegrid.js and the Node tests (tests/calendar/timegrid.test.mjs).

import { addDays, dayBounds, dayKey, wallclockISO } from './calendar-core.js';

export const DAY_MIN = 1440;
const DAY_MS = 86400000;

/** A timed event of 24 hours or more: a bar in the all-day row, like Google (user 2026-10-19). */
export function isLongTimed(occ) {
  return !occ.allDay && occ.end - occ.start >= DAY_MS;
}

const longMemo = new WeakMap(); // dayKey is a time-zone formatting call: once per occurrence and zone

/** [startDay, endDay) of an all-day event, or of a long timed one in `tz` (end exclusive). */
function barDays(occ, tz) {
  if (occ.allDay) return [occ.startDay, occ.endDay];
  const m = longMemo.get(occ);
  if (m && m.tz === tz) return m.days;
  const days = [dayKey(occ.start, tz), addDays(dayKey(occ.end - 1, tz), 1)];
  longMemo.set(occ, { tz, days });
  return days;
}
/** Shortest drawn event, in minutes (zero-length and 5-minute events stay readable/tappable). */
export const MIN_VISUAL_MIN = 25;

/** Weekday of a 'YYYY-MM-DD' day, 0 = Sunday. */
export function weekday(day) {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** First day of the week containing `day`, for a week starting on `firstDay` (0 = Sunday). */
export function weekStart(day, firstDay) {
  return addDays(day, -((weekday(day) - firstDay + 7) % 7));
}

export function rangeDays(startDay, n) {
  return Array.from({ length: n }, (_, i) => addDays(startDay, i));
}

/** Minutes since local midnight (wall clock) of instant `ms` in `tz`. */
export function wallMinutes(ms, tz) {
  const iso = wallclockISO(ms, tz);
  return Number(iso.slice(11, 13)) * 60 + Number(iso.slice(14, 16));
}

/**
 * Timed occurrences cut into per-day segments for `days`.
 * Positions are wall-clock minutes (they line up with the hour labels, also on DST days).
 * @returns {Array<Array<{occ, startMin, endMin, fromPrev, toNext}>>} one list per day
 */
export function timedSegments(occurrences, days, tz) {
  const out = days.map(() => []);
  days.forEach((day, i) => {
    const [from, to] = dayBounds(day, tz);
    for (const occ of occurrences) {
      if (occ.allDay || isLongTimed(occ)) continue; // bars in the all-day row
      const zero = occ.end <= occ.start;
      if (zero ? !(occ.start >= from && occ.start < to) : !(occ.start < to && occ.end > from)) continue;
      const fromPrev = occ.start < from;
      const toNext = occ.end > to;
      const startMin = fromPrev ? 0 : wallMinutes(occ.start, tz);
      let endMin = toNext ? DAY_MIN : (zero ? startMin : wallMinutes(occ.end, tz));
      if (!toNext && !zero && endMin <= startMin) endMin = DAY_MIN; // ends exactly at midnight
      out[i].push({ occ, startMin, endMin, fromPrev, toNext });
    }
  });
  return out;
}

/**
 * Side-by-side columns for overlapping segments of one day (in place): sets `col` and `cols`.
 * Events overlap by their drawn extent (at least MIN_VISUAL_MIN), so short events don't collide.
 */
export function layoutColumns(segs) {
  const drawnEnd = (s) => Math.min(DAY_MIN, Math.max(s.endMin, s.startMin + MIN_VISUAL_MIN));
  const sorted = [...segs].sort((a, b) => a.startMin - b.startMin || drawnEnd(b) - drawnEnd(a));
  let cluster = [];
  let clusterEnd = -1;
  const colEnds = [];
  const flush = () => {
    const n = Math.max(1, colEnds.length);
    for (const s of cluster) s.cols = n;
    cluster = [];
    colEnds.length = 0;
  };
  for (const s of sorted) {
    if (s.startMin >= clusterEnd) flush();
    let col = colEnds.findIndex((end) => end <= s.startMin);
    if (col < 0) { col = colEnds.length; colEnds.push(0); }
    colEnds[col] = drawnEnd(s);
    s.col = col;
    cluster.push(s);
    clusterEnd = Math.max(clusterEnd, drawnEnd(s));
  }
  flush();
  return segs;
}

/**
 * Google-style overlaps for one day's segments (in place; user 2026-10-19): an event starting at least
 * NEST_MIN after one it overlaps is drawn over it, indented one `level` (the earlier one keeps its full
 * width, so its name stays readable); events starting within NEST_MIN of each other are siblings side by
 * side, partly overlapping: sibling `k` of `n` starts k/n across the room left at its level. Later events
 * are drawn on top (`z`). Sets level, k, n, z.
 */
export const NEST_MIN = 30;
export function layoutCascade(segs) {
  const drawnEnd = (s) => Math.min(DAY_MIN, Math.max(s.endMin, s.startMin + MIN_VISUAL_MIN));
  const sorted = [...segs].sort((a, b) => a.startMin - b.startMin || drawnEnd(b) - drawnEnd(a));
  const placed = [];
  const groups = [];
  sorted.forEach((s, i) => {
    const over = placed.filter((p) => p.startMin < drawnEnd(s) && drawnEnd(p) > s.startMin);
    // The latest overlapping event that started about together with this one: siblings.
    const sib = over.filter((p) => s.startMin - p.startMin < NEST_MIN).pop();
    if (sib) {
      s.level = sib.level;
      s.group = sib.group;
      s.group.push(s);
    } else {
      s.level = over.length ? Math.max(...over.map((p) => p.level)) + 1 : 0;
      s.group = [s];
      groups.push(s.group);
    }
    s.z = i + 1;
    placed.push(s);
  });
  for (const g of groups) {
    g.forEach((s, k) => { s.k = k; s.n = g.length; });
  }
  for (const s of segs) delete s.group;
  return segs;
}

/**
 * All-day occurrences, and timed ones of 24 hours or more, as bars over the visible days, packed into lanes.
 * @returns {{ bars: Array<{occ, col, span, lane, fromPrev, toNext}>, lanes: number }}
 */
export function allDayLanes(occurrences, days, tz) {
  const first = days[0];
  const end = addDays(days[days.length - 1], 1); // exclusive
  const bars = occurrences
    .filter((o) => o.allDay || (tz && isLongTimed(o)))
    .map((occ) => ({ occ, d: barDays(occ, tz) }))
    .filter(({ d }) => d[0] < end && d[1] > first)
    .map(({ occ, d }) => {
      const s = d[0] < first ? first : d[0];
      const e = d[1] > end ? end : d[1];
      const col = days.indexOf(s);
      return { occ, col, span: days.indexOf(addDays(e, -1)) - col + 1, fromPrev: d[0] < first, toNext: d[1] > end };
    })
    .sort((a, b) => a.col - b.col || b.span - a.span || (a.occ.allDay === b.occ.allDay ? 0 : a.occ.allDay ? -1 : 1)
      || (a.occ.title || '').localeCompare(b.occ.title || ''));
  const laneEnds = [];
  for (const bar of bars) {
    let lane = laneEnds.findIndex((endCol) => endCol <= bar.col);
    if (lane < 0) { lane = laneEnds.length; laneEnds.push(0); }
    laneEnds[lane] = bar.col + bar.span;
    bar.lane = lane;
  }
  return { bars, lanes: laneEnds.length };
}

/** ISO-8601 week number of a 'YYYY-MM-DD' day. */
export function isoWeek(day) {
  const [y, m, d] = day.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const yearStart = Date.UTC(t.getUTCFullYear(), 0, 1);
  return Math.ceil(((t - yearStart) / 86400000 + 1) / 7);
}
