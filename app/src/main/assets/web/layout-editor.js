// Layout editor (SPEC §14, Phase 13c): edits one page's arrangement for the orientation on screen, over
// the real widgets. Tap a widget to select it; drag it to move; drag a corner handle to resize; drag a
// corner widget (clock overlay, caption, calendar button, warning icons) to the corner of the photo or the
// screen it should sit in. Moves are drawn as outlines and applied to the real widgets on release.
// The math lives in lib/editor-core.js.

import {
  WIDGET_LABELS, ADDABLE, minCells, moveWidget, resizeWidget, cannotAdd, addWidget, removeWidget,
  placeInCorner, cornerAt, toggleClockStyle, setDays, belowMinimum, daysThatFit,
} from './lib/editor-core.js';
import { anchorBox, MAX_DAYS, CORNERS, resolveArrangement } from './lib/layout-core.js';

const DRAG_START_PX = 8; // a touch that moves less than this is a tap
const HANDLES = ['nw', 'ne', 'sw', 'se'];
// The sample photo's shapes (user request: a still test card with its ratio, landscape and portrait).
const SAMPLES = [['4:3', 4 / 3], ['3:4', 3 / 4], ['16:9', 16 / 9], ['9:16', 9 / 16]];

/** Places a corner chip (or a drop target) inside `corner` of `box` (fractions of the page). */
function putInCorner(node, corner, box) {
  if (corner.endsWith('right')) node.style.right = `${(1 - box.left - box.width) * 100}%`; else node.style.left = `${box.left * 100}%`;
  if (corner.startsWith('bottom')) node.style.bottom = `${(1 - box.top - box.height) * 100}%`; else node.style.top = `${box.top * 100}%`;
}

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

function button(label, cls, onClick) {
  const b = el('button', `le-btn ${cls || ''}`);
  b.type = 'button';
  b.textContent = label;
  b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
  return b;
}

export class LayoutEditor {
  /**
   * @param {object} o
   * @param {HTMLElement} o.pageEl the page the widgets are drawn in
   * @param {object} o.page the page being edited (custom: { id, name, landscape, portrait }); a copy is kept
   * @param {() => boolean} o.portrait which arrangement is on screen
   * @param {(page) => void} o.onDraft shows the draft with the real widgets
   * @param {(page) => Promise} o.onSave saves the page (rejects with a readable message)
   * @param {() => void} o.onClose the editor closed (saved or not)
   * @param {number} o.inactivityMs closes without saving after no touch for this long
   * @param {(portrait: boolean) => void} [o.setPortrait] phones and PCs (copy of the frame): shows the
   *   Landscape / Portrait switch, which lays the copy out in that orientation; the frame turns instead
   * @param {() => object} [o.sample] the sample photo shown in the photo box ({ ratio, label })
   * @param {(sample) => void} [o.onSample] picks another sample shape
   * @param {() => void} [o.onBarResize] the copy of the frame: the bar is docked at the top and the copy fits below it
   */
  constructor(o) {
    this.o = o;
    this.page = JSON.parse(JSON.stringify(o.page));
    this.dirty = false;
    this.selected = null;
    this.drag = null;

    this.layer = el('div', 'le-layer');
    o.pageEl.append(this.layer);
    this.bar = el('div', `le-bar${o.onBarResize ? ' le-docked' : ''}`);
    document.body.append(this.bar);
    this.layer.addEventListener('pointerdown', (e) => this.down(e));
    this.layer.addEventListener('pointermove', (e) => this.move(e));
    this.layer.addEventListener('pointerup', (e) => this.up(e));
    this.layer.addEventListener('pointercancel', () => this.cancelDrag());
    this.onAnyTouch = () => this.arm();
    document.addEventListener('pointerdown', this.onAnyTouch, true);
    this.arm();
    this.draw();
  }

  get portrait() { return this.o.portrait(); }
  get key() { return this.portrait ? 'portrait' : 'landscape'; }
  get arr() { return this.page[this.key]; }
  set arr(a) { this.page = { ...this.page, [this.key]: a }; }

  /** Viewport of the frame page in CSS px (cells are fractions of it). */
  viewport() {
    return { w: this.o.pageEl.offsetWidth, h: this.o.pageEl.offsetHeight };
  }

