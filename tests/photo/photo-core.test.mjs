// Fill crop and per-photo position math (SPEC §6, §15).
// Run: node --test "tests/photo/*.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cropPosition, fillCenter, fillLayout, clampCenter, dragCenter, cropWith,
  mediaRect, visibleRect, holeClipPath, deviceRect,
  MAX_ZOOM, viewFor, viewRect, zoomScale, scaleZoom, clampView, dragView, viewFromLook, savedView, viewTransform, pinchView, easeView, pinchRatio, MAX_ZOOM_STEP, zoomToSlider, sliderToZoom,
} from '../../app/src/main/assets/web/lib/photo-core.js';

// Hybrid landscape photo area on the frame: 1206.18 × 904.71 CSS px (1025 × 769 device px at DPR 0.85).
const BOX = { w: 1206.1764, h: 904.7059 };
const VIDEO = { width: 1920, height: 1080 };
const PORTRAIT_VIDEO = { width: 1080, height: 1920 };

test('a fitted video is centered with bars', () => {
  const r = mediaRect(VIDEO, 'fit', BOX.w, BOX.h);
  near(r.x, 0, 1e-6);
  near(r.w, BOX.w, 1e-6);
  near(r.h, (BOX.w * 1080) / 1920, 1e-6);
  near(r.y, (BOX.h - r.h) / 2, 1e-6);
  const p = mediaRect(PORTRAIT_VIDEO, 'fit', BOX.w, BOX.h);
  near(p.h, BOX.h, 1e-6);
  near(p.x, (BOX.w - p.w) / 2, 1e-6);
});

test('a filled video overflows and follows the fill position', () => {
  const r = mediaRect(VIDEO, 'fill', BOX.w, BOX.h);
  near(r.h, BOX.h, 1e-6);
  assert.ok(r.w > BOX.w);
  near(r.x, (BOX.w - r.w) / 2, 1e-6); // no face, no position: the middle
  const left = mediaRect({ ...VIDEO, crop: { x: 0 } }, 'fill', BOX.w, BOX.h);
  near(left.x, 0, 1e-6);
  const vis = visibleRect(r, BOX.w, BOX.h);
  assert.deepEqual([vis.x, vis.y], [0, 0]);
  near(vis.w, BOX.w, 1e-6);
  near(vis.h, BOX.h, 1e-6);
});

test('device rectangles round outward', () => {
  assert.deepEqual(deviceRect({ x: 0, y: 112.94, w: 1206.18, h: 678.47 }, 0.85), { x: 0, y: 95, w: 1026, h: 578 });
  assert.deepEqual(deviceRect({ x: 10, y: 10, w: 100, h: 100 }, 1), { x: 10, y: 10, w: 100, h: 100 });
});

test('the hole is an even-odd window in the layer', () => {
  const c = holeClipPath({ x: 0, y: 112.941, w: 1206.176, h: 678.47 });
  assert.ok(c.startsWith('polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, 0px 112.94px'), c);
  assert.ok(c.endsWith('0px 112.94px)'), c);
});

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

// A 4:3 landscape photo (display copy 2048×1536) and the Hybrid photo area / Pictures-only screens (CSS px).
const LANDSCAPE_PHOTO = { width: 2048, height: 1536 };
const PORTRAIT_PHOTO = { width: 1536, height: 2048 };

test('cropPosition centers, then clamps at the edges', () => {
  near(cropPosition(0.5, 0.5), 50);
  near(cropPosition(0, 0.5), 0);
  near(cropPosition(1, 0.5), 100);
  near(cropPosition(0.3, 0.5), 10);
  near(cropPosition(0.7, 1), 50);
});

