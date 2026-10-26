// Layout editor math (SPEC §14, Phase 13c). Run: node --test "tests/layout/*.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  minCells, boxFits, moveWidget, resizeWidget, findFreeBox, cannotAdd, addWidget, removeWidget, placeInCorner,
  cornerAt, toggleClockStyle, setDays, belowMinimum, daysThatFit,
} from '../../app/src/main/assets/web/lib/editor-core.js';
import { customFromPreset, validateCustomArrangement } from '../../app/src/main/assets/web/lib/layout-core.js';

const LAND = { w: 1608, h: 904 };
const PORT = { w: 904, h: 1608 };
const OPTS = { corner: 'top-right', caption: { corner: 'bottom-left' } };
const hybrid = (portrait = false) => customFromPreset('hybrid', OPTS, 'p', 'P')[portrait ? 'portrait' : 'landscape'];
const box = (arr, id) => { const w = arr.widgets.find((x) => x.id === id); return w && { x: w.x, y: w.y, w: w.w, h: w.h }; };
const ok = (arr) => assert.deepEqual(validateCustomArrangement(arr), []);

test('minimum sizes follow the orientation (cells are wide and flat in landscape)', () => {
  assert.deepEqual(minCells('photo', LAND), { w: 3, h: 7 });
  assert.deepEqual(minCells('photo', PORT), { w: 5, h: 4 });
  assert.deepEqual(minCells('calendar_full', PORT), { w: 11, h: 8 });
  assert.deepEqual(belowMinimum(hybrid(), LAND), [], 'Hybrid is fine as it is');
  assert.deepEqual(belowMinimum(hybrid(true), PORT), []);
});

test('moving snaps to cells, stays on the grid, and never overlaps', () => {
  // Pictures only: a lone photo; shrink it, then move it around.
  let arr = resizeWidget(customFromPreset('pictures', OPTS, 'p', 'P').landscape, 'photo', { x: 0, y: 0, w: 12, h: 24 }, 'se', -6, -12, minCells('photo', LAND));
  assert.deepEqual(box(arr, 'photo'), { x: 0, y: 0, w: 6, h: 12 });
  const start = box(arr, 'photo');
  assert.deepEqual(box(moveWidget(arr, 'photo', start, 2.4, 3.6), 'photo'), { x: 2, y: 4, w: 6, h: 12 });
  assert.deepEqual(box(moveWidget(arr, 'photo', start, 50, 50), 'photo'), { x: 6, y: 12, w: 6, h: 12 }, 'clamped to the grid');
  // Hybrid: the photo can't move into the right column; it slides along y only... and y is full height.
  arr = hybrid();
  assert.deepEqual(box(moveWidget(arr, 'photo', box(arr, 'photo'), 2, 0), 'photo'), { x: 0, y: 0, w: 9, h: 24 });
  ok(moveWidget(arr, 'photo', box(arr, 'photo'), 2, 0));
});

test('blocked moves slide along the free axis', () => {
  const arr = { cols: 12, rows: 24, widgets: [
    { id: 'a', type: 'calendar_day', x: 0, y: 0, w: 4, h: 8 },
    { id: 'b', type: 'calendar_day', x: 6, y: 0, w: 4, h: 8 },
  ] };
  // Down-right into b: x is blocked at that height, so only y moves.
  assert.deepEqual(box(moveWidget(arr, 'a', box(arr, 'a'), 4, 2), 'a'), { x: 0, y: 2, w: 4, h: 8 });
  // Far down-right: clear of b.
  assert.deepEqual(box(moveWidget(arr, 'a', box(arr, 'a'), 4, 10), 'a'), { x: 4, y: 10, w: 4, h: 8 });
});

test('resizing keeps the opposite corner, the minimum, and other widgets', () => {
  const arr = hybrid();
  const min = minCells('photo', LAND);
  const start = box(arr, 'photo');
  assert.deepEqual(box(resizeWidget(arr, 'photo', start, 'se', -3, -4, min), 'photo'), { x: 0, y: 0, w: 6, h: 20 });
  assert.deepEqual(box(resizeWidget(arr, 'photo', start, 'nw', 2, 5, min), 'photo'), { x: 2, y: 5, w: 7, h: 19 });
  assert.deepEqual(box(resizeWidget(arr, 'photo', start, 'se', -20, -30, min), 'photo'), { x: 0, y: 0, w: 3, h: 7 }, 'not below the minimum');
  // Growing into the right column is refused (the height part still applies when it fits).
  assert.deepEqual(box(resizeWidget(arr, 'photo', start, 'se', 2, 0, min), 'photo'), start);
  ok(resizeWidget(arr, 'photo', start, 'nw', 2, 5, min));
});

