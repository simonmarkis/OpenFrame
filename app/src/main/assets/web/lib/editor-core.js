// Layout editor math (SPEC §14, Phase 13c): moving and resizing grid widgets with snapping and without
// overlaps, minimum sizes, adding and removing widgets, corner overlays. Pure functions on one custom
// arrangement ({ cols, rows, widgets }); shared by the editor and the Node tests (tests/layout/).
// Every function returns a new arrangement (or null when the change can't be made) and never mutates.

import { GRID, CORNERS, MAX_WIDGETS, MAX_DAYS, DAY_MIN_PX } from './layout-core.js';

export const WIDGET_LABELS = {
  photo: 'Photo',
  clock_weather: 'Clock and weather',
  caption: 'Photo caption',
  calendar_day: 'Day panel',
  calendar_full: 'Full calendar',
  calendar_icon: 'Calendar button',
  status: 'Warning icons',
};

// Smallest box per widget in CSS px of the frame, turned into cells for the orientation.
const MIN_PX = {
  photo: [320, 240],
  calendar_day: [240, 300],
  calendar_full: [760, 500],
  clock_weather: [220, 130], // as a panel
};
// Size a new widget asks for, as a fraction of the screen (shrunk to what fits, never below the minimum).
const NEW_FRACTION = {
  photo: [0.5, 0.5],
  calendar_day: [0.25, 0.5],
  calendar_full: [1, 1],
  clock_weather: [0.25, 0.2],
};
// Widgets that can be added (status icons are always there; one photo, caption, full calendar, calendar button).
export const ADDABLE = ['photo', 'clock_weather', 'caption', 'calendar_day', 'calendar_full', 'calendar_icon'];
const SINGLE = new Set(['photo', 'caption', 'calendar_full', 'calendar_icon', 'status']);
const ALWAYS_CORNER = new Set(['caption', 'calendar_icon', 'status']);

/** Cell size in CSS px for a viewport { w, h } (the frame: 1608×904 or 904×1608). */
export function cellSize(viewport) {
  return { w: viewport.w / GRID.cols, h: viewport.h / GRID.rows };
}

/** Minimum { w, h } in cells for a grid widget in this viewport. */
export function minCells(type, viewport) {
  const px = MIN_PX[type] || [100, 100];
  const c = cellSize(viewport);
  return { w: Math.min(GRID.cols, Math.ceil(px[0] / c.w - 1e-9)), h: Math.min(GRID.rows, Math.ceil(px[1] / c.h - 1e-9)) };
}

const isGrid = (w) => !w.anchor;
const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Whether `box` ({ x, y, w, h }) fits the grid without covering another grid widget (except `ignoreId`). */
export function boxFits(arr, box, ignoreId) {
  if (box.x < 0 || box.y < 0 || box.w < 1 || box.h < 1 || box.x + box.w > arr.cols || box.y + box.h > arr.rows) return false;
  return !arr.widgets.some((o) => o.id !== ignoreId && isGrid(o) && overlaps(box, o));
}