test('fillCenter: per-photo position, else faces, else the middle, per axis', () => {
  assert.deepEqual(fillCenter({}), { x: 0.5, y: 0.5 });
  const face = [0.1, 0.2, 0.3, 0.4];
  const f = fillCenter({ face });
  near(f.x, 0.2); near(f.y, 0.3);
  const yOnly = fillCenter({ face, crop: { x: null, y: 0.9 } });
  near(yOnly.x, 0.2); near(yOnly.y, 0.9);
  assert.deepEqual(fillCenter({ crop: { x: 0, y: 1 } }), { x: 0, y: 1 });
});

test('fillLayout crops top/bottom in landscape and the sides in portrait', () => {
  const land = fillLayout({ ...LANDSCAPE_PHOTO, crop: { x: 0.1, y: 0.2 } }, 1608, 904);
  assert.equal(land.axis, 'y');
  near(land.visible, (4 / 3) / (1608 / 904));
  near(land.center, 0.2);
  assert.equal(land.px, 50);
  near(land.py, cropPosition(0.2, land.visible));

  const port = fillLayout({ ...LANDSCAPE_PHOTO, crop: { x: 0.1, y: 0.2 } }, 904, 1608);
  assert.equal(port.axis, 'x');
  near(port.center, 0.1);
  assert.equal(port.py, 50);

  const tall = fillLayout(PORTRAIT_PHOTO, 1608, 904);
  assert.equal(tall.axis, 'y');
});

test('fillLayout: an exact (or almost exact) fit has nothing to move', () => {
  const hybrid = fillLayout(LANDSCAPE_PHOTO, 1206, 904.5); // 4:3 Hybrid photo area
  assert.equal(hybrid.axis, null);
  assert.equal(fillLayout({ width: 1600, height: 900 }, 1608, 904).axis, null);
});

test('clampCenter keeps the center where the photo still covers the box', () => {
  near(clampCenter(0, 0.5), 0.25);
  near(clampCenter(1, 0.5), 0.75);
  near(clampCenter(0.6, 0.5), 0.6);
  near(clampCenter(0.1, 1), 0.5);
});

test('dragCenter: the photo follows the finger', () => {
  // Box 900 px tall, half the photo visible: the photo is drawn 1800 px tall.
  near(dragCenter(0.5, 180, 900, 0.5), 0.4); // drag down → see more of the top
  near(dragCenter(0.5, -180, 900, 0.5), 0.6);
  near(dragCenter(0.5, 10000, 900, 0.5), 0.25); // stops at the edge
  near(dragCenter(0.9, 0, 900, 0.5), 0.75); // an out-of-range start is clamped first
});

test('cropWith changes one axis and keeps the other', () => {
  assert.deepEqual(cropWith(null, 'y', 0.3), { x: null, y: 0.3 });
  assert.deepEqual(cropWith({ x: 0.2, y: null }, 'y', 0.333333), { x: 0.2, y: 0.3333 });
  assert.deepEqual(cropWith({ x: 0.2, y: 0.4 }, 'y', null), { x: 0.2, y: null });
  assert.equal(cropWith({ x: null, y: 0.4 }, 'y', null), null);
});

// ---- Zoom (SPEC §15, 2026-10-26): a per-photo view for each direction ----

test('zoom 0 is the whole photo, 1 is Fill, 2 is twice Fill', () => {
  const W = 1206, H = 904;
  const p = PORTRAIT_PHOTO;
  const fit = Math.min(W / p.width, H / p.height);
  const fill = Math.max(W / p.width, H / p.height);
  near(viewRect(p, { zoom: 0, x: 0.5, y: 0.5 }, W, H).h, p.height * fit, 1e-6);
  near(viewRect(p, { zoom: 1, x: 0.5, y: 0.5 }, W, H).w, W, 1e-6);
  near(viewRect(p, { zoom: 2, x: 0.5, y: 0.5 }, W, H).w, 2 * W, 1e-6);
  // Halfway between the two is between them, and scaleZoom finds the zoom again.
  const half = zoomScale(0.5, fit, fill);
  assert.ok(half > fit && half < fill);
  near(scaleZoom(half, fit, fill), 0.5, 1e-9);
  near(scaleZoom(zoomScale(1.7, fit, fill), fit, fill), 1.7, 1e-9);
  near(scaleZoom(fit / 2, fit, fill), 0, 1e-9); // pinching past the ends stops there
  near(scaleZoom(fill * 9, fit, fill), MAX_ZOOM, 1e-9);
});

