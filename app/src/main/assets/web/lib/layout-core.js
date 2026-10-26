// Layout model (SPEC §14): pages → per-orientation arrangements; the presets are built-in pages.
// Pure functions shared by the renderer and the Node tests (tests/layout/).
//
// A widget either occupies grid cells ({ x, y, w, h } on the arrangement's cols × rows) or is an
// anchored overlay ({ anchor: { corner, over? } }) sized by its content: `over` names the grid widget
// whose box it sits in (default: the whole page). How overlays sharing a corner make room for each
// other is worked out by `resolveArrangement`, never stored: `lift` raises one to clear the calendar
// icon (or the status icons), `beside` moves the status icons next to the calendar icon, `statusLift`
// raises one only while the status icons below it are showing (the renderer toggles that).

import { captionFreeCorner } from './caption-core.js';

export const PRESETS = ['hybrid', 'pictures', 'calendar'];
export const PRESET_NAMES = { hybrid: 'Hybrid', pictures: 'Pictures only', calendar: 'Calendar' };
export const CORNERS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
export const WIDGET_TYPES = ['photo', 'clock_weather', 'caption', 'calendar_day', 'calendar_full', 'calendar_icon', 'status'];
/** Custom pages always use this grid (the presets' 12 × 12 arrangements are doubled when copied). */
export const GRID = { cols: 12, rows: 24 };
export const MAX_PAGES = 8;
export const MAX_WIDGETS = 16;
export const MAX_DAYS = 5; // days a day panel can show
export const DAY_MIN_PX = 160; // narrowest day column (CSS px): a narrower panel shows fewer days
export const PAGE_ID = /^[a-z0-9][a-z0-9-]{0,23}$/;
export const WIDGET_ID = /^[a-z0-9][a-z0-9_-]{0,23}$/;
export const MAX_NAME = 40;
/** Hybrid landscape: the clock panel's height (rows of 24) for each clock size (user decision 2026-10-16). */
export const PANEL_ROWS = { small: 4, medium: 5, large: 6 };
// Widgets that are always overlays, always grid boxes, or one per page.
const ANCHORED = new Set(['caption', 'calendar_icon', 'status']);
const GRIDDED = new Set(['photo', 'calendar_day', 'calendar_full']);
const SINGLE = new Set(['photo', 'caption', 'status', 'calendar_full', 'calendar_icon']);

/**
 * A preset's arrangements as stored (overlays carry only corner and `over`), before
 * `resolveArrangement`. Custom pages copied from a preset start from this.
 * @param {string} preset hybrid | pictures | calendar (unknown → hybrid)
 * @param {{ corner?: string, clockVisible?: boolean, caption?: { visible: boolean, corner: string },
 *           size?: string, hybridCalendar?: { landscape: string, portrait: string } }} opts
 *   corner/clockVisible/size from config.clock; caption from config.caption (absent = no caption);
 *   hybridCalendar from config.layout (Hybrid: calendar left/right in landscape, top/bottom in portrait)
 */
