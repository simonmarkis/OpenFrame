// The day panel's "Now" badge for the event in progress (SPEC §11). Synthetic times only.
// Run: node --test tests/calendar/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nowBadge, NOW_NO_END_MS } from '../../app/src/main/assets/web/lib/calendar-core.js';
import { nowAccent, contrast } from '../../app/src/main/assets/web/lib/colors.js';
import { PALETTE } from '../../app/src/main/assets/web/lib/settings-core.js';

const MIN = 60000;
const T = Date.UTC(2026, 9, 16, 15, 0); // 8:00 AM Pacific
const ev = (startMin, endMin, extra = {}) => ({ allDay: false, start: T + startMin * MIN, end: T + endMin * MIN, ...extra });

test('only an event in progress gets a badge; all-day events never', () => {
  assert.equal(nowBadge(ev(0, 30), T - 1, false), null); // not started
  assert.equal(nowBadge(ev(0, 30), T, false), 'Now'); // just started
  assert.equal(nowBadge(ev(0, 30), T + 30 * MIN, false), null); // ended
  assert.equal(nowBadge(ev(0, 30, { allDay: true }), T + MIN, true), null);
});

test('time left, when switched on', () => {
  assert.equal(nowBadge(ev(0, 30), T + 18 * MIN, true), 'Now · 12 min left');
  assert.equal(nowBadge(ev(0, 30), T + 17.5 * MIN, true), 'Now · 13 min left'); // rounds up
  assert.equal(nowBadge(ev(0, 30), T + 29.5 * MIN, true), 'Now · ending');
  assert.equal(nowBadge(ev(0, 90), T + 5 * MIN, true), 'Now · 1 h 25 min left');
  assert.equal(nowBadge(ev(0, 120), T, true), 'Now · 2 h left');
});

test('an event without an end time shows "Now" for a while after it starts', () => {
  assert.equal(nowBadge(ev(0, 0), T + 5 * MIN, true), 'Now');
  assert.equal(nowBadge(ev(0, 0), T + NOW_NO_END_MS, true), null);
});

test('the light-mode outline and badge color carries white text on every palette color', () => {
  for (const p of PALETTE) assert.ok(contrast(nowAccent(p.hex), '#ffffff') >= 4.5, p.name);
});
