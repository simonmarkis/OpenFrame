// Fill crop and zoom math (SPEC §6, §15), shared by the slideshow, the position editor, and the Node tests.
// A photo filling a box is cropped along one axis only: a wider photo loses its sides ('x'), a
// taller one its top and bottom ('y'). The kept part is centered on the photo's per-photo position
// (`crop`, set in the position editor), else on detected faces, else on the middle.

/** Below this much cropping (as a fraction of the photo), a fill counts as an exact fit. */
const EXACT = 0.995;

/** object-position (percent) that puts `center` (0..1) mid-box when only `visible` (0..1) fits. */
export function cropPosition(center, visible) {
  if (visible >= 1) return 50;
  const start = Math.min(Math.max(center - visible / 2, 0), 1 - visible);
  return (start / (1 - visible)) * 100;
}

/** The point of the photo (0..1 per axis) to keep in the middle when it fills a box. */
export function fillCenter(slide) {
  const f = slide.face;
  const c = slide.crop || {};
  const auto = (a, b) => (f ? (f[a] + f[b]) / 2 : 0.5);
  return {
    x: c.x != null ? c.x : auto(0, 2),
    y: c.y != null ? c.y : auto(1, 3),
  };
}

/**
 * How `slide` (display width/height) fills a boxW × boxH box: the cropped axis ('x', 'y', or null
 * when it fits exactly), the fraction of that axis that stays visible, and the object-position.
 */
export function fillLayout(slide, boxW, boxH) {
  const imgAR = slide.width / slide.height;
  const boxAR = boxW / boxH;
  const center = fillCenter(slide);
  if (imgAR > boxAR && boxAR / imgAR < EXACT) {
    const visible = boxAR / imgAR;
    return { axis: 'x', visible, center: center.x, px: cropPosition(center.x, visible), py: 50 };
  }
  if (imgAR < boxAR && imgAR / boxAR < EXACT) {
    const visible = imgAR / boxAR;
    return { axis: 'y', visible, center: center.y, px: 50, py: cropPosition(center.y, visible) };
  }
  return { axis: null, visible: 1, center: 0.5, px: 50, py: 50 };
}

/** Nearest center that cropPosition shows unclamped (so a saved position means what it shows). */
export function clampCenter(center, visible) {
  if (visible >= 1) return 0.5;
  return Math.min(Math.max(center, visible / 2), 1 - visible / 2);
}

/**
 * Dragging the photo by `deltaPx` along the cropped axis of a box `boxPx` long: the photo moves
 * with the finger, so the kept center moves the other way by deltaPx of the photo's drawn length.
 */
export function dragCenter(startCenter, deltaPx, boxPx, visible) {
  const drawnPx = boxPx / visible;
  return clampCenter(clampCenter(startCenter, visible) - deltaPx / drawnPx, visible);
}

/** The `crop` to save after positioning `axis`: the other axis keeps its own setting. */
export function cropWith(crop, axis, center) {
  const next = { x: crop && crop.x != null ? crop.x : null, y: crop && crop.y != null ? crop.y : null };
  next[axis] = center == null ? null : Math.round(center * 10000) / 10000;
  return next.x == null && next.y == null ? null : next;
}

// ---- Zoom (SPEC §15, 2026-10-26): a per-photo view for each direction of the frame ----
// slide.view = { landscape: { zoom, x, y } | null, portrait: ... }: zoom 0 = the whole photo (Fit), 1 = Fill,
// 2 = twice Fill; x, y = the point of the photo (0..1) kept in the middle of its box.

export const MAX_ZOOM = 2;

/** This direction's saved view of `slide`, or null (then fit and crop decide, as before). */
export function viewFor(slide, portrait) {
  const v = slide && slide.view && slide.view[portrait ? 'portrait' : 'landscape'];
  return v && typeof v.zoom === 'number' ? v : null;
}

/** Scales (box px per photo px) of Fit and Fill. */
export function fitFillOf(slide, boxW, boxH) {
  const a = boxW / slide.width;
  const b = boxH / slide.height;
  return { fit: Math.min(a, b), fill: Math.max(a, b) };
}

/** The scale for `zoom`: even steps from Fit to Fill, then from Fill to twice Fill. */
export function zoomScale(zoom, fit, fill) {
  const z = Math.min(Math.max(zoom, 0), MAX_ZOOM);
  return z <= 1 ? fit * (fill / fit) ** z : fill * 2 ** (z - 1);
}