  /** Client px per cell (the page may be scaled: copy of the frame on phones). */
  cellPx() {
    const r = this.o.pageEl.getBoundingClientRect();
    return { w: r.width / this.arr.cols, h: r.height / this.arr.rows };
  }

  arm() {
    clearTimeout(this.idle);
    this.idle = setTimeout(() => this.close(), this.o.inactivityMs);
  }

  /** The page was laid out again (rotation, settings): redraw for the arrangement now on screen. */
  refresh() {
    if (this.drag) return; // mid-drag (a settings poll re-rendered): the drop redraws
    if (this.lastKey !== this.key) this.selected = null;
    this.draw();
  }

  change(arr, select) {
    if (!arr) return false;
    this.arr = arr;
    this.dirty = true;
    if (select !== undefined) this.selected = select;
    this.o.onDraft(this.page); // re-renders the widgets, then calls refresh()
    return true;
  }

  // ---- drawing ----

  draw() {
    this.lastKey = this.key;
    const arr = this.arr;
    // The copy of the frame on a phone is drawn small: handles, chips, and labels scale back up to finger
    // size (about 0.7 of the frame's own size on the phone's screen).
    const k = this.o.pageEl.getBoundingClientRect().width / (this.o.pageEl.offsetWidth || 1);
    const s = k >= 0.9 ? 1 : 0.7 / k;
    this.layer.style.setProperty('--le-s', String(s));
    this.bar.classList.toggle('le-phone', s !== 1);
    const small = new Set(belowMinimum(arr, this.viewport()));
    this.layer.innerHTML = '';
    for (const w of arr.widgets) {
      if (w.anchor) continue;
      const b = el('div', `le-box${w.id === this.selected ? ' on' : ''}${small.has(w.id) ? ' small' : ''}`);
      b.dataset.id = w.id;
      this.place(b, w);
      // Calendars show their date heading at the top: their label goes to the bottom (SPEC §14).
      const low = w.type === 'calendar_day' || w.type === 'calendar_full';
      b.append(el('span', `le-label${low ? ' low' : ''}`, WIDGET_LABELS[w.type] || w.type));
      if (w.id === this.selected) {
        for (const h of HANDLES) {
          const hd = el('div', `le-handle ${h}`);
          hd.dataset.handle = h;
          b.append(hd);
        }
      }
      this.layer.append(b);
    }
    const stacked = {}; // chips sharing a corner of the same box stack toward the middle
    for (const w of arr.widgets) {
      if (!w.anchor) continue;
      const spot = `${w.anchor.over || ''}/${w.anchor.corner}`;
      const n = stacked[spot] = (stacked[spot] || 0) + 1;
      const c = el('div', `le-chip ${w.anchor.corner}${w.id === this.selected ? ' on' : ''}`);
      c.style.marginTop = c.style.marginBottom = `${(14 + (n - 1) * 64) * s}px`;
      c.dataset.id = w.id;
      const box = anchorBox(w, arr);
      putInCorner(c, w.anchor.corner, box); // inside the corner of its box, like the widget itself
      c.textContent = WIDGET_LABELS[w.type] || w.type;
      this.layer.append(c);
    }
    // A chip on a resize handle moves sideways past it, so both can be grabbed.
    const handles = [...this.layer.querySelectorAll('.le-handle')].map((h) => h.getBoundingClientRect());
    for (const c of this.layer.querySelectorAll('.le-chip')) {
      const r = c.getBoundingClientRect();
      if (handles.some((h) => r.left < h.right && h.left < r.right && r.top < h.bottom && h.top < r.bottom)) {
        c.style.marginLeft = c.style.marginRight = `${78 * s}px`;
      }
    }
    this.drawBar();
  }

  place(node, box) {
    const a = this.arr;
    node.style.left = `${(box.x / a.cols) * 100}%`;
    node.style.top = `${(box.y / a.rows) * 100}%`;
    node.style.width = `${(box.w / a.cols) * 100}%`;
    node.style.height = `${(box.h / a.rows) * 100}%`;
  }