export function presetArrangements(preset, opts = {}) {
  const corner = CORNERS.includes(opts.corner) ? opts.corner : 'top-right';
  const clock = opts.clockVisible !== false;
  const cap = opts.caption && opts.caption.visible ? opts.caption : null;
  // Photo caption (SPEC §8): its own corner (moved aside from the clock overlay when resolved).
  const caption = (over) => (cap
    ? [{ id: 'caption', type: 'caption', anchor: { corner: CORNERS.includes(cap.corner) ? cap.corner : 'bottom-left', ...over } }]
    : []);
  const photo = (x, y, w, h) => ({ id: 'photo', type: 'photo', x, y, w, h });
  // Offline/warning icons (SPEC §13): bottom-left (user decision), beside the calendar icon in Pictures-only.
  const status = (over) => ({ id: 'status', type: 'status', anchor: { corner: 'bottom-left', ...over } });
  const onPhoto = { over: 'photo' };

  switch (PRESETS.includes(preset) ? preset : 'hybrid') {
    case 'pictures': {
      const icon = { id: 'calicon', type: 'calendar_icon', anchor: { corner: 'bottom-left' } };
      const overlay = { id: 'clock', type: 'clock_weather', style: 'overlay', anchor: { corner } };
      const widgets = [photo(0, 0, 12, 12), ...(clock ? [overlay] : []), ...caption({}), icon, status({})];
      return { preset: 'pictures', landscape: { cols: 12, rows: 12, widgets }, portrait: { cols: 12, rows: 12, widgets } };
    }
    case 'calendar': {
      const full = () => [{ id: 'calendar', type: 'calendar_full', x: 0, y: 0, w: 12, h: 12 }, status({})];
      return { preset: 'calendar', landscape: { cols: 12, rows: 12, widgets: full() }, portrait: { cols: 12, rows: 12, widgets: full() } };
    }
    default: {
      // Landscape: photo 9/12 (1024×768 device px, 4:3) + a side column (right, or left: user choice
      // 2026-10-16): clock panel over the day panel. The clock size sets the panel's height.
      const side = opts.hybridCalendar || {};
      const colX = side.landscape === 'left' ? 0 : 9;
      const photoX = side.landscape === 'left' ? 3 : 0;
      const panelH = PANEL_ROWS[opts.size] || PANEL_ROWS.medium;
      const land = clock
        ? [photo(photoX, 0, 9, 24),
           { id: 'clock', type: 'clock_weather', style: 'panel', x: colX, y: 0, w: 3, h: panelH },
           { id: 'calendar', type: 'calendar_day', x: colX, y: panelH, w: 3, h: 24 - panelH, days: 1 }, ...caption(onPhoto), status(onPhoto)]
        : [photo(photoX, 0, 9, 24),
           { id: 'calendar', type: 'calendar_day', x: colX, y: 0, w: 3, h: 24, days: 1 }, ...caption(onPhoto), status(onPhoto)];
      // Portrait: photo 3/4 of the height (768×1024 device px: exactly 3:4, so 3:4 photos fill it;
      // user request 2026-10-14), clock overlaid on the photo, 2-day panel below (or above: user choice).
      const top = side.portrait === 'top';
      const port = [photo(0, top ? 6 : 0, 12, 18),
        ...(clock ? [{ id: 'clock', type: 'clock_weather', style: 'overlay', anchor: { corner, ...onPhoto } }] : []),
        { id: 'calendar', type: 'calendar_day', x: 0, y: top ? 0 : 18, w: 12, h: 6, days: 2 }, ...caption(onPhoto), status(onPhoto)];
      return { preset: 'hybrid', landscape: { cols: 12, rows: 24, widgets: land }, portrait: { cols: 12, rows: 24, widgets: port } };
    }
  }
}

/** A preset as the renderer shows it (both arrangements resolved). Same options as presetArrangements. */
export function presetPage(preset, opts = {}) {
  const p = presetArrangements(preset, opts);
  return { id: 'home', preset: p.preset, landscape: resolveArrangement(p.landscape), portrait: resolveArrangement(p.portrait) };
}

/**
 * Works out how overlays sharing a corner of the same box make room (see the header), and moves the
 * caption to the other side when a clock overlay sits in its corner. Returns a new arrangement; any
 * stored lift/beside/statusLift is ignored.
 */
export function resolveArrangement(arr) {
  const box = (w) => w.anchor.over || '';
  const at = (type, b, corner) => arr.widgets.some((o) => o.type === type && o.anchor && box(o) === b && o.anchor.corner === corner);
  const clockIn = (b, corner) => arr.widgets.some((o) => o.type === 'clock_weather' && o.anchor && box(o) === b && o.anchor.corner === corner);
  const widgets = arr.widgets.map((w) => {
    if (!w.anchor) return { ...w };
    const b = box(w);
    let corner = w.anchor.corner;
    // Away from the clocks: the other side, else the other edge (captionFreeCorner).
    if (w.type === 'caption') corner = captionFreeCorner(corner, (c) => clockIn(b, c));
    const anchor = { corner, ...(w.anchor.over ? { over: w.anchor.over } : {}) };
    const icon = at('calendar_icon', b, corner);
    const status = at('status', b, corner);
    if (w.type === 'status' && icon) anchor.beside = true;
    if (w.type === 'clock_weather' && (icon || status)) anchor.lift = true;
    if (w.type === 'caption') {
      if (icon) anchor.lift = true;
      else if (status) anchor.statusLift = true;
    }
    return { ...w, anchor };
  });
  return { cols: arr.cols, rows: arr.rows, widgets };
}

// ---- pages ----

/**
 * The pages the frame shows: `layout.pages`, or (none saved yet: every config before Phase 13) one
 * built-in page from `layout.preset`.
 */
export function layoutPages(layout) {
  if (layout && Array.isArray(layout.pages) && layout.pages.length) return layout.pages;
  const preset = layout && PRESETS.includes(layout.preset) ? layout.preset : 'hybrid';
  return [{ id: 'home', name: PRESET_NAMES[preset], preset }];
}

