// Text style: per-item overrides, automatic color, shadows, brightness under text (SPEC §9).
// Run: node --test "tests/layout/*.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FONTS, fontFamily, resolveStyle, textColor, shadowCss, hexLuminance, overrideSummary,
  photoRect, areaLuminance, AUTO, WHITE, DARK_TEXT,
} from '../../app/src/main/assets/web/lib/text-style-core.js';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

const TEXT = {
  font: 'roboto', bold: false, color: WHITE, shadow: 0.6, outline: false, opacity: 1,
  clock: { font: null, color: null, bold: null },
  date: { font: 'dancing-script', color: AUTO, bold: true },
  weather: { font: null, color: null, bold: false },
  caption: { font: null, color: null, bold: null },
  calendar: { font: null, size: 'medium' },
};

test('fonts: every id has a family, unknown ids fall back to Roboto', () => {
  assert.equal(FONTS.length, 6);
  assert.match(fontFamily('noto-serif'), /Noto Serif/);
  assert.equal(fontFamily('nope'), fontFamily('roboto'));
});

test('resolveStyle: item overrides win, nulls mean "same as all text"', () => {
  assert.deepEqual(resolveStyle(TEXT, 'clock'), { font: 'roboto', bold: false, color: WHITE, shadow: 0.6, outline: false, opacity: 1 });
  const date = resolveStyle(TEXT, 'date');
  assert.equal(date.font, 'dancing-script');
  assert.equal(date.color, AUTO);
  assert.equal(date.bold, true);
  assert.equal(resolveStyle({ ...TEXT, bold: true }, 'weather').bold, false); // explicit false beats the default
});

test('textColor: fixed colors stay; automatic picks by brightness with hysteresis', () => {
  assert.equal(textColor('#fdd663', 0.9), '#fdd663');
  assert.equal(textColor(AUTO, null), WHITE);
  assert.equal(textColor(AUTO, 0.1), WHITE);
  assert.equal(textColor(AUTO, 0.6), DARK_TEXT);
  assert.equal(textColor(AUTO, 0.37), WHITE); // between the limits: stays white…
  assert.equal(textColor(AUTO, 0.37, DARK_TEXT), DARK_TEXT); // …or stays dark
});

test('shadowCss: dark shadow under light text, light glow around dark text, outline, none', () => {
  assert.match(shadowCss(WHITE, 0.6, false), /rgba\(0,0,0,/);
  assert.match(shadowCss(DARK_TEXT, 0.6, false), /rgba\(255,255,255,/);
  assert.equal(shadowCss(WHITE, 0, false), 'none');
  assert.equal(shadowCss(WHITE, 0, true).split('),').length, 8); // 8 outline offsets only
  near(hexLuminance('#ffffff'), 1);
  near(hexLuminance('#000000'), 0);
});

test('overrideSummary', () => {
  const label = (id) => FONTS.find((f) => f.id === id).label;
  assert.equal(overrideSummary(TEXT.clock, label), 'Same as all text');
  assert.equal(overrideSummary(TEXT.date, label), 'Dancing Script, automatic color, bold');
  assert.equal(overrideSummary({ font: null, size: 'large' }, label), 'large text');
});

test('photoRect: fit contains and centers, fill covers', () => {
  const fit = photoRect(400, 300, 800, 400, false);
  near(fit.x, 400 / 3);
  near(fit.w, 1600 / 3);
  assert.deepEqual([fit.y, fit.h], [0, 400]);
  const fill = photoRect(400, 300, 800, 400, true, 50, 0);
  assert.deepEqual([fill.w, fill.h, fill.x + 0, fill.y + 0], [800, 600, 0, 0]); // + 0: -0 at 0%
});

// A 2×1 luminance grid: dark left half, bright right half.
const LUM = { w: 2, h: 1, data: new Float32Array([0.05, 0.9]) };

test('areaLuminance reads the photo under the text', () => {
  const photo = photoRect(2, 1, 800, 400, false); // fills the box exactly
  near(areaLuminance(LUM, photo, { x: 0, y: 0, w: 100, h: 50 }, 800, 400, 0), 0.05);
  near(areaLuminance(LUM, photo, { x: 700, y: 0, w: 100, h: 50 }, 800, 400, 0), 0.9);
});

test('areaLuminance outside the photo: black, a color, or the blurred photo', () => {
  const photo = photoRect(2, 1, 800, 800, false); // letterboxed: rows 200..600
  near(areaLuminance(LUM, photo, { x: 600, y: 0, w: 100, h: 50 }, 800, 800, 0), 0);
  near(areaLuminance(LUM, photo, { x: 600, y: 0, w: 100, h: 50 }, 800, 800, 0.5), 0.5);
  // The blurred copy covers the box (stretched): the right side is bright there too.
  near(areaLuminance(LUM, photo, { x: 700, y: 0, w: 100, h: 50 }, 800, 800, 'blur'), 0.9);
});