  drawBar() {
    const bar = this.bar;
    bar.innerHTML = '';
    const w = this.arr.widgets.find((x) => x.id === this.selected);
    const head = el('div', 'le-head');
    const title = el('b');
    title.textContent = this.page.name;
    head.append(title);
    if (this.o.setPortrait) {
      const seg = el('div', 'le-seg');
      for (const [label, p] of [['Landscape', false], ['Portrait', true]]) {
        seg.append(button(label, this.portrait === p ? 'on' : '', () => { if (this.portrait !== p) this.o.setPortrait(p); }));
      }
      head.append(seg);
    } else {
      const sub = el('span');
      sub.textContent = this.portrait ? 'Portrait · turn the frame to edit landscape' : 'Landscape · turn the frame to edit portrait';
      head.append(sub);
    }
    bar.append(head);

    const tools = el('div', 'le-tools');
    if (w) {
      const name = el('span', 'le-sel');
      name.textContent = WIDGET_LABELS[w.type] || w.type;
      tools.append(name);
      if (w.type === 'calendar_day') {
        const label = el('span', 'le-note');
        label.textContent = 'Days:';
        tools.append(label);
        for (let d = 1; d <= MAX_DAYS; d++) {
          tools.append(button(String(d), (w.days || 1) === d ? 'on' : '', () => this.change(setDays(this.arr, w.id, d))));
        }
        const fits = daysThatFit(w.w, this.viewport());
        if ((w.days || 1) > fits) {
          const n = el('span', 'le-note');
          n.textContent = `Shows ${fits} at this width: make it wider for more`;
          tools.append(n);
        }
      }
      if (w.type === 'photo' && this.o.onSample) {
        const label = el('span', 'le-note');
        label.textContent = 'Sample photo:';
        tools.append(label);
        const cur = this.o.sample();
        for (const [name, ratio] of SAMPLES) {
          tools.append(button(name, cur && cur.label === name ? 'on' : '', () => { this.o.onSample({ ratio, label: name }); this.drawBar(); }));
        }
      }
      if (w.anchor) {
        const n = el('span', 'le-note');
        n.textContent = 'Drag it to a corner of the photo or the screen';
        tools.append(n);
      }
      if (w.type === 'clock_weather') {
        tools.append(button(w.anchor ? 'Make it a panel' : 'Put it in a corner', '', () => {
          if (!this.change(toggleClockStyle(this.arr, w.id, this.viewport()))) this.say('No room for a panel: make another widget smaller first');
        }));
      }
      if (w.type !== 'status') {
        tools.append(button('Remove', 'danger', () => this.change(removeWidget(this.arr, w.id), null)));
      } else {
        const n = el('span', 'le-note');
        n.textContent = 'Always on the page';
        tools.append(n);
      }
    } else {
      const n = el('span', 'le-note');
      n.textContent = 'Tap a widget to change it, drag to move. Tap the photo to pick the sample\'s shape.';
      tools.append(n);
    }
    bar.append(tools);

    const actions = el('div', 'le-actions');
    actions.append(
      button('Add', 'add', () => this.openAdd()),
      button('Cancel', '', () => this.cancel()),
      button('Save', 'primary', () => this.save()),
    );
    bar.append(actions);
    this.msg = el('div', 'le-msg');
    this.msg.hidden = true;
    bar.append(this.msg);

    this.placeBar();
  }

  /** Top or bottom of the screen, whichever covers less of the corner chips and the resize handles. */
  /** Height the docked bar takes at the top of the screen (0 when not docked). */
  barHeight() {
    return this.o.onBarResize ? this.bar.offsetHeight : 0;
  }

