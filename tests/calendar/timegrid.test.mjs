// Day/week time grid layout (SPEC §11 calendar_full). Synthetic data only.
// Run: node --test "tests/calendar/*.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseFeed, expandFeed, dayBounds, wallclockToEpoch } from '../../app/src/main/assets/web/lib/calendar-core.js';
import {
  weekday, weekStart, rangeDays, wallMinutes, timedSegments, layoutColumns, allDayLanes, isoWeek, DAY_MIN, MIN_VISUAL_MIN,
} from '../../app/src/main/assets/web/lib/timegrid-core.js';

const TZ = 'America/Los_Angeles';
const at = (y, mo, d, h, mi = 0) => wallclockToEpoch(y, mo, d, h, mi, 0, TZ);
const timed = (title, start, end) => ({ calendar: 'c1', uid: title, title, allDay: false, start, end });
const allDay = (title, startDay, endDay) => ({ calendar: 'c1', uid: title, title, allDay: true, startDay, endDay, start: 0, end: 0 });

test('weeks start on the configured weekday', () => {
  assert.equal(weekday('2026-10-13'), 2); // Tuesday
  assert.equal(weekStart('2026-10-13', 0), '2026-10-11'); // Sunday start
  assert.equal(weekStart('2026-10-11', 0), '2026-10-11');
  assert.equal(weekStart('2026-10-13', 1), '2026-10-12'); // Monday start
  assert.equal(weekStart('2026-11-01', 1), '2026-10-26');
  assert.deepEqual(rangeDays('2026-12-30', 4), ['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02']);
});

test('ISO week numbers', () => {
  assert.equal(isoWeek('2026-10-13'), 42);
  assert.equal(isoWeek('2027-01-01'), 53); // Friday: still the last week of 2026
  assert.equal(isoWeek('2026-01-01'), 1);
});

test('segments: plain, zero-length, ending at midnight, and crossing midnight', () => {
  const days = ['2026-10-15', '2026-10-16'];
  const segs = timedSegments([
    timed('Dentist', at(2026, 10, 15, 14), at(2026, 10, 15, 14, 45)),
    timed('Reminder', at(2026, 10, 15, 12), at(2026, 10, 15, 12)),
    timed('Evening', at(2026, 10, 15, 22), at(2026, 10, 16, 0)),
    timed('Late flight', at(2026, 10, 15, 23), at(2026, 10, 16, 2)),
  ], days, TZ);
  const [d1, d2] = segs.map((list) => Object.fromEntries(list.map((s) => [s.occ.title, s])));
  assert.deepEqual([d1.Dentist.startMin, d1.Dentist.endMin], [14 * 60, 14 * 60 + 45]);
  assert.deepEqual([d1.Reminder.startMin, d1.Reminder.endMin], [720, 720]);
  assert.deepEqual([d1.Evening.startMin, d1.Evening.endMin], [22 * 60, DAY_MIN], 'ends at midnight = bottom of the day');
  assert.equal(d2.Evening, undefined, 'an event ending exactly at midnight is not on the next day');
  assert.deepEqual([d1['Late flight'].startMin, d1['Late flight'].endMin, d1['Late flight'].toNext], [23 * 60, DAY_MIN, true]);
  assert.deepEqual([d2['Late flight'].startMin, d2['Late flight'].endMin, d2['Late flight'].fromPrev], [0, 120, true]);
  assert.equal(segs[1].length, 1);
});

test('segments use wall-clock minutes on DST days (labels line up)', () => {
  // Nov 1, 2026 has 25 hours in Los Angeles; a 9:00 event still sits at the 9:00 line.
  const [seg] = timedSegments([timed('Pancakes', at(2026, 11, 1, 9), at(2026, 11, 1, 10))], ['2026-11-01'], TZ)[0];
  assert.deepEqual([seg.startMin, seg.endMin], [540, 600]);
  assert.equal(wallMinutes(at(2027, 3, 14, 3, 30), TZ), 210); // just after the spring-forward gap
});

test('overlapping events share the width; separate clusters get full width', () => {
  const s = (startMin, endMin) => ({ startMin, endMin });
  const a = s(540, 600); const b = s(570, 630); const c = s(600, 660); const d = s(720, 780);
  layoutColumns([a, b, c, d]);
  assert.deepEqual([a.col, a.cols], [0, 2]);
  assert.deepEqual([b.col, b.cols], [1, 2]);
  assert.deepEqual([c.col, c.cols], [0, 2], 'c reuses column 0 once a has ended');
  assert.deepEqual([d.col, d.cols], [0, 1]);
});

test('short events overlap by their drawn height, so a 5-minute event never hides the next one', () => {
  const vit = { startMin: 480, endMin: 485 };
  const breakfast = { startMin: 480 + MIN_VISUAL_MIN - 5, endMin: 540 };
  layoutColumns([vit, breakfast]);
  assert.equal(vit.cols, 2);
  assert.notEqual(vit.col, breakfast.col);
});

test('all-day bars are clipped to the visible days and packed into lanes', () => {
  const days = rangeDays('2026-10-11', 7); // Sun Oct 11 – Sat Oct 17
  const { bars, lanes } = allDayLanes([
    allDay('Trip', '2026-10-09', '2026-10-13'), // started before the week
    allDay('Library', '2026-10-16', '2026-10-17'),
    allDay('Trash', '2026-10-16', '2026-10-17'),
    allDay('Conference', '2026-10-15', '2026-10-20'), // continues past the week
    allDay('Old', '2026-10-01', '2026-10-02'), // not visible
  ], days);
  const by = Object.fromEntries(bars.map((b) => [b.occ.title, b]));
  assert.equal(by.Old, undefined);
  assert.deepEqual([by.Trip.col, by.Trip.span, by.Trip.fromPrev, by.Trip.toNext], [0, 2, true, false]);
  assert.deepEqual([by.Conference.col, by.Conference.span, by.Conference.toNext], [4, 3, true]);
  assert.equal(lanes, 3, 'Conference, Library and Trash all cover Friday');
  assert.equal(new Set([by.Library.lane, by.Trash.lane, by.Conference.lane]).size, 3);
  assert.equal(by.Trip.lane, 0);
});

test('fixture week renders without overlapping columns in any day', () => {
  const text = readFileSync(fileURLToPath(new URL('./fixtures/recurring.ics', import.meta.url)), 'utf8');
  const feed = parseFeed(text);
  const days = rangeDays('2026-10-11', 7);
  const occ = expandFeed(feed, dayBounds(days[0], TZ)[0], dayBounds(days[6], TZ)[1], TZ);
  for (const list of timedSegments(occ, days, TZ)) {
    layoutColumns(list);
    for (const x of list) {
      for (const y of list) {
        if (x === y || x.col !== y.col) continue;
        const xe = Math.max(x.endMin, x.startMin + MIN_VISUAL_MIN);
        const ye = Math.max(y.endMin, y.startMin + MIN_VISUAL_MIN);
        assert.ok(xe <= y.startMin || ye <= x.startMin, `${x.occ.title} and ${y.occ.title} share a column and overlap`);
      }
    }
  }
});
