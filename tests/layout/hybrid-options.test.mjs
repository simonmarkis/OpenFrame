// Hybrid: calendar side (left/right, top/bottom) and the clock panel's height from the clock size (2026-10-16).
// Run: node --test "tests/layout/*.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { presetPage, arrangementFor, validateArrangement, PANEL_ROWS } from '../../app/src/main/assets/web/lib/layout-core.js';

const box = (arr, type) => { const w = arr.widgets.find((x) => x.type === type && !x.anchor); return w && [w.x, w.y, w.w, w.h]; };

test('default: calendar on the right in landscape, below in portrait', () => {
  const p = presetPage('hybrid', {});
  assert.deepEqual(box(p.landscape, 'photo'), [0, 0, 9, 24]);
  assert.deepEqual(box(p.landscape, 'clock_weather'), [9, 0, 3, 5]);
  assert.deepEqual(box(p.landscape, 'calendar_day'), [9, 5, 3, 19]);
  assert.deepEqual(box(p.portrait, 'calendar_day'), [0, 18, 12, 6]);
});

test('calendar on the left / on top', () => {
  const p = presetPage('hybrid', { hybridCalendar: { landscape: 'left', portrait: 'top' } });
  assert.deepEqual(box(p.landscape, 'photo'), [3, 0, 9, 24]);
  assert.deepEqual(box(p.landscape, 'clock_weather'), [0, 0, 3, 5]);
  assert.deepEqual(box(p.landscape, 'calendar_day'), [0, 5, 3, 19]);
  assert.deepEqual(box(p.portrait, 'photo'), [0, 6, 12, 18]);
  assert.deepEqual(box(p.portrait, 'calendar_day'), [0, 0, 12, 6]);
  for (const arr of [p.landscape, p.portrait]) assert.deepEqual(validateArrangement(arr), []);
});

test('the clock size sets the panel height; the calendar takes the rest', () => {
  for (const [size, rows] of Object.entries(PANEL_ROWS)) {
    const arr = arrangementFor(presetPage('hybrid', { size }), false);
    assert.deepEqual(box(arr, 'clock_weather'), [9, 0, 3, rows]);
    assert.deepEqual(box(arr, 'calendar_day'), [9, rows, 3, 24 - rows]);
    assert.deepEqual(validateArrangement(arr), []);
  }
});

test('without a clock the calendar fills the column on either side', () => {
  const p = presetPage('hybrid', { clockVisible: false, hybridCalendar: { landscape: 'left', portrait: 'bottom' } });
  assert.deepEqual(box(p.landscape, 'calendar_day'), [0, 0, 3, 24]);
  assert.equal(box(p.landscape, 'clock_weather'), undefined);
});