function withBox(arr, id, box) {
  return { cols: arr.cols, rows: arr.rows, widgets: arr.widgets.map((w) => (w.id === id ? { ...w, ...box } : w)) };
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * Moves grid widget `id` from its box `start` by (dx, dy) cells, snapped and kept on the grid. When the
 * spot is taken it slides along one axis instead; when nothing fits it stays at `fallback` (the last good box).
 */
export function moveWidget(arr, id, start, dx, dy, fallback = start) {
  const x = clamp(start.x + Math.round(dx), 0, arr.cols - start.w);
  const y = clamp(start.y + Math.round(dy), 0, arr.rows - start.h);
  for (const box of [{ ...start, x, y }, { ...start, x, y: fallback.y }, { ...start, x: fallback.x, y }]) {
    if (boxFits(arr, box, id)) return withBox(arr, id, box);
  }
  return withBox(arr, id, fallback);
}

/**
 * Resizes grid widget `id` by dragging one corner (`nw`, `ne`, `sw`, `se`) by (dx, dy) cells from `start`,
 * keeping the opposite corner, the minimum size `min` ({ w, h }), and the grid. Overlaps fall back per axis.
 */
export function resizeWidget(arr, id, start, handle, dx, dy, min, fallback = start) {
  const left = handle.includes('w');
  const top = handle.includes('n');
  const r = start.x + start.w;
  const b = start.y + start.h;
  const x1 = left ? clamp(start.x + Math.round(dx), 0, r - min.w) : start.x;
  const x2 = left ? r : clamp(r + Math.round(dx), start.x + min.w, arr.cols);
  const y1 = top ? clamp(start.y + Math.round(dy), 0, b - min.h) : start.y;
  const y2 = top ? b : clamp(b + Math.round(dy), start.y + min.h, arr.rows);
  const box = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  const xOnly = { x: x1, w: x2 - x1, y: fallback.y, h: fallback.h };
  const yOnly = { x: fallback.x, w: fallback.w, y: y1, h: y2 - y1 };
  for (const c of [box, xOnly, yOnly]) if (boxFits(arr, c, id)) return withBox(arr, id, c);
  return withBox(arr, id, fallback);
}

/** The first free spot (top to bottom, left to right) for a w × h box, or null. */
export function findFreeBox(arr, w, h) {
  for (let y = 0; y + h <= arr.rows; y++) {
    for (let x = 0; x + w <= arr.cols; x++) {
      if (boxFits(arr, { x, y, w, h })) return { x, y, w, h };
    }
  }
  return null;
}

/** Why `type` can't be added here (null = it can). */
export function cannotAdd(arr, type, viewport) {
  if (!ADDABLE.includes(type)) return 'Not a widget that can be added';
  if (arr.widgets.length >= MAX_WIDGETS) return `A page holds up to ${MAX_WIDGETS} widgets`;
  if (SINGLE.has(type) && arr.widgets.some((w) => w.type === type)) return 'Already on this page';
  if (ALWAYS_CORNER.has(type)) return null;
  if (type === 'clock_weather' && arr.widgets.some((w) => w.type === 'photo')) return null; // as an overlay on the photo
  const m = minCells(type, viewport);
  return findFreeBox(arr, m.w, m.h) ? null : 'No room: make another widget smaller first';
}

function newId(arr, type) {
  const base = { clock_weather: 'clock', calendar_day: 'calendar', calendar_full: 'fullcal', calendar_icon: 'calicon' }[type] || type;
  if (!arr.widgets.some((w) => w.id === base)) return base;
  for (let i = 2; ; i++) if (!arr.widgets.some((w) => w.id === `${base}${i}`)) return `${base}${i}`;
}

/**
 * Adds a widget: corner widgets (and a clock when there is a photo) in a free corner over the photo
 * (else the screen); grid widgets at the biggest of their wanted size or minimum that fits.
 * Returns { arr, id } or null (see cannotAdd).
 */
export function addWidget(arr, type, viewport) {
  if (cannotAdd(arr, type, viewport)) return null;
  const id = newId(arr, type);
  const photo = arr.widgets.find((w) => w.type === 'photo' && isGrid(w));
  let widget;
  if (ALWAYS_CORNER.has(type) || (type === 'clock_weather' && photo)) {
    const over = photo ? { over: photo.id } : {};
    const used = new Set(arr.widgets.filter((w) => w.anchor && (w.anchor.over || '') === (over.over || '')).map((w) => w.anchor.corner));
    const prefer = { caption: 'bottom-left', calendar_icon: 'bottom-left', status: 'bottom-left', clock_weather: 'top-right' }[type];
    const corner = [prefer, ...CORNERS].find((c) => !used.has(c)) || prefer;
    widget = { id, type, anchor: { corner, ...over } };
    if (type === 'clock_weather') widget.style = 'overlay';
  } else {
    const m = minCells(type, viewport);
    const f = NEW_FRACTION[type];
    const want = { w: Math.max(m.w, Math.round(f[0] * arr.cols)), h: Math.max(m.h, Math.round(f[1] * arr.rows)) };
    let box = null;
    // Shrink from the wanted size toward the minimum until a spot is free.
    for (let w = want.w; !box && w >= m.w; w--) {
      for (let h = want.h; !box && h >= m.h; h--) box = findFreeBox(arr, w, h);
    }
    if (!box) return null;
    widget = { id, type, ...box };
    if (type === 'clock_weather') widget.style = 'panel';
    if (type === 'calendar_day') widget.days = 1;
  }
  return { arr: { cols: arr.cols, rows: arr.rows, widgets: [...arr.widgets, widget] }, id };
}

/** Removes a widget (never the status icons); overlays that sat over it move to the screen. */
export function removeWidget(arr, id) {
  const w = arr.widgets.find((x) => x.id === id);
  if (!w || w.type === 'status') return null;
  const widgets = arr.widgets.filter((x) => x.id !== id).map((x) => {
    if (!x.anchor || x.anchor.over !== id) return x;
    const { over, ...anchor } = x.anchor;
    return { ...x, anchor };
  });
  return { cols: arr.cols, rows: arr.rows, widgets };
}

/** Puts a corner widget in `corner` of grid widget `over` (or the screen when over is null). */
export function placeInCorner(arr, id, corner, over) {
  if (!CORNERS.includes(corner)) return null;
  if (over && !arr.widgets.some((w) => w.id === over && isGrid(w))) return null;
  return {
    cols: arr.cols, rows: arr.rows,
    widgets: arr.widgets.map((w) => (w.id === id && w.anchor ? { ...w, anchor: { corner, ...(over ? { over } : {}) } } : w)),
  };
}

/**
 * Which corner of which box a point (fractions 0..1 of the screen) is nearest: inside a photo → that
 * photo's corners, else the screen's. Returns { corner, over }.
 */
export function cornerAt(arr, fx, fy) {
  const photo = arr.widgets.find((w) => w.type === 'photo' && isGrid(w) &&
    fx >= w.x / arr.cols && fx <= (w.x + w.w) / arr.cols && fy >= w.y / arr.rows && fy <= (w.y + w.h) / arr.rows);
  const box = photo ? { l: photo.x / arr.cols, t: photo.y / arr.rows, w: photo.w / arr.cols, h: photo.h / arr.rows } : { l: 0, t: 0, w: 1, h: 1 };
  const right = fx > box.l + box.w / 2;
  const bottom = fy > box.t + box.h / 2;
  return { corner: `${bottom ? 'bottom' : 'top'}-${right ? 'right' : 'left'}`, over: photo ? photo.id : null };
}

/**
 * Clock as a panel on the grid ↔ an overlay in a corner. To a panel needs a free spot of its minimum
 * size; returns null when there is none.
 */
export function toggleClockStyle(arr, id, viewport) {
  const w = arr.widgets.find((x) => x.id === id && x.type === 'clock_weather');
  if (!w) return null;
  if (w.anchor) {
    const m = minCells('clock_weather', viewport);
    const rest = { cols: arr.cols, rows: arr.rows, widgets: arr.widgets.filter((x) => x.id !== id) };
    const box = findFreeBox(rest, m.w, m.h);
    if (!box) return null;
    return { cols: arr.cols, rows: arr.rows, widgets: arr.widgets.map((x) => (x.id === id ? { id, type: x.type, style: 'panel', ...box } : x)) };
  }
  const photo = arr.widgets.find((x) => x.type === 'photo' && isGrid(x));
  return {
    cols: arr.cols, rows: arr.rows,
    widgets: arr.widgets.map((x) => (x.id === id
      ? { id, type: x.type, style: 'overlay', anchor: { corner: 'top-right', ...(photo ? { over: photo.id } : {}) } } : x)),
  };
}

/** Sets a day panel's number of days (1–MAX_DAYS). */
export function setDays(arr, id, days) {
  if (!(Number.isInteger(days) && days >= 1 && days <= MAX_DAYS)) return null;
  return { cols: arr.cols, rows: arr.rows, widgets: arr.widgets.map((w) => (w.id === id && w.type === 'calendar_day' ? { ...w, days } : w)) };
}

/** How many days a day panel `w` cells wide shows at most in this viewport (DAY_MIN_PX each). */
export function daysThatFit(w, viewport) {
  return Math.max(1, Math.min(MAX_DAYS, Math.floor((w * viewport.w) / GRID.cols / DAY_MIN_PX)));
}

/** Ids of grid widgets smaller than their minimum size in this viewport (shown as a hint in the editor). */
export function belowMinimum(arr, viewport) {
  return arr.widgets.filter((w) => isGrid(w) && MIN_PX[w.type]).filter((w) => {
    const m = minCells(w.type, viewport);
    return w.w < m.w || w.h < m.h;
  }).map((w) => w.id);
}