test('below Fill the short side is centered with background around it', () => {
  const W = 1206, H = 904;
  const r = viewRect(PORTRAIT_PHOTO, { zoom: 0.5, x: 0.1, y: 0.5 }, W, H);
  assert.ok(r.w < W && r.h > H);
  near(r.x, (W - r.w) / 2, 1e-6); // x can't move the narrow side
  near(r.y, H / 2 - 0.5 * r.h, 1e-6);
});

test('a view never leaves a gap on a side the photo covers', () => {
  const W = 1206, H = 904;
  const r = viewRect(LANDSCAPE_PHOTO, { zoom: 2, x: 0, y: 1 }, W, H);
  near(r.x, 0, 1e-6);
  near(r.y + r.h, H, 1e-6);
  const v = clampView(LANDSCAPE_PHOTO, { zoom: 2, x: 0, y: 1 }, W, H);
  assert.ok(v.x > 0 && v.y < 1);
  near(viewRect(LANDSCAPE_PHOTO, v, W, H).x, 0, 1e-6); // clamping doesn't change what is shown
});

test('dragging moves the photo with the finger', () => {
  const W = 1206, H = 904;
  const v = { zoom: 2, x: 0.5, y: 0.5 };
  const before = viewRect(LANDSCAPE_PHOTO, v, W, H);
  const after = viewRect(LANDSCAPE_PHOTO, dragView(LANDSCAPE_PHOTO, v, 100, -50, W, H), W, H);
  near(after.x - before.x, 100, 1e-6);
  near(after.y - before.y, -50, 1e-6);
});

test('the look now becomes the starting view', () => {
  const W = 1206, H = 904;
  assert.deepEqual(viewFromLook(PORTRAIT_PHOTO, 'fit', W, H), { zoom: 0, x: 0.5, y: 0.5 });
  const fillLook = fillLayout({ ...PORTRAIT_PHOTO, crop: { x: null, y: 0.2 } }, W, H);
  const v = viewFromLook({ ...PORTRAIT_PHOTO, crop: { x: null, y: 0.2 } }, 'fill', W, H);
  assert.equal(v.zoom, 1);
  const r = viewRect(PORTRAIT_PHOTO, v, W, H);
  near(r.y, ((H - r.h) * fillLook.py) / 100, 1e-6); // same place as the slideshow's Fill
});

test('each direction has its own view; the transform draws the contained image at the view', () => {
  const s = { ...LANDSCAPE_PHOTO, view: { portrait: { zoom: 1.5, x: 0.4, y: 0.5 } } };
  assert.equal(viewFor(s, false), null);
  assert.equal(viewFor(s, true).zoom, 1.5);
  assert.equal(viewFor({ ...LANDSCAPE_PHOTO, view: null }, true), null);
  const W = 904, H = 1400;
  const rect = viewRect(s, viewFor(s, true), W, H);
  const t = viewTransform(s, rect, W, H);
  const [, tx, ty, k] = t.match(/translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([\d.]+)\)/).map(Number);
  const c = mediaRect(s, 'fit', W, H);
  near(c.x * k + tx, rect.x, 0.01);
  near(c.y * k + ty, rect.y, 0.01);
  near(c.w * k, rect.w, 0.05);
  assert.deepEqual(savedView({ zoom: 1.23456, x: 0.123456, y: 0.5 }), { zoom: 1.235, x: 0.1235, y: 0.5 });
  // mediaRect (videos) follows the view too.
  assert.deepEqual(mediaRect(s, 'fill', W, H, viewFor(s, true)), rect);
});