/** The home page: `layout.home`, else the first page. */
export function homePage(layout) {
  const pages = layoutPages(layout);
  return pages.find((p) => p.id === layout.home) || pages[0];
}

// Page list changes (Settings → Layout). Each returns { pages, home } to save as `layout`; the first
// change turns the implicit page of an old config into a stored one (keeping its id "home").

function pagesOf(layout) {
  return layoutPages(layout).map((p) => ({ ...p }));
}

/** A free page id: p1, p2, … */
export function newPageId(pages) {
  for (let i = 1; ; i++) if (!pages.some((p) => p.id === `p${i}`)) return `p${i}`;
}

/** `name`, or "name 2", "name 3", … if another page already has it. */
export function uniquePageName(pages, name, exceptId) {
  const taken = (n) => pages.some((p) => p.id !== exceptId && p.name.toLowerCase() === n.toLowerCase());
  const base = name.trim().slice(0, MAX_NAME) || 'Page';
  if (!taken(base)) return base;
  for (let i = 2; ; i++) {
    const n = `${base.slice(0, MAX_NAME - String(i).length - 1)} ${i}`;
    if (!taken(n)) return n;
  }
}

/**
 * Adds a page at the end: built-in from a preset, or 'blank' (a custom page with nothing on it yet, for
 * the layout editor). Returns null when the frame already has MAX_PAGES.
 */
export function addPage(layout, preset, name) {
  const pages = pagesOf(layout);
  if (pages.length >= MAX_PAGES) return null;
  const id = newPageId(pages);
  let page;
  if (preset === 'blank') {
    page = blankPage(id, uniquePageName(pages, name || 'New page'));
  } else {
    const p = PRESETS.includes(preset) ? preset : 'hybrid';
    page = { id, name: uniquePageName(pages, name || PRESET_NAMES[p]), preset: p };
  }
  return { pages: [...pages, page], home: homePage(layout).id };
}

/** Removes a page (never the last one); the home page passes to the first page left. */
export function removePage(layout, id) {
  const pages = pagesOf(layout).filter((p) => p.id !== id);
  if (!pages.length || pages.length === layoutPages(layout).length) return null;
  const home = homePage(layout).id;
  return { pages, home: pages.some((p) => p.id === home) ? home : pages[0].id };
}

/** Moves a page `delta` places (−1 up, +1 down), clamped to the list. */
export function movePage(layout, id, delta) {
  const pages = pagesOf(layout);
  const i = pages.findIndex((p) => p.id === id);
  const j = Math.max(0, Math.min(pages.length - 1, i + delta));
  if (i < 0 || i === j) return null;
  const [p] = pages.splice(i, 1);
  pages.splice(j, 0, p);
  return { pages, home: homePage(layout).id };
}

/** Changes a page's name and (built-in pages) its preset. */
export function editPage(layout, id, { name, preset }) {
  const pages = pagesOf(layout);
  const p = pages.find((x) => x.id === id);
  if (!p) return null;
  if (name !== undefined) p.name = uniquePageName(pages, name, id);
  if (preset !== undefined && p.preset && PRESETS.includes(preset)) p.preset = preset;
  return { pages, home: homePage(layout).id };
}

/** An empty custom page (the layout editor's "Start from blank"). */
export function blankPage(id, name) {
  const empty = () => ({ cols: GRID.cols, rows: GRID.rows, widgets: [] });
  return { id, name, landscape: empty(), portrait: empty() };
}

/** What Settings → Layout shows as your layout: the home page's preset, or 'custom'. */
export function layoutChoice(layout) {
  return homePage(layout).preset || 'custom';
}

/**
 * Your layout (the home page) becomes a preset, or the remembered custom layout ('custom'). A custom
 * layout being replaced is remembered in `custom` (user decision 2026-10-16: one tap switches back).
 * Returns { preset, pages, home, custom } to save as `layout`, or null ('custom' with none remembered).
 */
export function chooseLayout(layout, choice) {
  const pages = pagesOf(layout);
  const home = homePage(layout);
  const i = pages.findIndex((p) => p.id === home.id);
  const cur = pages[i];
  const copy = (x) => JSON.parse(JSON.stringify(x));
  let custom = layout.custom || null;
  if (!cur.preset) custom = { landscape: copy(cur.landscape), portrait: copy(cur.portrait) };
  // A name that only said what the layout was follows the new one; a name the user gave stays.
  const generic = [...Object.values(PRESET_NAMES), 'Custom'].includes(cur.name);
  if (choice === 'custom') {
    if (!custom) return null;
    pages[i] = { id: cur.id, name: generic ? 'Custom' : cur.name, landscape: copy(custom.landscape), portrait: copy(custom.portrait) };
    return { preset: layout.preset, pages, home: home.id, custom };
  }
  if (!PRESETS.includes(choice)) return null;
  pages[i] = { id: cur.id, name: generic ? PRESET_NAMES[choice] : cur.name, preset: choice };
  return { preset: choice, pages, home: home.id, custom };
}

