// Month grid arithmetic (SPEC §11, built 2026-10-19 to replace FullCalendar's Month): which weeks a month
// shows, all-day and multi-day events as bars packed in lanes per week, and what fits in each day cell
// ("+N more"). Pure; shared by calendar-month.js and the Node tests (tests/calendar/).

import { addDays, dayKey } from './calendar-core.js';
import { weekStart, rangeDays } from './timegrid-core.js';

/** 'YYYY-MM-01' of the month `delta` months after the one holding `day`. */
export function monthStart(day, delta = 0) {
  const [y, m] = day.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + delta, 1));
  return t.toISOString().slice(0, 10);
}

/** The weeks shown for the month holding `day`: as many rows as it needs (4–6), each 7 'YYYY-MM-DD'. */
export function monthWeeks(day, firstDay) {
  const first = monthStart(day);
  const next = monthStart(day, 1);
  const weeks = [];
  for (let start = weekStart(first, firstDay); start < next; start = addDays(start, 7)) weeks.push(rangeDays(start, 7));
  return weeks;
}

// dayKey is a time-zone formatting call (~0.16 ms on the frame): remembered per occurrence and zone.
const daysMemo = new WeakMap();

/** The days an occurrence covers: [first, end) as 'YYYY-MM-DD' in `tz` (end exclusive). */
export function occDays(occ, tz) {
  if (occ.allDay) return [occ.startDay, occ.endDay];
  const memo = daysMemo.get(occ);
  if (memo && memo.tz === tz) return memo.days;
  const s = dayKey(occ.start, tz);
  const e = occ.end > occ.start ? dayKey(occ.end - 1, tz) : s;
  const days = [s, addDays(e, 1)];
  daysMemo.set(occ, { tz, days });
  return days;
}

/** A bar (all-day, or a timed event over more than one day) rather than a line in one day. */
export function isBar(occ, tz) {
  if (occ.allDay) return true;
  const [s, e] = occDays(occ, tz);
  return addDays(s, 1) < e;
}

/**
 * One week row: `bars` ({ occ, col, span, lane, fromPrev, toNext }) packed into `lanes` (longest first, like
 * Google), and `lines[col]`: that day's single-day timed events in start order.
 */
export function weekLayout(week, occurrences, tz, bounds = null) {
  const first = week[0];
  const end = addDays(week[6], 1);
  const bars = [];
  const lines = week.map(() => []);
  for (const occ of occurrences) {
    // A cheap check first when the week's instants are known (±1 day: zones are settled by occDays).
    if (bounds && !occ.allDay && (occ.start >= bounds[1] + 86400000 || Math.max(occ.end, occ.start + 1) <= bounds[0] - 86400000)) continue;
    const [s, e] = occDays(occ, tz);
    if (!(s < end && e > first)) continue;
    if (isBar(occ, tz)) {
      const from = s < first ? first : s;
      const to = e > end ? end : e;
      const col = week.indexOf(from);
      bars.push({ occ, col, span: week.indexOf(addDays(to, -1)) - col + 1, fromPrev: s < first, toNext: e > end });
    } else {
      const col = week.indexOf(s);
      if (col >= 0) lines[col].push(occ);
    }
  }
  bars.sort((a, b) => a.col - b.col || b.span - a.span || (a.occ.allDay === b.occ.allDay ? 0 : a.occ.allDay ? -1 : 1)
    || a.occ.start - b.occ.start || (a.occ.title || '').localeCompare(b.occ.title || ''));
  const laneEnds = [];
  for (const bar of bars) {
    let lane = laneEnds.findIndex((endCol) => endCol <= bar.col);
    if (lane < 0) { lane = laneEnds.length; laneEnds.push(0); }
    laneEnds[lane] = bar.col + bar.span;
    bar.lane = lane;
  }
  for (const l of lines) l.sort((a, b) => a.start - b.start || a.end - b.end || (a.title || '').localeCompare(b.title || ''));
  return { bars, lanes: laneEnds.length, lines };
}

/**
 * What a week's cells show with room for `rows` lines each: every bar gets `visible`; per day `cells[col]` =
 * { lines: [{ occ, row }], more: { count, row } | null }. A day with more than fits keeps its last row for
 * "+N more"; a bar is shown only if its lane fits in every day it crosses. Rows are taken by bars first
 * (their lane), timed lines fill the free rows in order.
 */
export function fitWeek(layout, rows) {
  const { bars, lines } = layout;
  const cap = Math.max(1, rows);
  const inCol = (b, col) => b.col <= col && col < b.col + b.span;
  const total = lines.map((l, col) => l.length + bars.filter((b) => inCol(b, col)).length);
  // Crowded: more than fits, or a bar whose lane (shared across the week) is past the last row.
  const over = total.map((n, col) => n > cap || bars.some((b) => inCol(b, col) && b.lane >= cap));
  for (const b of bars) {
    let crowded = false;
    for (let c = b.col; c < b.col + b.span; c++) if (over[c]) crowded = true;
    b.visible = b.lane < cap - (crowded ? 1 : 0);
  }
  const cells = lines.map((dayLines, col) => {
    const taken = new Set();
    let shown = 0;
    for (const b of bars) {
      if (b.col <= col && col < b.col + b.span) {
        taken.add(b.lane); // a hidden bar's lane stays free of lines, so its "+1 more" has a place
        if (b.visible) shown++;
      }
    }
    const usable = over[col] ? cap - 1 : cap;
    const out = [];
    let row = 0;
    for (const occ of dayLines) {
      while (taken.has(row)) row++;
      if (row >= usable) break;
      out.push({ occ, row });
      row++;
    }
    const count = total[col] - shown - out.length;
    return { lines: out, more: count > 0 ? { count, row: cap - 1 } : null };
  });
  return { bars, cells };
}

/** Everything on `day` for the "+N more" list: bars and lines, all-day first, then by start. */
export function dayItems(layout, col) {
  const items = layout.bars.filter((b) => b.col <= col && col < b.col + b.span).map((b) => b.occ).concat(layout.lines[col]);
  return items.sort((a, b) => (a.allDay === b.allDay ? 0 : a.allDay ? -1 : 1) || a.start - b.start);
}