/** The zoom that draws at `scale` (for pinching), within 0..MAX_ZOOM. */
export function scaleZoom(scale, fit, fill) {
  let z;
  if (scale <= fill) z = fill / fit > 1.0001 ? Math.log(scale / fit) / Math.log(fill / fit) : 1;
  else z = 1 + Math.log2(scale / fill);
  return Math.min(Math.max(z, 0), MAX_ZOOM);
}

/** One axis: where a photo `drawn` long starts in a box `box` long, keeping `center` mid-box but never leaving a gap. */
function place(center, drawn, box) {
  if (drawn <= box) return (box - drawn) / 2;
  return Math.min(Math.max(box / 2 - center * drawn, box - drawn), 0);
}

/** Where `slide` is drawn with `view` in a boxW × boxH box: { x, y, w, h }, may overflow the box. */
export function viewRect(slide, view, boxW, boxH) {
  const { fit, fill } = fitFillOf(slide, boxW, boxH);
  const s = zoomScale(view.zoom, fit, fill);
  const w = slide.width * s;
  const h = slide.height * s;
  return { x: place(view.x, w, boxW), y: place(view.y, h, boxH), w, h };
}

/** The view that shows `slide` as it looks now with `fit` ('fit' | 'fill') and its crop or faces. */
export function viewFromLook(slide, fit, boxW, boxH) {
  if (fit !== 'fill') return { zoom: 0, x: 0.5, y: 0.5 };
  const c = fillCenter(slide);
  return clampView(slide, { zoom: 1, x: c.x, y: c.y }, boxW, boxH);
}

/** `view` with its center moved to where it can be shown (a centered axis stays at 0.5). */
export function clampView(slide, view, boxW, boxH) {
  const r = viewRect(slide, view, boxW, boxH);
  return { zoom: view.zoom, x: clampCenter(view.x, Math.min(boxW / r.w, 1)), y: clampCenter(view.y, Math.min(boxH / r.h, 1)) };
}

/** Dragging by dx, dy box px: the photo follows the finger, so the kept center moves the other way. */
export function dragView(slide, view, dx, dy, boxW, boxH) {
  const r = viewRect(slide, view, boxW, boxH);
  return clampView(slide, { zoom: view.zoom, x: view.x - dx / r.w, y: view.y - dy / r.h }, boxW, boxH);
}

/**
 * Pinching: the point of the photo that was between the fingers at the start (`startMid`, box px) stays
 * between them (`mid`), at the start scale times `ratio` (finger spread now / at the start).
 */
export function pinchView(slide, startView, startMid, mid, ratio, boxW, boxH) {
  const { fit, fill } = fitFillOf(slide, boxW, boxH);
  const r0 = viewRect(slide, startView, boxW, boxH);
  const zoom = scaleZoom((r0.w / slide.width) * ratio, fit, fill);
  const s = zoomScale(zoom, fit, fill);
  const w = slide.width * s;
  const h = slide.height * s;
  // The photo point under the start midpoint, then where the photo must start so it is under `mid` now.
  const px = (startMid.x - r0.x) / r0.w;
  const py = (startMid.y - r0.y) / r0.h;
  const x = mid.x - px * w;
  const y = mid.y - py * h;
  return clampView(slide, { zoom, x: (boxW / 2 - x) / w, y: (boxH / 2 - y) / h }, boxW, boxH);
}

/**
 * The finger-spread ratio for a pinch that started `startPx` apart and is `nowPx` apart: the change counts
 * against at least `refPx`, so fingers that start close together don't zoom in big steps (the frame's touch
 * screen reports them in jumps, 2026-10-26).
 */
export function pinchRatio(startPx, nowPx, refPx = 250) {
  const ref = Math.max(startPx, refPx);
  return Math.max((ref + nowPx - startPx) / ref, 0.05);
}

/**
 * The Position slider (0..1) for `zoom`: even steps in the photo's size from the whole photo to 2× Fill, so a
 * photo that nearly has its box's shape (Whole photo ≈ Fill) gets the whole slider for real zooming
 * (user 2026-10-26: the Whole photo → Fill half changed nothing for such photos).
 */
export function zoomToSlider(zoom, fit, fill) {
  const top = Math.log(zoomScale(MAX_ZOOM, fit, fill) / fit);
  return top > 0 ? Math.log(zoomScale(zoom, fit, fill) / fit) / top : 0;
}

/** The zoom at slider position `p` (0..1). */
export function sliderToZoom(p, fit, fill) {
  const top = Math.log(zoomScale(MAX_ZOOM, fit, fill) / fit);
  return scaleZoom(fit * Math.exp(Math.min(Math.max(p, 0), 1) * top), fit, fill);
}

