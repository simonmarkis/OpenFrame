// One layout, no pages by default (SPEC §14, user decision 2026-10-16): switching your layout and
// remembering the custom one. Run: node --test "tests/layout/*.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  chooseLayout, layoutChoice, homePage, blankPage, customFromPreset, validatePages,
} from '../../app/src/main/assets/web/lib/layout-core.js';

const builtIn = { preset: 'hybrid', pages: [], home: '' };
const custom = customFromPreset('pictures', {}, 'home', 'Custom');
const withCustomHome = { preset: 'hybrid', pages: [custom], home: 'home', custom: null };

test('a built-in layout switches to another preset, as one page', () => {
  const c = chooseLayout(builtIn, 'pictures');
  assert.equal(c.pages.length, 1);
  assert.deepEqual(c.pages[0], { id: 'home', name: 'Pictures only', preset: 'pictures' });
  assert.equal(c.preset, 'pictures');
  assert.equal(c.custom, null);
  assert.equal(layoutChoice({ ...builtIn, ...c }), 'pictures');
});

test('leaving a custom layout remembers it; Custom brings it back', () => {
  const toHybrid = chooseLayout(withCustomHome, 'hybrid');
  const l1 = { ...withCustomHome, ...toHybrid };
  assert.equal(layoutChoice(l1), 'hybrid');
  assert.deepEqual(l1.custom.landscape, custom.landscape);
  const back = chooseLayout(l1, 'custom');
  const l2 = { ...l1, ...back };
  assert.equal(layoutChoice(l2), 'custom');
  assert.deepEqual(homePage(l2).landscape, custom.landscape);
  assert.equal(homePage(l2).name, 'Custom');
  assert.deepEqual(validatePages(l2.pages, l2.home), []);
});

test('Custom without a remembered layout does nothing', () => {
  assert.equal(chooseLayout(builtIn, 'custom'), null);
});

test('a name the user gave stays; extra pages are untouched', () => {
  const layout = { preset: 'hybrid', home: 'home', pages: [{ id: 'home', name: 'Kitchen', preset: 'hybrid' }, { id: 'p1', name: 'Calendar', preset: 'calendar' }] };
  const c = chooseLayout(layout, 'pictures');
  assert.equal(c.pages[0].name, 'Kitchen');
  assert.deepEqual(c.pages[1], layout.pages[1]);
});

test('a blank page is a valid empty custom page', () => {
  const b = blankPage('home', 'Custom');
  assert.deepEqual(b.landscape.widgets, []);
  assert.deepEqual(validatePages([b], 'home'), []);
});
