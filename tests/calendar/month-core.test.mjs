// Month grid arithmetic (SPEC §11). Synthetic data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { monthStart, monthWeeks, occDays, isBar, weekLayout, fitWeek, dayItems } from '../../app/src/main/assets/web/lib/month-core.js';
import { dayBounds } from '../../app/src/main/assets/web/lib/calendar-core.js';

const TZ = 'America/Los_Angeles';
const at = (day, h, m = 0) => dayBounds(day, TZ)[0] + (h * 60 + m) * 60000;
let n = 0;
const timed = (day, h, hours = 1, title = `e${++n}`) => ({ title, allDay: false, start: at(day, h), end: at(day, h) + hours * 3600000, calendar: 'c', uid: title });
const allDay = (from, to, title = `a${++n}`) => ({ title, allDay: true, startDay: from, endDay: to, start: dayBounds(from, TZ)[0], end: dayBounds(to, TZ)[0], calendar: 'c', uid: title });

test('months and their weeks (4–6 rows, Sunday or Monday first)', () => {
  assert.equal(monthStart('2026-10-19'), '2026-10-01');
  assert.equal(monthStart('2026-12-31', 1), '2027-01-01');
  assert.equal(monthStart('2026-01-15', -1), '2025-12-01');
  const oct = monthWeeks('2026-10-19', 0); // Oct 1 2026 is a Thursday
  assert.equal(oct.length, 5);
  assert.equal(oct[0][0], '2026-09-27');
  assert.equal(oct[4][6], '2026-10-31');
  assert.equal(monthWeeks('2026-02-10', 0).length, 4); // Feb 2026 starts on a Sunday, 28 days
  assert.equal(monthWeeks('2026-08-10', 0).length, 6); // Aug 2026: Saturday the 1st, 31 days
  assert.equal(monthWeeks('2026-10-19', 1)[0][0], '2026-09-28'); // Monday first
});

test('which events are bars: all-day, or timed over more than one day', () => {
  assert.equal(isBar(allDay('2026-10-19', '2026-10-20'), TZ), true);
  assert.equal(isBar(timed('2026-10-19', 10), TZ), false);
  assert.equal(isBar(timed('2026-10-19', 22, 4), TZ), true); // 10 PM to 2 AM
  assert.equal(isBar(timed('2026-10-19', 23, 1), TZ), false); // ends exactly at midnight
  assert.deepEqual(occDays(timed('2026-10-19', 23, 1), TZ), ['2026-10-19', '2026-10-20']);
});

test('a week: bars clipped to it and packed in lanes, lines per day in start order', () => {
  const week = monthWeeks('2026-10-19', 0)[3]; // Oct 18–24
  const trip = allDay('2026-10-16', '2026-10-21', 'Trip'); // from the previous week, to Tue
  const fair = allDay('2026-10-20', '2026-10-23', 'Fair');
  const lunch = timed('2026-10-19', 12, 1, 'Lunch');
  const call = timed('2026-10-19', 9, 1, 'Call');
  const l = weekLayout(week, [fair, lunch, trip, call], TZ);
  const bar = (t) => l.bars.find((b) => b.occ.title === t);
  assert.deepEqual([bar('Trip').col, bar('Trip').span, bar('Trip').lane, bar('Trip').fromPrev], [0, 3, 0, true]);
  assert.deepEqual([bar('Fair').col, bar('Fair').span, bar('Fair').lane], [2, 3, 1]); // overlaps Trip on Tue
  assert.equal(l.lanes, 2);
  assert.deepEqual(l.lines[1].map((o) => o.title), ['Call', 'Lunch']);
});

test('fitting: everything shown when it fits', () => {
  const week = monthWeeks('2026-10-19', 0)[3];
  const l = weekLayout(week, [allDay('2026-10-19', '2026-10-20', 'Holiday'), timed('2026-10-19', 9, 1, 'A'), timed('2026-10-19', 10, 1, 'B')], TZ);
  const f = fitWeek(l, 3);
  assert.equal(f.bars[0].visible, true);
  assert.deepEqual(f.cells[1].lines.map((x) => [x.occ.title, x.row]), [['A', 1], ['B', 2]]);
  assert.equal(f.cells[1].more, null);
});

test('fitting: the last row says "+N more" when a day has too much', () => {
  const week = monthWeeks('2026-10-19', 0)[3];
  const evs = [9, 10, 11, 12, 13].map((h) => timed('2026-10-19', h, 1, `h${h}`));
  const f = fitWeek(weekLayout(week, evs, TZ), 3);
  assert.deepEqual(f.cells[1].lines.map((x) => x.occ.title), ['h9', 'h10']);
  assert.deepEqual(f.cells[1].more, { count: 3, row: 2 });
  assert.equal(f.cells[0].more, null);
});

test('fitting: a bar in the last lane hides on all its days when one of them is crowded', () => {
  const week = monthWeeks('2026-10-19', 0)[3];
  const top = allDay('2026-10-18', '2026-10-25', 'Week-long');
  const second = allDay('2026-10-19', '2026-10-21', 'Two days'); // lane 1 on Mon–Tue
  const busy = [9, 10, 11].map((h) => timed('2026-10-20', h, 1, `t${h}`)); // Tue: 2 bars + 3 lines
  // Three rows: crowded Tuesday keeps rows 0–1 for the two bars, row 2 says "+3 more".
  const f3 = fitWeek(weekLayout(week, [top, second, ...busy], TZ), 3);
  assert.equal(f3.bars.every((x) => x.visible), true);
  assert.deepEqual(f3.cells[2].more, { count: 3, row: 2 });
  assert.equal(f3.cells[1].more, null);
  // Two rows: lane 1 is Tuesday's "+N more" row, so "Two days" hides on Monday too, counted there.
  const f = fitWeek(weekLayout(week, [top, second, ...busy], TZ), 2);
  const b = (t) => f.bars.find((x) => x.occ.title === t);
  assert.equal(b('Week-long').visible, true);
  assert.equal(b('Two days').visible, false);
  assert.deepEqual(f.cells[1].more, { count: 1, row: 1 }, 'Monday: the hidden bar is counted');
  assert.equal(f.cells[1].lines.length, 0);
  assert.deepEqual(f.cells[2].more, { count: 4, row: 1 });
});

test('fitting: a bar past the last row on a quiet day still gets its "+1 more"', () => {
  const week = monthWeeks('2026-10-19', 0)[3];
  const a = allDay('2026-10-18', '2026-10-20', 'A'); // Sun–Mon, lane 0
  const b2 = allDay('2026-10-19', '2026-10-21', 'B'); // Mon–Tue, lane 1
  const c = allDay('2026-10-20', '2026-10-22', 'C'); // Tue–Wed, lane 0
  const d = allDay('2026-10-20', '2026-10-21', 'D'); // Tue, lane 2
  const f = fitWeek(weekLayout(week, [a, b2, c, d], TZ), 2);
  assert.equal(f.bars.find((x) => x.occ.title === 'D').visible, false);
  assert.equal(f.cells[2].more.count, 2); // Tue: B (row 1 = more) and D hidden
});

test('the "+N more" list: all of the day, all-day first, then by start', () => {
  const week = monthWeeks('2026-10-19', 0)[3];
  const l = weekLayout(week, [timed('2026-10-19', 15, 1, 'Late'), allDay('2026-10-19', '2026-10-20', 'Holiday'), timed('2026-10-19', 8, 1, 'Early')], TZ);
  assert.deepEqual(dayItems(l, 1).map((o) => o.title), ['Holiday', 'Early', 'Late']);
});