/** Slider span a frame may move at most: Whole photo to 2× Fill in ~0.8 s at 60 frames a second. */
export const MAX_ZOOM_STEP = 0.02;

/**
 * One animation frame of easing `shown` toward `target` (the touch screen reports a finger only ~20 times a
 * second, and sometimes not for most of a second): a fraction `k` of the way, but the size no faster than
 * [MAX_ZOOM_STEP] of the slider, so a late jump of the fingers becomes a glide. `scales`: fitFillOf the box.
 */
export function easeView(shown, target, scales, k = 0.35) {
  const { fit, fill } = scales;
  const ps = zoomToSlider(shown.zoom, fit, fill);
  const dp = zoomToSlider(target.zoom, fit, fill) - ps;
  const near = Math.abs(dp) < 0.001 && Math.abs(shown.x - target.x) < 0.0005 && Math.abs(shown.y - target.y) < 0.0005;
  if (near) return { ...target };
  const f = Math.abs(dp) * k > MAX_ZOOM_STEP ? MAX_ZOOM_STEP / Math.abs(dp) : k;
  return {
    zoom: sliderToZoom(ps + dp * f, fit, fill),
    x: shown.x + (target.x - shown.x) * f,
    y: shown.y + (target.y - shown.y) * f,
  };
}

/** A view as saved: rounded, so the same look always saves the same numbers. */
export function savedView(view) {
  const r = (v, n) => Math.round(v * n) / n;
  return { zoom: r(view.zoom, 1000), x: r(view.x, 10000), y: r(view.y, 10000) };
}

/**
 * CSS transform for an <img> filling the box with object-fit contain, so that it is drawn at `rect`
 * (transform-origin 0 0). The element keeps its size; the box clips what overflows.
 */
export function viewTransform(slide, rect, boxW, boxH) {
  const c = mediaRect(slide, 'fit', boxW, boxH);
  const k = rect.w / c.w;
  const tx = rect.x - c.x * k;
  const ty = rect.y - c.y * k;
  return `translate(${tx.toFixed(2)}px, ${ty.toFixed(2)}px) scale(${k.toFixed(5)})`;
}

// ---- Videos (SPEC §6): the native player sits behind the page, so the page needs the picture's rectangle ----

/**
 * Where `slide` is drawn in a boxW × boxH box, like an <img> with object-fit contain (fit) or cover
 * (fill, positioned by fillLayout), or with its saved `view` (zoom): { x, y, w, h } relative to the box;
 * may overflow it when filling or zoomed in.
 */
export function mediaRect(slide, fit, boxW, boxH, view = null) {
  if (!slide.width || !slide.height || !boxW || !boxH) return { x: 0, y: 0, w: boxW, h: boxH };
  if (view) return viewRect(slide, view, boxW, boxH);
  const fill = fit === 'fill';
  const s = fill ? Math.max(boxW / slide.width, boxH / slide.height) : Math.min(boxW / slide.width, boxH / slide.height);
  const w = slide.width * s;
  const h = slide.height * s;
  const { px, py } = fill ? fillLayout(slide, boxW, boxH) : { px: 50, py: 50 };
  return { x: ((boxW - w) * px) / 100, y: ((boxH - h) * py) / 100, w, h };
}

/** The part of `r` inside the box. */
export function visibleRect(r, boxW, boxH) {
  const x0 = Math.max(0, r.x);
  const y0 = Math.max(0, r.y);
  const x1 = Math.min(boxW, r.x + r.w);
  const y1 = Math.min(boxH, r.y + r.h);
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
}

/** CSS clip-path that keeps everything but `hole` (px, relative to the element): the box with a window. */
export function holeClipPath(hole) {
  const p = (x, y) => `${+x.toFixed(2)}px ${+y.toFixed(2)}px`;
  const { x, y, w, h } = hole;
  return `polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${p(x, y)}, ${p(x + w, y)}, ${p(x + w, y + h)}, ${p(x, y + h)}, ${p(x, y)})`;
}

/** A CSS-px rectangle on the page → the window's device pixels, rounded outward (the hole never shows past the video). */
export function deviceRect(r, dpr) {
  const x0 = Math.floor(r.x * dpr);
  const y0 = Math.floor(r.y * dpr);
  return { x: x0, y: y0, w: Math.ceil((r.x + r.w) * dpr) - x0, h: Math.ceil((r.y + r.h) * dpr) - y0 };
}
