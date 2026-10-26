// Google-style overlaps, long events in the all-day row, and hidden-event keys (SPEC §11, 2026-10-19).
// Synthetic data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wallclockToEpoch } from '../../app/src/main/assets/web/lib/calendar-core.js';
import { timedSegments, layoutCascade, allDayLanes, isLongTimed, NEST_MIN } from '../../app/src/main/assets/web/lib/timegrid-core.js';
import { occurrenceKey, seriesKey, isRepeat } from '../../app/src/main/assets/web/lib/calendar-data.js';

const TZ = 'America/Los_Angeles';
const at = (d, h, mi = 0) => wallclockToEpoch(2026, 10, d, h, mi, 0, TZ);
const timed = (title, start, end) => ({ calendar: 'c1', uid: title, title, allDay: false, start, end });
const seg = (title, startMin, endMin) => ({ occ: { title }, startMin, endMin });
const pick = (segs, title) => segs.find((s) => s.occ.title === title);

test('an event starting well after another is drawn over it, one level in', () => {
  const segs = layoutCascade([seg('Focus time', 7 * 60, 16 * 60), seg('Standup', 8 * 60 + 30, 9 * 60 + 30)]);
  assert.deepEqual([pick(segs, 'Focus time').level, pick(segs, 'Focus time').k, pick(segs, 'Focus time').n], [0, 0, 1]);
  assert.deepEqual([pick(segs, 'Standup').level, pick(segs, 'Standup').n], [1, 1]);
  assert.ok(pick(segs, 'Standup').z > pick(segs, 'Focus time').z, 'the later one is on top');
});

test('events starting together are siblings side by side; back-to-back ones share a level', () => {
  const segs = layoutCascade([
    seg('Focus time', 7 * 60, 16 * 60),
    seg('Team sync', 12 * 60 + 15, 13 * 60),
    seg('Workshop', 12 * 60 + 30, 13 * 60 + 30), // 15 min after Team sync: a sibling
    seg('Lunch', 9 * 60, 9 * 60 + 30),
  ]);
  const sync = pick(segs, 'Team sync');
  const bigger = pick(segs, 'Workshop');
  assert.deepEqual([sync.level, sync.k, sync.n], [1, 0, 2]);
  assert.deepEqual([bigger.level, bigger.k, bigger.n], [1, 1, 2]);
  assert.equal(pick(segs, 'Lunch').level, 1);
  assert.equal(NEST_MIN, 30);
});

test('no overlap: full width', () => {
  const segs = layoutCascade([seg('a', 600, 660), seg('b', 660, 720)]);
  assert.deepEqual(segs.map((s) => [s.level, s.n]), [[0, 1], [0, 1]]);
});

test('events of 24 hours or more become all-day bars, not hour segments', () => {
  const getaway = timed('Weekend getaway', at(23, 17), at(25, 18)); // Fri 5 PM → Sun 6 PM
  const ooo = timed('Away', at(23, 7), at(23, 19)); // 12 hours: stays in the hours
  assert.equal(isLongTimed(getaway), true);
  assert.equal(isLongTimed(ooo), false);
  const days = ['2026-10-23', '2026-10-24', '2026-10-25'];
  const segs = timedSegments([getaway, ooo], days, TZ);
  assert.deepEqual(segs.map((d) => d.map((s) => s.occ.title)), [['Away'], [], []]);
  const { bars } = allDayLanes([getaway, ooo], days, TZ);
  assert.deepEqual(bars.map((b) => [b.occ.title, b.col, b.span]), [['Weekend getaway', 0, 3]]);
  assert.deepEqual(allDayLanes([getaway], days).bars, [], 'without a zone only true all-day events (older callers)');
});

test('hidden-event keys: one occurrence or the whole series', () => {
  const one = { calendar: 'c1', uid: 'u1', recurrenceId: null };
  const rep = { calendar: 'c1', uid: 'u2', recurrenceId: '2026-10-23T09:00:00' };
  assert.equal(occurrenceKey(one), 'o|c1|u1|');
  assert.equal(occurrenceKey(rep), 'o|c1|u2|2026-10-23T09:00:00');
  assert.equal(seriesKey(rep), 's|c1|u2');
  assert.equal(isRepeat(one), false);
  assert.equal(isRepeat(rep), true);
});
