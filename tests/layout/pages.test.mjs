// Page list changes for Settings → Layout (SPEC §14, Phase 13b).
// Run: node --test "tests/layout/*.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addPage, removePage, movePage, editPage, setHomePage, replacePage, customFromPreset, newPageId, uniquePageName, validatePages, homePage, MAX_PAGES,
} from '../../app/src/main/assets/web/lib/layout-core.js';

const OLD = { preset: 'pictures', pages: [], home: '', inactivityReturnSec: 120 }; // a config from before Phase 13
const ids = (r) => r.pages.map((p) => p.id);
const valid = (r) => assert.deepEqual(validatePages(r.pages, r.home), []);

test('the first change keeps the old preset as the stored home page', () => {
  const r = addPage(OLD, 'calendar');
  assert.deepEqual(r.pages, [{ id: 'home', name: 'Pictures only', preset: 'pictures' }, { id: 'p1', name: 'Calendar', preset: 'calendar' }]);
  assert.equal(r.home, 'home');
  valid(r);
});

test('new pages get free ids and unique names', () => {
  let layout = OLD;
  for (let i = 0; i < 3; i++) layout = { ...layout, ...addPage(layout, 'pictures') };
  assert.deepEqual(ids(layout), ['home', 'p1', 'p2', 'p3']);
  assert.deepEqual(layout.pages.map((p) => p.name), ['Pictures only', 'Pictures only 2', 'Pictures only 3', 'Pictures only 4']);
  assert.equal(newPageId([{ id: 'p2' }]), 'p1');
  assert.equal(uniquePageName([{ id: 'a', name: 'Kitchen' }], 'kitchen'), 'kitchen 2');
  assert.equal(uniquePageName([{ id: 'a', name: 'Kitchen' }], 'Kitchen', 'a'), 'Kitchen', 'its own name is free');
  assert.equal(uniquePageName([], '   '), 'Page');
  assert.equal(uniquePageName([], 'x'.repeat(60)).length, 40);
  valid(layout);
});

test('at most 8 pages', () => {
  let layout = OLD;
  while (layoutLength(layout) < MAX_PAGES) layout = { ...layout, ...addPage(layout, 'hybrid') };
  assert.equal(addPage(layout, 'hybrid'), null);
  valid(layout);
});
function layoutLength(l) { return l.pages.length || 1; }

test('removing a page: never the last, and the home page moves to the first left', () => {
  assert.equal(removePage(OLD, 'home'), null);
  const two = { ...OLD, ...addPage(OLD, 'calendar') };
  const r = removePage(two, 'home');
  assert.deepEqual(ids(r), ['p1']);
  assert.equal(r.home, 'p1');
  assert.equal(removePage(two, 'nope'), null);
  const keep = removePage({ ...two, home: 'home' }, 'p1');
  assert.equal(keep.home, 'home');
});

test('moving pages up and down, clamped', () => {
  let l = { ...OLD, ...addPage(OLD, 'calendar') };
  l = { ...l, ...addPage(l, 'hybrid') };
  assert.deepEqual(ids(movePage(l, 'p2', -1)), ['home', 'p2', 'p1']);
  assert.deepEqual(ids(movePage(l, 'home', 1)), ['p1', 'home', 'p2']);
  assert.equal(movePage(l, 'home', -1), null);
  assert.equal(movePage(l, 'p2', 1), null);
  assert.equal(movePage(l, 'p2', -1).home, 'home', 'the home page stays home wherever it is');
});

test('renaming, changing a built-in page, choosing the home page', () => {
  const l = { ...OLD, ...addPage(OLD, 'calendar') };
  const r = editPage(l, 'p1', { name: '  Pictures only ', preset: 'hybrid' });
  assert.deepEqual(r.pages[1], { id: 'p1', name: 'Pictures only 2', preset: 'hybrid' });
  assert.equal(editPage(l, 'p1', { preset: 'collage' }).pages[1].preset, 'calendar');
  assert.equal(editPage(l, 'nope', { name: 'x' }), null);
  const h = setHomePage(l, 'p1');
  assert.equal(h.home, 'p1');
  assert.equal(homePage(h).id, 'p1');
  assert.equal(setHomePage(l, 'nope'), null);
});

test('replacePage: an edited page takes the place of the stored one (built-in becomes custom)', () => {
  const l = { ...OLD, ...addPage(OLD, 'calendar') };
  const custom = customFromPreset('pictures', { corner: 'top-right' }, 'home', 'Pictures only');
  const r = replacePage(l, custom);
  assert.deepEqual(ids(r), ['home', 'p1']);
  assert.equal(r.pages[0].preset, undefined);
  assert.equal(r.pages[0].landscape.rows, 24);
  assert.equal(r.home, 'home');
  valid(r);
  assert.equal(replacePage(l, { ...custom, id: 'gone' }), null);
});

test('a blank page is custom and empty (the status icons are added when shown)', () => {
  const r = addPage(OLD, 'blank');
  assert.deepEqual(r.pages[1], { id: 'p1', name: 'New page', landscape: { cols: 12, rows: 24, widgets: [] }, portrait: { cols: 12, rows: 24, widgets: [] } });
  valid(r);
  assert.equal(addPage(OLD, 'blank', 'Kitchen').pages[1].name, 'Kitchen');
});
