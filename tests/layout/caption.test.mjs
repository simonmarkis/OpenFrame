// Photo caption text and placement (SPEC §8).
// Run: node --test "tests/layout/*.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { captionDate, captionText, captionCorner, captionFreeCorner } from '../../app/src/main/assets/web/lib/caption-core.js';
import { presetPage, arrangementFor, validateArrangement, resolveArrangement } from '../../app/src/main/assets/web/lib/layout-core.js';

const TZ = 'America/Los_Angeles';
const ALL = { showComment: true, showLocation: true, showDate: true, lines: 'two' };
// Jun 14, 2026, 8:30 PM in Los Angeles (Jun 15 in UTC).
const JUN14 = Date.UTC(2026, 5, 15, 3, 30);
const SLIDE = { comment: 'Picnic in the park', place: "Springfield", takenAt: JUN14 };

test('captionDate is the short US date in the display zone', () => {
  assert.equal(captionDate(JUN14, TZ), 'Jun 14, 2026');
  assert.equal(captionDate(JUN14, 'UTC'), 'Jun 15, 2026');
  assert.equal(captionDate(null, TZ), null);
});

test('two lines: comment on top, place and date below', () => {
  assert.deepEqual(captionText(SLIDE, ALL, TZ), { main: 'Picnic in the park', sub: "Springfield · Jun 14, 2026" });
  assert.deepEqual(captionText({ ...SLIDE, comment: null }, ALL, TZ), { main: null, sub: "Springfield · Jun 14, 2026" });
  assert.deepEqual(captionText({ ...SLIDE, place: null }, ALL, TZ), { main: 'Picnic in the park', sub: 'Jun 14, 2026' });
});

test('one line joins everything', () => {
  assert.deepEqual(captionText(SLIDE, { ...ALL, lines: 'one' }, TZ),
    { main: "Picnic in the park · Springfield · Jun 14, 2026", sub: null });
});

test('each part can be switched off; nothing to show means no bubble', () => {
  assert.deepEqual(captionText(SLIDE, { ...ALL, showComment: false, showDate: false }, TZ), { main: null, sub: "Springfield" });
  assert.deepEqual(captionText({ takenAt: null }, ALL, TZ), { main: null, sub: null });
  assert.deepEqual(captionText(SLIDE, { ...ALL, showComment: false, showLocation: false, showDate: false }, TZ), { main: null, sub: null });
  assert.deepEqual(captionText(null, ALL, TZ), { main: null, sub: null });
});

test('captionCorner moves to the other side of a clock overlay in the same corner', () => {
  assert.equal(captionCorner('bottom-left', 'top-right', true), 'bottom-left');
  assert.equal(captionCorner('top-right', 'top-right', true), 'top-left');
  assert.equal(captionCorner('bottom-left', 'bottom-left', true), 'bottom-right');
  assert.equal(captionCorner('bottom-left', 'bottom-left', false), 'bottom-left'); // clock is a panel
});

const cap = (page, portrait) => arrangementFor(page, portrait).widgets.find((w) => w.id === 'caption');

test('presets place the caption bottom left, clear of the calendar button and status icons', () => {
  const caption = { visible: true, corner: 'bottom-left' };
  const pictures = presetPage('pictures', { corner: 'top-right', caption });
  assert.deepEqual(cap(pictures, false).anchor, { corner: 'bottom-left', lift: true });
  const hybrid = presetPage('hybrid', { corner: 'top-right', caption });
  assert.deepEqual(cap(hybrid, false).anchor, { corner: 'bottom-left', over: 'photo', statusLift: true });
  assert.deepEqual(cap(hybrid, true).anchor, { corner: 'bottom-left', over: 'photo', statusLift: true });
  for (const page of [pictures, hybrid]) for (const p of [false, true]) assert.deepEqual(validateArrangement(arrangementFor(page, p)), []);
});

test('presets: caption off, other corners, the Calendar preset', () => {
  assert.equal(cap(presetPage('pictures', { caption: { visible: false, corner: 'bottom-left' } }), false), undefined);
  assert.equal(cap(presetPage('pictures', {}), false), undefined);
  const right = presetPage('pictures', { corner: 'top-right', caption: { visible: true, corner: 'bottom-right' } });
  assert.deepEqual(cap(right, false).anchor, { corner: 'bottom-right' });
  // The clock overlay is bottom left (lifted): the caption goes bottom right; in Hybrid landscape the
  // clock is a panel, so the caption keeps its corner there.
  const shared = presetPage('hybrid', { corner: 'bottom-left', caption: { visible: true, corner: 'bottom-left' } });
  assert.equal(cap(shared, true).anchor.corner, 'bottom-right');
  assert.equal(cap(shared, false).anchor.corner, 'bottom-left');
  assert.equal(cap(presetPage('calendar', { caption: { visible: true, corner: 'bottom-left' } }), false), undefined);
});

test('the caption keeps clear of clocks in two or more corners (2026-10-19)', () => {
  const clocks = (...cs) => (c) => cs.includes(c);
  assert.equal(captionFreeCorner('top-left', clocks()), 'top-left');
  assert.equal(captionFreeCorner('top-left', clocks('top-left')), 'top-right');
  assert.equal(captionFreeCorner('top-left', clocks('top-left', 'top-right')), 'bottom-left');
  assert.equal(captionFreeCorner('top-right', clocks('top-left', 'top-right')), 'bottom-right');
  assert.equal(captionFreeCorner('top-left', clocks('top-left', 'top-right', 'bottom-left')), 'bottom-right');
  assert.equal(captionFreeCorner('top-left', clocks('top-left', 'top-right', 'bottom-left', 'bottom-right')), 'top-left');
  // In a layout: clocks in both top corners of the screen, the caption put top left → bottom left.
  const arr = { cols: 12, rows: 12, widgets: [
    { id: 'p', type: 'photo', x: 0, y: 0, w: 12, h: 12 },
    { id: 'c1', type: 'clock_weather', style: 'overlay', anchor: { corner: 'top-left' } },
    { id: 'c2', type: 'clock_weather', style: 'overlay', anchor: { corner: 'top-right' } },
    { id: 'cap', type: 'caption', anchor: { corner: 'top-left' } },
  ] };
  assert.equal(resolveArrangement(arr).widgets.find((w) => w.id === 'cap').anchor.corner, 'bottom-left');
});