test('free spots, and what can be added', () => {
  const arr = hybrid();
  assert.equal(findFreeBox(arr, 1, 1), null, 'Hybrid fills the screen');
  assert.equal(cannotAdd(arr, 'photo', LAND), 'Already on this page');
  assert.equal(cannotAdd(arr, 'calendar_day', LAND), 'No room: make another widget smaller first');
  assert.equal(cannotAdd(arr, 'clock_weather', LAND), null, 'a second clock goes over the photo');
  assert.equal(cannotAdd(arr, 'calendar_icon', LAND), null);
  assert.equal(cannotAdd(arr, 'status', LAND), 'Not a widget that can be added');
  assert.ok(boxFits({ cols: 12, rows: 24, widgets: [] }, { x: 0, y: 0, w: 12, h: 24 }));
});

test('adding: grid widgets in the biggest free spot up to their wanted size, corners over the photo', () => {
  const min = minCells('photo', LAND);
  let arr = resizeWidget(hybrid(), 'photo', box(hybrid(), 'photo'), 'se', -3, 0, min); // photo 6 wide: 3 columns free
  const day = addWidget(arr, 'calendar_day', LAND);
  assert.equal(day.id, 'calendar2');
  assert.deepEqual(box(day.arr, 'calendar2'), { x: 6, y: 0, w: 3, h: 12 });
  ok(day.arr);
  arr = day.arr;
  const icon = addWidget(arr, 'calendar_icon', LAND);
  assert.deepEqual(icon.arr.widgets.find((w) => w.id === 'calicon').anchor, { corner: 'top-left', over: 'photo' },
    'bottom-left is taken by the caption and the status icons');
  const clock = addWidget(arr, 'clock_weather', LAND);
  assert.deepEqual(clock.arr.widgets.find((w) => w.id === clock.id), { id: 'clock2', type: 'clock_weather', style: 'overlay', anchor: { corner: 'top-right', over: 'photo' } });
  ok(clock.arr);
  const blank = addWidget({ cols: 12, rows: 24, widgets: [] }, 'calendar_full', PORT);
  assert.deepEqual(box(blank.arr, 'fullcal'), { x: 0, y: 0, w: 12, h: 24 });
  assert.equal(addWidget(hybrid(), 'calendar_day', LAND), null);
});

test('removing a widget moves overlays that sat on it to the screen; status icons stay', () => {
  const arr = removeWidget(hybrid(true), 'photo');
  assert.deepEqual(arr.widgets.find((w) => w.id === 'clock').anchor, { corner: 'top-right' });
  assert.deepEqual(arr.widgets.find((w) => w.id === 'status').anchor, { corner: 'bottom-left' });
  ok(arr);
  assert.equal(removeWidget(hybrid(), 'status'), null);
  assert.equal(removeWidget(hybrid(), 'nope'), null);
});

test('corner widgets snap to the nearest corner of the photo under the finger, else the screen', () => {
  const arr = hybrid(); // photo 0..0.75 wide, full height
  assert.deepEqual(cornerAt(arr, 0.7, 0.9), { corner: 'bottom-right', over: 'photo' });
  assert.deepEqual(cornerAt(arr, 0.1, 0.1), { corner: 'top-left', over: 'photo' });
  assert.deepEqual(cornerAt(arr, 0.9, 0.9), { corner: 'bottom-right', over: null });
  const moved = placeInCorner(arr, 'caption', 'top-right', null);
  assert.deepEqual(moved.widgets.find((w) => w.id === 'caption').anchor, { corner: 'top-right' });
  assert.equal(placeInCorner(arr, 'caption', 'middle', null), null);
  assert.equal(placeInCorner(arr, 'caption', 'top-left', 'calendar') !== null, true, 'any grid widget can hold it');
  assert.equal(placeInCorner(arr, 'caption', 'top-left', 'status'), null, 'not over another overlay');
});

test('clock: panel to overlay and back (needs room on the grid)', () => {
  const arr = hybrid();
  const over = toggleClockStyle(arr, 'clock', LAND);
  assert.deepEqual(over.widgets.find((w) => w.id === 'clock'), { id: 'clock', type: 'clock_weather', style: 'overlay', anchor: { corner: 'top-right', over: 'photo' } });
  ok(over);
  const back = toggleClockStyle(over, 'clock', LAND);
  assert.deepEqual(box(back, 'clock'), { x: 9, y: 0, w: 2, h: 4 }, 'into the space it left');
  ok(back);
  assert.equal(toggleClockStyle(hybrid(true), 'clock', PORT), null, 'portrait Hybrid has no free cells for a panel');
});

test('day panel days: 1 to 5, as many as fit at 160 CSS px each', () => {
  assert.equal(setDays(hybrid(), 'calendar', 5).widgets.find((w) => w.id === 'calendar').days, 5);
  assert.equal(setDays(hybrid(), 'calendar', 6), null);
  assert.equal(setDays(hybrid(), 'calendar', 2.5), null);
  assert.equal(daysThatFit(3, LAND), 2, 'Hybrid landscape column: 402 px');
  assert.equal(daysThatFit(12, PORT), 5, 'full portrait width: 904 px');
  assert.equal(daysThatFit(4, PORT), 1, '301 px');
  assert.equal(daysThatFit(12, LAND), 5);
});