test('pinching keeps the spot between the fingers under them', () => {
  const W = 1206, H = 904;
  const start = { zoom: 1, x: 0.5, y: 0.5 };
  const mid = { x: 400, y: 300 };
  const r0 = viewRect(PORTRAIT_PHOTO, start, W, H);
  const spot = { x: (mid.x - r0.x) / r0.w, y: (mid.y - r0.y) / r0.h };
  const v = pinchView(PORTRAIT_PHOTO, start, mid, mid, 1.5, W, H);
  const r = viewRect(PORTRAIT_PHOTO, v, W, H);
  near(r.w, r0.w * 1.5, 1e-6);
  near(r.x + spot.x * r.w, mid.x, 1e-6);
  near(r.y + spot.y * r.h, mid.y, 1e-6);
  // Both fingers moving 50 px right moves the photo with them.
  const moved = viewRect(PORTRAIT_PHOTO, pinchView(PORTRAIT_PHOTO, start, mid, { x: 450, y: 300 }, 1.5, W, H), W, H);
  near(moved.x - r.x, 50, 1e-6);
  // Pinching in past the whole photo stops there, centered.
  assert.deepEqual(pinchView(PORTRAIT_PHOTO, start, mid, mid, 0.1, W, H), { zoom: 0, x: 0.5, y: 0.5 });
});

test('the shown view glides to the target, no faster than the size limit, and then lands on it', () => {
  const scales = { fit: 0.5, fill: 0.9 }; // a portrait photo on the landscape screen
  let shown = { zoom: 0, x: 0.5, y: 0.5 };
  const target = { zoom: 1, x: 0.4, y: 0.6 };
  shown = easeView(shown, target, scales);
  near(zoomToSlider(shown.zoom, scales.fit, scales.fill), MAX_ZOOM_STEP, 1e-9); // a big jump is rate-limited
  const full = zoomToSlider(1, scales.fit, scales.fill);
  near(shown.x, 0.5 - 0.1 * (MAX_ZOOM_STEP / full), 1e-9); // the position moves in step with the size
  for (let i = 0; i < 200; i++) shown = easeView(shown, target, scales);
  assert.deepEqual(shown, target);
});

test('the slider goes in even steps of size: a photo with its box shape gets it all for zooming', () => {
  // Portrait photo on the landscape screen: Whole photo → Fill is a real change, about half the slider.
  const fit = 0.5, fill = 0.9;
  near(zoomToSlider(0, fit, fill), 0, 1e-12);
  near(zoomToSlider(MAX_ZOOM, fit, fill), 1, 1e-12);
  near(zoomToSlider(1, fit, fill), Math.log(fill / fit) / Math.log((2 * fill) / fit), 1e-12);
  for (const z of [0, 0.3, 1, 1.4, 2]) near(sliderToZoom(zoomToSlider(z, fit, fill), fit, fill), z, 1e-9);
  // Almost its box's shape: Fill is right at the start; halfway along the slider is well past Fill.
  const f2 = 0.6, fl2 = 0.62;
  assert.ok(zoomToSlider(1, f2, fl2) < 0.06);
  assert.ok(sliderToZoom(0.5, f2, fl2) > 1.4);
  // Exactly its shape: the start of the slider is Fill.
  near(zoomToSlider(1, 0.6, 0.6), 0, 1e-12);
  near(sliderToZoom(0, 0.6, 0.6), 1, 1e-12);
});

test('fingers that start close together zoom against a 250 px reference', () => {
  near(pinchRatio(86, 95), (250 + 9) / 250, 1e-9);
  near(pinchRatio(400, 600), 1.5, 1e-9); // far apart: the plain ratio
  near(pinchRatio(100, 350), 2, 1e-9);
  near(pinchRatio(300, 0), 0.05, 1e-9); // never zero or negative
});