/** Puts an edited page (same id) in place of the stored one; a built-in page becomes custom. */
export function replacePage(layout, page) {
  const pages = pagesOf(layout);
  const i = pages.findIndex((p) => p.id === page.id);
  if (i < 0) return null;
  pages[i] = page;
  return { pages, home: homePage(layout).id };
}

export function setHomePage(layout, id) {
  const pages = pagesOf(layout);
  return pages.some((p) => p.id === id) ? { pages, home: id } : null;
}

/** Page `id`, or the home page if there is none by that id (deleted meanwhile, or null). */
export function findPage(layout, id) {
  return layoutPages(layout).find((p) => p.id === id) || homePage(layout);
}

/**
 * A page as the renderer shows it: { id, name, preset ('custom' for custom pages), landscape, portrait },
 * both arrangements resolved. `opts` as for presetArrangements: built-in pages follow the clock and caption
 * settings; custom pages keep their own corners but leave out a clock or caption with nothing to show,
 * and always get the status icons (SPEC §13: warnings never disappear).
 */
export function pageView(page, opts = {}) {
  if (page.preset) return { ...presetPage(page.preset, opts), id: page.id, name: page.name };
  const capVisible = !!(opts.caption && opts.caption.visible);
  const prepare = (arr) => {
    let widgets = arr.widgets.filter((w) => !(w.type === 'clock_weather' && opts.clockVisible === false) &&
      !(w.type === 'caption' && !capVisible));
    if (!widgets.some((w) => w.type === 'status')) {
      const photo = widgets.find((w) => w.type === 'photo' && !w.anchor);
      widgets = [...widgets, { id: 'status', type: 'status', anchor: { corner: 'bottom-left', ...(photo ? { over: photo.id } : {}) } }];
    }
    return resolveArrangement({ cols: arr.cols, rows: arr.rows, widgets });
  };
  return { id: page.id, name: page.name, preset: 'custom', landscape: prepare(page.landscape), portrait: prepare(page.portrait) };
}

/** A new custom page copied from a preset, on the 12 × 24 grid. `opts` as for presetArrangements. */
export function customFromPreset(preset, opts, id, name) {
  const p = presetArrangements(preset, { ...opts, clockVisible: true, caption: { visible: true, corner: opts && opts.caption ? opts.caption.corner : 'bottom-left' } });
  const scale = (arr) => {
    const k = GRID.rows / arr.rows;
    return {
      cols: GRID.cols, rows: GRID.rows,
      widgets: arr.widgets.map((w) => (w.anchor ? { ...w, anchor: { ...w.anchor } } : { ...w, y: w.y * k, h: w.h * k })),
    };
  };
  return { id, name, landscape: scale(p.landscape), portrait: scale(p.portrait) };
}

export function arrangementFor(page, portrait) {
  return portrait ? page.portrait : page.landscape;
}

/** Whether an arrangement holds a widget of `type`. */
export function hasWidget(arr, type) {
  return arr.widgets.some((w) => w.type === type);
}

/** Box of a grid widget as fractions of the page: { left, top, width, height } in 0..1. */
export function gridBox(widget, arr) {
  return {
    left: widget.x / arr.cols,
    top: widget.y / arr.rows,
    width: widget.w / arr.cols,
    height: widget.h / arr.rows,
  };
}

/** Box an anchored overlay is placed in: its `over` widget's box, else the whole page. */
export function anchorBox(widget, arr) {
  const over = widget.anchor.over && arr.widgets.find((w) => w.id === widget.anchor.over && !w.anchor);
  return over ? gridBox(over, arr) : { left: 0, top: 0, width: 1, height: 1 };
}