  placeBar() {
    if (this.o.onBarResize) {
      // Docked: when its height changes, the copy of the frame is fitted again below it, then redrawn.
      const h = this.bar.offsetHeight;
      if (h !== this.lastBarH) { this.lastBarH = h; this.o.onBarResize(); this.draw(); }
      return;
    }
    const avoid = [...this.layer.querySelectorAll('.le-chip, .le-handle')].map((e) => e.getBoundingClientRect());
    const covered = () => {
      const b = this.bar.getBoundingClientRect();
      return avoid.reduce((s, a) => s + Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
        Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)), 0);
    };
    this.bar.classList.remove('bottom');
    const top = covered();
    if (!top) return;
    this.bar.classList.add('bottom');
    if (covered() > top) this.bar.classList.remove('bottom');
  }

  say(text) {
    this.msg.textContent = text;
    this.msg.hidden = false;
    clearTimeout(this.msgTimer);
    this.msgTimer = setTimeout(() => { this.msg.hidden = true; }, 5000);
  }

  // ---- touch ----

  down(e) {
    const handle = e.target.closest('.le-handle');
    const target = e.target.closest('.le-box, .le-chip');
    if (!target) { if (this.selected) { this.selected = null; this.draw(); } return; }
    const id = target.dataset.id;
    const w = this.arr.widgets.find((x) => x.id === id);
    if (!w) return;
    e.preventDefault();
    try { this.layer.setPointerCapture(e.pointerId); } catch (err) { /* not an active pointer (scripted test) */ }
    this.drag = {
      id, node: target, handle: handle ? handle.dataset.handle : null, chip: !!w.anchor,
      x0: e.clientX, y0: e.clientY, moved: false,
      start: w.anchor ? null : { x: w.x, y: w.y, w: w.w, h: w.h }, last: null, arr: this.arr,
    };
    if (w.anchor) this.showTargets(target);
  }

  /** Page scale on screen (1 on the frame; the copy of the frame on a phone is smaller). */
  scale() {
    return this.o.pageEl.getBoundingClientRect().width / (this.o.pageEl.offsetWidth || 1);
  }

  /** While a corner widget is held: every corner it can go to, the one it would land in highlighted. */
  showTargets(chip) {
    this.hideTargets();
    const boxes = [{ over: null, box: { left: 0, top: 0, width: 1, height: 1 } }];
    for (const w of this.arr.widgets) {
      if (w.type === 'photo' && !w.anchor) boxes.push({ over: w.id, box: { left: w.x / this.arr.cols, top: w.y / this.arr.rows, width: w.w / this.arr.cols, height: w.h / this.arr.rows } });
    }
    const size = [chip.offsetWidth, chip.offsetHeight];
    const near = 60 / (this.o.pageEl.offsetWidth || 1608); // a screen corner this close to a photo corner is left out
    const photoCorner = (corner, b) => [corner.endsWith('right') ? b.left + b.width : b.left, corner.startsWith('bottom') ? b.top + b.height : b.top];
    this.targets = [];
    this.alias = {}; // a screen corner left out → the photo corner next to it, where a drop there lands
    for (const { over, box } of boxes) {
      for (const corner of CORNERS) {
        const twin = !over && boxes.slice(1).find((p) => {
          const [x, y] = photoCorner(corner, p.box);
          const [sx, sy] = photoCorner(corner, box);
          return Math.abs(x - sx) < near && Math.abs(y - sy) < near * 1.8;
        });
        if (twin) { this.alias[`/${corner}`] = { corner, over: twin.over }; continue; }
        const t = el('div', 'le-target');
        putInCorner(t, corner, box);
        t.style.width = `${size[0]}px`;
        t.style.height = `${size[1]}px`;
        t.dataset.spot = `${over || ''}/${corner}`;
        this.layer.append(t); // above the other chips (the held one is above all)
        this.targets.push(t);
      }
    }
    this.bar.classList.add('le-faded'); // the bottom targets show through the toolbar
  }

  hideTargets() {
    (this.targets || []).forEach((t) => t.remove());
    this.targets = [];
    this.bar.classList.remove('le-faded');
  }

  /** The corner a held corner widget would land in under the finger (as the targets show it). */
  spotAt(e) {
    const r = this.o.pageEl.getBoundingClientRect();
    const spot = cornerAt(this.arr, (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
    return (this.alias && this.alias[`${spot.over || ''}/${spot.corner}`]) || spot;
  }

  move(e) {
    const d = this.drag;
    if (!d) return;
    const dxPx = e.clientX - d.x0;
    const dyPx = e.clientY - d.y0;
    if (!d.moved && Math.hypot(dxPx, dyPx) < DRAG_START_PX) return;
    d.moved = true;
    if (d.chip) {
      d.node.classList.add('dragging');
      // In page px: on a phone the page is drawn smaller, so the chip has to move farther to follow the finger.
      const k = this.scale();
      d.node.style.transform = `translate(${dxPx / k}px, ${dyPx / k}px)`;
      const spot = this.spotAt(e);
      const key = `${spot.over || ''}/${spot.corner}`;
      (this.targets || []).forEach((t) => t.classList.toggle('on', t.dataset.spot === key));
      return;
    }
    const cell = this.cellPx();
    const dx = dxPx / cell.w;
    const dy = dyPx / cell.h;
    const fallback = d.last || d.start;
    const next = d.handle
      ? resizeWidget(d.arr, d.id, d.start, d.handle, dx, dy, minCells(d.arr.widgets.find((x) => x.id === d.id).type, this.viewport()), fallback)
      : moveWidget(d.arr, d.id, d.start, dx, dy, fallback);
    const w = next.widgets.find((x) => x.id === d.id);
    d.last = { x: w.x, y: w.y, w: w.w, h: w.h };
    d.result = next;
    this.place(d.node, d.last);
    d.node.classList.add('dragging');
  }

  up(e) {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    const spot = d.chip && d.moved ? this.spotAt(e) : null;
    this.hideTargets();
    if (!d.moved) { // a tap: select it (or keep it selected)
      if (this.selected !== d.id) { this.selected = d.id; this.draw(); }
      return;
    }
    if (d.chip) {
      let next = placeInCorner(this.arr, d.id, spot.corner, spot.over);
      // The caption keeps clear of clocks: drop it where it will really be, and say why (SPEC §14).
      const w = next && next.widgets.find((x) => x.id === d.id);
      if (w && w.type === 'caption') {
        const real = resolveArrangement(next).widgets.find((x) => x.id === d.id).anchor.corner;
        if (real !== spot.corner) {
          next = placeInCorner(next, d.id, real, spot.over);
          this.say(`A clock is in that corner: the caption goes ${real.replace('-', ' ')}`);
        }
      }
      this.change(next, d.id);
      return;
    }
    if (d.result) this.change(d.result, d.id); else this.draw();
  }

  cancelDrag() {
    this.drag = null;
    this.hideTargets();
    this.draw();
  }

  // ---- add, save, cancel ----

  openAdd() {
    this.closeSheet();
    const veil = el('div', 'le-veil');
    const card = el('div', 'le-sheet');
    const title = el('b');
    title.textContent = 'Add to this page';
    card.append(title);
    for (const type of ADDABLE) {
      const why = cannotAdd(this.arr, type, this.viewport());
      const b = el('button', 'le-add');
      b.type = 'button';
      b.disabled = !!why;
      const name = el('span');
      name.textContent = WIDGET_LABELS[type];
      b.append(name);
      if (why) { const s = el('small'); s.textContent = why; b.append(s); }
      b.addEventListener('click', () => {
        const r = addWidget(this.arr, type, this.viewport());
        this.closeSheet();
        if (r) this.change(r.arr, r.id); else this.say('No room: make another widget smaller first');
      });
      card.append(b);
    }
    const note = el('small', 'le-sheet-note');
    const other = this.o.setPortrait ? 'switch to' : 'turn the frame to add it in';
    note.textContent = this.portrait ? `Adds it in portrait; ${other} landscape to add it there too.` : `Adds it in landscape; ${other} portrait to add it there too.`;
    card.append(note, button('Close', '', () => this.closeSheet()));
    veil.append(card);
    veil.addEventListener('click', (e) => { if (e.target === veil) this.closeSheet(); });
    document.body.append(veil);
    this.sheetEl = veil;
  }

  closeSheet() {
    if (this.sheetEl) { this.sheetEl.remove(); this.sheetEl = null; }
  }

  async save() {
    try {
      await this.o.onSave(this.page);
      this.close();
    } catch (e) {
      this.say(`Not saved: ${e.message}`);
    }
  }

  cancel() {
    if (!this.dirty) { this.close(); return; }
    this.closeSheet();
    const veil = el('div', 'le-veil');
    const card = el('div', 'le-sheet');
    const t = el('b');
    t.textContent = 'Leave without saving?';
    const p = el('span');
    p.textContent = 'Your changes to this page will be lost.';
    const row = el('div', 'le-actions');
    row.append(button('Keep editing', '', () => this.closeSheet()), button('Discard', 'danger', () => this.close()));
    card.append(t, p, row);
    veil.append(card);
    document.body.append(veil);
    this.sheetEl = veil;
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.idle);
    clearTimeout(this.msgTimer);
    document.removeEventListener('pointerdown', this.onAnyTouch, true);
    this.closeSheet();
    this.layer.remove();
    this.bar.remove();
    this.o.onClose();
  }
}
