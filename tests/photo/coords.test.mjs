// Typed coordinates in the location editor (SPEC §8).
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCoords } from '../../app/src/main/assets/web/photo-menu.js';

test('coordinates as people type them', () => {
  assert.deepEqual(parseCoords('47.6205, -122.3493'), { lat: 47.6205, lon: -122.3493 });
  assert.deepEqual(parseCoords(' 47.6205 -122.3493 '), { lat: 47.6205, lon: -122.3493 });
  assert.deepEqual(parseCoords('47.6205,-122.3493'), { lat: 47.6205, lon: -122.3493 });
});

test('not coordinates', () => {
  assert.equal(parseCoords(''), null);
  assert.equal(parseCoords('Seattle'), null);
  assert.equal(parseCoords('95, 10'), null);
  assert.equal(parseCoords('0, 0'), null);
  assert.equal(parseCoords('47.6'), null);
});