/** Problems with an arrangement (empty = valid). Used by the tests and logged by the renderer. */
export function validateArrangement(arr) {
  const problems = [];
  const ids = new Set();
  const grid = [];
  for (const w of arr.widgets) {
    if (ids.has(w.id)) problems.push(`duplicate id ${w.id}`);
    ids.add(w.id);
    if (w.anchor) {
      if (!CORNERS.includes(w.anchor.corner)) problems.push(`${w.id}: bad corner ${w.anchor.corner}`);
      if (w.anchor.over && !arr.widgets.some((o) => o.id === w.anchor.over && !o.anchor)) {
        problems.push(`${w.id}: anchored over missing widget ${w.anchor.over}`);
      }
      continue;
    }
    if (![w.x, w.y, w.w, w.h].every(Number.isInteger) || w.w < 1 || w.h < 1 ||
        w.x < 0 || w.y < 0 || w.x + w.w > arr.cols || w.y + w.h > arr.rows) {
      problems.push(`${w.id}: outside the ${arr.cols}×${arr.rows} grid`);
    }
    for (const o of grid) {
      if (w.x < o.x + o.w && o.x < w.x + w.w && w.y < o.y + o.h && o.y < w.y + w.h) {
        problems.push(`${w.id} overlaps ${o.id}`);
      }
    }
    grid.push(w);
  }
  return problems;
}

/**
 * Problems with a stored custom arrangement, beyond validateArrangement: the 12 × 24 grid, known widget
 * types placed the way they can be shown, one photo / caption / status / full calendar / calendar icon.
 * Mirrors the shell's check (LayoutPages.kt), which is what actually guards config.json.
 */
export function validateCustomArrangement(arr, where = 'arrangement') {
  if (!arr || typeof arr !== 'object' || !Array.isArray(arr.widgets)) return [`${where}: needs a list of widgets`];
  const problems = [];
  if (arr.cols !== GRID.cols || arr.rows !== GRID.rows) problems.push(`${where}: the grid must be ${GRID.cols}×${GRID.rows}`);
  if (arr.widgets.length > MAX_WIDGETS) problems.push(`${where}: at most ${MAX_WIDGETS} widgets`);
  const count = {};
  for (const w of arr.widgets) {
    const name = `${where}: ${w && w.id}`;
    if (!w || typeof w.id !== 'string' || !WIDGET_ID.test(w.id)) { problems.push(`${where}: bad widget id ${w && w.id}`); continue; }
    if (!WIDGET_TYPES.includes(w.type)) { problems.push(`${name}: unknown type ${w.type}`); continue; }
    count[w.type] = (count[w.type] || 0) + 1;
    if (ANCHORED.has(w.type) && !w.anchor) problems.push(`${name}: a ${w.type} must sit in a corner`);
    if (GRIDDED.has(w.type) && w.anchor) problems.push(`${name}: a ${w.type} needs a box on the grid`);
    if (w.type === 'clock_weather' && w.style !== (w.anchor ? 'overlay' : 'panel')) {
      problems.push(`${name}: a clock in a corner is an overlay, on the grid a panel`);
    }
    if (w.type === 'calendar_day' && w.days !== undefined && !(Number.isInteger(w.days) && w.days >= 1 && w.days <= MAX_DAYS)) {
      problems.push(`${name}: days must be 1 to ${MAX_DAYS}`);
    }
  }
  for (const t of SINGLE) if (count[t] > 1) problems.push(`${where}: only one ${t} per page`);
  return problems.concat(validateArrangement(arr).map((p) => `${where}: ${p}`));
}

/** Problems with `layout.pages` / `layout.home` (empty = valid). */
export function validatePages(pages, home = '') {
  if (!Array.isArray(pages)) return ['layout.pages must be a list'];
  const problems = [];
  if (pages.length > MAX_PAGES) problems.push(`At most ${MAX_PAGES} pages`);
  const ids = new Set();
  pages.forEach((p, i) => {
    const where = `page ${i + 1}`;
    if (!p || typeof p.id !== 'string' || !PAGE_ID.test(p.id)) { problems.push(`${where}: bad id`); return; }
    if (ids.has(p.id)) problems.push(`${where}: id ${p.id} is used twice`);
    ids.add(p.id);
    if (typeof p.name !== 'string' || !p.name.trim() || p.name.length > MAX_NAME) problems.push(`${where}: needs a name of 1–${MAX_NAME} characters`);
    if (p.preset !== undefined) {
      if (!PRESETS.includes(p.preset)) problems.push(`${where}: unknown preset ${p.preset}`);
      if (p.landscape || p.portrait) problems.push(`${where}: a built-in page has no arrangements of its own`);
    } else {
      problems.push(...validateCustomArrangement(p.landscape, `${where} landscape`));
      problems.push(...validateCustomArrangement(p.portrait, `${where} portrait`));
    }
  });
  if (home && !ids.has(home)) problems.push(`layout.home: no page ${home}`);
  return problems;
}
